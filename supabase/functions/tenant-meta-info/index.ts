// Returns the Meta App credentials info that the current tenant needs to
// configure in Meta Developers (callback URLs + verify tokens). Verify tokens
// are env secrets, so we expose them only to authenticated users of that
// tenant.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes } = await userClient.auth.getUser();
  const user = userRes?.user;
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: profile } = await admin
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  const tenantId = (profile as any)?.tenant_id;
  if (!tenantId) {
    return new Response(JSON.stringify({ error: "no_tenant" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: tenant } = await admin
    .from("tenants")
    .select("slug, meta_app_version")
    .eq("id", tenantId)
    .maybeSingle();
  const slug = (tenant as any)?.slug || null;
  const version: "v1" | "v2" = ((tenant as any)?.meta_app_version === "v1") ? "v1" : "v2";

  const base = SUPABASE_URL.replace(/\/+$/, "");
  const suffix = slug ? `/${slug}` : "";

  const payload = {
    tenant_id: tenantId,
    tenant_slug: slug,
    meta_app_version: version,
    whatsapp: {
      callback_url: `${base}/functions/v1/whatsapp-webhook${suffix}`,
      verify_token: version === "v2"
        ? Deno.env.get("WHATSAPP_VERIFY_TOKEN_V2") || ""
        : Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "",
    },
    instagram: {
      callback_url: `${base}/functions/v1/instagram-lite-webhook${suffix}`,
      oauth_redirect_uri: version === "v2"
        ? (Deno.env.get("INSTAGRAM_REDIRECT_URI_V2") || `${base}/functions/v1/instagram-oauth-callback`)
        : (Deno.env.get("INSTAGRAM_REDIRECT_URI") || `${base}/functions/v1/instagram-oauth-callback${suffix}`),
      verify_token: version === "v2"
        ? Deno.env.get("INSTAGRAM_VERIFY_TOKEN_V2") || ""
        : Deno.env.get("INSTAGRAM_VERIFY_TOKEN") || Deno.env.get("INSTAGRAM_LITE_VERIFY_TOKEN") || "",
      app_id: version === "v2"
        ? Deno.env.get("META_APP_ID_V2") || ""
        : Deno.env.get("META_APP_ID") || "",
    },
  };

  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
