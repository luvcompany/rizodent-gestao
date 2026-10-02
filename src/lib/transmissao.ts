/**
 * Status de uma transmissão (crm_broadcasts) para a tela — AUTO-7/AUTO-8.
 *
 * O servidor (broadcast-engine + funções broadcast_* do banco) é a fonte do
 * status; a tela só traduz e decide qual botão mostrar:
 *  - draft (Rascunho)            → "Enviar"
 *  - running (Em andamento)      → "Continuar envio" (sobrou gente e a
 *    corrente de execuções parou). Entre uma execução e a próxima o servidor
 *    mantém 'sending' (broadcast_concluir com p_vai_continuar): 'running' não
 *    aparece mais no meio de um envio que segue sozinho;
 *  - paused (Pausada)            → "Continuar envio" (WABA pausada pelo
 *    suporte, número sem conexão, envio instável — o motivo vem em ultimo_erro)
 *  - sending (Enviando) PARADO   → "Continuar envio" (sem pulso há 10 min: a
 *    execução morreu; o banco devolve as reservas presas)
 *  - sending ativo, completed, failed → sem botão.
 */

export type StatusTransmissao = "draft" | "sending" | "running" | "paused" | "completed" | "failed";

export type VarianteStatus =
  | "soft-slate"
  | "soft-info"
  | "soft-warning"
  | "soft-success"
  | "soft-destructive";

const STATUS: Record<StatusTransmissao, { rotulo: string; variante: VarianteStatus; dica: string }> = {
  draft: { rotulo: "Rascunho", variante: "soft-slate", dica: "Ainda não foi enviada." },
  sending: { rotulo: "Enviando", variante: "soft-info", dica: "O envio está em andamento agora." },
  running: {
    rotulo: "Em andamento",
    variante: "soft-info",
    dica: "O envio parou antes de terminar. Clique em Continuar envio para mandar aos que faltam.",
  },
  paused: {
    rotulo: "Pausada",
    variante: "soft-warning",
    dica: "O envio foi pausado e não retoma sozinho. Resolva o motivo e clique em Continuar envio para mandar aos que faltam.",
  },
  completed: { rotulo: "Concluída", variante: "soft-success", dica: "Todos os destinatários foram processados." },
  failed: { rotulo: "Falhou", variante: "soft-destructive", dica: "Nenhuma mensagem saiu." },
};

/** Sem pulso por este tempo, um 'sending' está parado (mesma regra de broadcast_iniciar). */
export const PARADA_APOS_MS = 10 * 60 * 1000;

export function statusDaTransmissao(status: string | null | undefined): {
  rotulo: string;
  variante: VarianteStatus;
  dica: string;
} {
  return STATUS[(status ?? "") as StatusTransmissao] ?? { rotulo: status || "—", variante: "soft-slate", dica: "" };
}

type TransmissaoParaBotao = {
  status: string | null | undefined;
  atividade_em?: string | null;
  created_at?: string | null;
};

/** 'sending' sem pulso há 10 min (a execução que enviava parou). */
export function envioParado(b: TransmissaoParaBotao, agora = Date.now()): boolean {
  if (b.status !== "sending") return false;
  // Sem pulso nenhum (coluna vazia): só o front antigo grava 'sending' assim,
  // antes de chamar o engine; o servidor aceita retomar (broadcast_iniciar).
  if (b.atividade_em === null) return true;
  const pulso = Date.parse(b.atividade_em || b.created_at || "");
  return Number.isFinite(pulso) && agora - pulso > PARADA_APOS_MS;
}

/** 'sending' com pulso recente: o envio está rodando (a lista se atualiza sozinha). */
export function envioAtivo(b: TransmissaoParaBotao, agora = Date.now()): boolean {
  return b.status === "sending" && !envioParado(b, agora);
}

/** Qual ação a linha oferece. */
export function acaoDaTransmissao(b: TransmissaoParaBotao, agora = Date.now()): "enviar" | "continuar" | null {
  if (b.status === "draft") return "enviar";
  if (b.status === "running" || b.status === "paused") return "continuar";
  if (envioParado(b, agora)) return "continuar";
  return null;
}
