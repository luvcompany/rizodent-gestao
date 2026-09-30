/**
 * Quem merece um follow-up (gatilho no_response).
 *
 * A régua antiga exigia que o lead TIVESSE ESCRITO pelo menos uma vez. A
 * intenção era não cobrar retorno de quem está esperando resposta nossa — isso
 * continua valendo. O efeito colateral era o defeito relatado em 30/09/2026:
 * quem NUNCA respondeu (metade da etapa "Conversando" do funil Outros, 35 de
 * 70 leads) não tinha régua nenhuma e ficava parado para sempre.
 *
 * Agora são três situações, e só uma não cobra:
 *   - ninguém falou nada           → não cobra (não há conversa)
 *   - o lead falou por último      → não cobra (a dívida é nossa: responder)
 *   - nós falamos por último       → cobra depois do prazo, tenha ele
 *                                    respondido antes ou nunca
 */

export type EstadoDaConversa = {
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
};

export type DecisaoFollowUp = {
  cobrar: boolean;
  /** De quando conta o prazo (nossa última mensagem). */
  referencia: number;
  /** Para log e para o teto de lote: é alguém que nunca respondeu? */
  nuncaRespondeu: boolean;
  motivo: "sem conversa" | "a vez é nossa" | "prazo não venceu" | "parado demais" | "cobrar";
};

export function decidirFollowUp(
  estado: EstadoDaConversa,
  agoraMs: number,
  prazoMs: number,
): DecisaoFollowUp {
  const entrada = estado.lastInboundAt ? new Date(estado.lastInboundAt).getTime() : 0;
  const saida = estado.lastOutboundAt ? new Date(estado.lastOutboundAt).getTime() : 0;
  const nuncaRespondeu = !entrada;

  // Datas inválidas viram 0 — melhor não cobrar do que cobrar por engano.
  if (!saida || Number.isNaN(saida)) {
    return { cobrar: false, referencia: 0, nuncaRespondeu, motivo: "sem conversa" };
  }
  if (entrada && !Number.isNaN(entrada) && saida <= entrada) {
    return { cobrar: false, referencia: saida, nuncaRespondeu: false, motivo: "a vez é nossa" };
  }
  if (agoraMs - saida < prazoMs) {
    return { cobrar: false, referencia: saida, nuncaRespondeu, motivo: "prazo não venceu" };
  }
  // Teto de idade SÓ para quem nunca respondeu: são leads cuja janela de 24 h
  // nunca abriu. Medido em 30/09/2026: dos 57 alcançados, 32 tinham menos de
  // 30 dias e 25 estavam parados há MAIS DE 90 (um desde 16/04). Cutucar quem
  // sumiu há meses rende pouco e cobra caro — bloqueio derruba a qualidade do
  // número na Meta. Entre 30 e 90 dias não havia ninguém, então 30 é o corte
  // natural. Para incluir os antigos, é só aumentar este número.
  if (nuncaRespondeu && agoraMs - saida > IDADE_MAXIMA_SEM_RESPOSTA_DIAS * 24 * 60 * 60 * 1000) {
    return { cobrar: false, referencia: saida, nuncaRespondeu, motivo: "parado demais" };
  }
  return { cobrar: true, referencia: saida, nuncaRespondeu, motivo: "cobrar" };
}

/**
 * Teto de quantos "nunca respondeu" podem entrar numa mesma rodada do cron.
 * Sem ele, ligar a régua nova despejaria todo o passivo de uma vez (dezenas de
 * mensagens no mesmo minuto, em leads parados há semanas). Com ele, o estoque
 * escoa aos poucos e dá para acompanhar o resultado antes de continuar.
 */
export const MAX_NUNCA_RESPONDEU_POR_RODADA = 15;

/** Quem nunca respondeu só é cobrado se a nossa última mensagem for recente. */
export const IDADE_MAXIMA_SEM_RESPOSTA_DIAS = 30;
