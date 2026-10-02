// Fonte única dos papéis de usuário do app.
//
// Antes, cada ponto tinha a sua lista (dois seletores de UI, o diálogo de
// compartilhamento, allowlists em edge functions...). Ao adicionar o papel
// "recepcao" descobrimos o custo disso: ele aparecia numa tela e não na outra,
// e a função de criação caía silenciosamente em "crc". Papel novo entra AQUI.
//
// MODELO (decisão do dono, 29/09/2026 — migration 20260929002000):
//   gerente = o dono / administrador da clínica: vê todos os números e funis,
//             tem a lixeira, reabre desfechos e é o(a) gestor(a) da equipe por
//             padrão. O que ele cria (bot, modelo, resposta rápida…) nasce no
//             mundo do crc (owner_role 'crc'), para CRC e SDR enxergarem.
//   crc     = atendimento da central (o mundo do número principal), sem
//             administração. Continua com os poderes operacionais (funis,
//             etapas, automações, bots, modelos, IA).
// Gestão da clínica (lixeira, reabrir desfecho, telas de closer) é do gerente;
// use `ehGestaoDaClinica` em vez de repetir a comparação. A gestão da EQUIPE
// (SDRs, ponto, relatório) é outra coisa: é de UMA pessoa nomeada (ver
// useGestorEquipe), que por padrão é o gerente.
// Nunca dar dois papéis ao mesmo usuário: o AuthContext lê user_roles com
// maybeSingle.

export type AppRole = "crc" | "gerente" | "posvenda" | "recepcao" | "closer" | "sdr" | "superadmin" | "crc_legacy";

/** Papéis que um cliente (tenant) pode ter no dia a dia. */
export const TENANT_ROLES: { value: AppRole; label: string; descricao: string }[] = [
  {
    value: "crc",
    label: "CRC",
    descricao: "Atendimento da central (número principal), sem administração",
  },
  {
    value: "gerente",
    label: "Gerente",
    descricao: "Administra a clínica: todos os números e funis, lixeira, reabre desfechos, gestor da equipe",
  },
  { value: "posvenda", label: "Pós-venda", descricao: "Acompanha o paciente depois da venda (funil de pós-venda)" },
  { value: "recepcao", label: "Recepção", descricao: "Agenda e confirma consultas no número da recepção" },
  { value: "closer", label: "Closer", descricao: "Fecha o tratamento com o paciente no número do closer" },
  // SDR do rodízio: isolada por "leads dela" (crm_leads.assigned_to), não por
  // número — opera o número principal do cliente (mundo do CRC).
  { value: "sdr", label: "SDR", descricao: "Atende os leads que o rodízio entrega a ela" },
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
  recepcao: "bg-warning/15 text-foreground border-warning/40 dark:text-warning",
  closer: "bg-warning/15 text-foreground border-warning/40 dark:text-warning",
  sdr: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  superadmin: "bg-red-500/20 text-red-400 border-red-500/30",
};

export const roleLabel = (r: string | null | undefined) => (r ? ROLE_LABELS[r] ?? r : "—");

/**
 * Gestão da clínica (lixeira, reabrir desfecho, mudar data de consulta com
 * desfecho, telas de closer): gerente ou superadmin — a mesma régua do banco
 * (stamp_appointment_update, deleted_leads_backup). O crc NÃO entra: é papel de
 * atendimento.
 */
export const ehGestaoDaClinica = (role: string | null | undefined): boolean =>
  role === "gerente" || role === "superadmin";
