// IDs de usuários ocultos dos seletores do CRM (dropdowns de responsável,
// filtros, atribuição, transferência, etc). Ainda existem no banco para não
// quebrar o histórico, mas não aparecem em nenhuma UI de escolha.
export const HIDDEN_USER_IDS = new Set<string>([
  "70f9395c-cc40-48fa-86f6-2f7924c5cf84", // Meta App Review
]);

export function isHiddenUser(id: string | null | undefined): boolean {
  return !!id && HIDDEN_USER_IDS.has(id);
}

export function filterVisibleUsers<T extends { id: string }>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).filter((r) => !HIDDEN_USER_IDS.has(r.id));
}

/** Filtro PostgREST `.not('id','in','(...)')` para excluir usuários ocultos. */
export const HIDDEN_USER_IDS_PG = `(${[...HIDDEN_USER_IDS].join(",")})`;

