// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
    const requesterId = claimsData.claims.sub;

    const admin = createClient(URL, SR);

    // Verifica se o solicitante é admin/superadmin
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", requesterId);
    const isAdmin = (roles || []).some((r: any) => r.role === "admin" || r.role === "superadmin");
    if (!isAdmin) return json({ error: "Forbidden — admin only" }, 403);

    // Pega o tenant do solicitante
    const { data: requesterProfile } = await admin
      .from("profiles")
      .select("tenant_id")
      .eq("id", requesterId)
      .maybeSingle();
    const tenantId = requesterProfile?.tenant_id;
    if (!tenantId) return json({ error: "Tenant não encontrado" }, 400);

    const { email, password, nome, cargo, role } = await req.json();
    if (!email || !password || !nome) return json({ error: "Campos obrigatórios faltando" }, 400);
    const userRole = role || "crc";

    // Se já existir um usuário com esse e-mail sem profile válido, limpa antes de recriar
    try {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existingUser = list?.users?.find(
        (u: any) => u.email?.toLowerCase() === String(email).toLowerCase()
      );
      if (existingUser) {
        const { data: existingProfile } = await admin
          .from("profiles")
          .select("id, tenant_id")
          .eq("id", existingUser.id)
          .maybeSingle();
        if (existingProfile && existingProfile.tenant_id && existingProfile.tenant_id !== tenantId) {
          return json({ error: "Este e-mail já está em uso em outro cliente." }, 400);
        }
        // Órfão ou mesmo tenant — remove para recriar limpo
        await admin.from("user_roles").delete().eq("user_id", existingUser.id);
        await admin.from("profiles").delete().eq("id", existingUser.id);
        await admin.auth.admin.deleteUser(existingUser.id);
      }
    } catch (_) { /* ignore */ }

    // Cria usuário já confirmado
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome, tenant_id: tenantId, must_change_password: false },
    });
    if (cErr) return json({ error: cErr.message }, 400);

    await admin
      .from("profiles")
      .update({ tenant_id: tenantId, cargo: cargo || null, must_change_password: false })
      .eq("id", created.user.id);

    await admin
      .from("user_roles")
      .insert({ user_id: created.user.id, role: userRole, tenant_id: tenantId });

    return json({ user_id: created.user.id });
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
