// Fonte única dos papéis no BACKEND (espelha src/lib/roles.ts no frontend).
//
// Motivo de existir: cada edge function tinha a sua allowlist. Quando o papel
// "recepcao" foi criado, uma função não o conhecia e — pior — rebaixava para
// "crc" em silêncio, criando um usuário com permissão de ADMIN da clínica sem
// nenhum erro visível. Papel novo entra AQUI e em src/lib/roles.ts.

/** Papéis atribuíveis a usuários de um cliente (superadmin é da plataforma). */
export const TENANT_ROLES = ["crc", "gerente", "posvenda", "recepcao", "closer"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

const TENANT_ROLE_SET = new Set<string>(TENANT_ROLES);

export function isTenantRole(role: unknown): role is TenantRole {
  return typeof role === "string" && TENANT_ROLE_SET.has(role);
}

/**
 * Valida o papel pedido. NUNCA use fallback silencioso: rebaixar/elevar um papel
 * sem avisar é falha de segurança — quem pediu "recepcao" e recebeu "crc" ganhou
 * acesso de administrador sem saber.
 */
export function assertTenantRole(role: unknown): { ok: true; role: TenantRole } | { ok: false; error: string } {
  if (!isTenantRole(role)) {
    return {
      ok: false,
      error: `Papel inválido: ${JSON.stringify(role)}. Permitidos: ${TENANT_ROLES.join(", ")}.`,
    };
  }
  return { ok: true, role };
}
