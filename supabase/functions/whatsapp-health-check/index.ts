// Checa na Meta o estado de cada número de WhatsApp conectado e grava em
// integrations.health_* — usado para pausar envios e mostrar o selo de status.
// Chamado pelo cron (x-cron-secret) a cada 5 min ou pelo botão "Verificar agora".
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeInternal, unauthorizedResponse } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const GRAPH = "https://graph.facebook.com/v25.0";

async function checar(token: string, phoneId: string, wabaId?: string) {
  const r = await fetch(`${GRAPH}/${phoneId}?fields=status,quality_rating,messaging_limit_tier,code_verification_status,name_status,display_phone_number`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = String(d?.error?.code ?? r.status);
    const reason = code === "190" ? "Token expirado ou inválido" : `Erro da Meta: ${d?.error?.message ?? r.status}`;
    return { health_status: "error", health_reason: reason, meta_status: null, quality_rating: null };
  }
  const status = String(d.status ?? "").toUpperCase();
  const quality = String(d.quality_rating ?? "").toUpperCase() || null;
  let health = "ok";
  let reason: string | null = null;
  if (["DISCONNECTED", "BANNED", "RESTRICTED", "FLAGGED", "DELETED", "UNVERIFIED", "OFFLINE"].includes(status) || (status && status !== "CONNECTED" && status !== "PENDING")) {
    health = "error";
    reason = status === "BANNED" ? "Número banido pela Meta"
      : status === "RESTRICTED" ? "Conta restrita pela Meta"
      : "Desconectado da Meta";
  } else if (quality === "RED") {
    health = "warning"; reason = "Qualidade baixa (vermelha)";
  } else if (quality === "YELLOW" || status === "FLAGGED") {
    health = "warning"; reason = "Qualidade em alerta (amarela)";
  }
  if (health !== "error" && wabaId) {
    const w = await fetch(`${GRAPH}/${wabaId}?fields=account_review_status,ban_state`, { headers: { Authorization: `Bearer ${token}` } });
    const wd = await w.json().catch(() => ({}));
    if (w.ok && wd?.ban_state && wd.ban_state !== "DEFAULT") {
      health = "error"; reason = "Conta do WhatsApp bloqueada na Meta";
    } else if (w.ok && wd?.account_review_status === "REJECTED") {
      health = "error"; reason = "Conta reprovada na revisão da Meta";
    }
  }
  return { health_status: health, health_reason: reason, meta_status: status || null, quality_rating: quality };
}

// Inscreve o app dono do token na conta do WhatsApp (subscribed_apps), se ainda não estiver.
async function garantirAssinatura(token: string, wabaId: string): Promise<string | null> {
  try {
    const appR = await fetch(`${GRAPH}/app?fields=id`, { headers: { Authorization: `Bearer ${token}` } });
    const app = await appR.json();
    const subR = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, { headers: { Authorization: `Bearer ${token}` } });
    const sub = await subR.json();
    const inscrito = (sub?.data ?? []).some((d: any) => String(d?.whatsapp_business_api_data?.id) === String(app?.id));
    if (inscrito) return null;
    const r = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    return `assinatura de mensagens ${r.ok ? "ativada" : "falhou: " + (await r.text())}`;
  } catch (e) {
    return `assinatura de mensagens falhou: ${e}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const auth = await authorizeInternal(req, supabase, { cronSecretName: "automation_cron_token", allowUserJwt: true });
  if (!auth.ok) return unauthorizedResponse(corsHeaders);

  try {
    let q = supabase.from("integrations").select("id, tenant_id, key, config, status").like("key", "whatsapp_%").neq("status", "disabled");
    if (auth.via === "user_jwt") {
      const { data: prof } = await supabase.from("profiles").select("tenant_id").eq("user_id", auth.userId!).maybeSingle();
      if (prof?.tenant_id) {
        q = q.eq("tenant_id", prof.tenant_id);
      } else {
        // Sem clínica vinculada: só o superadmin (Luv Agency) pode checar todos.
        const { data: isSuper } = await supabase.rpc("has_role", { _user_id: auth.userId!, _role: "superadmin" });
        if (!isSuper) return new Response(JSON.stringify({ ok: true, checked: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    const out: any[] = [];
    for (const row of rows ?? []) {
      const cfg = (row.config ?? {}) as any;
      const token = cfg.access_token || cfg.token;
      if (!token || !cfg.phone_number_id) continue;
      try {
        const res = await checar(token, String(cfg.phone_number_id), cfg.waba_id);
        const extra: Record<string, unknown> = {};
        // Número novo que a Meta já confirma conectado passa a valer sem precisar "Testar".
        if (res.meta_status === "CONNECTED" && row.status === "disconnected") extra.status = "connected";
        // Garante que a conta do WhatsApp entrega as mensagens recebidas para o nosso app.
        if (cfg.waba_id) {
          const assinatura = await garantirAssinatura(token, String(cfg.waba_id));
          if (assinatura) console.log(`[wa-health] ${row.key}: ${assinatura}`);
        }
        await supabase.from("integrations").update({ ...res, ...extra, health_checked_at: new Date().toISOString() }).eq("id", row.id);
        out.push({ key: row.key, ...res });
      } catch (e) {
        console.error(`[wa-health] ${row.key}:`, e);
      }
    }
    return new Response(JSON.stringify({ ok: true, checked: out }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[wa-health]", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
