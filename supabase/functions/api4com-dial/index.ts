// @ts-nocheck
// Click-to-call Api4Com: origina a chamada via POST /api/v1/dialer com o ramal do
// operador + metadata { leadId }. A extensão/webphone toca como "aparelho"; ao
// desligar, o webhook chega em tempo real já com o lead exato (metadata.leadId).
// O token da conta fica no servidor — nunca vai ao frontend.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const API4COM_BASE = "https://api.api4com.com/api/v1";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Api4Com espera o número com DDI. Normaliza para +55DDNNNNNNNNN.
function toE164(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  return "+" + (d.startsWith("55") ? d : "55" + d);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
    const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Não autenticado" }, 401);
    const jwt = auth.slice(7);

    const userClient = createClient(SUPA_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: claims, error: cErr } = await userClient.auth.getClaims(jwt);
    if (cErr || !claims?.claims?.sub) return json({ error: "Não autenticado" }, 401);
    const uid = claims.claims.sub as string;

    const admin = createClient(SUPA_URL, SR);
    const { data: prof } = await admin.from("profiles").select("tenant_id").eq("id", uid).maybeSingle();
    const tenantId = prof?.tenant_id;
    if (!tenantId) return json({ error: "Usuário sem clínica." }, 403);

    const body = await req.json().catch(() => ({}));
    const leadId = body.lead_id as string | undefined;
    let phone = String(body.phone || "");

    // Config da telefonia (token + ramal) — só via service role.
    const { data: cfg } = await admin.from("api4com_config")
      .select("api_token, ramal, connected_at").eq("tenant_id", tenantId).maybeSingle();
    if (!cfg?.api_token || !cfg?.connected_at) return json({ error: "Telefonia não conectada. Conecte em Integrações." }, 400);
    if (!cfg?.ramal) return json({ error: "Ramal não configurado. Defina o ramal em Integrações → Telefonia." }, 400);

    // Resolve o telefone do lead (valida que o lead é do tenant).
    if (leadId) {
      const { data: lead } = await admin.from("crm_leads").select("id, phone").eq("id", leadId).eq("tenant_id", tenantId).maybeSingle();
      if (!lead) return json({ error: "Lead não encontrado nesta clínica." }, 404);
      if (!phone) phone = lead.phone || "";
    }
    const e164 = toE164(phone);
    if (!e164 || e164.replace(/\D/g, "").length < 12) return json({ error: "Número de telefone inválido." }, 400);

    // Origina a chamada. metadata.leadId volta no webhook → casamento exato.
    const res = await fetch(`${API4COM_BASE}/dialer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: cfg.api_token },
      body: JSON.stringify({
        extension: String(cfg.ramal),
        phone: e164,
        metadata: { leadId: leadId ?? null, tenantId, userId: uid, source: "crclin" },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json({ error: "Falha ao iniciar a ligação na Api4Com. (" + (data?.error?.message || data?.message || res.status) + ")" }, 502);
    }
    // O id do /dialer NÃO é o id real da chamada (débito técnico da Api4Com) —
    // o id verdadeiro vem no webhook. Só confirmamos o disparo.
    return json({ ok: true, ramal: String(cfg.ramal) });
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
