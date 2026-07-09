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
  if (userId) {
    try { await admin.auth.admin.deleteUser(userId); } catch { /* best effort cleanup */ }
  }
  if (!tenantId) return;

  const tenantTables = [
    "funnel_channels",
    "tipos_procedimento",
    "ai_assistant_config",
    "crm_stages",
    "crm_pipelines",
    "clinicas",
    "tenant_subscriptions",
    "user_roles",
    "profiles",
  ];

  for (const table of tenantTables) {
    try { await admin.from(table).delete().eq("tenant_id", tenantId); } catch { /* best effort cleanup */ }
  }
  try {
    await admin.from("tenants").delete().eq("id", tenantId);
  } catch {
    await admin
      .from("tenants")
      .update({ status: "deleted", slug: `failed-${Date.now()}-${tenantId}`.slice(0, 63) })
      .eq("id", tenantId);
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


    // Seed the default "Funil Principal" (model funnel — same as Rizodent's main funnel)
    const { data: defaultPipeline, error: pErr } = await admin
      .from("crm_pipelines")
      .insert({
        tenant_id: tenant.id,
        name: "Funil Principal",
        color: "#6366f1",
        is_default: true,
      })
      .select()
      .single();
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
    const { error: stagesErr } = await admin.from("crm_stages").insert(
      defaultStages.map((s) => ({
        ...s,
        tenant_id: tenant.id,
        pipeline_id: defaultPipeline.id,
        is_won: (s as any).is_won === true,
      }))
    );
    if (stagesErr) throw new Error(`Falha ao criar etapas do funil: ${stagesErr.message}`);

    // ---- Optional seeding (non-fatal): accumulate warnings, never roll back the tenant ----
    const warnings: string[] = [];

    // 1) AI assistant config — one active row per tenant, empty KB (tenant fills in later)
    const { error: aiErr } = await admin.from("ai_assistant_config").insert({
      tenant_id: tenant.id,
      is_active: true,
      assistant_display_name: "Assistente",
      name: `${name} — Assistente`,
      knowledge_base: "",
      auto_send_enabled: false,
      shift_start: "08:00",
      shift_end: "18:00",
    });
    if (aiErr) warnings.push(`ai_assistant_config: ${aiErr.message}`);

    // 2) tipos_procedimento — default dental procedure list
    const defaultProcs = [
      { nome: "Avaliação / Consulta", especialidade: "Clínica Geral" },
      { nome: "Limpeza (Profilaxia)", especialidade: "Clínica Geral" },
      { nome: "Restauração", especialidade: "Clínica Geral" },
      { nome: "Extração", especialidade: "Cirurgia" },
      { nome: "Tratamento de Canal", especialidade: "Endodontia" },
      { nome: "Clareamento", especialidade: "Estética" },
      { nome: "Prótese", especialidade: "Prótese" },
      { nome: "Implante", especialidade: "Implantodontia" },
      { nome: "Aparelho Ortodôntico", especialidade: "Ortodontia" },
      { nome: "Facetas", especialidade: "Estética" },
    ];
    const { error: procErr } = await admin.from("tipos_procedimento").insert(
      defaultProcs.map((p) => ({
        ...p,
        tenant_id: tenant.id,
        ativo: true,
        valor_referencia: 0,
      })),
    );
    if (procErr) warnings.push(`tipos_procedimento: ${procErr.message}`);

    // 3) funnel_channels — map WhatsApp to the default pipeline
    const { error: chErr } = await admin.from("funnel_channels").insert({
      tenant_id: tenant.id,
      pipeline_id: defaultPipeline.id,
      channel_type: "whatsapp",
    });
    if (chErr) warnings.push(`funnel_channels: ${chErr.message}`);

    // 4) crm_quick_replies — intentionally NOT seeded (tenant creates their own)

    return new Response(JSON.stringify({ tenant, user_id: created.user.id, warnings }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    if (admin && createdTenantId) {
      await cleanupFailedTenant(admin, createdTenantId, createdUserId);
    }
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
