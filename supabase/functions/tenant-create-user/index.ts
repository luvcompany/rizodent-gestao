// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { resolveCaller } from "../_shared/authz.ts";

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

    const admin = createClient(URL, SR);

    // Gate único via helper compartilhado. Gestão de usuários vive SÓ no painel
    // do superadmin — crc/gerente não têm acesso a esta função.
    const ctx = await resolveCaller(req, admin);
    if (!ctx.ok) return json({ error: ctx.error }, ctx.status);
    if (!ctx.isSuperadmin) {
      return json({ error: "Forbidden — gestão de usuários é feita no painel administrativo" }, 403);
    }
    const requesterId = ctx.userId;

    const body = await req.json().catch(() => ({}));
    const { email, password, nome, cargo, role } = body as any;

    // tenant_id no corpo só para superadmin (que é o único caller permitido) e
    // precisa existir de fato. Sem tenant_id no corpo => tenant do solicitante.
    let tenantId: string | null = null;
    if (body?.tenant_id) {
      const { data: t } = await admin.from("tenants").select("id").eq("id", body.tenant_id).maybeSingle();
      if (!t) return json({ error: "Tenant inválido" }, 400);
      tenantId = t.id;
    } else {
      const { data: requesterProfile } = await admin
        .from("profiles")
        .select("tenant_id")
        .eq("id", requesterId)
        .maybeSingle();
      tenantId = requesterProfile?.tenant_id ?? null;
    }
    if (!tenantId) return json({ error: "Tenant não encontrado" }, 400);

    if (!email || !password || !nome) return json({ error: "Campos obrigatórios faltando" }, 400);

    // Allowlist de roles — bloqueia escalada de privilégio.
    const requestedRole = role || "crc";
    const allowed = new Set(["crc", "posvenda", "recepcao", "gerente", "closer", "superadmin"]);
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
