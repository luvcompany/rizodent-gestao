// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "superadmin").maybeSingle();
    if (!roleRow) return new Response(JSON.stringify({ error: "Forbidden — superadmin only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    const { name, slug, primary_color, logo_url, plan_id, admin_email, admin_password, admin_name } = body;

    if (!name || !slug || !admin_email || !admin_password) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Create tenant
    const { data: tenant, error: tErr } = await admin.from("tenants").insert({
      name, slug, primary_color: primary_color || "#3b82f6", logo_url, status: "active",
    }).select().single();
    if (tErr) throw tErr;

    // Create subscription if plan provided
    if (plan_id) {
      const { data: plan } = await admin.from("plans").select("monthly_price").eq("id", plan_id).single();
      await admin.from("tenant_subscriptions").insert({
        tenant_id: tenant.id, plan_id, status: "active", amount: plan?.monthly_price ?? 0,
      });
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
    await admin.from("profiles").update({ tenant_id: tenant.id, must_change_password: true }).eq("id", created.user.id);

    // Add admin role for this user (within tenant)
    await admin.from("user_roles").insert({ user_id: created.user.id, role: "admin", tenant_id: tenant.id });

    return new Response(JSON.stringify({ tenant, user_id: created.user.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
