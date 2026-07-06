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
    const isSuperadmin = (roles || []).some((r: any) => r.role === "superadmin");
    const isAdmin = isSuperadmin || (roles || []).some((r: any) => r.role === "crc" || r.role === "gerente");
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

    // Allowlist de roles — bloqueia escalada de privilégio.
    // - crc/gerente só podem criar: crc, posvenda
    // - superadmin pode criar: crc, posvenda, gerente, superadmin
    const requestedRole = role || "crc";
    const allowedForAdmin = new Set(["crc", "posvenda"]);
    const allowedForSuperadmin = new Set(["crc", "posvenda", "gerente", "superadmin"]);
    const allowed = isSuperadmin ? allowedForSuperadmin : allowedForAdmin;
    if (!allowed.has(requestedRole)) {
      return json({ error: `Role '${requestedRole}' não permitida para este usuário` }, 403);
    }
    const userRole = requestedRole;

    // Procura usuário existente paginando (para verificar se e-mail já existe globalmente)
    let existingUser: any = null;
    for (let page = 1; page <= 20; page++) {
      const { data: list, error: lErr } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (lErr) break;
      const found = list?.users?.find(
        (u: any) => u.email?.toLowerCase() === String(email).toLowerCase()
      );
      if (found) { existingUser = found; break; }
      if (!list?.users || list.users.length < 1000) break;
    }

    if (existingUser) {
      // Segurança: só é seguro tocar num usuário existente se ele pertencer ao MESMO tenant.
      // Caso contrário, um admin de uma clínica poderia sequestrar/apagar conta de outra.
      const { data: existingProfile } = await admin
        .from("profiles")
        .select("tenant_id")
        .eq("id", existingUser.id)
        .maybeSingle();
      const existingTenantId = existingProfile?.tenant_id ?? existingUser.user_metadata?.tenant_id ?? null;

      if (!existingTenantId || existingTenantId !== tenantId) {
        return json({ error: "E-mail já cadastrado em outra conta" }, 409);
      }

      // Mesmo tenant: atualiza senha/metadata e reajusta papel sem deletar a conta de auth
      const { error: uErr } = await admin.auth.admin.updateUserById(existingUser.id, {
        password,
        email_confirm: true,
        user_metadata: {
          ...(existingUser.user_metadata ?? {}),
          nome,
          tenant_id: tenantId,
          must_change_password: false,
        },
      });
      if (uErr) return json({ error: "Falha ao atualizar usuário existente: " + uErr.message }, 400);

      await admin
        .from("profiles")
        .update({ tenant_id: tenantId, cargo: cargo || null, must_change_password: false })
        .eq("id", existingUser.id);

      // Reajusta papéis do usuário dentro deste tenant (não toca em papéis de outros tenants)
      await admin
        .from("user_roles")
        .delete()
        .eq("user_id", existingUser.id)
        .eq("tenant_id", tenantId);
      await admin
        .from("user_roles")
        .insert({ user_id: existingUser.id, role: userRole, tenant_id: tenantId });

      return json({ user_id: existingUser.id, updated: true });
    }

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
