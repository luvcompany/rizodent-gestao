// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function randomPassword(length = 16) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let pass = "";
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

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

    // Generate temporary password and update user
    const tempPassword = randomPassword(20);
    const { error: updateErr } = await admin.auth.admin.updateUserById(targetUserId, { password: tempPassword });
    if (updateErr) return json({ error: updateErr.message }, 500);

    // Sign in via REST API to get tokens
    const tokenRes = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "apikey": ANON,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: targetProf.email, password: tempPassword }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      return json({ error: tokenData.error_description || tokenData.error || "Falha ao gerar sessão." }, 500);
    }

    await admin.from("access_logs").insert({
      user_id: user.id,
      tenant_id,
      context: "admin",
      event: "impersonate",
      metadata: { target_user_id: targetUserId, target_email: targetProf.email },
    });

    return json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      slug: tenant!.slug,
      email: targetProf.email,
    });
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
