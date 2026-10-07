import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { deduplicateTemplates } from "@/lib/templateUtils";
import { sortTemplatesByUsage } from "@/lib/templateUsage";
import { supabase } from "@/integrations/supabase/client";
import { anotarNoHistorico } from "@/lib/notaDeSistema";
import { gravarMotivoDesqualificacao } from "@/lib/desqualificacao";
import { avisarQueLeadMudou } from "@/lib/kanbanFresco";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { envioFalhou, motivoDoEnvio } from "@/lib/erroDoEnvio";
import { useEnvioDoLead } from "@/hooks/useEnvioDoLead";
import type { ModeloParaEnviar } from "@/components/chat/EnviarModeloDialog";

// Janela de mensagens por conversa (CONV-5). A conversa abre nas N mais
// RECENTES e "Carregar anteriores" traz as de antes, N por vez. Antes a
// consulta era sem limite e em ordem crescente: o PostgREST corta em 1.000
// linhas e devolvia as 1.000 MAIS ANTIGAS — as recentes sumiam e a janela de
// 24h "expirava" com o paciente acabando de escrever.
export const JANELA_DE_MENSAGENS = 300;
// Complemento da PRIMEIRA carga: com a janela cheia, mais uma leitura (até o
// teto de 1.000 linhas do PostgREST) ANTES de mostrar a conversa. Quem tinha
// até 1.000 mensagens continua vendo todas — sem isso, enquanto a tela não
// tiver o botão "Carregar anteriores" (P16), o histórico antigo das conversas
// longas ficaria inalcançável. Carregar antes de mostrar evita o salto da
// rolagem de inserir mensagens no topo depois. Só custa a 2ª leitura quem tem
// mais de 300 mensagens.
export const COMPLEMENTO_DA_PRIMEIRA_CARGA = 1000;

// Cache global para não buscar de novo ao alternar entre leads. Guarda a
// JANELA carregada (inclusive as páginas anteriores) e se ainda há mais.
const messageCache = new Map<string, { messages: ChatMessage[]; timestamp: number; temAnteriores?: boolean }>();
const CACHE_TTL = 5 * 60_000; // 5 minutes

export type ChatMessage = {
  id: string;
  lead_id: string;
  direction: string;
  type: string;
  content: string | null;
  media_url: string | null;
  status: string;
  created_at: string;
  whatsapp_message_id?: string | null;
  reply_to_message_id?: string | null;
  reactions?: { emoji: string; from: string }[];
  ad_headline?: string | null;
  ad_body?: string | null;
  ad_image_url?: string | null;
  ad_source_url?: string | null;
  ad_source_id?: string | null;
  ad_account_name?: string | null;
  sender_id?: string | null;
  error_reason?: string | null;
};

export type ChatStage = {
  id: string;
  name: string;
  color: string;
  position: number;
  pipeline_id: string;
};

const stageCache = { cacheKey: null as string | null, data: null as ChatStage[] | null, timestamp: 0 };
const STAGE_CACHE_TTL = 5 * 60_000;
const repairedMediaLeadCache = new Set<string>();

type ActivityToast = { id: string; content: string };

const CONFIRMED_STATUSES = new Set(["sent", "delivered", "read", "played", "accepted", "failed", "error", "system"]);

const normalizeOutboundStatus = (message: ChatMessage): ChatMessage => {
  if (message.direction !== "outbound") return message;
  // Keep all real statuses as-is; the UI now handles them properly
  return message;
};

// Janela em ms para "puxar" a mensagem inbound do anúncio para cima da resposta
// automática do bot. O webhook do click-to-WhatsApp geralmente chega alguns
// segundos depois do lead ser criado, mas visualmente ele precisa vir primeiro.
const AD_INBOUND_REORDER_WINDOW_MS = 10_000;

const hasAdContext = (m: ChatMessage): boolean => {
  const anyMsg = m as any;
  return Boolean(
    anyMsg?.ad_source_id ||
      anyMsg?.ad_headline ||
      anyMsg?.ad_body ||
      anyMsg?.ad_image_url ||
      anyMsg?.ad_source_url,
  );
};

const sortChatMessages = (list: ChatMessage[]): ChatMessage[] => {
  // Ordena por created_at; em caso de empate (ou diferença curta entre o webhook
  // do lead vindo de anúncio e o disparo automático do bot), a inbound com
  // contexto de anúncio vem antes da outbound para que o card do anúncio
  // apareça acima da resposta automática.
  return [...list].sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    const delta = Math.abs(ta - tb);

    // Reordenação especial: inbound com contexto de anúncio deve vir antes de
    // outbound automática (bot/audio de boas-vindas) mesmo que tenha chegado
    // alguns segundos depois.
    if (delta <= AD_INBOUND_REORDER_WINDOW_MS) {
      const aAdInbound = a.direction === "inbound" && hasAdContext(a);
      const bAdInbound = b.direction === "inbound" && hasAdContext(b);
      if (aAdInbound && b.direction === "outbound") return -1;
      if (bAdInbound && a.direction === "outbound") return 1;
    }

    if (ta !== tb) return ta - tb;
    const da = a.direction === "inbound" ? 0 : 1;
    const db = b.direction === "inbound" ? 0 : 1;
    return da - db;
  });
};

/** Colunas de messages que a tela lê mas o tipo ChatMessage não declara. */
type LinhaDaMensagem = ChatMessage & {
  channel?: string | null;
  deleted_at?: string | null;
  transcription?: string | null;
  template_snapshot?: unknown;
};

/** A linha mudou em algo que a tela mostra? (evita re-render a cada consulta) */
const mesmaMensagem = (a: LinhaDaMensagem, b: LinhaDaMensagem): boolean =>
  a.status === b.status &&
  a.content === b.content &&
  a.media_url === b.media_url &&
  a.error_reason === b.error_reason &&
  a.whatsapp_message_id === b.whatsapp_message_id &&
  a.deleted_at === b.deleted_at &&
  a.transcription === b.transcription &&
  a.ad_headline === b.ad_headline &&
  a.ad_body === b.ad_body &&
  a.ad_image_url === b.ad_image_url &&
  a.ad_source_url === b.ad_source_url &&
  a.ad_source_id === b.ad_source_id &&
  a.ad_account_name === b.ad_account_name &&
  JSON.stringify(a.reactions ?? []) === JSON.stringify(b.reactions ?? []) &&
  JSON.stringify(a.template_snapshot ?? null) === JSON.stringify(b.template_snapshot ?? null);

/**
 * Índice da mensagem OTIMISTA que a linha gravada `linha` confirma: saída,
 * ainda sem wamid, em status transitório e do mesmo tipo — a regra que o
 * INSERT do Realtime sempre usou, agora também para o polling. Só casa com ids
 * de `otimistas` (o que a tela criou e o banco ainda não devolveu). -1 = nada.
 */
export function indiceDaOtimista(lista: ChatMessage[], linha: ChatMessage, otimistas: ReadonlySet<string>): number {
  if (linha.direction !== "outbound" || !otimistas.size) return -1;
  return lista.findIndex((m) =>
    otimistas.has(m.id) &&
    m.direction === "outbound" &&
    !m.whatsapp_message_id &&
    !CONFIRMED_STATUSES.has(m.status) &&
    m.type === linha.type,
  );
}

/**
 * Junta mensagens vindas do banco na lista da tela — CONV-5: MESCLAR, nunca
 * substituir (a lista pode ter páginas anteriores e mensagens otimistas que o
 * banco ainda não devolveu). Mesmo id = troca pela versão do banco; id novo
 * que confirma uma otimista (indiceDaOtimista) = TOMA O LUGAR dela (senão o
 * polling que chega antes do Realtime deixava o balão duplicado); id novo =
 * entra. Devolve a MESMA lista quando nada mudou. Pura: não mexe em
 * `otimistas` (o hook limpa os ids que saíram da lista).
 */
export function mesclarMensagens(
  atual: ChatMessage[],
  doBanco: ChatMessage[],
  otimistas: ReadonlySet<string> = new Set(),
): ChatMessage[] {
  if (!doBanco.length) return atual;
  const posicao = new Map(atual.map((m, i) => [m.id, i] as const));
  const lista = [...atual];
  const pendentes = new Set(otimistas);
  let mudou = false;
  for (const m of doBanco) {
    const i = posicao.get(m.id);
    if (i === undefined) {
      const j = indiceDaOtimista(lista, m, pendentes);
      if (j >= 0) {
        pendentes.delete(lista[j].id);
        posicao.delete(lista[j].id);
        posicao.set(m.id, j);
        lista[j] = m;
      } else {
        posicao.set(m.id, lista.length);
        lista.push(m);
      }
      mudou = true;
    } else if (!mesmaMensagem(lista[i], m)) {
      lista[i] = m;
      mudou = true;
    }
  }
  return mudou ? sortChatMessages(lista) : atual;
}

/** created_at mais recente entre as mensagens que vieram do banco (não as otimistas). */
function ultimaDoBanco(lista: ChatMessage[], otimistas: Set<string>): string | null {
  let ultima: string | null = null;
  for (const m of lista) {
    if (otimistas.has(m.id)) continue;
    if (!ultima || m.created_at > ultima) ultima = m.created_at;
  }
  return ultima;
}

/** A mais antiga já carregada (a lista está em ordem crescente). */
function maisAntigaDoBanco(lista: ChatMessage[], otimistas: Set<string>): string | null {
  for (const m of lista) if (!otimistas.has(m.id)) return m.created_at;
  return null;
}

/** As N mensagens mais recentes do lead (ou anteriores a `ate`), em ordem crescente. */
async function buscarJanela(
  leadId: string,
  ate?: string,
  limite: number = JANELA_DE_MENSAGENS,
): Promise<{ lista: ChatMessage[]; erro: boolean }> {
  // Mensagens de lead mesclado (historico_de_lead_id) ficam na aba "Histórico anterior".
  let q = supabase.from("messages").select("*").eq("lead_id", leadId).is("historico_de_lead_id" as any, null);
  // lte + deduplicação pelo id: mensagens do histórico importado podem ter o
  // MESMO created_at, e lt pularia as que empatam com a mais antiga carregada.
  if (ate) q = q.lte("created_at", ate);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limite);
  if (error) return { lista: [], erro: true };
  const lista = ((data as unknown as ChatMessage[]) || []).map(normalizeOutboundStatus).reverse();
  return { lista, erro: false };
}

// ─── Modelos (templates) do lead ───

/** Linha de public.modelos_do_lead (migration 20260929002260). */
export type ModeloDoLead = {
  id: string;
  name: string;
  language: string | null;
  category: string | null;
  status: string;
  body_text: string | null;
  header_type: string | null;
  header_content: string | null;
  footer_text: string | null;
  buttons: unknown;
  waba_id: string | null;
  whatsapp_number_id: string | null;
  owner_role: string | null;
  created_at: string;
  updated_at: string;
  numero_de_envio_id: string | null;
};

/**
 * Modelos que o servidor aceita para o lead — CONV-8: só os da WABA do número
 * que vai enviar (RPC modelos_do_lead), deduplicados DENTRO da WABA (fica a
 * cópia do próprio número de envio) e ordenados pelo uso. Antes a lista
 * juntava as WABAs de todos os números do cliente e escolher um modelo da
 * outra WABA dava "Template não existe na WABA deste número".
 * Ambiente sem a migration (PGRST202): cai na leitura antiga, por cliente.
 */
export async function carregarModelosDoLead(
  leadId: string,
  tenantId: string | null | undefined,
): Promise<{ modelos: ModeloDoLead[]; erro: string | null }> {
  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
  }).rpc("modelos_do_lead", { p_lead_id: leadId });

  let linhas: ModeloDoLead[];
  if (error && error.code === "PGRST202" && tenantId) {
    const antigo = await supabase
      .from("crm_whatsapp_templates")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("status", "APPROVED")
      .order("created_at", { ascending: false });
    linhas = ((antigo.data as unknown as ModeloDoLead[]) ?? []).map((t) => ({ ...t, numero_de_envio_id: null }));
  } else if (error) {
    return { modelos: [], erro: error.message || "Não foi possível carregar os modelos deste lead." };
  } else {
    linhas = (data as ModeloDoLead[] | null) ?? [];
  }

  const numeroDeEnvio = linhas.find((l) => l.numero_de_envio_id)?.numero_de_envio_id ?? null;
  const deduplicados = deduplicateTemplates(linhas);
  return { modelos: await sortTemplatesByUsage(deduplicados, tenantId), erro: null };
}

type ModeloParaEnvio = { name: string; language?: string | null };

/**
 * Envio de um modelo (template) ao lead, com a mensagem otimista e os avisos —
 * o MESMO caminho para o Sheet de modelos (useChatConversation.sendTemplate) e
 * para o "/" do compositor (ChatInput). `componentes` = template_components
 * escolhidos na tela (CONV-15); sem eles o servidor preenche pela posição.
 * Recusa aparece com o motivo do servidor (CONV-3). Devolve se saiu.
 */
export async function enviarModeloAoLead(p: {
  leadId: string;
  modelo: ModeloParaEnvio;
  componentes?: unknown[];
  aoCriarOtimista: (m: ChatMessage) => void;
  aoConfirmar: (tempId: string, gravada?: ChatMessage) => void;
  aoFalhar: (tempId: string) => void;
}): Promise<{ ok: boolean; pausado: boolean }> {
  const tempId = crypto.randomUUID();
  const otimista: ChatMessage = {
    id: tempId,
    lead_id: p.leadId,
    direction: "outbound",
    // O servidor grava o modelo como type "text" com "📋 Template: nome" no
    // content; a otimista espelha esse formato para o Realtime substituí-la.
    type: "text",
    content: `📋 Template: ${p.modelo.name}`,
    media_url: null,
    status: "sending",
    created_at: new Date().toISOString(),
    whatsapp_message_id: null,
    reply_to_message_id: null,
  };
  p.aoCriarOtimista(otimista);

  try {
    const { data, error } = await supabase.functions.invoke("send-whatsapp-message", {
      body: {
        lead_id: p.leadId,
        type: "template",
        template_name: p.modelo.name,
        template_language: p.modelo.language || "pt_BR",
        ...(p.componentes && p.componentes.length > 0 ? { template_components: p.componentes } : {}),
      },
    });
    const gravada = (data as { message?: ChatMessage } | null)?.message;
    if (envioFalhou(data, error)) {
      const motivo = await motivoDoEnvio(data, error, "Não foi possível enviar o modelo");
      // A Meta aceitou e só o histórico não gravou: é ENVIADO (reenviar
      // duplicaria o modelo para o paciente).
      if (motivo.semRegistro) {
        p.aoConfirmar(tempId, { ...otimista, status: "sent", whatsapp_message_id: motivo.wamid });
        toast.warning(motivo.texto);
        return { ok: true, pausado: false };
      }
      // Recusa da Meta: o servidor grava a tentativa (status "failed", com o
      // texto que ia sair). Mostrar essa linha em vez do balão otimista.
      if (gravada) p.aoConfirmar(tempId, gravada);
      else p.aoFalhar(tempId);
      toast.error(`Modelo não enviado: ${motivo.texto}`);
      return { ok: false, pausado: motivo.pausado };
    }
    // A resposta traz a mensagem gravada — com template_snapshot, o texto exato
    // que o paciente recebeu.
    p.aoConfirmar(tempId, gravada ?? undefined);
    toast.success("Modelo enviado");
    return { ok: true, pausado: false };
  } catch {
    p.aoFalhar(tempId);
    toast.error("Não foi possível enviar o modelo. Confira a conexão e tente de novo.");
    return { ok: false, pausado: false };
  }
}

export function useChatConversation(leadId: string | null | undefined) {
  const { tenant } = useTenant();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stages, setStages] = useState<ChatStage[]>([]);
  const [loading, setLoading] = useState(true);

  // Janela de mensagens (CONV-5): há mensagens mais antigas que as carregadas?
  const [temAnteriores, setTemAnteriores] = useState(false);
  const [carregandoAnteriores, setCarregandoAnteriores] = useState(false);

  // Número de envio do lead: pausa da WABA e cliente sem número (S29P-3c, CRC-11).
  const envio = useEnvioDoLead(leadId);

  // Reply & Forward
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null);

  // Media preview
  const [mediaPreview, setMediaPreview] = useState<{ url: string; type: "image" | "video" } | null>(null);

  // Templates
  const [templates, setTemplates] = useState<any[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  // Modelo escolhido esperando a confirmação com prévia e variáveis (CONV-15).
  // Quem mostra o EnviarModeloDialog é a tela (P16 adota no Sheet de modelos).
  const [modeloEmConfirmacao, setModeloEmConfirmacao] = useState<ModeloParaEnviar | null>(null);

  // Activity toasts
  const [activityToasts, setActivityToasts] = useState<ActivityToast[]>([]);

  // Última inbound de WhatsApp consultada no banco (CONV-5).
  const [ultimaEntradaWaConsultada, setUltimaEntradaWaConsultada] = useState<string | null>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const initialLoadDone = useRef(false);
  const activeLeadRef = useRef<string | null>(leadId ?? null);
  const fetchRequestRef = useRef(0);
  // Espelho da lista para callbacks/intervalos (sem recriá-los a cada mensagem).
  const messagesRef = useRef<ChatMessage[]>([]);
  // Ids das mensagens otimistas (ainda sem linha no banco): ficam fora do
  // "a mais recente do banco" — o relógio do navegador pode estar adiantado.
  const otimistasRef = useRef<Set<string>>(new Set());
  // Otimistas que já apareceram na lista (para limpar quando saírem dela).
  const otimistasVistasRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    messagesRef.current = messages;
    // Otimista que saiu da lista (o banco a confirmou) deixa de ser otimista.
    // Só apaga ids que JÁ estiveram na lista: um id recém-criado ainda pode
    // não ter chegado a este render.
    if (!otimistasRef.current.size) return;
    const naTela = new Set(messages.map((m) => m.id));
    for (const id of otimistasRef.current) {
      if (naTela.has(id)) otimistasVistasRef.current.add(id);
      else if (otimistasVistasRef.current.has(id)) {
        otimistasRef.current.delete(id);
        otimistasVistasRef.current.delete(id);
      }
    }
  }, [messages]);

  const gravarCache = useCallback((alvo: string, lista: ChatMessage[], anteriores?: boolean) => {
    const atual = messageCache.get(alvo);
    messageCache.set(alvo, {
      messages: lista,
      timestamp: Date.now(),
      temAnteriores: anteriores ?? atual?.temAnteriores ?? false,
    });
  }, []);

  // Filtered templates
  const filteredTemplates = useMemo(() => {
    if (!templateSearch.trim()) return templates;
    const q = templateSearch.toLowerCase();
    return templates.filter(t => t.name.toLowerCase().includes(q) || (t.body_text || "").toLowerCase().includes(q));
  }, [templates, templateSearch]);

  // Last inbound message time (any type)
  const lastInboundAt = useMemo(() => {
    return [...messages].reverse().find((m) => m.direction === "inbound")?.created_at || null;
  }, [messages]);

  // Last inbound DM time (non-comment) for Instagram 24h window check.
  // Comments do NOT count for the Instagram DM window — only actual DMs do.
  const lastInboundDmAt = useMemo(() => {
    return [...messages]
      .reverse()
      .find((m) => m.direction === "inbound" && m.type !== "comment")
      ?.created_at || null;
  }, [messages]);

  // Última inbound do WhatsApp — para a janela de 24h do WhatsApp. Um lead transferido
  // do Instagram tem inbounds de IG que NÃO abrem sessão de WhatsApp na Meta, então a
  // janela do WhatsApp deve olhar só inbounds channel='whatsapp' (senão liberaria texto
  // livre e a Meta recusaria — força usar template para reabrir).
  // CONV-5: vem de consulta própria (a última pode estar fora da janela
  // carregada) e da lista (o Realtime traz a nova na hora); vale a mais recente.
  const lastInboundWaAt = useMemo(() => {
    const daLista = [...messages].reverse().find((m) => m.direction === "inbound" && (m as LinhaDaMensagem).channel === "whatsapp")?.created_at || null;
    if (!daLista) return ultimaEntradaWaConsultada;
    if (!ultimaEntradaWaConsultada) return daLista;
    return daLista > ultimaEntradaWaConsultada ? daLista : ultimaEntradaWaConsultada;
  }, [messages, ultimaEntradaWaConsultada]);

  const consultarUltimaEntradaWa = useCallback(async (alvo: string) => {
    const { data, error } = await supabase
      .from("messages")
      .select("created_at")
      .eq("lead_id", alvo)
      .eq("direction", "inbound")
      .eq("channel", "whatsapp")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || activeLeadRef.current !== alvo) return;
    setUltimaEntradaWaConsultada((data as { created_at?: string } | null)?.created_at ?? null);
  }, []);

  // ─── Cache stages globally ───
  const stagesLoadedRef = useRef(false);

  const fetchStages = useCallback(async () => {
    if (!tenant.id) return;
    if (stagesLoadedRef.current && stages.length > 0) return;

    if (stageCache.cacheKey === tenant.id && stageCache.data && Date.now() - stageCache.timestamp < STAGE_CACHE_TTL) {
      setStages(stageCache.data);
      stagesLoadedRef.current = true;
      return;
    }

    const { data } = await supabase.from("crm_stages").select("*").eq("tenant_id", tenant.id).order("position");
    if (data) {
      const nextStages = data as ChatStage[];
      stageCache.cacheKey = tenant.id;
      stageCache.data = nextStages;
      stageCache.timestamp = Date.now();
      setStages(nextStages);
      stagesLoadedRef.current = true;
    }
  }, [stages.length, tenant.id]);

  // ─── Fetch messages with cache ───
  // Busca a JANELA mais recente e MESCLA com o que já está na tela (páginas
  // anteriores e otimistas continuam). CONV-5.
  // `silencioso` = sem spinner (o polling de uma conversa ainda vazia não pode
  // trocar "Nenhuma mensagem ainda" pelo carregando a cada minuto).
  const fetchMessages = useCallback(async (skipCache = false, silencioso = false) => {
    const targetLeadId = leadId;
    if (!targetLeadId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    const requestId = ++fetchRequestRef.current;
    const isCurrentRequest = () => activeLeadRef.current === targetLeadId && fetchRequestRef.current === requestId;

    void consultarUltimaEntradaWa(targetLeadId);

    const buscarEMesclar = async () => {
      const janela = await buscarJanela(targetLeadId);
      if (janela.erro) {
        if (isCurrentRequest()) setLoading(false);
        return;
      }
      if (!isCurrentRequest()) return;
      let lista = janela.lista;
      // Só na primeira carga da conversa a janela diz se há anteriores; depois
      // quem sabe é o "Carregar anteriores".
      const primeiraCarga = messagesRef.current.length === 0;
      let temMais = lista.length === JANELA_DE_MENSAGENS;
      if (primeiraCarga && temMais) {
        // Complemento antes de mostrar (COMPLEMENTO_DA_PRIMEIRA_CARGA).
        const comp = await buscarJanela(targetLeadId, lista[0]?.created_at, COMPLEMENTO_DA_PRIMEIRA_CARGA);
        if (!isCurrentRequest()) return;
        if (!comp.erro) {
          const conhecidas = new Set(lista.map((m) => m.id));
          const antes = comp.lista.filter((m) => !conhecidas.has(m.id));
          lista = [...antes, ...lista];
          temMais = comp.lista.length === COMPLEMENTO_DA_PRIMEIRA_CARGA && antes.length > 0;
        }
      }
      setMessages((prev) => {
        if (activeLeadRef.current !== targetLeadId) return prev;
        const mesclada = mesclarMensagens(prev, lista, otimistasRef.current);
        gravarCache(targetLeadId, mesclada, primeiraCarga ? temMais : undefined);
        return mesclada;
      });
      if (primeiraCarga) setTemAnteriores(temMais);
      setLoading(false);
      // Media URLs are signed on-demand by ChatMessageContent's useSignedUrl, no upfront batch needed.
    };

    // Serve from cache instantly if available and fresh
    if (!skipCache) {
      const cached = messageCache.get(targetLeadId);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        if (isCurrentRequest()) {
          setMessages((prev) => (prev.length ? mesclarMensagens(prev, cached.messages as ChatMessage[], otimistasRef.current) : sortChatMessages(cached.messages as ChatMessage[])));
          setTemAnteriores(!!cached.temAnteriores);
          setLoading(false);
        }
        // Only refresh in background if cache is stale (>30s) to avoid wasting bandwidth
        if (Date.now() - cached.timestamp < 30_000) return;
        void buscarEMesclar();
        return;
      }
    }

    if (!silencioso && messagesRef.current.length === 0) setLoading(true);
    try {
      await buscarEMesclar();
    } catch (err) {
      console.error("[useChatConversation] Fetch error:", err);
      if (isCurrentRequest()) setLoading(false);
    }
  }, [leadId, consultarUltimaEntradaWa, gravarCache]);

  // Mensagens anteriores às carregadas (botão "Carregar anteriores" — P16 põe
  // o botão no topo da lista quando temAnteriores).
  const carregarAnteriores = useCallback(async () => {
    const alvo = leadId;
    if (!alvo || carregandoAnteriores) return;
    const maisAntiga = maisAntigaDoBanco(messagesRef.current, otimistasRef.current);
    if (!maisAntiga) return;
    setCarregandoAnteriores(true);
    try {
      const { lista, erro } = await buscarJanela(alvo, maisAntiga);
      if (activeLeadRef.current !== alvo) return;
      if (erro) {
        toast.error("Não foi possível carregar as mensagens anteriores. Tente de novo.");
        return;
      }
      const conhecidas = new Set(messagesRef.current.map((m) => m.id));
      const novas = lista.filter((m) => !conhecidas.has(m.id)).length;
      const aindaHa = lista.length === JANELA_DE_MENSAGENS && novas > 0;
      setMessages((prev) => {
        if (activeLeadRef.current !== alvo) return prev;
        const mesclada = mesclarMensagens(prev, lista, otimistasRef.current);
        gravarCache(alvo, mesclada, aindaHa);
        return mesclada;
      });
      setTemAnteriores(aindaHa);
    } finally {
      setCarregandoAnteriores(false);
    }
  }, [leadId, carregandoAnteriores, gravarCache]);


  useEffect(() => { fetchMessages(); fetchStages(); }, [fetchMessages, fetchStages]);

  useEffect(() => {
    activeLeadRef.current = leadId ?? null;
    initialLoadDone.current = false;
    otimistasRef.current = new Set();
    otimistasVistasRef.current = new Set();
    setReplyTo(null);
    setForwardMsg(null);
    setMediaPreview(null);
    setActivityToasts([]);
    setModeloEmConfirmacao(null);
    setUltimaEntradaWaConsultada(null);
    setCarregandoAnteriores(false);

    if (!leadId) {
      messagesRef.current = [];
      setMessages([]);
      setTemAnteriores(false);
      setLoading(false);
      return;
    }

    const cached = messageCache.get(leadId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      messagesRef.current = cached.messages as ChatMessage[];
      // Balão ainda "enviando" guardado no cache (a pessoa trocou de conversa
      // antes da confirmação) continua otimista: a linha do banco toma o
      // lugar dele em vez de entrar ao lado.
      for (const m of cached.messages) {
        if (m.direction === "outbound" && m.status === "sending" && !m.whatsapp_message_id) {
          otimistasRef.current.add(m.id);
          otimistasVistasRef.current.add(m.id);
        }
      }
      setMessages(cached.messages as ChatMessage[]);
      setTemAnteriores(!!cached.temAnteriores);
      setLoading(false);
      return;
    }

    messagesRef.current = [];
    setMessages([]);
    setTemAnteriores(false);
    setLoading(true);
  }, [leadId]);

  // ─── Repair legacy media (deferred, non-blocking, visible-tab-only) ───
  useEffect(() => {
    if (!leadId || repairedMediaLeadCache.has(leadId)) return;
    const timer = setTimeout(async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      repairedMediaLeadCache.add(leadId);
      try {
        if (activeLeadRef.current !== leadId) return;
        const { data, error } = await supabase.functions.invoke("repair-chat-media", {
          body: { leadId },
        });
        if (error) { console.error("[useChatConversation] Repair error:", error); return; }
        if (data?.repaired?.length) {
          console.log(`[useChatConversation] Repaired ${data.repaired.length} media`);
          fetchMessages(true);
        }
      } catch {
        repairedMediaLeadCache.delete(leadId);
      }
    }, 8000); // Defer 8s to not block initial render or quick lead-switching
    return () => clearTimeout(timer);
  }, [leadId, fetchMessages]);


  // ─── Scroll to bottom on initial load ───
  useEffect(() => {
    if (!initialLoadDone.current && messages.length > 0) {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
      });
      // Fallback for long conversations where DOM may not be fully rendered
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
      }, 150);
      initialLoadDone.current = true;
    }
  }, [messages]);

  // Reset on lead change
  useEffect(() => {
    initialLoadDone.current = false;
  }, [leadId]);

  // ─── Realtime subscription ───
  useEffect(() => {
    const targetLeadId = leadId;
    if (!targetLeadId) return;

    const channel = supabase
      .channel("chat-messages-" + targetLeadId)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "messages", filter: `lead_id=eq.${targetLeadId}`,
      }, (payload) => {
        if (activeLeadRef.current !== targetLeadId) return;
        const newMsg = normalizeOutboundStatus(payload.new as ChatMessage);
        setMessages((prev) => {
          if (activeLeadRef.current !== targetLeadId) return prev;
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          // A linha gravada toma o lugar da otimista que ela confirma (mesma
          // regra do polling: indiceDaOtimista). O id otimista sai de
          // otimistasRef no efeito da lista — nunca aqui dentro: o updater
          // pode rodar duas vezes (StrictMode) e a 2ª não acharia a otimista.
          const optimisticIdx = indiceDaOtimista(prev, newMsg, otimistasRef.current);
          if (optimisticIdx >= 0) {
            const updated = [...prev];
            updated[optimisticIdx] = newMsg;
            gravarCache(targetLeadId, updated);
            return updated;
          }
          const updated = sortChatMessages([...prev, newMsg]);
          gravarCache(targetLeadId, updated);
          return updated;
        });
      })
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "messages", filter: `lead_id=eq.${targetLeadId}`,
      }, (payload) => {
        if (activeLeadRef.current !== targetLeadId) return;
        setMessages((prev) => {
          if (activeLeadRef.current !== targetLeadId) return prev;
          const updatedMessage = normalizeOutboundStatus(payload.new as ChatMessage);
          const updated = prev.map((m) => m.id === updatedMessage.id ? updatedMessage : m);
          gravarCache(targetLeadId, updated);
          return updated;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [leadId, gravarCache]);

  // ─── Polling fallback (only when tab is visible; realtime handles most updates) ───
  // CONV-5: pede só o que chegou DEPOIS da última mensagem do banco já na tela
  // (gte + deduplicação pelo id, para não perder as que empatam no horário) e
  // mescla. Antes trocava a lista inteira pelas 1.000 mais antigas.
  useEffect(() => {
    const targetLeadId = leadId;
    if (!targetLeadId) return;

    const interval = setInterval(async () => {
      if (activeLeadRef.current !== targetLeadId) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const ultima = ultimaDoBanco(messagesRef.current, otimistasRef.current);
      if (!ultima) {
        void fetchMessages(true, true);
        return;
      }
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("lead_id", targetLeadId)
        .gte("created_at", ultima)
        .order("created_at", { ascending: true })
        .limit(JANELA_DE_MENSAGENS);
      if (error || !data || activeLeadRef.current !== targetLeadId) return;
      const novas = (data as unknown as ChatMessage[]).map(normalizeOutboundStatus);
      setMessages((prev) => {
        if (activeLeadRef.current !== targetLeadId) return prev;
        const mesclada = mesclarMensagens(prev, novas, otimistasRef.current);
        if (mesclada !== prev) gravarCache(targetLeadId, mesclada);
        return mesclada;
      });
    }, 60000); // 60s — realtime carries the load; this is just a safety net
    return () => clearInterval(interval);
  }, [leadId, fetchMessages, gravarCache]);


  // ─── Activity Toasts ───
  const dismissToast = useCallback((toastId: string) => {
    setActivityToasts((prev) => prev.filter((t) => t.id !== toastId));
  }, []);

  const showActivityToast = useCallback((content: string) => {
    const toastItem: ActivityToast = { id: Date.now().toString(), content };
    setActivityToasts((prev) => [...prev, toastItem]);
  }, []);

  // ─── Scrolling ───
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const scrollToMessage = useCallback((msgId: string) => {
    const el = messageRefs.current[msgId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary/50");
      setTimeout(() => el.classList.remove("ring-2", "ring-primary/50"), 2000);
    }
  }, []);

  // ─── Stage change ───
  const handleStageChange = useCallback(async (newStageId: string, currentStageId: string, onSuccess?: (stageId: string, pipelineId?: string) => void, newPipelineId?: string, motivo?: string) => {
    if (!leadId) return;

    const updatePayload: { stage_id: string; updated_at: string; pipeline_id?: string } = { stage_id: newStageId, updated_at: new Date().toISOString() };
    if (newPipelineId) updatePayload.pipeline_id = newPipelineId;

    // A conversa abre por uma função que enxerga leads de funis que a regra de
    // edição não libera. Sem conferir a linha afetada, mover de etapa "dava
    // certo", o histórico era escrito e a automação da etapa disparava — com o
    // lead parado onde estava.
    //
    // O retorno traz stage_id e pipeline_id GRAVADOS (não os pedidos): gatilhos
    // do banco podem ajustar o funil conforme a etapa, e a tela tem de mostrar
    // o que ficou na linha, não o que ela tentou escrever.
    const { data: movido, error } = await supabase
      .from("crm_leads")
      .update(updatePayload)
      .eq("id", leadId)
      .select("id, stage_id, pipeline_id");
    if (error) {
      // Recusa de gatilho vem com mensagem escrita em português para a pessoa
      // (lead do Instagram que não sai do funil, etapa de funil diferente do
      // que a tela mandou). Engolir isso num "Erro ao mover lead" apagava a
      // única explicação existente.
      toast.error(error.message ? `Não foi possível mover: ${error.message}` : "Erro ao mover lead");
      return;
    }
    if (!movido || movido.length === 0) {
      toast.error(
        newPipelineId
          ? "Seu perfil não tem permissão para mover este lead para esse funil. Peça ao gestor o acesso ao funil de destino."
          : "Seu perfil não tem permissão para mover este lead de etapa.",
      );
      return;
    }

    // O que o banco realmente gravou — é isso que volta para a tela.
    const gravado = movido[0] as { stage_id: string; pipeline_id: string | null };
    const stageGravado = gravado.stage_id || newStageId;
    const pipelineGravado = gravado.pipeline_id || newPipelineId;
    if (stageGravado !== newStageId) {
      toast.error("O banco gravou uma etapa diferente da escolhida. Recarregue a conversa antes de seguir.");
    } else if (newPipelineId && pipelineGravado && pipelineGravado !== newPipelineId) {
      toast.error("A etapa foi gravada, mas o lead continuou no funil anterior.");
    }

    // Histórico de etapa é escrito SÓ pelo gatilho sync_lead_stage_history
    // (front + gatilho gravavam a mesma passagem duas vezes).
    avisarQueLeadMudou();

    // Motivo da desqualificação vai na passagem que o gatilho acabou de abrir.
    if (motivo && stageGravado === newStageId) {
      const gravou = await gravarMotivoDesqualificacao(leadId, stageGravado, motivo);
      if (!gravou) toast.error("O lead foi desqualificado, mas o motivo não foi registrado no histórico.");
    }

    // Insert system message
    const fromName = stages.find(s => s.id === currentStageId)?.name || "?";
    const toName = stages.find(s => s.id === stageGravado)?.name || "?";
    const systemContent = `📋 Etapa alterada: ${fromName} → ${toName}${motivo ? ` · Motivo: ${motivo}` : ""}`;
    await anotarNoHistorico(leadId, systemContent);

    showActivityToast(`📋 Lead movido para ${toName}`);

    // Automações da etapa (on_enter / on_create_or_enter): quem enfileira é o
    // gatilho enqueue_stage_entry_automations do banco, no UPDATE acima, e
    // quem envia é o automation-queue-worker (P05, fila única). Chamar daqui
    // de novo não enviava nada desde o P05 — a chamada saiu.

    onSuccess?.(stageGravado, pipelineGravado || undefined);
    toast.success("Etapa atualizada");
  }, [leadId, stages, showActivityToast]);


  // ─── Reactions ───
  // CONV-3: reação que o servidor recusa VOLTA ao estado anterior (antes o
  // emoji otimista ficava na tela) e o motivo vem do servidor.
  const handleReact = useCallback(async (msg: ChatMessage, emoji: string, leadPhone: string | null, channel: "whatsapp" | "instagram" = "whatsapp") => {
    if (channel === "instagram") {
      toast.info("Reações ainda não são suportadas no Instagram Direct");
      return;
    }
    if (!leadPhone) { toast.error("Lead sem telefone"); return; }
    if (envio.bloqueio) { toast.error(envio.bloqueio.texto); return; }

    const alvo = activeLeadRef.current;
    const anteriores = Array.isArray(msg.reactions) ? msg.reactions : [];
    const trocarReacoes = (reactions: ChatMessage["reactions"]) => {
      setMessages((prev) => {
        const updated = prev.map((m) => (m.id === msg.id ? { ...m, reactions } : m));
        if (alvo) gravarCache(alvo, updated);
        return updated;
      });
    };
    trocarReacoes([...anteriores.filter((r) => r.from !== "me"), { emoji, from: "me" }]);

    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp-message", {
        body: {
          lead_id: leadId,
          type: "reaction",
          reaction_emoji: emoji,
          reaction_to_message_id: msg.id,
        },
      });
      if (envioFalhou(data, error)) {
        if (activeLeadRef.current === alvo) trocarReacoes(anteriores);
        const motivo = await motivoDoEnvio(data, error, "Não foi possível enviar a reação");
        if (motivo.pausado) envio.reconsultar();
        toast.error(`Reação não enviada: ${motivo.texto}`);
      }
    } catch {
      if (activeLeadRef.current === alvo) trocarReacoes(anteriores);
      toast.error("Não foi possível enviar a reação. Confira a conexão e tente de novo.");
    }
  }, [leadId, envio, gravarCache]);

  // ─── Optimistic message handling ───
  const handleOptimisticMessage = useCallback((optimisticMsg: any) => {
    if (optimisticMsg?.id) otimistasRef.current.add(optimisticMsg.id);
    setMessages((prev) => {
      if (prev.some((m) => m.id === optimisticMsg.id)) return prev;
      const updated = [...prev, optimisticMsg];
      const currentLeadId = activeLeadRef.current;
      if (currentLeadId) gravarCache(currentLeadId, updated);
      return updated;
    });
  }, [gravarCache]);

  const handleMessageError = useCallback((tempId: string) => {
    setMessages((prev) => {
      const updated = prev.map((m) => m.id === tempId ? { ...m, status: "error" } : m);
      const currentLeadId = activeLeadRef.current;
      if (currentLeadId) gravarCache(currentLeadId, updated);
      return updated;
    });
  }, [gravarCache]);

  // `confirmedMessage` com o MESMO id da temporária = a Meta aceitou mas o
  // histórico não gravou ('enviado_sem_registro'): o balão vira "enviado" e
  // continua fora do "a mais recente do banco" (não há linha no banco).
  const handleMessageSuccess = useCallback((tempId: string, confirmedMessage?: ChatMessage) => {
    if (confirmedMessage && confirmedMessage.id !== tempId) otimistasRef.current.delete(tempId);
    setMessages((prev) => {
      const normalizedConfirmed = confirmedMessage ? normalizeOutboundStatus(confirmedMessage) : null;
      // Se o Realtime já trouxe a mensagem gravada, some com a temporária em vez de duplicar.
      if (normalizedConfirmed && prev.some((m) => m.id === normalizedConfirmed.id && m.id !== tempId)) {
        const semTemp = prev.filter((m) => m.id !== tempId);
        const leadAtual = activeLeadRef.current;
        if (leadAtual) gravarCache(leadAtual, semTemp);
        return semTemp;
      }
      const updated = prev.map((m) => {
        if (m.id !== tempId) return m;
        if (normalizedConfirmed) return normalizedConfirmed;
        return m;
      });

      const currentLeadId = activeLeadRef.current;
      if (currentLeadId) gravarCache(currentLeadId, updated);
      return updated;
    });
  }, [gravarCache]);

  // ─── Templates ───
  // CONV-8: só os modelos da WABA do número que vai enviar (modelos_do_lead).
  const loadTemplates = useCallback(async () => {
    if (!tenant.id || !leadId) return;
    // Cliente sem número para este lead (ou número fora do acesso de quem
    // está no chat): não há modelo que o servidor aceite.
    if (envio.consultado && envio.bloqueio && (!envio.numero || envio.bloqueio.tipo === "sem_acesso")) {
      toast.error(envio.bloqueio.texto);
      return;
    }
    const alvo = leadId;
    const { modelos, erro } = await carregarModelosDoLead(alvo, tenant.id);
    if (activeLeadRef.current !== alvo) return;
    if (erro) {
      toast.error(`Não foi possível carregar os modelos: ${erro}`);
      return;
    }
    setTemplates(modelos);
    setTemplatesOpen(true);
  }, [tenant.id, leadId, envio.consultado, envio.numero, envio.bloqueio]);

  // Abre a confirmação (prévia preenchida + um campo por variável) do modelo
  // escolhido no Sheet — CONV-15. Quem renderiza o EnviarModeloDialog é a tela.
  const pedirConfirmacaoDoModelo = useCallback((template: ModeloParaEnviar) => {
    setTemplatesOpen(false);
    setModeloEmConfirmacao(template);
  }, []);

  // `componentes` = template_components escolhidos na tela (CONV-15); sem eles
  // o servidor preenche as variáveis pela posição.
  const sendTemplate = useCallback(async (template: ModeloParaEnvio, leadPhone: string | null, channel: "whatsapp" | "instagram" = "whatsapp", componentes?: unknown[]) => {
    if (channel === "instagram") {
      toast.error("Modelos só estão disponíveis no WhatsApp");
      return;
    }
    if (!leadPhone) { toast.error("Lead sem telefone configurado"); return; }
    if (!leadId) return;
    if (envio.bloqueio) { toast.error(envio.bloqueio.texto); return; }
    setTemplatesOpen(false);

    const r = await enviarModeloAoLead({
      leadId,
      modelo: template,
      componentes,
      aoCriarOtimista: handleOptimisticMessage,
      aoConfirmar: handleMessageSuccess,
      aoFalhar: handleMessageError,
    });
    if (r.pausado) envio.reconsultar();
  }, [leadId, envio, handleOptimisticMessage, handleMessageError, handleMessageSuccess]);

  // ─── Notes ───
  const saveNotes = useCallback(async (updatedNotes: string) => {
    if (!leadId) return;
    const { data, error } = await supabase
      .from("crm_leads")
      .update({ notes: updatedNotes })
      .eq("id", leadId)
      .select("id");
    if (error) { toast.error("Erro ao salvar nota"); return false; }
    if (!data || data.length === 0) {
      toast.error("Seu perfil não tem permissão para escrever nota neste lead.");
      return false;
    }
    return true;
  }, [leadId]);

  const addNote = useCallback(async (noteText: string, currentNotes: string | null) => {
    if (!noteText.trim()) return;
    const timestamp = new Date().toLocaleString("pt-BR");
    const updatedNotes = `${currentNotes || ""}\n[${timestamp}] ${noteText.trim()}`.trim();
    return saveNotes(updatedNotes);
  }, [saveNotes]);


  // ─── Helpers ───
  const isSystemMessage = useCallback((msg: ChatMessage) => {
    if (msg.type === "system" || msg.status === "system") return true;
    // Respostas de permissão de ligação do WhatsApp são renderizadas como sistema
    const c = (msg.content || "").trim();
    if (c.startsWith("{") && c.includes("call_permission_reply")) return true;
    return false;
  }, []);

  const deleteSystemMessage = useCallback(async (messageId: string) => {
    // Some da tela antes de o banco confirmar (é o que dá a sensação de rápido),
    // então quando o banco recusa é preciso PÔR DE VOLTA — senão o balão some,
    // o aviso diz "excluída", e ela reaparece sozinha no próximo carregamento.
    let anterior: ChatMessage[] = [];
    setMessages((prev) => { anterior = prev; return prev.filter((m) => m.id !== messageId); });
    const { data, error } = await supabase
      .from("messages")
      .delete()
      .eq("id", messageId)
      .select("id");
    if (error) {
      setMessages(anterior);
      toast.error("Erro ao excluir confirmação");
      return;
    }
    if (!data || data.length === 0) {
      setMessages(anterior);
      toast.error("Seu perfil não tem permissão para excluir esta confirmação.");
      return;
    }
    toast.success("Confirmação excluída");
  }, []);

  return {
    // State
    messages,
    stages,
    loading,
    replyTo,
    forwardMsg,
    mediaPreview,
    templates,
    templatesOpen,
    templateSearch,
    filteredTemplates,
    activityToasts,
    lastInboundAt,
    lastInboundWaAt,
    lastInboundDmAt,
    /** Há mensagens mais antigas que as carregadas (mostrar "Carregar anteriores"). */
    temAnteriores,
    carregandoAnteriores,
    /** Modelo esperando a confirmação (EnviarModeloDialog). */
    modeloEmConfirmacao,
    /** Número de envio do lead e o bloqueio (pausado/desconectado), para selo na tela. */
    envio: { numero: envio.numero, bloqueio: envio.bloqueio },

    // Refs
    messagesEndRef,
    messageRefs,

    // Setters
    setReplyTo,
    setForwardMsg,
    setMediaPreview,
    setTemplatesOpen,
    setTemplateSearch,
    setModeloEmConfirmacao,

    // Actions
    fetchMessages,
    carregarAnteriores,
    scrollToBottom,
    scrollToMessage,
    handleStageChange,
    handleReact,
    loadTemplates,
    pedirConfirmacaoDoModelo,
    sendTemplate,
    saveNotes,
    addNote,
    handleOptimisticMessage,
    handleMessageError,
    handleMessageSuccess,
    dismissToast,
    showActivityToast,
    isSystemMessage,
    deleteSystemMessage,
  };
}
