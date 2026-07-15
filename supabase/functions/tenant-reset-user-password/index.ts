// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Papéis do tenant autorizados a redefinir a senha de outro usuário da MESMA clínica.
const ALLOWED_CALLER_ROLES = new Set(["crc", "gerente"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const URL = Deno.env.get("SUPABASE_URL")!;
    const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = auth.replace("Bearer ", "");

    // Valida o JWT do caller.
    const userClient = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const callerId = claimsData.claims.sub;

    const { user_id, password } = await req.json();
    if (!user_id) return json({ error: "user_id required" }, 400);
    if (!password || String(password).length < 6) return json({ error: "A senha precisa ter ao menos 6 caracteres." }, 400);

    const admin = createClient(URL, SR);

    // Tenant do caller e do alvo (precisam ser o mesmo).
    const { data: callerProfile } = await admin.from("profiles").select("tenant_id").eq("id", callerId).maybeSingle();
    const callerTenant = callerProfile?.tenant_id ?? null;
    if (!callerTenant) return json({ error: "Forbidden" }, 403);

    const { data: targetProfile } = await admin.from("profiles").select("tenant_id").eq("id", user_id).maybeSingle();
    const targetTenant = targetProfile?.tenant_id ?? null;
    if (!targetTenant || targetTenant !== callerTenant) return json({ error: "Forbidden" }, 403);

    // Caller precisa ter papel crc OU gerente no MESMO tenant do alvo.
    const { data: callerRoles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .eq("tenant_id", callerTenant);
    const hasRole = (callerRoles ?? []).some((r: any) => ALLOWED_CALLER_ROLES.has(r.role));
    if (!hasRole) return json({ error: "Forbidden" }, 403);

    // Redefine a senha e força troca no próximo login.
    const { error: pwErr } = await admin.auth.admin.updateUserById(user_id, { password });
    if (pwErr) return json({ error: pwErr.message }, 400);

    const { error: profErr } = await admin.from("profiles").update({ must_change_password: true }).eq("id", user_id);
    if (profErr) return json({ error: profErr.message }, 500);

    await admin.from("access_logs").insert({
      user_id: callerId,
      tenant_id: callerTenant,
      context: "tenant",
      event: "tenant_reset_password",
      metadata: { target: user_id },
    });

    return json({ ok: true });
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
