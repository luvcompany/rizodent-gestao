// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

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
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = auth.replace("Bearer ", "");
    const userClient = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const user = { id: claimsData.claims.sub as string };

    const admin = createClient(URL, SR);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "superadmin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden" }, 403);

    const { tenant_id, action, patch } = await req.json();
    if (!tenant_id || !action) return json({ error: "tenant_id and action required" }, 400);

    if (action === "update") {
      const allowed: any = {};
      const fields = ["name", "slug", "primary_color", "secondary_color", "tertiary_color", "logo_url", "favicon_url", "status"];
      for (const f of fields) if (patch?.[f] !== undefined) allowed[f] = patch[f];
      if (allowed.slug) allowed.slug = String(allowed.slug).toLowerCase().replace(/[^a-z0-9-]/g, "");
      const { data, error } = await admin.from("tenants").update(allowed).eq("id", tenant_id).select().single();
      if (error) return json({ error: error.message }, 400);
      await admin.from("access_logs").insert({ user_id: user.id, tenant_id, context: "admin", event: "tenant_update", metadata: allowed });
      return json({ tenant: data });
    }

    if (action === "pause" || action === "activate" || action === "delete") {
      const status = action === "pause" ? "paused" : action === "activate" ? "active" : "deleted";
      const patchObj: any = { status };
      if (action === "delete") {
        const { data: cur } = await admin.from("tenants").select("slug").eq("id", tenant_id).maybeSingle();
        if (cur?.slug && !cur.slug.startsWith("deleted-")) {
          patchObj.slug = `deleted-${Date.now()}-${cur.slug}`.slice(0, 63);
        }
      }
      const { error } = await admin.from("tenants").update(patchObj).eq("id", tenant_id);
      if (error) return json({ error: error.message }, 400);
      await admin.from("access_logs").insert({ user_id: user.id, tenant_id, context: "admin", event: `tenant_${action}` });
      return json({ ok: true, status });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
