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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
    const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPA_URL, SR);

    const url = new URL(req.url);
    const secret = url.searchParams.get("secret") || "";
    const gw = url.searchParams.get("gw") || "";
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
    const recordUrl = payload.recordUrl ?? payload.recording_url ?? payload.record ?? null;
    const hangupCause = payload.hangupCause ?? payload.hangup_cause ?? null;
    const startedAt = payload.startedAt ?? payload.started_at ?? null;
    const answeredAt = payload.answeredAt ?? payload.answered_at ?? null;
    const endedAt = payload.endedAt ?? payload.ended_at ?? null;
    const metaLeadId = payload?.metadata?.entityId ?? payload?.metadata?.lead_id ?? null;

    // Só registramos no fim da chamada (hangup). channel-answer só confirmamos.
    if (type === "channel-answer") return json({ ok: true, ignored: "answer" });

    // Descobre o número do LEAD (o que não é ramal curto). Ramal costuma ter <=6 dígitos.
    const callerDigits = onlyDigits(caller), calledDigits = onlyDigits(called);
    const leadNumber = calledDigits.length >= 8 ? called : (callerDigits.length >= 8 ? caller : called);
    const direction = calledDigits.length >= 8 ? "outbound" : "inbound";

    // Casa o lead pelo final do número (últimos 8 dígitos), no tenant.
    let leadId = metaLeadId;
    if (!leadId && leadNumber) {
      const l8 = last8(leadNumber);
      const { data: lead } = await admin.from("crm_leads")
        .select("id").eq("tenant_id", tenantId)
        .ilike("phone", `%${l8}%`).limit(1).maybeSingle();
      leadId = lead?.id ?? null;
    }

    const status = hangupCause === "NORMAL_CLEARING" && durationSeconds ? "answered"
      : (answeredAt ? "answered" : "no-answer");

    const { data: inserted, error: insErr } = await admin.from("api4com_calls").insert({
      tenant_id: tenantId,
      lead_id: leadId,
      call_id: payload.callId ?? payload.uniqueid ?? payload.id ?? null,
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
    if (insErr) return json({ error: insErr.message }, 500);

    // Dispara transcrição da gravação (best-effort).
    if (recordUrl && inserted?.id) {
      try {
        await fetch(`${SUPA_URL}/functions/v1/transcribe-audio`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SR}`, apikey: SR },
          body: JSON.stringify({ api4com_call_id: inserted.id }),
        });
      } catch (_) { /* ignore */ }
    }

    return json({ ok: true, call_id: inserted?.id, lead_matched: !!leadId });
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
