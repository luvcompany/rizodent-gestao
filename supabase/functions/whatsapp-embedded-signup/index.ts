// WhatsApp Embedded Signup callback.
// Recebe { code, phone_number_id, waba_id } do frontend após o fluxo FB.login,
// troca por token de negócio, assina o webhook da WABA, tenta registrar o número
// e faz upsert em `integrations` (mesma tabela lida por send-whatsapp-message).
// Aditivo: não altera nenhum fluxo existente.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const API_VERSION = "v21.0";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  if (!META_APP_ID || !META_APP_SECRET) {
    return json({ error: "server_not_configured", detail: "META_APP_ID/SECRET missing" }, 500);
  }

  // Autenticar usuário e resolver tenant.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
  const userId = claimsData?.claims?.sub as string | undefined;
  if (claimsErr || !userId) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: profile } = await admin
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  const tenantId = (profile as any)?.tenant_id;
  if (!tenantId) return json({ error: "no_tenant" }, 400);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const code = String(body?.code || "").trim();
  const phone_number_id = String(body?.phone_number_id || "").trim();
  const waba_id = String(body?.waba_id || "").trim();
  if (!code || !phone_number_id || !waba_id) {
    return json({ error: "missing_fields", detail: "code, phone_number_id, waba_id são obrigatórios" }, 400);
  }

  // 1) Trocar code por access_token de negócio.
  const tokenUrl = new URL(`https://graph.facebook.com/${API_VERSION}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", META_APP_ID);
  tokenUrl.searchParams.set("client_secret", META_APP_SECRET);
  tokenUrl.searchParams.set("code", code);
  const tokenResp = await fetch(tokenUrl.toString());
  const tokenJson: any = await tokenResp.json().catch(() => ({}));
  if (!tokenResp.ok || !tokenJson?.access_token) {
    console.error("[wa-embedded] token exchange failed", tokenJson);
    return json({ error: "token_exchange_failed", detail: tokenJson }, 400);
  }
  const access_token: string = tokenJson.access_token;

  // 2) Assinar app no webhook da WABA.
  try {
    const subResp = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${encodeURIComponent(waba_id)}/subscribed_apps`,
      { method: "POST", headers: { Authorization: `Bearer ${access_token}` } },
    );
    if (!subResp.ok) {
      const t = await subResp.text().catch(() => "");
      console.warn("[wa-embedded] subscribed_apps failed:", subResp.status, t);
    }
  } catch (e) {
    console.warn("[wa-embedded] subscribed_apps error:", e);
  }

  // 3) Register do número (best-effort).
  try {
    const regResp = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${encodeURIComponent(phone_number_id)}/register`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", pin: "000000" }),
      },
    );
    if (!regResp.ok) {
      const t = await regResp.text().catch(() => "");
      console.warn("[wa-embedded] register failed:", regResp.status, t);
    }
  } catch (e) {
    console.warn("[wa-embedded] register error:", e);
  }

  // 4) Descobrir display_name (best-effort).
  let display_name = "";
  try {
    const infoResp = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${encodeURIComponent(phone_number_id)}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${access_token}` } },
    );
    const infoJson: any = await infoResp.json().catch(() => ({}));
    if (infoResp.ok) {
      display_name = infoJson?.verified_name || infoJson?.display_phone_number || "";
    }
  } catch (e) {
    console.warn("[wa-embedded] phone info error:", e);
  }

  // 5) Upsert em `integrations`. Chave única por tenant+phone.
  const key = `whatsapp_es_${phone_number_id}`;
  const config = {
    access_token,
    token: access_token, // compat com send-whatsapp-message que aceita ambos
    phone_number_id,
    waba_id,
    app_id: META_APP_ID,
    api_version: API_VERSION,
    display_name: display_name || `WhatsApp ${phone_number_id.slice(-4)}`,
    webhook_verify_token: WHATSAPP_VERIFY_TOKEN,
    source: "embedded_signup",
  };

  const { data: existing } = await admin
    .from("integrations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("key", key)
    .maybeSingle();

  if (existing?.id) {
    const { error: updErr } = await admin
      .from("integrations")
      .update({ config, status: "connected", updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updErr) {
      console.error("[wa-embedded] update failed", updErr);
      return json({ error: "db_update_failed", detail: updErr.message }, 500);
    }
  } else {
    const { error: insErr } = await admin
      .from("integrations")
      .insert({ tenant_id: tenantId, key, config, status: "connected" });
    if (insErr) {
      console.error("[wa-embedded] insert failed", insErr);
      return json({ error: "db_insert_failed", detail: insErr.message }, 500);
    }
  }

  return json({ success: true, phone_number_id, waba_id, display_name });
});
