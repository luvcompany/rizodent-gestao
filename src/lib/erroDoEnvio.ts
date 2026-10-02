import { motivoDoServidor } from "@/lib/erroDeFuncao";
import { FRASE_NUMERO_NAO_LIBERADO } from "@/lib/mensagemDeErro";

/**
 * Motivo de uma recusa de ENVIO (send-whatsapp-message, instagram-send-message,
 * bot-engine…) em PT-BR, para o toast do chat — CONV-3, S29P-3c, CRC-11.
 *
 * O supabase-js entrega o corpo de uma resposta não-2xx em `error.context`, e
 * o `error.message` é o fixo "Edge Function returned a non-2xx status code".
 * motivoDoServidor (src/lib/erroDeFuncao.ts) já lê o corpo; aqui entram as
 * coisas a mais que só o envio tem:
 *  - `codigo` 'waba_pausada'/'numero_pausado' (409 do send-whatsapp-message,
 *    combinado com a sessão 29) vira a MESMA frase do aviso do compositor;
 *  - `codigo` 'enviado_sem_registro': a Meta ACEITOU e só o histórico não
 *    gravou — quem chama trata como enviado (reenviar duplicaria a mensagem);
 *  - `user_message` (instagram-send-message, ligações) vem antes de `error`;
 *  - recusas que o servidor ainda escreve em inglês ("Cannot react…", "Meta
 *    media upload failed"…) viram frase PT-BR pelo mapa abaixo, e qualquer
 *    outro texto com cara de inglês (transporte, erro cru da Meta) vira o
 *    padrão de quem chama — inglês nunca chega à pessoa.
 */

/** Frase da pausa — a mesma do servidor (send-whatsapp-message) e do aviso do chat. */
export const FRASE_WABA_PAUSADA = "O WhatsApp desta clínica está pausado pelo suporte";
/** Placeholder do campo com o envio pausado. */
export const PLACEHOLDER_PAUSADO = "Envio pausado pelo administrador";
/** Cliente sem número para falar com o lead (CRC-11). */
export const FRASE_WHATSAPP_DESCONECTADO = "WhatsApp desconectado — conecte um número em Integrações";
/** Papéis da operação, que não têm a tela de Integrações. */
const PAPEIS_SEM_INTEGRACOES = new Set(["sdr", "recepcao", "closer", "posvenda"]);
function ehOperacao(papel: string | null | undefined): boolean {
  return !!papel && PAPEIS_SEM_INTEGRACOES.has(papel);
}
/** Aviso de cliente sem número, conforme o papel (só a operação confirmada lê "peça ao gerente"). */
export function fraseWhatsappDesconectado(papel: string | null | undefined): string {
  return ehOperacao(papel) ? FRASE_NUMERO_NAO_LIBERADO : FRASE_WHATSAPP_DESCONECTADO;
}
/** Aviso de número que não está pronto, conforme o papel. */
export function fraseNumeroDesconectado(nome: string | null | undefined, papel: string | null | undefined): string {
  const n = nome && nome.trim() ? nome : "WhatsApp";
  return ehOperacao(papel)
    ? `WhatsApp desconectado — peça ao gerente para reconectar o número “${n}”`
    : `WhatsApp desconectado — reconecte o número “${n}” em Integrações`;
}
/** O número por onde o lead seria atendido não é do acesso de quem está no chat. */
export const FRASE_SEM_ACESSO_AO_NUMERO = "Você não tem acesso ao número de WhatsApp deste lead";
/** A Meta aceitou a mensagem, mas o histórico não gravou (codigo 'enviado_sem_registro'). */
export const FRASE_ENVIADO_SEM_REGISTRO =
  "Mensagem enviada ao paciente, mas não foi registrada no histórico. Não envie de novo.";

/** Códigos estáveis de pausa que o servidor devolve (CODIGOS_DE_PAUSA). */
export const CODIGOS_DE_PAUSA = new Set(["waba_pausada", "numero_pausado"]);
export const CODIGO_ENVIADO_SEM_REGISTRO = "enviado_sem_registro";

const TEXTO_TECNICO = /non-2xx|edge function|failed to send a request|functionsfetcherror|functionshttperror|failed to fetch|networkerror/i;

/**
 * Recusas conhecidas que o servidor ainda escreve em inglês (send-whatsapp-
 * message, _shared/authz.ts, instagram-send-message). A tradução definitiva é
 * no servidor (pendência do P08); até lá, a tela nunca mostra o inglês.
 */
const RECUSAS_CONHECIDAS: [RegExp, string][] = [
  [/cannot react|has no whatsapp id/i, "Não dá para reagir a uma mensagem que não chegou ao WhatsApp"],
  [/whatsapp reaction error/i, "A Meta recusou a reação. Tente de novo"],
  [/meta media upload failed/i, "A Meta recusou o arquivo. Confira o formato e o tamanho e tente de novo"],
  [/unsupported media type/i, "Tipo de arquivo não aceito pelo WhatsApp"],
  [/missing media_url/i, "O arquivo não chegou ao servidor. Anexe de novo"],
  [/failed to download file from storage|media_url não permitida/i, "Não foi possível ler o arquivo anexado. Anexe de novo"],
  [/missing message for text type/i, "Escreva a mensagem antes de enviar"],
  [/missing lead_id/i, "Abra a conversa de novo e tente outra vez"],
  [/missing authorization header|^unauthorized$|invalid jwt|jwt expired/i, "Sua sessão expirou. Entre de novo"],
  [/instagram messaging permission denied/i, "A integração do Instagram ainda não tem permissão para enviar mensagens"],
  [/instagram 24h dm window expired/i, "A janela de 24h do Direct fechou. Aguarde a pessoa escrever de novo"],
  [/no inbound dm thread/i, "Este lead não tem conversa por Direct com esta conta do Instagram"],
];

/** Sinais de PT-BR: acento, cedilha ou palavra funcional comum. */
const SINAL_DE_PORTUGUES = /[áàâãéêíóôõúç]|\b(não|nao|sem|de|do|da|dos|das|para|com|um|uma|este|esta|deste|desta|mensagem|número|numero|envio|tente|conta|arquivo|lead|cliente)\b/i;
/** Palavras típicas de erro em inglês (Meta, Deno, supabase-js). */
const SINAL_DE_INGLES = /\b(the|is|has|not|no|failed|error|invalid|missing|cannot|unsupported|permission|denied|expired|unknown|request|parameter|message|unable|must|does|should|was|were)\b/i;

/** Texto que não deve chegar à pessoa como está (transporte ou inglês cru). */
function pareceIngles(texto: string): boolean {
  return TEXTO_TECNICO.test(texto) || (SINAL_DE_INGLES.test(texto) && !SINAL_DE_PORTUGUES.test(texto));
}

/**
 * Texto do servidor pronto para o toast: recusa conhecida → frase PT-BR;
 * inglês/transporte → `padrao`; o resto (já em PT-BR) passa como veio.
 */
export function traduzirMotivo(texto: string | null | undefined, padrao: string): string {
  const t = String(texto ?? "").trim();
  if (!t) return padrao;
  for (const [re, frase] of RECUSAS_CONHECIDAS) if (re.test(t)) return frase;
  return pareceIngles(t) ? padrao : t;
}

type Corpo = {
  error?: unknown;
  user_message?: unknown;
  codigo?: unknown;
  code?: unknown;
  whatsapp_message_id?: unknown;
};

async function corpoDaResposta(data: unknown, error: unknown): Promise<Corpo> {
  if (data && typeof data === "object") return data as Corpo;
  const ctx = (error && typeof error === "object" ? (error as { context?: unknown }).context : null) as
    | { clone?: () => Response }
    | null;
  if (ctx && typeof ctx.clone === "function") {
    try {
      const corpo = await ctx.clone().json();
      if (corpo && typeof corpo === "object") return corpo as Corpo;
    } catch {
      /* corpo não-JSON */
    }
  }
  return {};
}

export type MotivoDoEnvio = {
  /** Texto para mostrar (PT-BR). */
  texto: string;
  /** A recusa foi a pausa do WhatsApp (quem mostra o aviso deve reconsultar o estado). */
  pausado: boolean;
  /**
   * A Meta aceitou e só o histórico não gravou ('enviado_sem_registro'): quem
   * chama trata como ENVIADO — não marca erro, não devolve o texto à caixa e
   * mostra FRASE_ENVIADO_SEM_REGISTRO (reenviar duplicaria para o paciente).
   */
  semRegistro: boolean;
  /** wamid da mensagem aceita pela Meta (só com semRegistro). */
  wamid: string | null;
};

export async function motivoDoEnvio(data: unknown, error: unknown, padrao: string): Promise<MotivoDoEnvio> {
  const corpo = await corpoDaResposta(data, error);
  const codigo = String(corpo.codigo ?? corpo.code ?? "");
  const base = { pausado: false, semRegistro: false, wamid: null };
  if (codigo === CODIGO_ENVIADO_SEM_REGISTRO) {
    const wamid = typeof corpo.whatsapp_message_id === "string" ? corpo.whatsapp_message_id : null;
    return { ...base, texto: FRASE_ENVIADO_SEM_REGISTRO, semRegistro: true, wamid };
  }
  if (CODIGOS_DE_PAUSA.has(codigo)) return { ...base, texto: FRASE_WABA_PAUSADA, pausado: true };
  if (typeof corpo.user_message === "string" && corpo.user_message.trim()) {
    // user_message do Instagram pode ser o texto cru da Meta (em inglês).
    return { ...base, texto: traduzirMotivo(corpo.user_message, padrao) };
  }
  const texto = await motivoDoServidor(data, error, padrao);
  return { ...base, texto: traduzirMotivo(texto, padrao) };
}

/** Resposta de envio que deu errado: erro de transporte, `ok: false` ou `error` no corpo. */
export function envioFalhou(data: unknown, error: unknown): boolean {
  if (error) return true;
  const corpo = (data && typeof data === "object" ? data : {}) as { ok?: unknown; error?: unknown };
  return corpo.ok === false || !!corpo.error;
}
