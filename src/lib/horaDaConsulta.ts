// Hora de uma consulta (crm_appointments.scheduled_date + scheduled_time) como
// INSTANTE, no fuso da clínica (tenants.timezone, via src/lib/fuso.ts).
//
// Por que existe (X-1): scheduled_date é `date` ("2026-09-29"). O jeito antigo
// — new Date(scheduled_date) + setHours(h, m) — lê a data como meia-noite UTC,
// que no Brasil é o DIA ANTERIOR às 21:00, e o setHours aplicava a hora nesse
// dia errado: o aviso "Agendamento em N min" nunca disparava (a consulta das
// 10:00 de hoje virava a de ontem, diferença negativa). E "hoje" tirado de
// toISOString() é o dia UTC: das 21:00 às 23:59 a busca pegava o dia seguinte.
// Aqui não há Date com hora local em lugar nenhum: a data e a hora são
// quebradas em números e convertidas por instanteNoFusoMs.

import { diaNoFuso, instanteNoFusoMs } from "@/lib/fuso";

/**
 * Instante (ms epoch) do horário marcado, no fuso da clínica. NaN quando a data
 * ou a hora não estão no formato do banco (YYYY-MM-DD / HH:MM[:SS]).
 */
export function instanteDaConsultaMs(scheduledDate: string, scheduledTime?: string | null): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(scheduledDate || "");
  const h = /^(\d{1,2}):(\d{2})/.exec(scheduledTime || "00:00");
  if (!d || !h) return NaN;
  return instanteNoFusoMs(+d[1], +d[2], +d[3], +h[1], +h[2]);
}

/** "Hoje" (YYYY-MM-DD) no fuso da clínica — nunca o dia UTC. */
export function hojeNoFusoDaClinica(agora: Date = new Date()): string {
  return diaNoFuso(agora);
}

/**
 * Minutos que faltam para a consulta, arredondados para cima, quando ela cai
 * dentro da janela de aviso (0 < faltam ≤ janelaMin); null fora dela, já
 * passada ou com data/hora inválida.
 */
export function minutosParaAviso(
  scheduledDate: string,
  scheduledTime: string | null | undefined,
  agoraMs: number,
  janelaMin: number,
): number | null {
  const alvo = instanteDaConsultaMs(scheduledDate, scheduledTime);
  if (Number.isNaN(alvo)) return null;
  const diff = alvo - agoraMs;
  if (diff < 0 || diff > janelaMin * 60_000) return null;
  return Math.max(1, Math.ceil(diff / 60_000));
}
