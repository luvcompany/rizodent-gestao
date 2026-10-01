// Fonte única dos papéis de usuário do app.
//
// Antes, cada ponto tinha a sua lista (dois seletores de UI, o diálogo de
// compartilhamento, allowlists em edge functions...). Ao adicionar o papel
// "recepcao" descobrimos o custo disso: ele aparecia numa tela e não na outra,
// e a função de criação caía silenciosamente em "crc". Papel novo entra AQUI.

export type AppRole = "crc" | "gerente" | "posvenda" | "recepcao" | "closer" | "sdr" | "superadmin" | "crc_legacy";

/** Papéis que um cliente (tenant) pode ter no dia a dia. */
export const TENANT_ROLES: { value: AppRole; label: string }[] = [
  { value: "crc", label: "CRC" },
  { value: "gerente", label: "Gerente" },
  { value: "posvenda", label: "Pós-venda" },
  { value: "recepcao", label: "Recepção" },
  { value: "closer", label: "Closer" },
  // SDR do rodízio: isolada por "leads dela" (crm_leads.assigned_to), não por
  // número — opera o número principal do cliente (mundo do CRC).
  { value: "sdr", label: "SDR" },
];

export const ROLE_LABELS: Record<string, string> = {
  ...Object.fromEntries(TENANT_ROLES.map((r) => [r.value, r.label])),
  closer: "Closer",
  superadmin: "Superadmin",
  crc_legacy: "CRC (legado)",
};

export const ROLE_BADGE_CLASS: Record<string, string> = {
  gerente: "bg-primary/20 text-primary border-primary/30",
  crc: "border-info/30 bg-info-soft text-info-soft-foreground",
  posvenda: "border-success/30 bg-success-soft text-success-soft-foreground",
  recepcao: "border-warning/30 bg-warning-soft text-warning-soft-foreground",
  closer: "border-warning/30 bg-warning-soft text-warning-soft-foreground",
  sdr: "border-purple/30 bg-purple-soft text-purple-soft-foreground",
  superadmin: "border-destructive/30 bg-destructive-soft text-destructive-soft-foreground",
};

export const roleLabel = (r: string | null | undefined) => (r ? ROLE_LABELS[r] ?? r : "—");
