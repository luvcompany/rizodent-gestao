import { CalendarDays, Clock, MessageSquare, Phone, type LucideIcon } from "lucide-react";

// Tipo de tarefa (crm_tasks.type): rótulo em PT-BR e ícone — fonte ÚNICA.
//
// Por que existe: cada tela tinha o seu mapa (Calendário, painel de tarefas do
// chat, Dashboard) e nenhum conhecia 'call' e 'follow_up', os valores que as
// automações e integrações gravam. A tarefa aparecia crua ("call") no
// Calendário e no diálogo, e o filtro "Ligação" não a encontrava. Aqui os
// sinônimos viram o tipo canônico da tela (ligacao / followup) para rótulo,
// ícone e filtro. O valor gravado no banco não muda.

/** Tipos que a tela oferece ao criar/filtrar, na ordem dos seletores. */
export const TIPOS_DE_TAREFA = ["agendamento", "ligacao", "followup", "personalizado"] as const;

export type TipoDeTarefa = (typeof TIPOS_DE_TAREFA)[number];

/** Valores gravados por outros caminhos (automação, integração) → tipo da tela. */
const SINONIMOS: Record<string, TipoDeTarefa> = {
  call: "ligacao",
  ligacao: "ligacao",
  "ligação": "ligacao",
  follow_up: "followup",
  "follow-up": "followup",
  followup: "followup",
  agendamento: "agendamento",
  personalizado: "personalizado",
};

export const ROTULO_TIPO_DE_TAREFA: Record<TipoDeTarefa, string> = {
  agendamento: "Agendamento",
  ligacao: "Ligação",
  followup: "Follow-up",
  personalizado: "Personalizado",
};

const ICONE_TIPO_DE_TAREFA: Record<TipoDeTarefa, LucideIcon> = {
  agendamento: CalendarDays,
  ligacao: Phone,
  followup: MessageSquare,
  personalizado: Clock,
};

/** Tipo canônico da tela, ou null quando o valor é desconhecido. */
export function tipoDeTarefa(valor: string | null | undefined): TipoDeTarefa | null {
  const chave = (valor ?? "").trim().toLowerCase();
  return SINONIMOS[chave] ?? null;
}

/** "Ligação" para 'ligacao' e 'call'; valor desconhecido volta como veio (nunca vazio). */
export function rotuloTipoDeTarefa(valor: string | null | undefined): string {
  const tipo = tipoDeTarefa(valor);
  if (tipo) return ROTULO_TIPO_DE_TAREFA[tipo];
  const cru = (valor ?? "").trim();
  return cru || "Tarefa";
}

/** Ícone do tipo (relógio para desconhecido). */
export function iconeTipoDeTarefa(valor: string | null | undefined): LucideIcon {
  const tipo = tipoDeTarefa(valor);
  return tipo ? ICONE_TIPO_DE_TAREFA[tipo] : Clock;
}

/** A tarefa é do tipo do filtro? ('call' casa com "Ligação"). Filtro vazio = todas. */
export function tarefaDoTipo(valor: string | null | undefined, filtro: string | null | undefined): boolean {
  if (!filtro) return true;
  const tipoDoFiltro = tipoDeTarefa(filtro);
  if (!tipoDoFiltro) return (valor ?? "") === filtro;
  return tipoDeTarefa(valor) === tipoDoFiltro;
}
