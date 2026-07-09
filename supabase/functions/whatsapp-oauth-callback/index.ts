// WhatsApp OAuth callback (redirect-based, sem FB JS SDK).
// Espelha instagram-oauth-callback: valida state, troca code por token,
// descobre WABAs via debug_token, para cada número: subscribed_apps + register (best-effort)
// e upsert em `integrations` com key `whatsapp_es_{phone_number_id}`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const REDIRECT_URI = Deno.env.get("WHATSAPP_REDIRECT_URI") ?? "";
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const FRONTEND_URL = Deno.env.get("FRONTEND_URL") ?? "https://crclin.com.br";
const API_VERSION = "v21.0";

const supabase = createClient(supabaseUrl, serviceRoleKey);

function popupResponse(
  channel: "instagram" | "whatsapp",
  status: "connected" | "error",
  count = 0,
): Response {
  let base = "https://crclin.com.br";
  try {
    base = new URL(FRONTEND_URL || "https://crclin.com.br").origin;
  } catch {
    base = "https://crclin.com.br";
  }
  const qs = new URLSearchParams({ channel, status, count: String(count) });
  return Response.redirect(`${base}/oauth-close?${qs.toString()}`, 302);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  

  if (errorParam) {
    console.error("[wa-oauth-callback] error from Meta:", errorParam, url.searchParams.get("error_description"));
    return popupResponse("whatsapp", "error");
  }
  if (!code || !state) {
    return new Response(JSON.stringify({ error: "Missing code or state" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!META_APP_ID || !META_APP_SECRET || !REDIRECT_URI) {
    console.error("[wa-oauth-callback] Missing META/REDIRECT secrets");
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Valida state
  const { data: stateRow, error: stateErr } = await supabase
    .from("whatsapp_oauth_states")
    .select("tenant_id, user_id, expires_at")
    .eq("state", state)
    .maybeSingle();
  if (stateErr || !stateRow) {
    console.warn("[wa-oauth-callback] invalid state:", state, stateErr);
    return popupResponse("whatsapp", "error");
  }
  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    await supabase.from("whatsapp_oauth_states").delete().eq("state", state);
    return popupResponse("whatsapp", "error");
  }
  const tenantId: string = stateRow.tenant_id;
  await supabase.from("whatsapp_oauth_states").delete().eq("state", state);

  try {
    // 1) Troca code por access_token
    const tokUrl = new URL(`https://graph.facebook.com/${API_VERSION}/oauth/access_token`);
    tokUrl.searchParams.set("client_id", META_APP_ID);
    tokUrl.searchParams.set("client_secret", META_APP_SECRET);
    tokUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    tokUrl.searchParams.set("code", code);
    const tokRes = await fetch(tokUrl.toString());
    const tokJson: any = await tokRes.json().catch(() => ({}));
    if (!tokRes.ok || !tokJson?.access_token) {
      console.error("[wa-oauth-callback] token exchange failed:", tokJson);
      return popupResponse("whatsapp", "error");
    }
    const access_token: string = tokJson.access_token;

    // 2) Descobre WABAs via debug_token
    const appAccessToken = `${META_APP_ID}|${META_APP_SECRET}`;
    const dbgUrl = new URL(`https://graph.facebook.com/${API_VERSION}/debug_token`);
    dbgUrl.searchParams.set("input_token", access_token);
    dbgUrl.searchParams.set("access_token", appAccessToken);
    const dbgRes = await fetch(dbgUrl.toString());
    const dbgJson: any = await dbgRes.json().catch(() => ({}));
    if (!dbgRes.ok) {
      console.error("[wa-oauth-callback] debug_token failed:", dbgJson);
      return popupResponse("whatsapp", "error");
    }
    const granular: Array<{ scope: string; target_ids?: string[] }> = dbgJson?.data?.granular_scopes ?? [];
    const wabaIds = new Set<string>();
    for (const g of granular) {
      if (g.scope === "whatsapp_business_management" || g.scope === "whatsapp_business_messaging") {
        for (const tid of g.target_ids ?? []) wabaIds.add(tid);
      }
    }
    console.log(`[wa-oauth-callback] discovered ${wabaIds.size} WABA(s):`, [...wabaIds]);

    if (wabaIds.size === 0) {
      return popupResponse("whatsapp", "error");
    }

    let connected = 0;
    for (const waba_id of wabaIds) {
      // 3) Assina webhook da WABA
      try {
        const subRes = await fetch(
          `https://graph.facebook.com/${API_VERSION}/${encodeURIComponent(waba_id)}/subscribed_apps`,
          { method: "POST", headers: { Authorization: `Bearer ${access_token}` } },
        );
        if (!subRes.ok) {
          const t = await subRes.text().catch(() => "");
          console.warn(`[wa-oauth-callback] subscribed_apps failed for ${waba_id}:`, subRes.status, t);
        }
      } catch (e) {
        console.warn(`[wa-oauth-callback] subscribed_apps error for ${waba_id}:`, e);
      }

      // 4) Lista números da WABA
      const phRes = await fetch(
        `https://graph.facebook.com/${API_VERSION}/${encodeURIComponent(waba_id)}/phone_numbers?access_token=${encodeURIComponent(access_token)}`,
      );
      const phJson: any = await phRes.json().catch(() => ({}));
      if (!phRes.ok) {
        console.warn(`[wa-oauth-callback] phone_numbers failed for ${waba_id}:`, phJson);
        continue;
      }
      const numbers: Array<{ id: string; display_phone_number?: string; verified_name?: string }> = phJson?.data ?? [];

      for (const num of numbers) {
        const phone_number_id = num.id;
        const display_name = num.verified_name || num.display_phone_number || `WhatsApp ${phone_number_id.slice(-4)}`;

        // Register (best-effort)
        try {
          const regRes = await fetch(
            `https://graph.facebook.com/${API_VERSION}/${encodeURIComponent(phone_number_id)}/register`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ messaging_product: "whatsapp", pin: "000000" }),
            },
          );
          if (!regRes.ok) {
            const t = await regRes.text().catch(() => "");
            console.warn(`[wa-oauth-callback] register failed for ${phone_number_id}:`, regRes.status, t);
          }
        } catch (e) {
          console.warn(`[wa-oauth-callback] register error for ${phone_number_id}:`, e);
        }

        // Upsert em integrations (não sobrescreve entradas manuais — key distinta)
        const key = `whatsapp_es_${phone_number_id}`;
        const config = {
          access_token,
          token: access_token,
          phone_number_id,
          waba_id,
          app_id: META_APP_ID,
          api_version: API_VERSION,
          display_name,
          webhook_verify_token: WHATSAPP_VERIFY_TOKEN,
          source: "embedded_signup",
        };

        const { data: existing } = await supabase
          .from("integrations")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("key", key)
          .maybeSingle();

        if (existing?.id) {
          const { error: updErr } = await supabase
            .from("integrations")
            .update({ config, status: "connected", updated_at: new Date().toISOString() })
            .eq("id", existing.id);
          if (updErr) console.error("[wa-oauth-callback] update failed", updErr);
          else connected += 1;
        } else {
          const { error: insErr } = await supabase
            .from("integrations")
            .insert({ tenant_id: tenantId, key, config, status: "connected" });
          if (insErr) console.error("[wa-oauth-callback] insert failed", insErr);
          else connected += 1;
        }
      }
    }

    console.log(`[wa-oauth-callback] connected ${connected} number(s) for tenant ${tenantId}`);
    if (connected === 0) {
      return popupResponse("whatsapp", "error");
    }
    return popupResponse("whatsapp", "connected", connected);
  } catch (err) {
    console.error("[wa-oauth-callback] unexpected error:", err);
    return popupResponse("whatsapp", "error");
  }
});
