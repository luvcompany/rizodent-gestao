// IDs de usuários ocultos dos seletores do CRM (dropdowns de responsável,
// filtros, atribuição, transferência, etc). Ainda existem no banco para não
// quebrar o histórico, mas não aparecem em nenhuma UI de escolha.
export const HIDDEN_USER_IDS = new Set<string>([
  // O id antigo aqui não existia em profiles — o usuário do Meta App Review
  // (meta.review@crclin.com.br) aparecia em todos os seletores de responsável.
  "f9042a25-9150-4ee9-8865-fa437047629c", // Meta App Review
]);

export function isHiddenUser(id: string | null | undefined): boolean {
  return !!id && HIDDEN_USER_IDS.has(id);
}

export function filterVisibleUsers<T extends { id: string }>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).filter((r) => !HIDDEN_USER_IDS.has(r.id));
}

/** Filtro PostgREST `.not('id','in','(...)')` para excluir usuários ocultos. */
export const HIDDEN_USER_IDS_PG = `(${[...HIDDEN_USER_IDS].join(",")})`;

