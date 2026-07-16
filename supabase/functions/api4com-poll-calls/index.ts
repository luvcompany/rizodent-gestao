// @ts-nocheck
// Rede de segurança da telefonia Api4Com: puxa periodicamente as ligações da conta
// (GET /api/v1/calls) — INCLUSIVE as discadas manualmente na extensão, que NÃO
// disparam o webhook — e importa para api4com_calls (casando o lead pelo telefone).
// O webhook (chamadas via /dialer) continua sendo o caminho em tempo real; este cron
// reconcilia o resto. Auth interna (cron secret / service role).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { authorizeInternal, unauthorizedResponse } from "../_shared/internalAuth.ts";

const API4COM_BASE = "https://api.api4com.com/api/v1";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const onlyDigits = (s: string) => String(s || "").replace(/\D/g, "");
const last8 = (s: string) => { const d = onlyDigits(s); return d.length >= 8 ? d.slice(-8) : d; };

function isSafePublicHttpsUrl(raw: string): boolean {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
    return true;
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPA_URL, SR);

  const auth = await authorizeInternal(req, admin, { cronSecretName: "api4com_poll_cron_token" });
  if (!auth.ok) return unauthorizedResponse(corsHeaders);

  const stats: any = { tenants: 0, fetched: 0, imported: 0, matched: 0, transcribed: 0, errors: [] as string[] };
  try {
    const { data: cfgs } = await admin.from("api4com_config")
      .select("tenant_id, api_token").not("api_token", "is", null);

    for (const cfg of cfgs || []) {
      stats.tenants++;
      try {
        // Página 1, mais recentes primeiro. O dedup por call_id torna sobreposição inofensiva.
        const filter = encodeURIComponent(JSON.stringify({ order: "started_at DESC", limit: 50 }));
        const r = await fetch(`${API4COM_BASE}/calls?page=1&filter=${filter}`, {
          headers: { Authorization: cfg.api_token, "Content-Type": "application/json" },
        });
        if (!r.ok) { stats.errors.push(`tenant ${cfg.tenant_id}: GET /calls HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 160)}`); continue; }
        const jr = await r.json().catch(() => ({}));
        const calls = Array.isArray(jr?.data) ? jr.data : (Array.isArray(jr) ? jr : []);
        stats.fetched += calls.length;

        // Amostra ÚNICA para diagnóstico dos nomes de campo reais (uma vez só).
        try {
          const { count } = await admin.from("api4com_webhook_log").select("id", { count: "exact", head: true }).eq("note", "cdr-poll-sample");
          if (!count && calls.length) await admin.from("api4com_webhook_log").insert({ method: "POLL", note: "cdr-poll-sample", body: calls[0] });
        } catch (_) { /* ignore */ }

        for (const c of calls) {
          const callId = c.id ?? c.uuid ?? null;
          if (!callId) continue;

          const { data: existing } = await admin.from("api4com_calls")
            .select("id").eq("tenant_id", cfg.tenant_id).eq("call_id", String(callId)).maybeSingle();
          if (existing) continue;

          const fromP = String(c.from ?? c.caller ?? "");
          const toP = String(c.to ?? c.called ?? "");
          // O lado com >=8 dígitos é o telefone do lead; o ramal é curto.
          const fromIsExternal = onlyDigits(fromP).length >= 8;
          const toIsExternal = onlyDigits(toP).length >= 8;
          const leadNumber = toIsExternal ? toP : (fromIsExternal ? fromP : toP);
          const direction = toIsExternal ? "outbound" : (fromIsExternal ? "inbound" : (c.direction || "outbound"));

          // Casa o lead: metadata (chamadas via /dialer) tem prioridade; senão, telefone.
          let leadId: string | null = null;
          const metaLead = c?.metadata?.leadId ?? c?.metadata?.lead_id ?? c?.metadata?.entityId ?? null;
          if (metaLead) {
            const { data: ml } = await admin.from("crm_leads").select("id").eq("tenant_id", cfg.tenant_id).eq("id", metaLead).maybeSingle();
            leadId = ml?.id ?? null;
          }
          if (!leadId) {
            const l8 = last8(leadNumber);
            if (l8.length >= 8) {
              const { data: cands } = await admin.from("crm_leads")
                .select("id, phone").eq("tenant_id", cfg.tenant_id).ilike("phone", `%${l8}%`).limit(10);
              const m = (cands || []).filter((x: any) => onlyDigits(x.phone).endsWith(l8));
              if (m.length === 1) leadId = m[0].id;
            }
          }
          if (leadId) stats.matched++;

          const rec = c.record_url && isSafePublicHttpsUrl(c.record_url) ? c.record_url
            : (c.recordUrl && isSafePublicHttpsUrl(c.recordUrl) ? c.recordUrl : null);
          const dur = Number(c.duration ?? c.billsec ?? 0) || null;
          const status = dur && dur > 0 ? "answered" : "no-answer";

          const { data: inserted, error: insErr } = await admin.from("api4com_calls").insert({
            tenant_id: cfg.tenant_id,
            lead_id: leadId,
            call_id: String(callId),
            from_phone: fromP || null,
            to_phone: toP || null,
            direction,
            status,
            hangup_cause: c.hangup_cause ?? c.hangupCause ?? null,
            duration_seconds: dur,
            recording_url: rec,
            started_at: c.started_at ?? c.startedAt ?? null,
            ended_at: c.ended_at ?? c.endedAt ?? null,
            answered_at: c.answered_at ?? c.answeredAt ?? null,
            raw_payload: c,
          }).select("id").single();
          if (insErr) {
            if (insErr.code !== "23505") stats.errors.push(`ins ${callId}: ${insErr.message}`);
            continue;
          }
          stats.imported++;

          if (rec && inserted?.id) {
            try {
              const tr = await fetch(`${SUPA_URL}/functions/v1/transcribe-audio`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${SR}`, apikey: SR },
                body: JSON.stringify({ api4com_call_id: inserted.id }),
              });
              if (tr.ok) stats.transcribed++;
            } catch (_) { /* best-effort; o cron de transcrição pendente reprocessa */ }
          }
        }
      } catch (e: any) {
        stats.errors.push(`tenant ${cfg.tenant_id}: ${String(e?.message ?? e).slice(0, 160)}`);
      }
    }
    return json({ ok: true, ...stats, errors: stats.errors.slice(0, 10) });
  } catch (e: any) {
    return json({ error: String(e?.message ?? e), ...stats }, 500);
  }
});
