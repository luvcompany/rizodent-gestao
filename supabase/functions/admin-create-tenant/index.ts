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

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "superadmin").maybeSingle();
    if (!roleRow) return new Response(JSON.stringify({ error: "Forbidden — superadmin only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    const { name, slug, primary_color, secondary_color, tertiary_color, logo_url, favicon_url, plan_id, admin_email, admin_password, admin_name, clinic_name, clinic_city } = body;

    if (!name || !slug || !admin_email || !admin_password) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!clinic_name) {
      return new Response(JSON.stringify({ error: "Informe o nome da clínica" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Free up slug if it belongs to a previously deleted tenant
    const { data: existing } = await admin.from("tenants").select("id, status, slug").eq("slug", slug).maybeSingle();
    if (existing) {
      if (existing.status === "deleted") {
        await admin.from("tenants").update({ slug: `deleted-${Date.now()}-${existing.slug}`.slice(0, 63) }).eq("id", existing.id);
      } else {
        return json({ error: `Slug "${slug}" já está em uso por outro cliente ativo.` }, 400);
      }
    }

    // Create tenant
    const { data: tenant, error: tErr } = await admin.from("tenants").insert({
      name, slug,
      primary_color: primary_color || "#3b82f6",
      secondary_color: secondary_color || "#fb923c",
      tertiary_color: tertiary_color || "#fed7aa",
      logo_url, favicon_url, status: "active",
    }).select().single();
    if (tErr) throw tErr;

    // Create subscription if plan provided
    if (plan_id) {
      const { data: plan } = await admin.from("plans").select("monthly_price").eq("id", plan_id).single();
      await admin.from("tenant_subscriptions").insert({
        tenant_id: tenant.id, plan_id, status: "active", amount: plan?.monthly_price ?? 0,
      });
    }

    // Free up email if it belongs to a previously orphaned/deleted tenant user.
    // SAFETY: never delete a user that belongs to a DIFFERENT ACTIVE tenant.
    try {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existingUser = list?.users?.find((u: any) => u.email?.toLowerCase() === String(admin_email).toLowerCase());
      if (existingUser) {
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
          if (existingTenant && existingTenant.status === "active") {
            return json({ error: "E-mail já cadastrado em outra conta" }, 409);
          }
        }
        await admin.from("profiles").delete().eq("id", existingUser.id);
        await admin.auth.admin.deleteUser(existingUser.id);
      }
    } catch (e: any) {
      // Only swallow non-conflict errors; re-raise nothing else so provisioning stays reliable.
      if (e?.status === 409) throw e;
    }

    // Create auth user with metadata
    const { data: created, error: uErr } = await admin.auth.admin.createUser({
      email: admin_email,
      password: admin_password,
      email_confirm: true,
      user_metadata: {
        nome: admin_name || admin_email,
        tenant_id: tenant.id,
        must_change_password: true,
      },
    });
    if (uErr) throw uErr;

    // Ensure profile points to tenant (handle_new_user trigger does it, but enforce)
    const { error: profErr } = await admin.from("profiles").update({ tenant_id: tenant.id, must_change_password: true }).eq("id", created.user.id);
    if (profErr) return json({ error: `Falha ao atualizar profile do admin: ${profErr.message}` }, 500);

    // Add admin role for this user (within tenant). "crc" is the clinic admin role.
    const { error: roleErr } = await admin.from("user_roles").insert({ user_id: created.user.id, role: "crc", tenant_id: tenant.id });
    if (roleErr) return json({ error: `Falha ao atribuir papel ao admin: ${roleErr.message}` }, 500);

    // Create the clinic record for this tenant (starts empty otherwise)
    const { error: clinErr } = await admin.from("clinicas").insert({
      tenant_id: tenant.id,
      nome: clinic_name,
      cidade: clinic_city || clinic_name,
      ativa: true,
    });
    if (clinErr) return json({ error: `Falha ao criar clínica: ${clinErr.message}` }, 500);


    // Seed the default "Funil Principal" (model funnel — same as Rizodent's main funnel)
    const { data: defaultPipeline, error: pErr } = await admin
      .from("crm_pipelines")
      .insert({
        tenant_id: tenant.id,
        name: "Funil Principal",
        color: "#6366f1",
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
      { name: "Contratado",     position: 9,  color: "#84cc16" },
      { name: "Desqualificado", position: 10, color: "#ef4444" },
    ];
    await admin.from("crm_stages").insert(
      defaultStages.map((s) => ({
        ...s,
        tenant_id: tenant.id,
        pipeline_id: defaultPipeline.id,
      }))
    );

    return new Response(JSON.stringify({ tenant, user_id: created.user.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
