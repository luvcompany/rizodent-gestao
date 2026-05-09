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
    const FRONTEND = Deno.env.get("FRONTEND_URL") ?? "https://crclin.com.br";

    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(URL, SR);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "superadmin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden" }, 403);

    const { tenant_id, user_id } = await req.json();
    if (!tenant_id) return json({ error: "tenant_id required" }, 400);

    // Pick target user: first admin profile of tenant or provided user_id
    let targetUserId = user_id;
    if (!targetUserId) {
      const { data: prof } = await admin.from("profiles").select("id").eq("tenant_id", tenant_id).eq("is_blocked", false).limit(1).maybeSingle();
      if (!prof) return json({ error: "Nenhum usuário ativo neste cliente." }, 404);
      targetUserId = prof.id;
    }

    const { data: targetProf } = await admin.from("profiles").select("email, tenant_id").eq("id", targetUserId).single();
    if (!targetProf || targetProf.tenant_id !== tenant_id) return json({ error: "Usuário não pertence a este cliente." }, 400);

    const { data: tenant } = await admin.from("tenants").select("slug").eq("id", tenant_id).single();

    const { data: link, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: targetProf.email,
      options: { redirectTo: `${FRONTEND}/${tenant!.slug}/dashboard` },
    });
    if (error) return json({ error: error.message }, 500);

    await admin.from("access_logs").insert({
      user_id: user.id,
      tenant_id,
      context: "admin",
      event: "impersonate",
      metadata: { target_user_id: targetUserId, target_email: targetProf.email },
    });

    return json({ url: link.properties?.action_link, slug: tenant!.slug, email: targetProf.email });
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
