/**
 * O bot ainda tem o direito de falar com este lead?
 *
 * Defeito relatado em 30/09/2026: o lead sai da etapa de follow-up (a SDR move
 * para Relacionamento, ou o dono devolve para Conversando) e o bot continua
 * mandando as mensagens seguintes, porque nada cancela a execução na troca de
 * etapa — nem gatilho no banco, nem o motor.
 *
 * A trava vale só para a continuação por TEMPO (timeout). Se o lead escreveu,
 * ele está conversando: o motor responde onde quer que ele esteja.
 *
 * Duas exceções deliberadas:
 *   - bot iniciado à mão (sem automação de etapa) não pertence a etapa nenhuma;
 *   - se foi o PRÓPRIO bot que moveu o lead, ele continua — senão todo fluxo
 *     que muda de etapa no meio se mataria no passo seguinte.
 */
export function botDeveParar(args: {
  /** Etapa em que o lead está agora. */
  stageAtual: string | null | undefined;
  /** Etapa da automação que iniciou o bot (null = início manual). */
  stageDaAutomacao: string | null | undefined;
  /** Etapa para onde o próprio bot mandou o lead durante o fluxo. */
  stageDoBot?: string | null;
}): boolean {
  const { stageAtual, stageDaAutomacao, stageDoBot } = args;
  if (!stageDaAutomacao) return false;
  if (!stageAtual) return false;
  if (stageAtual === stageDaAutomacao) return false;
  if (stageDoBot && stageAtual === stageDoBot) return false;
  return true;
}

/** Chave onde o motor guarda a etapa para a qual o próprio bot mandou o lead. */
export const CHAVE_ETAPA_DO_BOT = "__etapa_do_bot";
