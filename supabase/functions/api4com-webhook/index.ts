// @ts-nocheck
// Recebe os webhooks da Api4Com (channel-answer / channel-hangup) e registra a
// ligação no lead correspondente (casando pelo número de telefone). Guarda o
// raw_payload para refinarmos com dados reais. Dispara a transcrição da gravação.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const onlyDigits = (s: string) => String(s || "").replace(/\D/g, "");
const last8 = (s: string) => { const d = onlyDigits(s); return d.length >= 8 ? d.slice(-8) : d; };

// Só aceitamos gravações públicas em https e para hosts externos (evita SSRF:
// impede que um payload forjado aponte a URL de gravação para IPs internos /
// metadata, que o transcribe-audio buscaria via fetch server-side).
function isSafePublicHttpsUrl(raw: string): boolean {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
    // IP literais privados / loopback / link-local / metadata.
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
    return true;
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
    const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPA_URL, SR);

    const url = new URL(req.url);
    // Segredo pode vir na query (registro atual) ou no header (mais seguro).
    const secret = req.headers.get("x-webhook-secret") || url.searchParams.get("secret") || "";
    const gw = url.searchParams.get("gw") || "";

    // DIAGNÓSTICO (temporário): registra TODA requisição recebida, mesmo inválida,
    // para confirmar se a Api4Com está de fato chamando o webhook das ligações.
    let rawBody: any = null;
    try {
      const bodyText = await req.clone().text().catch(() => "");
      try { rawBody = JSON.parse(bodyText); } catch { rawBody = { _text: bodyText.slice(0, 2000) }; }
    } catch (_) { /* ignore */ }
    try {
      await admin.from("api4com_webhook_log").insert({
        method: req.method,
        query: url.search,
        user_agent: req.headers.get("user-agent"),
        content_type: req.headers.get("content-type"),
        body: rawBody,
        note: secret ? "com secret" : "SEM secret",
      });
    } catch (_) { /* nunca bloqueia o fluxo por causa do log */ }

    if (!secret) return json({ error: "missing secret" }, 401);

    // Identifica o tenant pela combinação gateway + secret.
    const { data: cfg } = await admin.from("api4com_config")
      .select("tenant_id, webhook_secret, gateway")
      .eq("webhook_secret", secret).maybeSingle();
    if (!cfg || (gw && cfg.gateway && gw !== cfg.gateway)) return json({ error: "unauthorized" }, 401);
    const tenantId = cfg.tenant_id;

    const payload = await req.json().catch(() => ({}));
    // Campos conforme a doc (channel-hangup): caller, called, duration, recordUrl,
    // hangupCause, metadata, startedAt/answeredAt/endedAt. Nomes podem variar por
    // versão — por isso guardamos o raw_payload e lemos de forma tolerante.
    const type = payload.type || payload.event || url.searchParams.get("type") || "channel-hangup";
    const caller = String(payload.caller ?? payload.from ?? payload.src ?? "");
    const called = String(payload.called ?? payload.to ?? payload.dst ?? payload.phone ?? "");
    const durationSeconds = Number(payload.duration ?? payload.billsec ?? payload.durationSeconds ?? 0) || null;
    const recordUrlRaw = payload.recordUrl ?? payload.recording_url ?? payload.record ?? null;
    const hangupCause = payload.hangupCause ?? payload.hangup_cause ?? null;
    const startedAt = payload.startedAt ?? payload.started_at ?? null;
    const answeredAt = payload.answeredAt ?? payload.answered_at ?? null;
    const endedAt = payload.endedAt ?? payload.ended_at ?? null;
    const metaLeadId = payload?.metadata?.leadId ?? payload?.metadata?.entityId ?? payload?.metadata?.lead_id ?? null;
    const callIdVal = payload.callId ?? payload.uniqueid ?? payload.id ?? null;

    // Só registramos no fim da chamada (hangup). channel-answer só confirmamos.
    if (type === "channel-answer") return json({ ok: true, ignored: "answer" });

    // Só guardamos a URL de gravação se for pública/https (anti-SSRF).
    const recordUrl = recordUrlRaw && isSafePublicHttpsUrl(recordUrlRaw) ? recordUrlRaw : null;

    // Descobre o número do LEAD (o que não é ramal curto). Ramal costuma ter <=6 dígitos.
    const callerDigits = onlyDigits(caller), calledDigits = onlyDigits(called);
    const leadNumber = calledDigits.length >= 8 ? called : (callerDigits.length >= 8 ? caller : called);
    const direction = calledDigits.length >= 8 ? "outbound" : "inbound";

    // Casa o lead. Preferimos o entityId do metadata (mas validando que é do tenant).
    // Caso contrário, casamos pelos últimos 8 dígitos ANCORADOS no fim do telefone,
    // e só aceitamos quando há EXATAMENTE um candidato (evita atribuir ao lead errado).
    let leadId: string | null = null;
    if (metaLeadId) {
      const { data: ml } = await admin.from("crm_leads")
        .select("id").eq("tenant_id", tenantId).eq("id", metaLeadId).maybeSingle();
      leadId = ml?.id ?? null;
    }
    if (!leadId && leadNumber) {
      const l8 = last8(leadNumber);
      if (l8.length >= 8) {
        // Busca candidatos que contenham os 8 dígitos e confirma no lado do servidor
        // que o telefone (só dígitos) TERMINA com eles. Ambíguo (>1) => não atribui.
        const { data: cands } = await admin.from("crm_leads")
          .select("id, phone").eq("tenant_id", tenantId).ilike("phone", `%${l8}%`).limit(10);
        const matches = (cands || []).filter((c: any) => onlyDigits(c.phone).endsWith(l8));
        if (matches.length === 1) leadId = matches[0].id;
      }
    }

    const status = hangupCause === "NORMAL_CLEARING" && durationSeconds ? "answered"
      : (answeredAt ? "answered" : "no-answer");

    // Dedup: a Api4Com pode reenviar o mesmo channel-hangup (retry/timeout). Se já
    // registramos essa call_id no tenant, respondemos ok sem duplicar.
    if (callIdVal) {
      const { data: existing } = await admin.from("api4com_calls")
        .select("id").eq("tenant_id", tenantId).eq("call_id", callIdVal).maybeSingle();
      if (existing?.id) return json({ ok: true, call_id: existing.id, deduped: true, lead_matched: null });
    }

    const { data: inserted, error: insErr } = await admin.from("api4com_calls").insert({
      tenant_id: tenantId,
      lead_id: leadId,
      call_id: callIdVal,
      from_phone: caller || null,
      to_phone: called || null,
      direction,
      status,
      hangup_cause: hangupCause,
      duration_seconds: durationSeconds,
      recording_url: recordUrl,
      started_at: startedAt,
      answered_at: answeredAt,
      ended_at: endedAt,
      raw_payload: payload,
    }).select("id").single();
    if (insErr) {
      // 23505 = corrida com um reenvio simultâneo (unique parcial em tenant+call_id).
      if (insErr.code === "23505") return json({ ok: true, deduped: true, lead_matched: !!leadId });
      return json({ error: insErr.message }, 500);
    }

    // Dispara transcrição da gravação em SEGUNDO PLANO (não trava a resposta ao
    // provedor — reduz timeout/retry e, com ele, duplicidade). A rede de segurança
    // (cron transcribe-pending-audios) reprocessa se isto falhar.
    if (recordUrl && inserted?.id) {
      const fire = async () => {
        try {
          const r = await fetch(`${SUPA_URL}/functions/v1/transcribe-audio`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SR}`, apikey: SR },
            body: JSON.stringify({ api4com_call_id: inserted.id }),
          });
          if (!r.ok) console.warn(`[api4com-webhook] transcribe-audio ${r.status} p/ call ${inserted.id} — cron reprocessa`);
        } catch (e: any) {
          console.warn(`[api4com-webhook] transcribe-audio falhou p/ call ${inserted.id}: ${e?.message} — cron reprocessa`);
        }
      };
      try {
        const rt = (globalThis as any).EdgeRuntime;
        if (rt?.waitUntil) rt.waitUntil(fire()); else fire();
      } catch { fire(); }
    }

    return json({ ok: true, call_id: inserted?.id, lead_matched: !!leadId });
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
