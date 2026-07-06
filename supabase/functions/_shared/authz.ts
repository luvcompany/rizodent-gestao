// Shared tenant authorization helpers for edge functions.
// Goal: prevent IDOR across tenants. Helpers are ADDITIVE — they only
// reject requests that try to act on resources outside the caller's tenant.
//
// Usage pattern:
//   const ctx = await resolveCaller(req, supabaseAdmin);
//   if (!ctx.ok) return jsonResponse({ error: ctx.error }, ctx.status);
//   // ctx.isServiceRole === true  -> trusted backend call, skip tenant checks
//   // ctx.isSuperadmin === true   -> platform admin, can cross tenants
//   // otherwise:
//   const check = await assertLeadInTenant(supabaseAdmin, leadId, ctx.tenantId);
//   if (!check.ok) return jsonResponse({ error: check.error }, 403);


// Comparação de tempo constante para segredos/API keys. Evita timing attacks
// que revelam prefixos corretos por diferença de tempo entre === curto e longo.
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface CallerContext {
  ok: true;
  userId: string | null;
  tenantId: string | null;
  isServiceRole: boolean;
  isSuperadmin: boolean;
}
export interface CallerError {
  ok: false;
  status: number;
  error: string;
}

export async function resolveCaller(
  req: Request,
  admin: any,
): Promise<CallerContext | CallerError> {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const apiKeyHeader = req.headers.get("apikey") || "";
  const serviceRoleKey = (globalThis as any).Deno?.env?.get?.("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing authorization header" };
  }
  const token = authHeader.slice("Bearer ".length).trim();

  // Service-role calls (internal cron / edge -> edge) are trusted.
  if (serviceRoleKey && (token === serviceRoleKey || apiKeyHeader === serviceRoleKey)) {
    return { ok: true, userId: null, tenantId: null, isServiceRole: true, isSuperadmin: false };
  }

  // Validate JWT via supabase.
  const { data: claimsData, error: claimsErr } = await admin.auth.getClaims(token);
  if (claimsErr || !claimsData?.claims?.sub) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const userId = claimsData.claims.sub as string;

  // Read tenant + roles (service-role bypasses RLS, which is what we want).
  const [{ data: profile }, { data: roles }] = await Promise.all([
    admin.from("profiles").select("tenant_id").eq("id", userId).maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", userId),
  ]);

  const tenantId: string | null = profile?.tenant_id ?? null;
  const isSuperadmin = Array.isArray(roles) && roles.some((r: any) => r.role === "superadmin");

  if (!tenantId && !isSuperadmin) {
    return { ok: false, status: 403, error: "Usuário sem tenant associado" };
  }

  return { ok: true, userId, tenantId, isServiceRole: false, isSuperadmin };
}

export async function assertLeadInTenant(
  admin: any,
  leadId: string,
  ctx: CallerContext,
): Promise<{ ok: true; tenantId: string } | { ok: false; status: number; error: string }> {
  if (ctx.isServiceRole || ctx.isSuperadmin) {
    // Still resolve the tenant for downstream use, but don't gate.
    const { data } = await admin.from("crm_leads").select("tenant_id").eq("id", leadId).maybeSingle();
    if (!data) return { ok: false, status: 404, error: "Lead não encontrado" };
    return { ok: true, tenantId: data.tenant_id };
  }
  const { data, error } = await admin
    .from("crm_leads")
    .select("tenant_id")
    .eq("id", leadId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404, error: "Lead não encontrado" };
  if (data.tenant_id !== ctx.tenantId) {
    return { ok: false, status: 403, error: "Recurso de outro tenant" };
  }
  return { ok: true, tenantId: data.tenant_id };
}

export async function assertMessageInTenant(
  admin: any,
  messageId: string,
  ctx: CallerContext,
): Promise<{ ok: true; tenantId: string } | { ok: false; status: number; error: string }> {
  if (ctx.isServiceRole || ctx.isSuperadmin) {
    const { data } = await admin.from("messages").select("tenant_id").eq("id", messageId).maybeSingle();
    if (!data) return { ok: false, status: 404, error: "Mensagem não encontrada" };
    return { ok: true, tenantId: data.tenant_id };
  }
  const { data, error } = await admin
    .from("messages")
    .select("tenant_id")
    .eq("id", messageId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404, error: "Mensagem não encontrada" };
  if (data.tenant_id !== ctx.tenantId) {
    return { ok: false, status: 403, error: "Recurso de outro tenant" };
  }
  return { ok: true, tenantId: data.tenant_id };
}
