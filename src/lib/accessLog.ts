import { supabase } from "@/integrations/supabase/client";

/**
 * Eventos de public.access_logs.
 *
 * O navegador só grava três (policy de INSERT "Anyone authenticated can insert
 * own access log": login, logout e login_blocked, sem ip e sem metadata). Todo
 * o resto é gravado pelo servidor: tenant-login, admin-manage-user,
 * admin-impersonate/impersonate-redeem, trocar-senha, os callbacks de
 * WhatsApp/Instagram e as funções do banco (gestor_equipe_definido). Os nomes
 * (rótulos em src/lib/eventosDeAcesso.ts) são os que esse código grava de
 * fato — CLIN-12: a tela procurava "user_blocked"/"user_unblocked", mas o
 * servidor grava "user_block"/"user_unblock", e o filtro "Bloqueios" nunca
 * achava nada.
 */
export type EventoDoNavegador = "login" | "logout" | "login_blocked";

// Rótulos: mapa único em src/lib/eventosDeAcesso.ts (o mesmo do painel
// admin). Reexportados aqui para a tela CRM › Logs de acesso.
export { ROTULOS_EVENTO_ACESSO, rotuloEventoAcesso } from "@/lib/eventosDeAcesso";

/** Grupos do filtro da tela Logs de acesso. */
export const GRUPOS_EVENTO_ACESSO = {
  logins: ["login", "logout"],
  falhas: ["login_failed", "senha_troca_falha", "reauth_failed", "impersonate_redeem_falha"],
  bloqueios: [
    "login_blocked", "user_block", "user_unblock", "user_blocked", "user_unblocked", "sdr_block", "sdr_unblock",
    "equipe_user_block", "equipe_user_unblock", "equipe_user_block_desfeito",
  ],
  usuarios: [
    "user_create", "sdr_create", "equipe_user_create", "user_set_role", "equipe_user_set_role",
    "user_set_email", "sdr_set_email", "equipe_user_set_email", "user_rename", "sdr_set_nome", "equipe_user_set_nome",
    "user_delete", "sdr_delete", "equipe_user_delete", "user_delete_email_reuse", "gestor_equipe_definido",
    "sessoes_encerradas", "sdr_sessoes_encerradas", "sdr_redistribuir_leads", "api4com_ramal_usuario",
  ],
  senhas: [
    "senha_alterada", "senha_redefinida", "senha_troca_falha", "user_reset_password", "sdr_reset_password",
    "equipe_user_reset_password",
  ],
  suporte: ["impersonate", "impersonate_redeem", "impersonate_redeem_falha", "reauth_failed"],
} as const satisfies Record<string, readonly string[]>;

export type GrupoEventoAcesso = keyof typeof GRUPOS_EVENTO_ACESSO;

type LogParams = {
  userId: string;
  email: string;
  tenantId?: string | null;
  context: "admin" | "client";
  // A policy de INSERT só aceita estes três eventos vindos do navegador
  // (sem ip e sem metadata); os demais só o servidor grava.
  event: EventoDoNavegador;
};

export async function logAccess(p: LogParams) {
  try {
    await (supabase as any).from("access_logs").insert({
      user_id: p.userId,
      email: p.email,
      tenant_id: p.tenantId ?? null,
      context: p.context,
      event: p.event,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
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
