// Notificações do NAVEGADOR (as do sistema operacional), pelas preferências
// que o usuário grava em CRM › Configurações › Notificações
// (crm_notification_preferences).
//
// Por que existe (INTEG-4): a aba gravava "Notificar novo lead", "Notificar
// resposta de lead", "Notificar tarefa vencendo" e "Notificações do
// navegador", e NADA no sistema lia isso — o usuário ligava tudo, dava
// permissão, e nunca recebia aviso nenhum. Este módulo é o consumidor: quem
// avisa (o sino, pelo realtime de crm_notifications, e o lembrete de tarefas e
// consultas) pergunta aqui se pode mostrar, e só mostra quando:
//   1) o navegador tem Notification e a permissão é 'granted';
//   2) browser_push_enabled está ligado; e
//   3) a preferência do TIPO está ligada (novo lead, resposta, tarefa).
// Sem linha na tabela valem os DEFAULT dela: push desligado. Falha ao ler as
// preferências também não mostra nada (fail-closed): aviso indesejado no
// sistema operacional é pior que um aviso a menos — o sino e o toast continuam.
//
// Os textos da aba (status da permissão em PT-BR etc.) são do P13.

import { supabase } from "@/integrations/supabase/client";

/** Tipo de aviso ↔ interruptor da aba Notificações. */
export type TipoDeAviso = "novo_lead" | "resposta" | "tarefa";

export type PreferenciasDeNotificacao = {
  browser_push_enabled: boolean;
  notify_new_lead: boolean;
  notify_lead_reply: boolean;
  notify_task_due: boolean;
};

/** Os mesmos DEFAULT da tabela crm_notification_preferences (usuário sem linha). */
export const PREFERENCIAS_PADRAO: Readonly<PreferenciasDeNotificacao> = {
  browser_push_enabled: false,
  notify_new_lead: true,
  notify_lead_reply: true,
  notify_task_due: true,
};

const CAMPO_DO_TIPO: Record<TipoDeAviso, keyof PreferenciasDeNotificacao> = {
  novo_lead: "notify_new_lead",
  resposta: "notify_lead_reply",
  tarefa: "notify_task_due",
};

/** A aba salva e o próximo aviso já respeita (no máximo 1 min de atraso). */
const VALIDADE_DO_CACHE_MS = 60_000;

let cache: { userId: string; prefs: PreferenciasDeNotificacao; lidoEm: number } | null = null;
let leituraEmCurso: { userId: string; promessa: Promise<PreferenciasDeNotificacao> } | null = null;

/** Descarta o cache (a aba Notificações chama depois de salvar; os testes também). */
export function esquecerPreferenciasDeNotificacao(): void {
  cache = null;
  leituraEmCurso = null;
}

/**
 * Preferências do usuário, com cache de 1 minuto e UMA leitura por vez (dois
 * avisos juntos não fazem duas consultas).
 */
export async function preferenciasDeNotificacao(userId: string): Promise<PreferenciasDeNotificacao> {
  if (cache && cache.userId === userId && Date.now() - cache.lidoEm < VALIDADE_DO_CACHE_MS) {
    return cache.prefs;
  }
  if (leituraEmCurso && leituraEmCurso.userId === userId) return leituraEmCurso.promessa;

  const promessa = (async (): Promise<PreferenciasDeNotificacao> => {
    const { data, error } = await supabase
      .from("crm_notification_preferences")
      .select("browser_push_enabled, notify_new_lead, notify_lead_reply, notify_task_due")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      // Não guarda no cache: a próxima tentativa lê de novo.
      console.error("[notificacoesNavegador] preferências:", error.message);
      return { ...PREFERENCIAS_PADRAO };
    }
    const linha = (data ?? {}) as Partial<PreferenciasDeNotificacao>;
    const prefs: PreferenciasDeNotificacao = {
      browser_push_enabled: linha.browser_push_enabled ?? PREFERENCIAS_PADRAO.browser_push_enabled,
      notify_new_lead: linha.notify_new_lead ?? PREFERENCIAS_PADRAO.notify_new_lead,
      notify_lead_reply: linha.notify_lead_reply ?? PREFERENCIAS_PADRAO.notify_lead_reply,
      notify_task_due: linha.notify_task_due ?? PREFERENCIAS_PADRAO.notify_task_due,
    };
    cache = { userId, prefs, lidoEm: Date.now() };
    return prefs;
  })();

  leituraEmCurso = { userId, promessa };
  try {
    return await promessa;
  } finally {
    if (leituraEmCurso?.promessa === promessa) leituraEmCurso = null;
  }
}

/**
 * Tipo de aviso de uma linha de crm_notifications, ou null quando ela não é de
 * nenhum dos três interruptores (fica só no sino).
 *
 * As linhas não têm um tipo "novo lead"/"resposta" próprio; a regra abaixo
 * segue quem as grava hoje:
 *   - 'transfer' (transfer-lead: "Lead transferido para você") → novo lead;
 *   - 'bot_transfer' (bot-engine, nó "transferir para humano": "Bot
 *     transferiu para atendimento humano", sempre com lead) → novo lead: é o
 *     lead que o bot acabou de entregar a quem vai atender, como a
 *     transferência feita por uma pessoa;
 *   - 'rodizio' com lead, gravadas por rodizio_notifica ao ENTREGAR um lead a
 *     alguém ("Novo lead para você", "Lead realocado para você", "Lead
 *     recebido") → novo lead. As outras do rodízio (pagamento que não moveu,
 *     entrega não concluída, expediente…) são alertas de gestão: só no sino;
 *   - 'automation' de mensagem recebida ("Lead frio retornou!", "Palavra-chave
 *     detectada", do whatsapp-webhook) → resposta de lead.
 */
export function categoriaDaNotificacao(n: {
  type?: string | null;
  title?: string | null;
  lead_id?: string | null;
}): TipoDeAviso | null {
  const tipo = (n.type || "").trim().toLowerCase();
  const titulo = (n.title || "").trim();
  if (tipo === "transfer") return "novo_lead";
  if (tipo === "bot_transfer" && n.lead_id) return "novo_lead";
  if (tipo === "rodizio" && n.lead_id && /^(novo lead para você|lead realocado para você|lead recebido)/i.test(titulo)) {
    return "novo_lead";
  }
  if (tipo === "automation" && /^(lead frio retornou|palavra-chave detectada)/i.test(titulo)) {
    return "resposta";
  }
  return null;
}

/** Ícone da marca: o favicon que o BrandContext aplicou (o do cliente ou o padrão). */
function iconeDaMarca(): string {
  try {
    const link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    return link?.href || "/favicon.ico";
  } catch {
    return "/favicon.ico";
  }
}

/** A permissão do navegador está concedida (e ele tem notificações)? */
export function navegadorPermiteNotificar(): boolean {
  return typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";
}

/**
 * Mostra a notificação do navegador se o usuário quer receber este tipo.
 * Devolve true quando mostrou. Nunca lança: no pior caso não mostra.
 *
 * `tag` evita o aviso repetido quando há mais de uma aba (ou mais de um sino)
 * aberta: o navegador troca a notificação de mesma tag em vez de empilhar.
 */
export async function avisarNoNavegador(
  userId: string | null | undefined,
  tipo: TipoDeAviso,
  aviso: { titulo: string; corpo?: string | null; tag?: string; aoClicar?: () => void },
): Promise<boolean> {
  if (!userId || !navegadorPermiteNotificar()) return false;
  try {
    const prefs = await preferenciasDeNotificacao(userId);
    if (!prefs.browser_push_enabled || !prefs[CAMPO_DO_TIPO[tipo]]) return false;
    // A permissão pode ter sido revogada enquanto líamos.
    if (!navegadorPermiteNotificar()) return false;
    const n = new Notification(aviso.titulo, {
      body: aviso.corpo || undefined,
      icon: iconeDaMarca(),
      tag: aviso.tag,
    });
    n.onclick = () => {
      try {
        window.focus();
        aviso.aoClicar?.();
      } finally {
        n.close();
      }
    };
    return true;
  } catch (e) {
    // Ex.: Chrome no Android recusa `new Notification` fora de service worker.
    console.error("[notificacoesNavegador] não foi possível notificar:", e);
    return false;
  }
}
