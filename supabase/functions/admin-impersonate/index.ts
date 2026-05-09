// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Note: previous implementation reset the user's password to a random one to log in,
// which broke the user's real password permanently. We now use generateLink({ magiclink })
// + verifyOtp to mint a real session WITHOUT touching the password.

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

    // Generate a magic link (does NOT change the user's password)
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: targetProf.email,
    });
    if (linkErr || !linkData?.properties?.hashed_token) {
      return json({ error: linkErr?.message || "Falha ao gerar link de acesso." }, 500);
    }

    // Exchange the OTP hash for an actual session (access + refresh tokens)
    const userClient = createClient(URL, ANON);
    const { data: verifyData, error: verifyErr } = await userClient.auth.verifyOtp({
      type: "magiclink",
      token_hash: linkData.properties.hashed_token,
    });
    if (verifyErr || !verifyData?.session) {
      return json({ error: verifyErr?.message || "Falha ao gerar sessão." }, 500);
    }
    const tokenData = {
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
    };

    await admin.from("access_logs").insert({
      user_id: userId,
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
