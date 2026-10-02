import { addDays } from "date-fns";
import { ehGestaoDaClinica } from "@/lib/roles";
import type { Horario } from "@/lib/horarioComercial";
import { diaNoFuso } from "@/lib/fuso";

// Regras da agenda que o Calendário (e o Início da recepção) precisam decidir
// na tela — sempre espelhando o que o BANCO aceita, para a tela não oferecer
// botão que só serve para dar erro:
//   • excluir agendamento = RPC sdr_excluir_agendamento (migration 20260929002041);
//   • reabrir desfecho = gatilho stamp_appointment_update (gestão da clínica);
//   • desfecho antecipado = gatilho trg_a_desfecho_nao_antecipado (migration
//     20260929002320, SDR-01): no dia da consulta qualquer papel registra, mesmo
//     antes do horário; em dia futuro, só a gestão;
//   • dias e horas da grade = horário comercial do cliente (tenants.business_hours);
//   • agenda por cidade = número de unidades ativas (RPC agenda_quantas_unidades,
//     migration 20260929002320, AGENDA-8).

/** Consulta ainda em aberto: 'confirmed' (agendada) ou 'pending' (criada por bot/API, aguardando a equipe). */
export function consultaAberta(status: string | null | undefined): boolean {
  const s = (status ?? "").trim().toLowerCase();
  return s === "confirmed" || s === "pending";
}

/**
 * Origens AUTOMÁTICAS de contrato — a mesma lista das RPCs sdr_corrigir_desfecho
 * / sdr_excluir_agendamento e do AppointmentConfirmBar: o contrato segue a
 * origem (pagamento, etapa de contrato, integração ou Dontus).
 */
export function origemAutomaticaDeContrato(fonte: string | null | undefined): boolean {
  const f = fonte || "";
  return f === "pagamento_apos_carencia" || f === "auto_stage_contratado" || f === "service"
    || f.startsWith("dontus-sync");
}

export interface ConsultaParaRegra {
  status: string | null | undefined;
  outcome_source?: string | null;
}

/** Papéis que a RPC sdr_excluir_agendamento aceita (a SDR só nos leads dela — o banco confere). */
const PAPEIS_QUE_EXCLUEM = new Set(["sdr", "crc", "gerente", "superadmin"]);

/**
 * "Excluir agendamento" (status 'cancelled' + motivo + nota no chat, pela RPC):
 * aparece só quando a RPC aceitaria. Remarcada (é o histórico da remarcação) e
 * já excluída, nunca; contrato automático, nunca; contrato marcado à mão, só a
 * gestão da clínica (ou a própria marca da SDR).
 */
export function podeExcluirAgendamento(papel: string | null | undefined, consulta: ConsultaParaRegra): boolean {
  if (!papel || !PAPEIS_QUE_EXCLUEM.has(papel)) return false;
  const status = (consulta.status ?? "").trim().toLowerCase();
  if (status === "cancelled" || status === "rescheduled") return false;
  if (status === "contracted") {
    if (origemAutomaticaDeContrato(consulta.outcome_source)) return false;
    return ehGestaoDaClinica(papel) || (consulta.outcome_source || "") === "sdr";
  }
  return true;
}

/**
 * "Reabrir" um desfecho: só a gestão da clínica (a régua do gatilho
 * stamp_appointment_update). Remarcada não reabre (vale a consulta nova) e o
 * contrato do pagamento/integração/Dontus segue a origem. O contrato
 * automático pela ETAPA ('auto_stage_contratado') reabre aqui: é o caminho que
 * o chat indica ("tire o lead da etapa de contrato e reabra pelo Calendário").
 */
export function podeReabrirAgendamento(papel: string | null | undefined, consulta: ConsultaParaRegra): boolean {
  if (!ehGestaoDaClinica(papel)) return false;
  const status = (consulta.status ?? "").trim().toLowerCase();
  if (!status || consultaAberta(status) || status === "rescheduled") return false;
  if (status === "contracted") {
    const f = consulta.outcome_source || "";
    if (f === "pagamento_apos_carencia" || f === "service" || f.startsWith("dontus-sync")) return false;
  }
  return true;
}

/**
 * A consulta é num dia FUTURO no fuso da clínica? No próprio dia da consulta
 * o desfecho pode ser registrado mesmo antes do horário (paciente adiantado —
 * decisão do dono, 30/09/2026); a mesma régua está no gatilho SDR-01.
 */
export function consultaEmDiaFuturo(scheduledDate: string | null | undefined, agora: number = Date.now()): boolean {
  if (!scheduledDate) return false;
  return scheduledDate.slice(0, 10) > diaNoFuso(agora);
}

/**
 * Registrar o desfecho ANTES do horário: no dia da consulta, qualquer papel
 * (com confirmação); em dia futuro, só a gestão — o banco recusa os outros
 * (SDR-01), então a tela só explica.
 */
export function podeAnteciparDesfecho(papel: string | null | undefined, diaFuturo = true): boolean {
  return !diaFuturo || ehGestaoDaClinica(papel);
}

/**
 * A leitura falhou porque o banco ainda não tem as colunas de presença (site
 * publicado antes da migration 20260929002100): 42703 do Postgres ou PGRST204
 * do PostgREST, citando presenca_confirmada.
 */
export function colunaDePresencaAusente(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const codigo = error.code || "";
  if (codigo !== "42703" && codigo !== "PGRST204") return false;
  return /presenca_confirmada/.test(error.message || "");
}

/** O dia da semana (0 = domingo) está aberto no horário comercial? Sem horário = desconhecido (null). */
export function diaDaSemanaAberto(horario: Horario | null | undefined, diaDaSemana: number): boolean | null {
  if (!horario) return null;
  return !!horario[String(diaDaSemana) as keyof Horario];
}

/**
 * Colunas da grade de agendamentos (AGENDA-9): segunda a sábado e, também, o
 * domingo quando a clínica abre no domingo OU quando há consulta no domingo
 * desta semana — consulta nunca some da grade. `inicioDaSemana` é a segunda.
 */
export function diasDaGradeDaSemana(
  inicioDaSemana: Date,
  horario: Horario | null | undefined,
  datasComConsulta: Iterable<string>,
  formatar: (d: Date) => string,
): Date[] {
  const semana = Array.from({ length: 7 }, (_, i) => addDays(inicioDaSemana, i));
  const domingo = semana[6];
  const chaveDomingo = formatar(domingo);
  let temConsultaNoDomingo = false;
  for (const d of datasComConsulta) {
    if (d === chaveDomingo) { temConsultaNoDomingo = true; break; }
  }
  const domingoAberto = diaDaSemanaAberto(horario, 0) === true;
  return domingoAberto || temConsultaNoDomingo ? semana : semana.slice(0, 6);
}

/**
 * Horas da visão semanal de tarefas (AGENDA-9): a faixa padrão 7h–20h,
 * ampliada para caber o expediente (abertura e fechamento de qualquer dia) e
 * todas as tarefas da semana — tarefa às 21h ou às 6h não some mais.
 */
export function horasDaGradeSemanal(horario: Horario | null | undefined, horasDasTarefas: Iterable<number>): number[] {
  let inicio = 7;
  let fim = 20;
  if (horario) {
    for (const janela of Object.values(horario)) {
      if (!janela) continue;
      const [abre, fecha] = janela;
      const hAbre = Number(abre.slice(0, 2));
      const [hFecha, mFecha] = fecha.split(":").map(Number);
      // Fecha às 18:00 → a última linha é a das 17h; às 18:30, a das 18h.
      const ultima = mFecha > 0 ? hFecha : hFecha - 1;
      if (Number.isFinite(hAbre)) inicio = Math.min(inicio, hAbre);
      if (Number.isFinite(ultima)) fim = Math.max(fim, ultima);
    }
  }
  for (const h of horasDasTarefas) {
    if (!Number.isFinite(h)) continue;
    inicio = Math.min(inicio, h);
    fim = Math.max(fim, h);
  }
  inicio = Math.max(0, inicio);
  fim = Math.min(23, fim);
  return Array.from({ length: fim - inicio + 1 }, (_, i) => inicio + i);
}

/**
 * AGENDA-8: a grade de agendamentos separa por cidade só em cliente com 2 ou
 * mais unidades ativas; com 0 ou 1, é uma linha só.
 *   • `quantasNoServidor` = agenda_quantas_unidades (vale para todo papel —
 *     inclusive a SDR, que não lê `clinicas`); null = ainda não chegou ou a
 *     RPC não existe (site publicado antes da migration);
 *   • sem ela, as unidades que a pessoa conseguiu ler; lista VAZIA quer dizer
 *     "não sei" (a SDR lê zero linhas mesmo com várias unidades), não "zero
 *     unidades" — aí decidem as cidades das consultas da semana, como antes.
 */
export function agendaSeparaPorCidade(
  quantasNoServidor: number | null | undefined,
  unidadesLidas: number,
  cidadesDasConsultas: number,
): boolean {
  if (typeof quantasNoServidor === "number") return quantasNoServidor >= 2;
  if (unidadesLidas > 0) return unidadesLidas >= 2;
  return cidadesDasConsultas >= 2;
}
