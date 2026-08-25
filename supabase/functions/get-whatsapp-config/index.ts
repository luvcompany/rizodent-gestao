import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveWhatsAppCreds, extractSlugFromUrl } from "../_shared/tenantCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Tenant do chamador: slug no path (…/get-whatsapp-config/<slug>) ou JWT.
async function resolveTenantId(req: Request): Promise<string | null> {
  const slug = extractSlugFromUrl(req, "get-whatsapp-config");
  if (slug) {
    const { data } = await admin.rpc("get_tenant_by_slug", { _slug: slug });
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.id) return row.id as string;
  }
  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return null;
  const { data: userRes } = await admin.auth.getUser(jwt);
  const uid = userRes?.user?.id;
  if (!uid) return null;
  const { data: prof } = await admin
    .from("profiles")
    .select("tenant_id")
    .eq("id", uid)
    .maybeSingle();
  return (prof as any)?.tenant_id ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Envs continuam como FALLBACK — o tenant Rizodent segue idêntico.
  let app_id = Deno.env.get("META_APP_ID") ?? "";
  let config_id = Deno.env.get("WHATSAPP_EMBEDDED_CONFIG_ID") ?? "";
  let redirect_uri = Deno.env.get("WHATSAPP_REDIRECT_URI") ?? "";

  try {
    const tenantId = await resolveTenantId(req);
    if (tenantId) {
      const creds = await resolveWhatsAppCreds({ tenantId });
      if (creds.app_id) app_id = creds.app_id;

      // Embedded Signup: config_id/redirect_uri do app do próprio cliente,
      // gravados na integração whatsapp_config do tenant.
      const { data: integ } = await admin
        .from("integrations")
        .select("config")
        .eq("tenant_id", tenantId)
        .eq("key", "whatsapp_config")
        .maybeSingle();
      const cfg = ((integ as any)?.config ?? {}) as Record<string, string>;
      if (cfg.app_id) app_id = cfg.app_id;
      if (cfg.embedded_config_id) config_id = cfg.embedded_config_id;
      if (cfg.redirect_uri) redirect_uri = cfg.redirect_uri;
    }
  } catch (e) {
    console.log("[get-whatsapp-config] fallback para env:", (e as any)?.message);
  }

  return new Response(
    JSON.stringify({ app_id, config_id, redirect_uri, api_version: "v21.0" }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
