// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function findUserByEmail(admin: any, email: string) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return null;

  const perPage = 1000;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data?.users?.find((u: any) => u.email?.toLowerCase() === target);
    if (found) return found;
    if (!data?.users || data.users.length < perPage) break;
  }

  return null;
}

async function ensureEmailAvailable(admin: any, email: string) {
  const existingUser = await findUserByEmail(admin, email);
  if (!existingUser) return;

  const { data: existingProfile } = await admin
    .from("profiles")
    .select("tenant_id")
    .eq("id", existingUser.id)
    .maybeSingle();
  const existingTenantId = existingProfile?.tenant_id ?? existingUser.user_metadata?.tenant_id ?? null;

  if (existingTenantId) {
    const { data: existingTenant } = await admin
      .from("tenants")
      .select("status")
      .eq("id", existingTenantId)
      .maybeSingle();

    if (existingTenant?.status === "active") {
      return json({ error: "Este e-mail já pertence a um cliente ativo. Use outro e-mail para o primeiro usuário." }, 409);
    }
  }

  await admin.from("profiles").delete().eq("id", existingUser.id);
  const { error: deleteErr } = await admin.auth.admin.deleteUser(existingUser.id);
  if (deleteErr) throw deleteErr;
}

async function cleanupFailedTenant(admin: any, tenantId: string | null, userId: string | null) {
  // Always try to delete the auth user we just created (may be null if we didn't reach that step)
  if (userId) {
    try { await admin.auth.admin.deleteUser(userId); } catch { /* best effort */ }
  }
  if (!tenantId) return;

  // Use the same hard-delete used by the admin panel — removes ALL rows for this tenant
  // across every public table, and returns the list of auth user ids to purge as well.
  try {
    const { data, error } = await admin.rpc("hard_delete_tenant", { _tenant_id: tenantId });
    if (error) throw error;
    const userIds: string[] = Array.isArray((data as any)?.user_ids) ? (data as any).user_ids : [];
    for (const uid of userIds) {
      if (uid === userId) continue;
      try { await admin.auth.admin.deleteUser(uid); } catch { /* best effort */ }
    }
  } catch (err) {
    // Do NOT silently leave a zombie tenant row — surface the failure to the caller/logs.
    console.error("[admin-create-tenant] cleanupFailedTenant hard_delete_tenant failed:", err);
    throw err;
  }
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let admin: any = null;
  let createdTenantId: string | null = null;
  let createdUserId: string | null = null;

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claimsData.claims.sub;

    admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "superadmin").maybeSingle();
    if (!roleRow) return new Response(JSON.stringify({ error: "Forbidden — superadmin only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    const { name, slug, primary_color, secondary_color, tertiary_color, logo_url, favicon_url, plan_id, admin_email, admin_password, admin_name, clinic_name, clinic_city } = body;
    const cleanEmail = String(admin_email || "").trim().toLowerCase();
    const cleanSlug = String(slug || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");

    if (!name || !cleanSlug || !cleanEmail || !admin_password) {
      return json({ error: "Preencha nome, slug, e-mail e senha temporária." }, 400);
    }
    if (!clinic_name) {
      return json({ error: "Informe o nome da clínica" }, 400);
    }
    if (String(admin_password).length < 6) {
      return json({ error: "A senha temporária precisa ter pelo menos 6 caracteres." }, 400);
    }

    const emailAvailability = await ensureEmailAvailable(admin, cleanEmail);
    if (emailAvailability) return emailAvailability;

    // Free up slug if it belongs to a previously deleted tenant
    const { data: existing } = await admin.from("tenants").select("id, status, slug").eq("slug", cleanSlug).maybeSingle();
    if (existing) {
      if (existing.status === "deleted") {
        await admin.from("tenants").update({ slug: `deleted-${Date.now()}-${existing.slug}`.slice(0, 63) }).eq("id", existing.id);
      } else {
        return json({ error: `Slug "${cleanSlug}" já está em uso por outro cliente ativo.` }, 400);
      }
    }

    // Create tenant
    const { data: tenant, error: tErr } = await admin.from("tenants").insert({
      name, slug: cleanSlug,
      primary_color: primary_color || "#3b82f6",
      secondary_color: secondary_color || "#fb923c",
      tertiary_color: tertiary_color || "#fed7aa",
      logo_url, favicon_url, status: "active",
    }).select().single();
    if (tErr) throw tErr;
    createdTenantId = tenant.id;

    // Create subscription if plan provided
    if (plan_id) {
      const { data: plan } = await admin.from("plans").select("monthly_price").eq("id", plan_id).single();
      await admin.from("tenant_subscriptions").insert({
        tenant_id: tenant.id, plan_id, status: "active", amount: plan?.monthly_price ?? 0,
      });
    }

    // Create auth user with metadata
    const { data: created, error: uErr } = await admin.auth.admin.createUser({
      email: cleanEmail,
      password: admin_password,
      email_confirm: true,
      user_metadata: {
        nome: admin_name || admin_email,
        tenant_id: tenant.id,
        must_change_password: true,
      },
    });
    if (uErr) throw uErr;
    createdUserId = created.user.id;

    // Ensure profile points to tenant (handle_new_user trigger does it, but enforce)
    const { error: profErr } = await admin.from("profiles").update({ tenant_id: tenant.id, must_change_password: true }).eq("id", created.user.id);
    if (profErr) throw new Error(`Falha ao atualizar profile do admin: ${profErr.message}`);

    // Add admin role for this user (within tenant). "crc" is the clinic admin role.
    const { error: roleErr } = await admin.from("user_roles").insert({ user_id: created.user.id, role: "crc", tenant_id: tenant.id });
    if (roleErr) throw new Error(`Falha ao atribuir papel ao admin: ${roleErr.message}`);

    // Create the clinic record for this tenant (starts empty otherwise)
    const { error: clinErr } = await admin.from("clinicas").insert({
      tenant_id: tenant.id,
      nome: clinic_name,
      cidade: clinic_city || clinic_name,
      ativa: true,
    });
    if (clinErr) throw new Error(`Falha ao criar clínica: ${clinErr.message}`);


    // Seed default pipelines: "Funil Principal" (WhatsApp) and "Instagram"
    // Both come with the same standard stage set — tenant customizes later.
    // Nothing else is seeded: the new tenant starts with a completely empty system.
    const { data: pipelinesInserted, error: pErr } = await admin
      .from("crm_pipelines")
      .insert([
        { tenant_id: tenant.id, name: "Funil Principal", color: "#6366f1", is_default: true },
        { tenant_id: tenant.id, name: "Instagram",        color: "#ec4899", is_default: false },
      ])
      .select();
    if (pErr) throw pErr;

    const defaultStages = [
      { name: "Novo Lead",      position: 0,  color: "#3b82f6" },
      { name: "Conversando",    position: 1,  color: "#f59e0b" },
      { name: "Relacionamento", position: 2,  color: "#8b5cf6" },
      { name: "Follow - Up",    position: 3,  color: "#f59e0b" },
      { name: "Recuperado",     position: 4,  color: "#8b5cf6" },
      { name: "Pré - Agendado", position: 5,  color: "#bff075" },
      { name: "Agendado",       position: 6,  color: "#c0ee1b" },
      { name: "Não compareceu", position: 7,  color: "#eab308" },
      { name: "Reagendado",     position: 8,  color: "#6366f1" },
      { name: "Contratado",     position: 9,  color: "#84cc16", is_won: true },
      { name: "Desqualificado", position: 10, color: "#ef4444" },
    ];
    const stageRows = pipelinesInserted.flatMap((pipe: any) =>
      defaultStages.map((s) => ({
        ...s,
        tenant_id: tenant.id,
        pipeline_id: pipe.id,
        is_won: (s as any).is_won === true,
      }))
    );
    const { error: stagesErr } = await admin.from("crm_stages").insert(stageRows);
    if (stagesErr) throw new Error(`Falha ao criar etapas dos funis: ${stagesErr.message}`);

    const warnings: string[] = [];
    // Nothing else is seeded — no ai_assistant_config, tipos_procedimento,
    // funnel_channels, quick_replies, bots, automations, holidays, etc.
    // The client's system starts totally empty and is populated by the tenant itself.


    return new Response(JSON.stringify({ tenant, user_id: created.user.id, warnings }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    let cleanupError: string | null = null;
    if (admin && createdTenantId) {
      try {
        await cleanupFailedTenant(admin, createdTenantId, createdUserId);
      } catch (ce: any) {
        cleanupError = ce?.message ?? String(ce);
      }
    }
    return new Response(JSON.stringify({
      error: e?.message ?? String(e),
      cleanup_error: cleanupError,
    }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

