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
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = auth.replace("Bearer ", "");
    const userClient = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claimsData.claims.sub;

    const admin = createClient(URL, SR);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "superadmin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden" }, 403);

    const { action, tenant_id, user_id, email, password, nome } = await req.json();

    if (action === "create") {
      if (!tenant_id || !email || !password) return json({ error: "missing fields" }, 400);
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { nome: nome || email, tenant_id, must_change_password: true },
      });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({ tenant_id, must_change_password: true }).eq("id", created.user.id);
      await admin.from("user_roles").insert({ user_id: created.user.id, role: "admin", tenant_id });
      return json({ user_id: created.user.id });
    }

    if (!user_id) return json({ error: "user_id required" }, 400);

    if (action === "block") {
      await admin.from("profiles").update({ is_blocked: true, blocked_at: new Date().toISOString(), blocked_by: userId }).eq("id", user_id);
      return json({ ok: true });
    }
    if (action === "unblock") {
      await admin.from("profiles").update({ is_blocked: false, blocked_at: null, blocked_by: null }).eq("id", user_id);
      return json({ ok: true });
    }
    if (action === "reset_password") {
      if (!password) return json({ error: "password required" }, 400);
      const { error } = await admin.auth.admin.updateUserById(user_id, { password });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({ must_change_password: true }).eq("id", user_id);
      return json({ ok: true });
    }
    if (action === "delete") {
      const { error } = await admin.auth.admin.deleteUser(user_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
