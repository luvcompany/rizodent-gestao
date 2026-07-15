// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Papéis atribuíveis a usuários de um cliente (superadmin é da plataforma, não do tenant).
const TENANT_ROLES = new Set(["crc", "gerente", "posvenda"]);
const BAN_FOREVER = "876000h"; // ~100 anos

async function ensureProfile(admin: any, user: any, tenantId: string, nome?: string, cargo?: string | null, mustChangePassword = true) {
  const { error } = await admin
    .from("profiles")
    .upsert({
      id: user.id,
      nome: nome || user.user_metadata?.nome || user.email,
      email: user.email,
      tenant_id: tenantId,
      cargo: cargo || null,
      must_change_password: mustChangePassword,
    }, { onConflict: "id" });
  return error;
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

    const { action, tenant_id, user_id, email, password, nome, role } = await req.json();

    if (action === "create") {
      if (!tenant_id || !email || !password) return json({ error: "missing fields" }, 400);
      const wantRole = TENANT_ROLES.has(role) ? role : "crc";
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { nome: nome || email, tenant_id, must_change_password: true },
      });
      if (error) return json({ error: error.message }, 400);

      const profErr = await ensureProfile(admin, created.user, tenant_id, nome || email, null, true);
      if (profErr) return json({ error: `Falha ao criar perfil: ${profErr.message}` }, 500);

      const { error: roleErr } = await admin
        .from("user_roles")
        .upsert({ user_id: created.user.id, role: wantRole, tenant_id }, { onConflict: "user_id,role" });
      if (roleErr) return json({ error: `Falha ao atribuir papel: ${roleErr.message}` }, 500);

      return json({ user_id: created.user.id, role: wantRole });
    }

    if (!user_id) return json({ error: "user_id required" }, 400);

    // tenant do alvo (para logs e escopo de papel)
    const { data: targetProfile } = await admin.from("profiles").select("tenant_id").eq("id", user_id).maybeSingle();
    const targetTenant = tenant_id || targetProfile?.tenant_id || null;

    if (action === "block") {
      // Revoga a sessão de verdade (ban no auth) + marca no perfil.
      try { await admin.auth.admin.updateUserById(user_id, { ban_duration: BAN_FOREVER }); } catch (_) { /* ignore */ }
      await admin.from("profiles").update({ is_blocked: true, blocked_at: new Date().toISOString(), blocked_by: userId }).eq("id", user_id);
      await admin.from("access_logs").insert({ user_id: userId, tenant_id: targetTenant, context: "admin", event: "user_block", metadata: { target: user_id } });
      return json({ ok: true });
    }
    if (action === "unblock") {
      try { await admin.auth.admin.updateUserById(user_id, { ban_duration: "none" }); } catch (_) { /* ignore */ }
      await admin.from("profiles").update({ is_blocked: false, blocked_at: null, blocked_by: null }).eq("id", user_id);
      await admin.from("access_logs").insert({ user_id: userId, tenant_id: targetTenant, context: "admin", event: "user_unblock", metadata: { target: user_id } });
      return json({ ok: true });
    }
    if (action === "reset_password") {
      if (!password || String(password).length < 6) return json({ error: "A senha precisa ter ao menos 6 caracteres." }, 400);
      const { error } = await admin.auth.admin.updateUserById(user_id, { password });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({ must_change_password: true }).eq("id", user_id);
      await admin.from("access_logs").insert({ user_id: userId, tenant_id: targetTenant, context: "admin", event: "user_reset_password", metadata: { target: user_id } });
      return json({ ok: true });
    }
    if (action === "set_role") {
      if (!TENANT_ROLES.has(role)) return json({ error: "Papel inválido." }, 400);
      if (!targetTenant) return json({ error: "Usuário sem tenant." }, 400);
      // Um usuário tem um papel: remove os antigos e define o novo.
      await admin.from("user_roles").delete().eq("user_id", user_id);
      const { error } = await admin.from("user_roles").upsert({ user_id, role, tenant_id: targetTenant }, { onConflict: "user_id,role" });
      if (error) return json({ error: error.message }, 400);
      await admin.from("access_logs").insert({ user_id: userId, tenant_id: targetTenant, context: "admin", event: "user_set_role", metadata: { target: user_id, role } });
      return json({ ok: true, role });
    }
    if (action === "set_email") {
      if (!email) return json({ error: "email required" }, 400);
      const { error } = await admin.auth.admin.updateUserById(user_id, { email, email_confirm: true });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({ email }).eq("id", user_id);
      await admin.from("access_logs").insert({ user_id: userId, tenant_id: targetTenant, context: "admin", event: "user_set_email", metadata: { target: user_id, email } });
      return json({ ok: true });
    }
    if (action === "delete") {
      // Solta os leads atribuídos a este usuário antes de removê-lo (evita órfãos).
      try { await admin.from("crm_leads").update({ assigned_to: null }).eq("assigned_to", user_id); } catch (_) { /* ignore */ }
      await admin.from("user_roles").delete().eq("user_id", user_id);
      const { error } = await admin.auth.admin.deleteUser(user_id);
      if (error) return json({ error: error.message }, 400);
      await admin.from("access_logs").insert({ user_id: userId, tenant_id: targetTenant, context: "admin", event: "user_delete", metadata: { target: user_id } });
      return json({ ok: true });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});
