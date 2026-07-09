import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";

  let appVersion: "v1" | "v2" = "v1";
  if (authHeader.startsWith("Bearer ")) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData } = await userClient.auth.getClaims(token);
    const userId = claimsData?.claims?.sub as string | undefined;
    if (userId) {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: profile } = await admin
        .from("profiles")
        .select("tenant_id, tenants(meta_app_version)")
        .eq("id", userId)
        .maybeSingle();
      appVersion = (profile as any)?.tenants?.meta_app_version === "v2" ? "v2" : "v1";
    }
  }

  const appId = appVersion === "v2" ? (Deno.env.get("META_APP_ID_V2") ?? "") : (Deno.env.get("META_APP_ID") ?? "");
  const redirectUri = appVersion === "v2"
    ? (Deno.env.get("INSTAGRAM_REDIRECT_URI_V2") ?? "")
    : (Deno.env.get("INSTAGRAM_REDIRECT_URI") ?? "");
  return new Response(
    JSON.stringify({ app_id: appId, redirect_uri: redirectUri, app_version: appVersion }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
