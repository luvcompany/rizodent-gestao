// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const URL = Deno.env.get("SUPABASE_URL")!;
    const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authClient = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: claimsData, error: claimsErr } = await authClient.auth.getClaims(token);
    const userId = claimsData?.claims?.sub;
    if (claimsErr || !userId) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(URL, SR);

    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "superadmin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden" }, 403);

    const { tenant_id } = await req.json();
    if (!tenant_id) return json({ error: "tenant_id required" }, 400);

    const userClient = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data, error } = await userClient.rpc("admin_tenant_metrics", { _tenant_id: tenant_id });
    if (error) return json({ error: error.message }, 500);
    return json(data);
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
