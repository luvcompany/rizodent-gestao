// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = [
  "https://crclin.com.br",
  "https://www.crclin.com.br",
  "https://app.crclin.com.br",
  "https://rizodent-gestao.lovable.app",
  "https://id-preview--776b814b-ba0d-4aab-a78f-ae5953dabe2a.lovable.app",
];
function buildCors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  const json = (b: any, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const URL = Deno.env.get("SUPABASE_URL")!;
    const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = auth.replace("Bearer ", "");

    const admin = createClient(URL, SR);
    const userClient = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const callerId = claimsData.claims.sub as string;

    const { user_id, blocked } = await req.json().catch(() => ({}));
    if (!user_id || typeof blocked !== "boolean") return json({ error: "Parâmetros inválidos" }, 400);

    if (user_id === callerId) {
      return json({ error: "Você não pode bloquear a si mesmo" }, 400);
    }

    // Caller profile + roles
    const [{ data: callerProfile }, { data: callerRoles }] = await Promise.all([
      admin.from("profiles").select("tenant_id, email").eq("id", callerId).maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", callerId),
    ]);
    const rolesArr = (callerRoles || []).map((r: any) => r.role);
    const isSuperadmin = rolesArr.includes("superadmin");
    const isCrc = rolesArr.includes("crc");
    if (!isSuperadmin && !isCrc) return json({ error: "Forbidden" }, 403);

    // Target profile + roles
    const [{ data: targetProfile }, { data: targetRoles }] = await Promise.all([
      admin.from("profiles").select("id, tenant_id, nome, email, is_blocked").eq("id", user_id).maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", user_id),
    ]);
    if (!targetProfile) return json({ error: "Usuário não encontrado" }, 404);
    const targetIsSuperadmin = (targetRoles || []).some((r: any) => r.role === "superadmin");

    // Only superadmins can block superadmins
    if (targetIsSuperadmin && !isSuperadmin) {
      return json({ error: "Apenas superadmin pode bloquear outro superadmin" }, 403);
    }
    // CRC restricted to same tenant
    if (!isSuperadmin) {
      if (!callerProfile?.tenant_id || callerProfile.tenant_id !== targetProfile.tenant_id) {
        return json({ error: "Usuário de outro cliente" }, 403);
      }
    }

    // Apply: profile + auth ban
    const banDuration = blocked ? "876000h" : "none";
    const { error: banErr } = await admin.auth.admin.updateUserById(user_id, { ban_duration: banDuration } as any);
    if (banErr) return json({ error: banErr.message }, 400);

    const updates: any = blocked
      ? { is_blocked: true, blocked_at: new Date().toISOString(), blocked_by: callerId }
      : { is_blocked: false, blocked_at: null, blocked_by: null };
    const { error: profErr } = await admin.from("profiles").update(updates).eq("id", user_id);
    if (profErr) return json({ error: profErr.message }, 400);

    // Log
    try {
      await admin.from("access_logs").insert({
        user_id: callerId,
        email: callerProfile?.email ?? null,
        tenant_id: targetProfile.tenant_id,
        context: "client",
        event: blocked ? "user_blocked" : "user_unblocked",
        ip: req.headers.get("x-forwarded-for") ?? null,
        user_agent: req.headers.get("user-agent") ?? null,
        metadata: { target_user_id: user_id, target_email: targetProfile.email },
      });
    } catch (_e) {}

    return json({ ok: true, blocked });
  } catch (e: any) {
    return json({ error: e?.message || "Erro interno" }, 500);
  }
});
