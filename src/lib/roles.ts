// Fonte única dos papéis de usuário do app.
//
// Antes, cada ponto tinha a sua lista (dois seletores de UI, o diálogo de
// compartilhamento, allowlists em edge functions...). Ao adicionar o papel
// "recepcao" descobrimos o custo disso: ele aparecia numa tela e não na outra,
// e a função de criação caía silenciosamente em "crc". Papel novo entra AQUI.

export type AppRole = "crc" | "gerente" | "posvenda" | "recepcao" | "closer" | "superadmin" | "crc_legacy";

/** Papéis que um cliente (tenant) pode ter no dia a dia. */
export const TENANT_ROLES: { value: AppRole; label: string }[] = [
  { value: "crc", label: "CRC" },
  { value: "gerente", label: "Gerente" },
  { value: "posvenda", label: "Pós-venda" },
  { value: "recepcao", label: "Recepção" },
  { value: "closer", label: "Closer" },
];

export const ROLE_LABELS: Record<string, string> = {
  ...Object.fromEntries(TENANT_ROLES.map((r) => [r.value, r.label])),
  closer: "Closer",
  superadmin: "Superadmin",
  crc_legacy: "CRC (legado)",
};

export const ROLE_BADGE_CLASS: Record<string, string> = {
  gerente: "bg-primary/20 text-primary border-primary/30",
  crc: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  posvenda: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  recepcao: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  closer: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  superadmin: "bg-red-500/20 text-red-400 border-red-500/30",
};

export const roleLabel = (r: string | null | undefined) => (r ? ROLE_LABELS[r] ?? r : "—");
