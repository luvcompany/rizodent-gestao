import { supabase } from "@/integrations/supabase/client";

type LogParams = {
  userId: string;
  email: string;
  tenantId?: string | null;
  context: "admin" | "client";
  event: "login" | "logout" | "login_blocked" | "login_failed";
};

export async function logAccess(p: LogParams) {
  try {
    await (supabase as any).from("access_logs").insert({
      user_id: p.userId,
      email: p.email,
      tenant_id: p.tenantId ?? null,
      context: p.context,
      event: p.event,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
  } catch (e) {
    console.warn("[access-log] failed", e);
  }
}

/** Returns true if user is blocked (and signs them out). */
export async function enforceBlockCheck(userId: string, email: string, context: "admin" | "client") {
  const { data: prof } = await supabase
    .from("profiles")
    .select("is_blocked, tenant_id")
    .eq("id", userId)
    .maybeSingle();
  const tenantId = (prof as any)?.tenant_id ?? null;
  if ((prof as any)?.is_blocked) {
    await logAccess({ userId, email, tenantId, context, event: "login_blocked" });
    await supabase.auth.signOut();
    return true;
  }
  await logAccess({ userId, email, tenantId, context, event: "login" });
  return false;
}
