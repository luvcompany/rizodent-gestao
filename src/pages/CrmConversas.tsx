import { rotuloOrigemLead } from "@/lib/origensLead";
import { Suspense, lazy, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { usePresencaNaConversa } from "@/hooks/usePresencaNaConversa";
import { useHidratarLeadsAvisados } from "@/hooks/useHidratarLeadsAvisados";

/**
 * Compara ignorando acento, do mesmo jeito que a busca no banco faz desde
 * 11/09/2026 (public.termo_regex_acento_indiferente). Sem isto a RPC devolve os
 * 444 leads certos para "orcamento" e a lista não realça nada, porque
 * indexOf("orcamento") não acha "orçamento": a pessoa recebe um parágrafo
 * cortado e tem de caçar a palavra com o olho.
 */
const semAcento = (t: string) =>
  (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
import { useAuth } from "@/contexts/AuthContext";
import { bloquearContatoNaMeta, papelBloqueiaNaMeta, temTelefoneParaMeta } from "@/lib/bloqueioMeta";
import { mensagemDeErro } from "@/lib/mensagemDeErro";
import { motivoDoServidor } from "@/lib/erroDeFuncao";
import { ehGestaoDaClinica } from "@/lib/roles";
import { useModule } from "@/hooks/useModule";
import { useNumerosLiberados } from "@/hooks/useNumerosLiberados";
import EnviarModeloDialog, { type ComponentesDoModelo, type ModeloParaEnviar } from "@/components/chat/EnviarModeloDialog";
import { SeloDoEnvio } from "@/components/chat/AvisoDeEnvio";
import { ehPapelSdr, rotuloDesfecho, type PapelUsuario } from "@/lib/desfechoLabel";
import { leadSourceMatchesFilter } from "@/lib/reportKit";
import { useDestinosTransferenciaSdr } from "@/hooks/useDestinosTransferenciaSdr";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLeadLabels } from "@/hooks/useLeadLabels";
import { getLeadChannel } from "@/lib/leadChannel";
import { formatPhoneDisplayBR, toE164BR } from "@/lib/phoneUtils";
import Api4ComDialButton from "@/components/chat/Api4ComDialButton";
import { HIDDEN_USER_IDS_PG } from "@/lib/hiddenUsers";
import { Badge } from "@/components/ui/badge";
import { cleanTemplateName } from "@/lib/templateUtils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import ChatInput from "@/components/chat/ChatInput";
import ChatNumberSeparator from "@/components/chat/ChatNumberSeparator";
import SeletorNumeroEnvio from "@/components/chat/SeletorNumeroEnvio";
import AiSuggestionStrip from "@/components/chat/AiSuggestionStrip";
import ChatActivitySeparator from "@/components/chat/ChatActivitySeparator";
import ChatDateSeparator from "@/components/chat/ChatDateSeparator";
import ChatAccountSeparator from "@/components/chat/ChatAccountSeparator";
import SendToPosvendaButton from "@/components/chat/SendToPosvendaButton";
import FecharConversaButton, { ConversaFechadaBadge, FecharConversaMenuItem } from "@/components/chat/FecharConversaButton";
import ChatActivityToast from "@/components/chat/ChatActivityToast";
import ChatMessageBubble from "@/components/chat/ChatMessageBubble";
import { useHistoricoAnterior, AbasHistorico, ListaHistoricoAnterior } from "@/components/chat/HistoricoAnterior";
import { parseCallPermissionReply, formatCallPermissionReply, formatCallPermissionPreview } from "@/lib/callPermissionReply";
import LeadAiAssistPanel from "@/components/chat/LeadAiAssistPanel";
import ChatMediaPreview from "@/components/chat/ChatMediaPreview";
import ChatReplyPreview from "@/components/chat/ChatReplyPreview";
import ForwardMessageDialog from "@/components/chat/ForwardMessageDialog";
import ConversationInlineNote, { AddInlineNoteButton } from "@/components/chat/ConversationInlineNote";
import { useConversationNotes } from "@/hooks/useConversationNotes";
import NotesBar from "@/components/chat/NotesBar";
import PipelineStageSelector from "@/components/chat/PipelineStageSelector";

import ConversationFilters, { type ConversationFilterValues, emptyFilters } from "@/components/chat/ConversationFilters";
import ChannelBadgeIcon from "@/components/chat/ChannelBadgeIcon";
import {
  Search, MessageSquare, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen, Bot, Square, UserRoundCog, Loader2, CheckCheck, MoreHorizontal, Star, Ban, Copy, Phone, BellRing, ChevronLeft, ChevronUp, AlertTriangle
} from "lucide-react";
import { nomeDoNumero, useWhatsappCall } from "@/contexts/WhatsappCallContext";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { getDateRangeFromFilter } from "@/components/ui/date-range-filter";
import { isWithinInterval } from "date-fns";

import { useChatConversation } from "@/hooks/useChatConversation";
import { useIsCrmMobile } from "@/hooks/use-mobile";

type LeadConversation = {
  id: string;
  name: string;
  phone: string | null;
  instagram_user_id?: string | null;
  active_channel?: string | null;
  last_message: string | null;
  last_message_at: string | null;
  tags: string[] | null;
  source: string | null;
  stage_id: string;
  pipeline_id: string;
  value: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  assigned_to?: string | null;
  last_direction?: string;
  last_inbound_at?: string | null;
  last_outbound_at?: string | null;
  imagem_origem?: string | null;
  titulo_anuncio?: string | null;
  descricao_anuncio?: string | null;
  link_anuncio?: string | null;
  ad_id?: string | null;
  nome_anuncio?: string | null;
  paciente_id?: string | null;
  cidade?: string | null;
  servico_interesse?: string | null;
  especialidade_interesse_id?: string | null;
  procedimento_interesse_id?: string | null;
  instagram_username?: string | null;
  instagram_profile_pic_url?: string | null;
  last_instagram_interaction_type?: "comment" | "dm" | null;
  /** Fase 2 do rodízio: "Fechar conversa" (NULL = aberta). Vem na RPC da lista
   *  (get_conversation_leads) e tira o lead das não lidas (CONV-10). */
  conversa_fechada_em?: string | null;
};

type PipelineWithRoles = { id: string; name: string; allowed_roles: string[] | null; is_instagram?: boolean | null };
/** Pessoa da equipe (Responsável e filtro). `is_blocked` tira da escolha — CONV-21. */
type PerfilDaEquipe = { id: string; nome: string; is_blocked?: boolean | null };

// Global cache for leads list — survives component remounts
const leadsListCache = {
  cacheKey: null as string | null,
  leads: null as LeadConversation[] | null,
  profiles: null as PerfilDaEquipe[] | null,
  pipelines: null as PipelineWithRoles[] | null,
  timestamp: 0,
};
const LEADS_CACHE_TTL = 5 * 60_000; // 5 min: navegação entre telas usa cache instantâneo
const LEADS_BG_REFRESH_AFTER = 60_000; // só refaz fetch em background se cache > 60s

// ── localStorage: persiste entre reloads ────────────────────────────────────
// v2: invalidate previous cache after RLS revert (Pós-Venda leak fix)
const CONV_LS_KEY = "crm:conversas_cache_v2";
const CONV_LS_TTL = 10 * 60_000;
type ConversasLSData = {
  leads: LeadConversation[];
  profiles: PerfilDaEquipe[];
  pipelines: PipelineWithRoles[];
};
function readConversasLS(cacheKey: string): ConversasLSData | null {
  try {
    const raw = localStorage.getItem(`${CONV_LS_KEY}:${cacheKey}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CONV_LS_TTL) return null;
    return data as ConversasLSData;
  } catch { return null; }
}
function writeConversasLS(cacheKey: string, data: ConversasLSData): void {
  // Persistimos só os 500 leads mais recentes p/ não travar a thread serializando ~6k linhas.
  const slim: ConversasLSData = {
    leads: data.leads.slice(0, 500),
    profiles: data.profiles,
    pipelines: data.pipelines,
  };
  const write = () => {
    try { localStorage.setItem(`${CONV_LS_KEY}:${cacheKey}`, JSON.stringify({ data: slim, ts: Date.now() })); } catch {}
  };
  if (typeof (window as any).requestIdleCallback === "function") {
    (window as any).requestIdleCallback(write, { timeout: 2000 });
  } else {
    setTimeout(write, 0);
  }
}

const LeadEditPanel = lazy(() => import("@/components/chat/LeadEditPanel"));
import SetorDoLead from "@/components/setores/SetorDoLead";
const LeadCustomFields = lazy(() => import("@/components/chat/LeadCustomFields"));
const LeadExtraFields = lazy(() => import("@/components/chat/LeadExtraFields"));
const LeadServiceField = lazy(() => import("@/components/chat/LeadServiceField"));
const LeadStageTimeline = lazy(() => import("@/components/chat/LeadStageTimeline"));
const LeadResponseTimes = lazy(() => import("@/components/chat/LeadResponseTimes"));
const LeadBudgetPanel = lazy(() => import("@/components/chat/LeadBudgetPanel"));
// O painel do crc lê tabelas bloqueadas para o closer; ele tem o equivalente próprio.
const CloserLeadPacientePanel = lazy(() => import("@/components/closer/CloserLeadPacientePanel"));
const InlineTagsEditor = lazy(() => import("@/components/chat/InlineTagsEditor"));
const TaskPanel = lazy(() => import("@/components/chat/TaskPanel"));
const AppointmentConfirmBar = lazy(() => import("@/components/chat/AppointmentConfirmBar"));

const SidePanelFallback = () => (
  <div className="space-y-3 p-4">
    <div className="h-20 rounded-xl bg-surface-sunken animate-pulse" />
    <div className="h-24 rounded-xl bg-surface-sunken/70 animate-pulse" />
    <div className="h-24 rounded-xl bg-surface-sunken/70 animate-pulse" />
  </div>
);

/**
 * Rótulo do chip do filtro `?appointment_status=` da URL. Antes o valor cru do
 * banco ia para a tela ("not_contracted"), e para a SDR isso é justamente o que
 * ela não pode ler (decisão D3).
 *
 * Os apelidos "compareceram"/"attended", "missed" e "reagendados" descrevem uma
 * RÉGUA (compareceram = contracted + not_contracted), não um status; por isso o
 * primeiro tem texto próprio para todos os papéis — chamá-lo de "Contratado"
 * seria mentira — e os outros dois emprestam o nome do status equivalente.
 * Qualquer outro valor é um status de crm_appointments e passa pelo helper de
 * papel: a SDR lê "Compareceu", a gestão lê "Contratado"/"Não contratado".
 */
const rotuloFiltroAgendamento = (valor: string, papel: PapelUsuario): string => {
  const v = valor.trim().toLowerCase();
  if (v === "attended" || v === "compareceram") return "Compareceram";
  if (v === "missed") return rotuloDesfecho("no_show", papel);
  if (v === "reagendados") return rotuloDesfecho("rescheduled", papel);
  return rotuloDesfecho(valor, papel);
};

const CONVERSATION_PAGE_SIZE = 1000;
const CONVERSATION_MAX_PAGES = 50; // teto de SEGURANÇA (loop para antes ao receber página incompleta)
// Colunas leves p/ a LISTA de conversas (sem campos pesados de anúncio/extras).
// Lista (sem `notes`/`value` que são pesados e só usados no painel direito; os campos de anúncio ficam
// porque os filtros derivam opções deles).
const LEAD_LIST_COLS = "id, name, phone, instagram_user_id, active_channel, instagram_username, instagram_profile_pic_url, last_message, last_message_at, last_inbound_at, last_outbound_at, last_instagram_interaction_type, tags, source, stage_id, pipeline_id, created_at, updated_at, assigned_to, paciente_id, cidade, servico_interesse, imagem_origem, titulo_anuncio, descricao_anuncio, link_anuncio, ad_id, nome_anuncio, ad_account_id, ad_account_name, is_blocked, whatsapp_number_id, conversa_fechada_em";
// Colunas completas p/ o lead selecionado (inclui notes/value).
const LEAD_SELECT_COLS = LEAD_LIST_COLS + ", value, notes";


const getLastDirection = (lead: LeadConversation & { last_inbound_at?: string | null; last_outbound_at?: string | null }) => {
  if (lead.last_inbound_at && lead.last_outbound_at) {
    return new Date(lead.last_inbound_at) > new Date(lead.last_outbound_at) ? "inbound" : "outbound";
  }
  if (lead.last_inbound_at) return "inbound";
  if (lead.last_outbound_at) return "outbound";
  return undefined;
};

const normalizeLead = (lead: LeadConversation & { last_inbound_at?: string | null; last_outbound_at?: string | null }) => ({
  ...lead,
  last_direction: getLastDirection(lead),
});

// Janela de "não lidas": 60 dias por last_inbound_at — a MESMA aplicada nos RPCs
// get_crm_unread_leads_count / get_crm_unread_leads_count_by_channel (migração
// 20260708030000_unread_badge_window). Mantém badge da sidebar, abas e lista
// concordando entre si: leads aguardando resposta há mais de 60 dias não contam
// como "não lidos".
const UNREAD_WINDOW_DAYS = 60;
const UNREAD_WINDOW_MS = UNREAD_WINDOW_DAYS * 86_400_000;
const UNREAD_WINDOW_LABEL = `últimos ${UNREAD_WINDOW_DAYS} dias`;
// Conversa FECHADA não é não lida (CONV-10) — mesma regra das RPCs de contagem
// (migration 20260929002300). A mensagem nova do paciente reabre a conversa no
// banco e ela volta a contar.
const isUnreadLead = (lead: LeadConversation) =>
  lead.last_direction === "inbound" &&
  !!lead.last_inbound_at &&
  !lead.conversa_fechada_em &&
  Date.now() - new Date(lead.last_inbound_at).getTime() <= UNREAD_WINDOW_MS;

/** Evento que o badge do menu (CrmLayout, P19) e as abas escutam para recontar as não lidas. */
const EVENTO_NAO_LIDAS_MUDOU = "crm:nao-lidas-mudou";

/** Texto da "mídia do histórico" (S29-12) na prévia da lista, em vez do marcador cru. */
const MARCADOR_MIDIA_DO_HISTORICO = /^\s*\[media_placeholder\]\s*$/i;

/** CONV-13: o que a pessoa lê quando o link aponta para conversa que ela não alcança. */
const FRASE_CONVERSA_INDISPONIVEL = "Esta conversa não está disponível para você (excluída, transferida ou sem acesso).";

/** Papéis que veem "Orçamento & Valor" (X-2: os que a RLS de pacientes deixa criar e vincular). */
const PAPEIS_DO_ORCAMENTO = new Set(["crc", "gerente", "superadmin"]);
/** Papéis que podem apagar a mensagem de agendamento do chat (CONV-22: a mesma régua da policy de DELETE em messages). */
const PAPEIS_QUE_APAGAM_SISTEMA = new Set(["crc", "gerente", "superadmin"]);

const sortLeadsByLastActivity = (items: LeadConversation[]) =>
  [...items].sort((a, b) => {
    const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : new Date(a.created_at).getTime();
    const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : new Date(b.created_at).getTime();
    return bTime - aTime;
  });

// Idle scheduler helper — não bloqueia a thread principal.
const runIdle = (cb: () => void, timeout = 1500) => {
  if (typeof (window as any).requestIdleCallback === "function") {
    (window as any).requestIdleCallback(cb, { timeout });
  } else {
    setTimeout(cb, 0);
  }
};

// Carrega TODOS os leads do tenant em páginas de 1000 (limite default do Supabase).
// Necessário para que filtros por etapa/funil correspondam ao Kanban.
// `onFirstPage` é chamado assim que a primeira página chega (para pintar a UI rápido).
const fetchAllConversationLeads = async (
  tenantId: string,
  onFirstPage?: (rows: LeadConversation[]) => void,
) => {
  // Uma única chamada RPC (SECURITY DEFINER) devolve TODO o inbox já escopado
  // (equivalente à RLS) e ordenado por last_message_at. Substitui as ~7 páginas
  // sequenciais que faziam seq scan avaliando RLS por linha (~20s → ~1s).
  const { data, error } = await supabase.rpc("get_conversation_leads", {
    p_tenant_id: tenantId,
    p_limit: 20000,
  });
  if (error) throw error;
  const rows = ((data || []) as any as LeadConversation[]).map(normalizeLead);
  if (onFirstPage) onFirstPage([...rows]);
  return sortLeadsByLastActivity(rows);
};


/** Pré-carrega a lista de conversas + profiles + pipelines e popula o cache em memória + localStorage.
 *  Idempotente: se o cache estiver fresco (< LEADS_BG_REFRESH_AFTER), retorna imediatamente. */
export const prefetchConversasData = async (tenantId: string, userId: string): Promise<void> => {
  if (!tenantId || !userId) return;
  const cacheKey = `${tenantId}:${userId}`;
  if (
    leadsListCache.cacheKey === cacheKey &&
    leadsListCache.leads &&
    Date.now() - leadsListCache.timestamp < LEADS_BG_REFRESH_AFTER
  ) {
    return;
  }
  try {
    const [rawLeads, profilesRes, pipelinesRes] = await Promise.all([
      fetchAllConversationLeads(tenantId),
      supabase.from("profiles").select("id, nome, is_blocked").eq("tenant_id", tenantId).not("id","in",HIDDEN_USER_IDS_PG),
      supabase.from("crm_pipelines").select("id, name, allowed_roles, is_instagram").eq("tenant_id", tenantId).order("position", { ascending: true, nullsFirst: false }).order("created_at"),
    ]);
    const profs = (profilesRes.data as PerfilDaEquipe[]) || [];
    const pipes = (pipelinesRes.data as PipelineWithRoles[]) || [];
    leadsListCache.cacheKey = cacheKey;
    leadsListCache.leads = rawLeads;
    leadsListCache.profiles = profs;
    leadsListCache.pipelines = pipes;
    leadsListCache.timestamp = Date.now();
    writeConversasLS(cacheKey, { leads: rawLeads, profiles: profs, pipelines: pipes });
  } catch (e) {
    console.warn("[prefetchConversasData] falhou:", e);
  }
};


interface ConversationsViewProps {
  pipelineFilter?: string;          // include only this pipeline
  excludePipelines?: string[];      // exclude these pipelines
  channel?: "whatsapp" | "instagram";
  channelFilter?: "whatsapp" | "instagram"; // filter leads by channel (instagram = has instagram_user_id)
}

type InstagramInteractionFilter = "comment" | "dm";

const getInstagramInteractionType = (lead: LeadConversation): InstagramInteractionFilter =>
  lead.last_instagram_interaction_type === "comment" || lead.last_message?.startsWith("[Comentário]")
    ? "comment"
    : "dm";

function WhatsAppConversations({ pipelineFilter, excludePipelines, channel = "whatsapp", channelFilter }: ConversationsViewProps = {}) {
  const { user, userRole } = useAuth();
  const destinosSdr = useDestinosTransferenciaSdr(userRole === "sdr");
  const { tenant } = useTenant();
  const cacheKey = tenant.id && user?.id ? `${tenant.id}:${user.id}` : null;
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  // Módulos que desenham partes do painel (só esconde com `false` explícito ou,
  // no botão de IA, enquanto não se sabe — botão que falha não aparece).
  const { ligado: iaLigada } = useModule("ia");
  const { ligado: agendaLigada } = useModule("agenda");
  // Números liberados para quem está logado (REC-07 e selo "Pausado", S29P-3d).
  const { numeros: numerosLiberados, semNumeroLiberado, aviso: avisoSemNumero } = useNumerosLiberados();
  const canUseInitialCache = !!cacheKey && leadsListCache.cacheKey === cacheKey && Date.now() - leadsListCache.timestamp < LEADS_CACHE_TTL;
  // Lê localStorage uma vez no primeiro render — fallback quando módulo cache está frio (reload)
  const [_lsData] = useState<ConversasLSData | null>(() => canUseInitialCache || !cacheKey ? null : readConversasLS(cacheKey));
  const [leads, setLeads] = useState<LeadConversation[]>(() => canUseInitialCache ? (leadsListCache.leads || []) : (_lsData?.leads || []));
  const [search, setSearch] = useState("");
  const [instagramInteractionFilter, setInstagramInteractionFilter] = useState<InstagramInteractionFilter>("dm");
  const [loading, setLoading] = useState(!canUseInitialCache && !_lsData);
  const [fullyLoaded, setFullyLoaded] = useState<boolean>(canUseInitialCache);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<LeadConversation | null>(null);
  // Leituras sem dependência nos efeitos de URL e da lista (o valor do render atual).
  const selectedLeadIdRef = useRef(selectedLeadId);
  selectedLeadIdRef.current = selectedLeadId;
  const selectedLeadRef = useRef(selectedLead);
  selectedLeadRef.current = selectedLead;
  const leadsRef = useRef(leads);
  leadsRef.current = leads;
  /**
   * O lead aberto JÁ CONFIRMADO (REC-04): o chat, as notas, a presença
   * (conversa_estou_aqui) e o repair-chat-media só recebem o id depois que a
   * conversa foi achada — nunca o id cru de um link, que pode ser de lead
   * excluído, transferido ou de outro número.
   */
  const leadAbertoId = selectedLeadId && selectedLead?.id === selectedLeadId ? selectedLeadId : null;
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [tentativaLista, setTentativaLista] = useState(0);
  // Falha de rede/timeout ao abrir a conversa do link (?lead=): não é "sem
  // acesso". A conversa fica selecionada com o motivo e "Tentar novamente".
  const [falhaAoAbrir, setFalhaAoAbrir] = useState<{ id: string; motivo: string } | null>(null);
  const [tentativaAoAbrir, setTentativaAoAbrir] = useState(0);
  const [newNote, setNewNote] = useState("");
  const isCrmMobile = useIsCrmMobile();
  const { initiateCall, requestCallPermission, state: callState, podeLigarPorWhatsapp, numerosVisiveis } = useWhatsappCall();
  // Identificação do "mundo" (número de WhatsApp) na lista. Só aparece quando o
  // usuário enxerga mais de um número — com um só não poluímos a UI. Lead sem
  // carimbo (whatsapp_number_id NULL) aparece como "Sem número": na hora de
  // enviar, o servidor usa o número do funil ou o número padrão.
  const numberNames = useMemo(() => {
    const map: Record<string, string> = {};
    (numerosVisiveis ?? []).forEach((n) => { map[n.id] = nomeDoNumero(n); });
    return map;
  }, [numerosVisiveis]);
  const multiNumberTenant = (numerosVisiveis?.length ?? 0) > 1;
  const rotuloNumeroDoLead = (whatsappNumberId: string | null | undefined): string | null =>
    whatsappNumberId ? numberNames[whatsappNumberId] ?? null : "Sem número";
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  // On mobile, force single-panel view: list | chat | lead details.
  // Use a separate flag so opening a lead always lands on the chat, not on details.
  const [mobileShowDetails, setMobileShowDetails] = useState(false);
  const effLeftVisible = isCrmMobile ? !selectedLeadId : leftPanelVisible;
  const effRightVisible = isCrmMobile
    ? (!!selectedLeadId && mobileShowDetails)
    : rightPanelVisible;
  const effCenterVisible = isCrmMobile
    ? (!!selectedLeadId && !mobileShowDetails)
    : true;
  const mobileBackToList = () => {
    setSelectedLeadId(null);
    setSelectedLead(null);
    setMobileShowDetails(false);
  };
  const [urlFiltersApplied, setUrlFiltersApplied] = useState(false);
  const [filters, setFilters] = useState<ConversationFilterValues>(() => {
    // Initialize from URL params if present
    const pipeline = searchParams.get("pipeline") || "";
    const stageId = searchParams.get("stage_id") || "";
    const assignedTo = searchParams.get("assigned_to") || "";
    if (pipeline || stageId || assignedTo) {
      return { ...emptyFilters, pipelineId: pipeline, stageId, assignedTo };
    }
    return emptyFilters;
  });
  // Special URL filters not part of ConversationFilters
  const urlGhost = searchParams.get("ghost") === "true";
  const urlInactiveDays = searchParams.get("inactive_days");
  const urlAppointmentStatus = searchParams.get("appointment_status");
  const [ghostLeadIds, setGhostLeadIds] = useState<Set<string> | null>(null);
  const [appointmentLeadIds, setAppointmentLeadIds] = useState<Set<string> | null>(null);
  // Lead IDs whose message history contains the current search term
  const [messageMatchLeadIds, setMessageMatchLeadIds] = useState<Set<string> | null>(null);
  // Trecho da mensagem que casou com a busca, por lead. É o que explica na lista
  // POR QUE aquele lead apareceu quando o nome e o telefone não têm o termo.
  const [messageMatchSnippets, setMessageMatchSnippets] = useState<Map<string, string> | null>(null);
  // Data/hora da mensagem que casou com a busca, por lead. Na busca, é ESTE
  // horário que a lista mostra — não o da última mensagem da conversa.
  const [messageMatchTimes, setMessageMatchTimes] = useState<Map<string, string> | null>(null);
  // A busca devolve no máximo 500 leads. Sem este aviso, "avaliação" mostra 500
  // de 2.412 e o contador ao lado de "Conversas" é lido como se fosse o total —
  // o mesmo sintoma que originou a correção da busca ("não puxa o geral").
  const [buscaNoTeto, setBuscaNoTeto] = useState(false);
  const [profiles, setProfiles] = useState<PerfilDaEquipe[]>(() => canUseInitialCache ? (leadsListCache.profiles || []) : (_lsData?.profiles || []));
  const [pipelines, setPipelines] = useState<PipelineWithRoles[]>(() => canUseInitialCache ? (leadsListCache.pipelines || []) : (_lsData?.pipelines || []));
  const [activeExecution, setActiveExecution] = useState<{
    id: string; status: string; bot_name?: string;
  } | null>(null);

  // Fontes p/ os filtros de etiqueta e de pagamento (aplicados no `filtered` abaixo).
  // A view crm_leads_com_pagamento retorna os lead_id com pagamento (escopo por RLS).
  const { labelsByLead } = useLeadLabels();
  const [leadsWithPagamento, setLeadsWithPagamento] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    supabase.from("crm_leads_com_pagamento").select("lead_id").then(({ data }) => {
      if (!cancelled) setLeadsWithPagamento(new Set((data || []).map((r: any) => r.lead_id)));
    });
    return () => { cancelled = true; };
  }, []);

  // Deep-link ?lead=<id>: notificação, Kanban, Calendário, Ligações, a fila da
  // home e /crm/conversa/:id (que agora redireciona para cá — CONV-29).
  //
  // CONV-13: sem linha na RPC (a régua da RLS, conversa_lead_visivel) nem na
  // leitura direta, a conversa não abre e a pessoa é avisada — antes o centro
  // ficava girando para sempre. SDR-17: o ?lead= fica na URL enquanto a
  // conversa está aberta (F5 e link compartilhado funcionam); este efeito só
  // abre quando o id da URL não é o da conversa que já está na tela.
  //
  // Falha de rede ou timeout nas DUAS leituras não é "sem acesso": volta
  // `erro` com o motivo em PT-BR, e a tela oferece "Tentar novamente" em vez
  // de dizer que a conversa foi excluída ou transferida.
  const buscarLeadDaConversa = useCallback(async (
    id: string,
  ): Promise<{ lead: LeadConversation | null; erro: string | null }> => {
    try {
      const { data, error } = await supabase.rpc("get_lead_for_conversation", { _lead_id: id });
      let linha: unknown = !error && Array.isArray(data) && data.length > 0 ? data[0] : null;
      if (!linha) {
        const direto = await supabase.from("crm_leads").select(LEAD_SELECT_COLS).eq("id", id).maybeSingle();
        if (direto.error) console.error("[CrmConversas] conversa do link:", direto.error.message);
        linha = direto.data ?? null;
        if (!linha && error && direto.error) {
          return { lead: null, erro: mensagemDeErro(direto.error, "Tente de novo em instantes.") };
        }
      }
      return { lead: linha ? (normalizeLead(linha as LeadConversation) as LeadConversation) : null, erro: null };
    } catch (e) {
      return { lead: null, erro: mensagemDeErro(e, "Tente de novo em instantes.") };
    }
  }, []);

  const avisarConversaIndisponivel = useCallback((id: string) => {
    setSelectedLeadId((prev) => (prev === id ? null : prev));
    setSelectedLead((prev) => (prev?.id === id ? null : prev));
    // A gestão restaura lead excluído (CRC-14): o aviso leva a Configurações.
    // O rótulo não promete "a Lixeira": enquanto Configurações não abre a aba
    // pelo ?aba=lixeira (P20), a tela abre na primeira aba e a descrição diz
    // onde clicar. O ?aba= já vai no link para quando a aba passar a ser lida.
    if (ehGestaoDaClinica(userRole)) {
      toast.error(FRASE_CONVERSA_INDISPONIVEL, {
        description: "Se o lead foi excluído, dá para restaurar em Configurações › Lixeira por até 30 dias.",
        action: { label: "Ir para Configurações", onClick: () => navigate("/crm/configuracoes?aba=lixeira") },
      });
    } else {
      toast.error(FRASE_CONVERSA_INDISPONIVEL);
    }
  }, [userRole, navigate]);

  const urlLeadId = searchParams.get("lead");
  useEffect(() => {
    if (!urlLeadId) return;
    // Já aberta e confirmada: a URL só acompanhou a seleção.
    if (selectedLeadIdRef.current === urlLeadId && selectedLeadRef.current?.id === urlLeadId) return;
    setSelectedLeadId(urlLeadId);
    setMobileShowDetails(false);
    setFalhaAoAbrir(null);
    const daLista = leadsRef.current.find((l) => l.id === urlLeadId);
    if (daLista) { setSelectedLead(daLista); return; }
    let vivo = true;
    void buscarLeadDaConversa(urlLeadId).then(({ lead, erro }) => {
      if (!vivo) return;
      if (lead) { setSelectedLead((prev) => (prev && prev.id === urlLeadId ? prev : lead)); return; }
      // Rede/timeout: a conversa continua selecionada, com o motivo e "Tentar novamente".
      if (erro) { setFalhaAoAbrir({ id: urlLeadId, motivo: erro }); return; }
      avisarConversaIndisponivel(urlLeadId);
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlLeadId, tentativaAoAbrir]);

  // SDR-17: a URL acompanha a conversa aberta (replace, sem empilhar
  // histórico) e perde o ?lead= quando ela é fechada. O estado da navegação
  // (o "Voltar" de quem chegou por link) é preservado.
  const idAnteriorNaUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const anterior = idAnteriorNaUrlRef.current;
    idAnteriorNaUrlRef.current = selectedLeadId;
    if (anterior === selectedLeadId) return;
    const naUrl = searchParams.get("lead");
    if (selectedLeadId) {
      if (naUrl === selectedLeadId) return;
      const next = new URLSearchParams(searchParams);
      next.set("lead", selectedLeadId);
      setSearchParams(next, { replace: true, state: location.state });
    } else if (anterior && naUrl === anterior) {
      const next = new URLSearchParams(searchParams);
      next.delete("lead");
      setSearchParams(next, { replace: true, state: location.state });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeadId]);


  // Unified chat hook — só com a conversa confirmada (REC-04).
  const chat = useChatConversation(leadAbertoId);
  const qtdHistorico = useHistoricoAnterior(leadAbertoId);
  const [abaHistorico, setAbaHistorico] = useState<"conversa" | "historico">("conversa");
  useEffect(() => { setAbaHistorico("conversa"); }, [leadAbertoId]);
  const convNotes = useConversationNotes(leadAbertoId);

  const handleSelectLead = useCallback((lead: LeadConversation) => {
    setSelectedLeadId(lead.id);
    setSelectedLead(lead);
    // On mobile: opening a lead should land on the chat view, not the details panel.
    setMobileShowDetails(false);
  }, []);

  /** "Fechar conversa" (Fase 2): reflete a coluna na lista e no lead aberto. */
  const atualizarFechada = useCallback((leadId: string, quando: string | null) => {
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, conversa_fechada_em: quando } : l)));
    setSelectedLead((prev) => (prev && prev.id === leadId ? { ...prev, conversa_fechada_em: quando } : prev));
    // Fechada não conta como não lida (CONV-10): badge do menu e abas recontam já.
    window.dispatchEvent(new Event(EVENTO_NAO_LIDAS_MUDOU));
  }, []);

  // ===== Bot Active Execution State =====
  const checkExecution = useCallback(async () => {
    if (!leadAbertoId) { setActiveExecution(null); return; }
    const { data } = await supabase
      .from("bot_executions")
      .select("id, status, current_node_id, bots(name)")
      .eq("lead_id", leadAbertoId)
      .in("status", ["active", "waiting_reply"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setActiveExecution({
        id: data.id,
        status: data.status,
        bot_name: (data as any).bots?.name,
      });
    } else {
      setActiveExecution(null);
    }
  }, [leadAbertoId]);

  useEffect(() => { checkExecution(); }, [checkExecution]);

  useEffect(() => {
    if (!leadAbertoId) return;
    const channel = supabase
      .channel(`bot-exec-conv-${leadAbertoId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "bot_executions",
        filter: `lead_id=eq.${leadAbertoId}`,
      }, () => checkExecution())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [leadAbertoId, checkExecution]);

  const handleStopBot = async () => {
    if (!activeExecution) return;
    // O `.select()` confere que a linha realmente mudou: RLS barrada devolve
    // sucesso com zero linhas e o bot continuaria respondendo o paciente.
    const { data, error } = await supabase
      .from("bot_executions")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", activeExecution.id)
      .select("id");
    if (error) { toast.error("Erro ao encerrar bot: " + mensagemDeErro(error)); return; }
    if (!data || data.length === 0) {
      toast.error("Seu perfil não tem permissão para encerrar este bot.");
      return;
    }
    toast.success("Bot encerrado");
    setActiveExecution(null);
  };

  // Fetch leads list with global cache
  //
  // CONV-14: a RPC da lista pode falhar (rede, statement_timeout de 8 s em
  // cliente grande). Antes a promessa rejeitada ficava sem tratamento e a
  // coluna mostrava "Carregando..." para sempre. Agora: sem nada na tela, a
  // coluna diz "Não foi possível carregar as conversas" com "Tentar
  // novamente"; com a lista do cache na tela, ela fica e só aparece o aviso.
  useEffect(() => {
    if (!tenant.id || !cacheKey) return;
    let vivo = true;
    const buscarTudo = async () => {
      const [rawLeads, profilesRes, pipelinesRes] = await Promise.all([
        fetchAllConversationLeads(tenant.id, (firstPage) => {
          if (!vivo) return;
          setLeads(firstPage);
          setLoading(false);
        }),
        supabase.from("profiles").select("id, nome, is_blocked").eq("tenant_id", tenant.id).not("id","in",HIDDEN_USER_IDS_PG),
        supabase.from("crm_pipelines").select("id, name, allowed_roles, is_instagram").eq("tenant_id", tenant.id).order("position", { ascending: true, nullsFirst: false }).order("created_at"),
      ]);
      const profs = (profilesRes.data as PerfilDaEquipe[]) || [];
      const pipes = (pipelinesRes.data as PipelineWithRoles[]) || [];
      leadsListCache.cacheKey = cacheKey;
      leadsListCache.leads = rawLeads;
      leadsListCache.profiles = profs;
      leadsListCache.pipelines = pipes;
      leadsListCache.timestamp = Date.now();
      writeConversasLS(cacheKey, { leads: rawLeads, profiles: profs, pipelines: pipes });
      if (!vivo) return;
      setLeads(rawLeads);
      setProfiles(profs);
      setPipelines(pipes);
      setLoading(false);
      setErroLista(null);
      setFullyLoaded(true);
    };
    const avisarFalha = (e: unknown) => {
      console.error("[CrmConversas] lista de conversas:", e);
      if (!vivo) return;
      setLoading(false);
      setFullyLoaded(true);
      if (leadsRef.current.length > 0) {
        toast.warning("Não foi possível atualizar a lista de conversas agora. Mostrando a última versão carregada.");
      } else {
        const motivo = mensagemDeErro(e, "Tente de novo em instantes.");
        setErroLista(motivo);
        toast.error("Não foi possível carregar as conversas: " + motivo);
      }
    };

    // If cache is fresh, skip network fetch entirely
    if (tentativaLista === 0 && leadsListCache.cacheKey === cacheKey && leadsListCache.leads && Date.now() - leadsListCache.timestamp < LEADS_CACHE_TTL) {
      setLeads(leadsListCache.leads);
      setProfiles(leadsListCache.profiles || []);
      setPipelines(leadsListCache.pipelines || []);
      setLoading(false);
      setFullyLoaded(true);
      // Só refaz fetch em background se o cache estiver com mais de 60s — evita roundtrip a cada navegação.
      const cacheAge = Date.now() - leadsListCache.timestamp;
      if (cacheAge < LEADS_BG_REFRESH_AFTER) return () => { vivo = false; };
      setFullyLoaded(false);
      buscarTudo().catch(avisarFalha);
      return () => { vivo = false; };
    }

    setFullyLoaded(false);
    setErroLista(null);
    buscarTudo().catch(avisarFalha);
    return () => { vivo = false; };
  }, [tenant.id, cacheKey, tentativaLista]);

  const tentarCarregarDeNovo = useCallback(() => {
    setErroLista(null);
    setLoading(true);
    setTentativaLista((n) => n + 1);
  }, []);


  // Server-side search: when user types, fetch matching leads beyond the initial 500-row cache
  // so older conversations (sorted lower by last_message_at) are still findable.
  useEffect(() => {
    const term = search.trim();
    if (!tenant.id) return;
    if (term.length < 2) return;
    const handle = setTimeout(async () => {
      const digits = term.replace(/\D/g, "");
      // Build OR filter: match by name (case-insensitive) and phone variants (handles BR 9th digit + country code)
      const orParts: string[] = [];
      if (term.length >= 2) orParts.push(`name.ilike.%${term}%`);
      if (digits.length >= 3) {
        const variants = new Set<string>();
        variants.add(digits);
        const noCountry = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
        variants.add(noCountry);
        if (noCountry.length === 11 && noCountry[2] === "9") variants.add(noCountry.slice(0, 2) + noCountry.slice(3));
        if (noCountry.length === 10) variants.add(noCountry.slice(0, 2) + "9" + noCountry.slice(2));
        if (noCountry.length >= 8) variants.add(noCountry.slice(-8));
        variants.forEach((v) => orParts.push(`phone.ilike.%${v}%`));
      }
      if (!orParts.length) return;

      const { data, error } = await supabase
        .from("crm_leads")
        .select(LEAD_LIST_COLS)
        .eq("tenant_id", tenant.id)
        // Busca explícita inclui bloqueados — senão o usuário procura e não acha.
        .or(orParts.join(","))
        .limit(50);
      if (error || !data?.length) return;

      setLeads((prev) => {
        const existingIds = new Set(prev.map((l) => l.id));
        const additions = (data as any as LeadConversation[]).map(normalizeLead).filter((l) => !existingIds.has(l.id));
        if (!additions.length) return prev;
        return sortLeadsByLastActivity([...prev, ...additions]);
      });
    }, 350);
    return () => clearTimeout(handle);
  }, [search, tenant.id]);

  // Busca dentro do TEXTO das mensagens (não só na última).
  //
  // POR QUE VIA RPC E NÃO DIRETO NA TABELA: a consulta direta
  // (.from("messages").ilike("content", ...)) sai daqui com a RLS ligada, e
  // public.messages tem 255 mil linhas e 8 policies de leitura, quatro delas
  // chamando função por linha. O ILIKE deixa de usar o índice trigram, a
  // consulta estoura o statement_timeout, o erro caía no `return` mudo abaixo e
  // a busca por conteúdo simplesmente não acontecia — sobravam os leads achados
  // por nome/telefone/última mensagem. Era esse o bug que o dono via.
  //
  // public.buscar_leads_por_mensagem (SECURITY DEFINER) faz o ILIKE pelo índice
  // e aplica a MESMA régua de visibilidade uma vez só, no fim, devolvendo UM
  // registro por lead (o mais recente) com um trecho do texto em volta do termo.
  useEffect(() => {
    const term = search.trim();
    if (!tenant.id) { setMessageMatchLeadIds(null); setMessageMatchSnippets(null); setMessageMatchTimes(null); setBuscaNoTeto(false); return; }
    if (term.length < 3) { setMessageMatchLeadIds(null); setMessageMatchSnippets(null); setMessageMatchTimes(null); setBuscaNoTeto(false); return; }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const ids = new Set<string>();
      const trechos = new Map<string, string>();
      const quandos = new Map<string, string>();

      // Caminho novo: a RPC. O termo vai CRU — quem escapa os curingas do LIKE
      // (%, _ e a barra invertida) é a função, para não escapar duas vezes.
      const { data: achados, error: erroRpc } = await (supabase as any).rpc(
        "buscar_leads_por_mensagem",
        { p_termo: term, p_limite: 500 }
      );
      if (cancelled) return;

      const TETO_BUSCA = 500;
      if (!erroRpc && Array.isArray(achados)) {
        achados.forEach((r: { lead_id: string; trecho: string | null; quando?: string | null }) => {
          if (!r?.lead_id) return;
          ids.add(r.lead_id);
          if (r.trecho) trechos.set(r.lead_id, r.trecho);
          if (r.quando) quandos.set(r.lead_id, r.quando);
        });
        // Veio exatamente o teto: quase certamente há mais do que isto.
        setBuscaNoTeto(achados.length >= TETO_BUSCA);
      } else {
        setBuscaNoTeto(false);
        // Rede de segurança: se a RPC ainda não estiver publicada (ou falhar),
        // cai no caminho antigo em vez de deixar a busca sem nada. Ele acha
        // menos — é limitado pela RLS e por 500 LINHAS DE MENSAGEM —, mas acha.
        const safe = term.replace(/[%_\\]/g, (c) => `\\${c}`);
        const { data, error } = await supabase
          .from("messages")
          .select("lead_id, created_at")
          .eq("tenant_id", tenant.id)
          .not("lead_id", "is", null)
          .ilike("content", `%${safe}%`)
          .order("created_at", { ascending: false })
          .limit(500);
        if (cancelled || error) return;
        // Vem ordenado do mais novo para o mais velho: o primeiro de cada lead
        // é o horário da mensagem encontrada mais recente.
        (data ?? []).forEach((r: any) => {
          if (!r.lead_id) return;
          ids.add(r.lead_id);
          if (r.created_at && !quandos.has(r.lead_id)) quandos.set(r.lead_id, r.created_at);
        });
      }

      if (cancelled) return;
      setMessageMatchLeadIds(ids);
      setMessageMatchSnippets(trechos.size ? trechos : null);
      setMessageMatchTimes(quandos.size ? quandos : null);

      // Hidrata os leads que não estão na lista carregada, para eles aparecerem
      // no resultado. Sem teto de 100: o corte agora é o LIMIT da RPC (500
      // LEADS, não 500 linhas de mensagem). O que existe é um lote de 100 por
      // requisição, porque `.in("id", [...])` viaja na URL e 500 uuids passam
      // de 18 KB — tamanho que proxy nenhum aceita.
      const missing = Array.from(ids).filter((id) => !leads.some((l) => l.id === id));
      const LOTE = 100;
      for (let i = 0; i < missing.length; i += LOTE) {
        const { data: leadRows } = await supabase
          .from("crm_leads")
          .select(LEAD_LIST_COLS)
          .eq("tenant_id", tenant.id)
          // Busca por conteúdo de mensagem também retorna bloqueados.
          .in("id", missing.slice(i, i + LOTE));
        if (cancelled) return;
        if (!leadRows?.length) continue;
        setLeads((prev) => {
          const existing = new Set(prev.map((l) => l.id));
          const additions = (leadRows as any as LeadConversation[])
            .map(normalizeLead)
            .filter((l) => !existing.has(l.id));
          if (!additions.length) return prev;
          return sortLeadsByLastActivity([...prev, ...additions]);
        });
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [search, tenant.id]); // eslint-disable-line react-hooks/exhaustive-deps


  // Load special URL filter data (ghost leads, appointment leads)
  useEffect(() => {
    if (!urlGhost && !urlAppointmentStatus && !urlInactiveDays) return;
    const loadSpecialFilters = async () => {
      const PAGE = 1000;
      const fetchAll = async <T,>(build: (from: number, to: number) => any): Promise<T[]> => {
        const out: T[] = [];
        let from = 0;
        while (true) {
          const { data, error } = await build(from, from + PAGE - 1);
          if (error || !data || data.length === 0) break;
          out.push(...(data as T[]));
          if (data.length < PAGE) break;
          from += PAGE;
        }
        return out;
      };

      if (urlGhost) {
        const msgs = await fetchAll<{ lead_id: string }>((f, t) =>
          supabase.from("messages").select("lead_id").eq("direction", "inbound").neq("status", "system").range(f, t)
        );
        const inboundIds = new Set(msgs.map((m) => m.lead_id));
        // Ghost = leads NOT in inboundIds → we store inbound ids and invert in filter
        setGhostLeadIds(inboundIds);
      }
      if (urlAppointmentStatus) {
        // Régua canônica (reportKit.kpiAgendamentos): compareceram =
        // contracted + not_contracted; faltaram = no_show; reagendados =
        // is_rescheduled (agendamento NOVO nascido de remarcação).
        const apts = await fetchAll<{ lead_id: string }>((f, t) => {
          const q = supabase.from("crm_appointments").select("lead_id");
          if (urlAppointmentStatus === "rescheduled" || urlAppointmentStatus === "reagendados") {
            return q.eq("is_rescheduled", true).range(f, t);
          }
          if (urlAppointmentStatus === "missed" || urlAppointmentStatus === "no_show") {
            return q.eq("status", "no_show").range(f, t);
          }
          if (urlAppointmentStatus === "attended" || urlAppointmentStatus === "compareceram") {
            return q.in("status", ["contracted", "not_contracted"]).range(f, t);
          }
          return q.eq("status", urlAppointmentStatus).range(f, t);
        });
        setAppointmentLeadIds(new Set(apts.map((a) => a.lead_id)));
      }
    };
    loadSpecialFilters();
  }, [urlGhost, urlAppointmentStatus, urlInactiveDays]);

  // A lista muda a cada evento de Realtime (mensagem nova em QUALQUER conversa).
  // Este efeito roda junto — por isso ele MISTURA a versão da lista no lead
  // aberto em vez de trocá-lo. Trocando, os campos que a lista não traz
  // (notes/value/conversa_fechada_em) voltavam a ficar indefinidos a cada
  // atualização: a barra de notas sumia no meio da edição e o "Todas as Notas"
  // fechava sozinho (relato da gestão, 22/09/2026 — "não consigo editar/
  // excluir as notas de alguns leads").
  useEffect(() => {
    if (!selectedLeadId) {
      setSelectedLead(null);
      return;
    }
    const daLista = leads.find((l) => l.id === selectedLeadId) || null;
    if (!daLista) return; // ainda não chegou na lista: quem abriu por URL já hidratou
    setSelectedLead((prev) =>
      prev && prev.id === selectedLeadId ? ({ ...prev, ...daLista } as LeadConversation) : daLista,
    );
  }, [selectedLeadId, leads]);

  // Campos pesados (notes/value) ficam fora da lista: busca UMA vez por lead
  // aberto — já confirmado (REC-04), nunca com o id cru de um link.
  useEffect(() => {
    if (!leadAbertoId) return;
    let cancelled = false;
    supabase
      .from("crm_leads")
      .select("id, notes, value, conversa_fechada_em")
      .eq("id", leadAbertoId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setSelectedLead((prev) => prev && prev.id === leadAbertoId ? { ...prev, ...(data as any) } : prev);
      });
    return () => { cancelled = true; };
  }, [leadAbertoId]);


  // Hidrata, do BANCO, os leads que o Realtime avisou existirem e que não estão
  // na lista. É assim que o lead DISTRIBUÍDO para a SDR aparece para ela sem
  // recarregar a página. Se a RLS não devolver a linha, nada acontece — que é
  // exatamente o que deve acontecer quando o lead não é dela.
  //
  // Fila, não um id só (ver src/hooks/useHidratarLeadsAvisados.ts): até
  // 17/09/2026 isto era um useState de UM valor, e a abertura do expediente —
  // que entrega o lote reservado de uma vez — deixava aparecer só o último lead
  // do lote. Relato da SDR em 16/09: "o lead ficou oculto e não apareceu pra ela".
  const leadsNaTelaRef = useRef<Set<string>>(new Set());
  useEffect(() => { leadsNaTelaRef.current = new Set(leads.map((l) => l.id)); }, [leads]);

  const avisarLeadAusente = useHidratarLeadsAvisados<LeadConversation>(
    async (ids) => {
      const { data } = await supabase
        .from("crm_leads")
        .select(LEAD_LIST_COLS)
        .in("id", ids)
        .eq("is_blocked", false);
      return ((data as any[]) || []).map((d) => normalizeLead(d) as unknown as LeadConversation);
    },
    (novos) => {
      setLeads((prev) => {
        const ja = new Set(prev.map((l) => l.id));
        const entram = novos.filter((n) => !ja.has(n.id));
        return entram.length ? sortLeadsByLastActivity([...(entram as any[]), ...prev]) : prev;
      });
    },
  );

  // REDE DE SEGURANÇA, só para quem vê por DONA (SDR). A fila acima depende de
  // o Realtime entregar o aviso; se o canal caiu, a aba dormiu ou o aviso chegou
  // enquanto a lista ainda carregava, o lead só apareceria ao recarregar. Esta
  // conferência pergunta ao banco "quais leads são meus" e busca os que faltam
  // na tela. Roda: quando a lista termina de carregar, quando a aba volta a ficar
  // visível, a cada 60 s com a aba visível, e quando o expediente é aberto
  // (evento disparado por SdrExpediente). Custo: uma consulta de ids por índice.
  useEffect(() => {
    if (userRole !== "sdr" || !user?.id || !fullyLoaded) return;
    let vivo = true;
    const conferir = async () => {
      if (!vivo || document.visibilityState !== "visible") return;
      const { data, error } = await supabase
        .from("crm_leads")
        .select("id")
        .eq("assigned_to", user.id)
        .eq("is_blocked", false);
      if (!vivo || error || !data) return;
      data.forEach((r: { id: string }) => {
        if (!leadsNaTelaRef.current.has(r.id)) avisarLeadAusente(r.id);
      });
    };
    void conferir();
    const t = window.setInterval(conferir, 60_000);
    document.addEventListener("visibilitychange", conferir);
    window.addEventListener("crm:leads-da-sdr-mudaram", conferir);
    return () => {
      vivo = false;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", conferir);
      window.removeEventListener("crm:leads-da-sdr-mudaram", conferir);
    };
  }, [userRole, user?.id, fullyLoaded, avisarLeadAusente]);

  // PRESENÇA NA CONVERSA. Enquanto esta conversa estiver aberta e a aba visível,
  // Presença nesta conversa (ver src/hooks/usePresencaNaConversa.ts): segura o
  // lead contra a realocação por silêncio e contra o fechamento automático
  // enquanto a pessoa está aqui de verdade.
  // Só com a conversa confirmada (REC-04 / CLO-04): nada com o id cru do link.
  usePresencaNaConversa(leadAbertoId);

  // Realtime - leads list
  //
  // O canal é criado UMA vez. Antes ele dependia de [selectedLeadId] e era
  // desmontado e remontado a cada conversa que a SDR abria — e o aviso de lead
  // distribuído que chegasse nesse intervalo simplesmente se perdia. O id da
  // conversa aberta é lido por ref (selectedLeadIdRef, declarado lá em cima).

  useEffect(() => {
    const channel = supabase
      .channel("conv-leads-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_leads" }, (payload) => {
        if (payload.eventType === "INSERT") {
          const newLead = normalizeLead(payload.new as LeadConversation & { last_inbound_at?: string | null; last_outbound_at?: string | null });
          if ((newLead as any).is_blocked) return;
          setLeads((prev) => {
            if (prev.some((l) => l.id === newLead.id)) return prev;
            return sortLeadsByLastActivity([newLead, ...prev]);
          });
        } else if (payload.eventType === "UPDATE") {
          const updated = normalizeLead(payload.new as LeadConversation & { last_inbound_at?: string | null; last_outbound_at?: string | null }) as any;
          if (updated.is_blocked) {
            setLeads((prev) => prev.filter((l) => l.id !== updated.id));
            return;
          }
          // LEAD QUE AINDA NÃO ESTÁ NA LISTA: não entra pelo payload.
          //
          // É o caso de TODA distribuição para a SDR: o lead nasce sem dona
          // (INSERT) e a dona é gravada logo depois num UPDATE — então para ela
          // o lead distribuído sempre chega aqui como "lead que eu não tinha".
          // Inserir o payload cru tem dois problemas: ele não passou pela
          // consulta da lista (que traz derivados e recortes) e, sobretudo, o
          // evento de Realtime chega antes de qualquer conferência de permissão
          // do lado do cliente — confiar nele é confiar no que veio pela rede.
          //
          // Então o evento serve só de AVISO, e vai para a FILA fora do
          // setState (efeito colateral dentro de updater pode rodar duas vezes).
          // Quem busca é o banco, onde a RLS decide.
          if (!leadsNaTelaRef.current.has(updated.id as string)) {
            avisarLeadAusente(updated.id as string);
            return;
          }
          setLeads((prev) =>
            sortLeadsByLastActivity(prev.map((l) => l.id === updated.id ? { ...l, ...updated } : l)),
          );
          if (updated.id === selectedLeadIdRef.current) {
            setSelectedLead((prev) => prev ? { ...prev, ...updated } : prev);
          }
        } else if (payload.eventType === "DELETE") {
          const deletedId = (payload.old as any).id;
          setLeads((prev) => prev.filter((l) => l.id !== deletedId));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // avisarLeadAusente é estável (useCallback sem dependências mutáveis); o id
    // da conversa aberta vem por ref. O canal não é refeito a cada conversa.
  }, [avisarLeadAusente]);

  const handleStageChange = useCallback(async (stageId: string, pipelineId: string, motivo?: string) => {
    if (!selectedLeadId || !selectedLead) return;
    const previousStageId = selectedLead.stage_id;
    await chat.handleStageChange(stageId, previousStageId, (newStageId, newPipelineId) => {
      setSelectedLead((prev) => prev ? { ...prev, stage_id: newStageId, pipeline_id: newPipelineId || prev.pipeline_id } : prev);
      setLeads((prev) => prev.map((l) => l.id === selectedLeadId ? { ...l, stage_id: newStageId, pipeline_id: newPipelineId || l.pipeline_id } : l));
    }, pipelineId, motivo);
  }, [selectedLeadId, selectedLead, chat]);

  const handleSaveNotes = useCallback(async (updatedNotes: string) => {
    const ok = await chat.saveNotes(updatedNotes);
    if (ok) setSelectedLead((prev) => prev ? { ...prev, notes: updatedNotes } : prev);
  }, [chat]);

  const handleAddNote = useCallback(async (noteText: string) => {
    if (!noteText.trim() || !selectedLead) return;
    const existingNotes = selectedLead.notes || "";
    const timestamp = new Date().toLocaleString("pt-BR");
    const updatedNotes = `${existingNotes}\n[${timestamp}] ${noteText.trim()}`.trim();
    await handleSaveNotes(updatedNotes);
  }, [selectedLead, handleSaveNotes]);

  // Envio de modelo: Sheet (depois da confirmação do EnviarModeloDialog) e o
  // "/" do compositor (CONV-1) — com os valores das variáveis escolhidos na
  // tela (CONV-15).
  const handleSendTemplate = useCallback(async (template: ModeloParaEnviar, componentes?: ComponentesDoModelo) => {
    const ch: "whatsapp" | "instagram" = getLeadChannel(selectedLead);
    await chat.sendTemplate(template, selectedLead?.phone || null, ch, componentes);
  }, [chat, selectedLead]);

  // Transfer lead to another user
  //
  // CONV-3: nada de "Lead transferido" antes da resposta. O seletor muda na
  // hora (otimista), mas o aviso e a linha no chat só saem com o OK da
  // transfer-lead; a recusa aparece com o motivo do servidor.
  const handleTransferLead = useCallback(async (newUserId: string) => {
    if (!selectedLead || !selectedLeadId) return;
    const oldUserId = selectedLead.assigned_to;
    if (newUserId === oldUserId) return;

    const newUserName = profiles.find(p => p.id === newUserId)?.nome || "?";
    const capturedLeadId = selectedLeadId;

    setSelectedLead(prev => prev && prev.id === capturedLeadId ? { ...prev, assigned_to: newUserId } : prev);
    setLeads(prev => prev.map(l => l.id === capturedLeadId ? { ...l, assigned_to: newUserId } : l));

    // Call edge function — it handles automatic pipeline/stage restoration
    const { data, error } = await supabase.functions.invoke("transfer-lead", {
      body: { leadId: capturedLeadId, newUserId },
    });

    if (error || data?.error) {
      setSelectedLead(prev => prev && prev.id === capturedLeadId ? { ...prev, assigned_to: oldUserId } : prev);
      setLeads(prev => prev.map(l => l.id === capturedLeadId ? { ...l, assigned_to: oldUserId ?? null } : l));
      const motivo = await motivoDoServidor(data, error, "Não foi possível transferir o lead.");
      toast.error(`Erro ao transferir lead: ${motivo}`);
      return;
    }

    chat.showActivityToast(`🔄 Lead transferido para ${newUserName}`);
    toast.success(`Lead transferido para ${newUserName}`);

    // Só a SDR perde o lead de vista ao transferir (a visibilidade dela é por
    // dona). Gestor/CRC continuam vendo tudo: a conversa fica na lista.
    if (userRole === "sdr") {
      window.setTimeout(() => {
        setLeads(prev => prev.filter(l => l.id !== capturedLeadId));
        setSelectedLeadId(prev => prev === capturedLeadId ? null : prev);
        setSelectedLead(prev => prev?.id === capturedLeadId ? null : prev);
      }, 10000);
    }

    // If the function moved the lead to another pipeline/stage, update local state
    if (data?.pipeline_id || data?.stage_id) {
      setSelectedLead(prev => prev && prev.id === capturedLeadId ? {
        ...prev,
        assigned_to: newUserId,
        ...(data.pipeline_id ? { pipeline_id: data.pipeline_id } : {}),
        ...(data.stage_id ? { stage_id: data.stage_id } : {}),
      } : prev);
      setLeads(prev => prev.map(l => l.id === capturedLeadId ? {
        ...l,
        assigned_to: newUserId,
        ...(data.pipeline_id ? { pipeline_id: data.pipeline_id } : {}),
        ...(data.stage_id ? { stage_id: data.stage_id } : {}),
      } : l));
      if (data.moved_pipeline && data.moved_stage) {
        chat.showActivityToast(`📂 Movido para: ${data.moved_pipeline} • ${data.moved_stage}`);
      }
    }
  }, [selectedLead, selectedLeadId, profiles, chat, userRole]);

  // CONV-21: quem está bloqueado não entra na escolha de Responsável nem no
  // filtro — o responsável atual continua aparecendo com o nome (e o aviso).
  const perfisAtivos = useMemo(() => profiles.filter((p) => !p.is_blocked), [profiles]);
  const perfisDoFiltro = useMemo(
    () => (filters.assignedTo && !perfisAtivos.some((p) => p.id === filters.assignedTo)
      ? [...perfisAtivos, ...profiles.filter((p) => p.id === filters.assignedTo)]
      : perfisAtivos),
    [profiles, perfisAtivos, filters.assignedTo],
  );

  // Números da clínica para o filtro "Número" e o selo "Pausado" (S29P-3d).
  const numerosPausados = useMemo(
    () => new Set(numerosLiberados.filter((n) => n.waba_pausada === true).map((n) => n.id)),
    [numerosLiberados],
  );
  const numerosDoFiltro = useMemo(
    () => (numerosLiberados.length > 1
      ? numerosLiberados.map((n) => ({ id: n.id, nome: nomeDoNumero(n), pausado: n.waba_pausada === true }))
      : []),
    [numerosLiberados],
  );

  // Collect all tags for filters
  const allTags = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => l.tags?.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [leads]);

  // Instagram accounts (only on instagram tab)
  const [instagramAccounts, setInstagramAccounts] = useState<{ id: string; username: string }[]>([]);
  const [leadIgAccountMap, setLeadIgAccountMap] = useState<Map<string, Set<string>>>(new Map());
  useEffect(() => {
    let cancelled = false;
    if (!tenant.id) return;
    (async () => {
      const { data: accs } = await supabase
        .from("ig_accounts")
        .select("ig_user_id, username, active")
        .eq("tenant_id", tenant.id)
        .eq("active", true);
      if (cancelled) return;
      setInstagramAccounts(
        (accs ?? [])
          .filter((a: any) => a.ig_user_id && a.username)
          .map((a: any) => ({ id: a.ig_user_id, username: a.username }))
      );
      // Map lead -> set(instagram_account_id) from messages
      const { data: msgs } = await supabase
        .from("messages")
        .select("lead_id, instagram_account_id")
        .eq("tenant_id", tenant.id)
        .not("instagram_account_id", "is", null)
        .limit(5000);
      if (cancelled) return;
      const map = new Map<string, Set<string>>();
      (msgs ?? []).forEach((m: any) => {
        if (!m.lead_id || !m.instagram_account_id) return;
        if (!map.has(m.lead_id)) map.set(m.lead_id, new Set());
        map.get(m.lead_id)!.add(m.instagram_account_id);
      });
      setLeadIgAccountMap(map);
    })();
    return () => { cancelled = true; };
  }, [tenant.id]);

  // Collect ad accounts and ads available among leads
  const { adAccounts, ads } = useMemo(() => {
    const accMap = new Map<string, string>();
    const adMap = new Map<string, { name: string; ad_account_id: string | null; image: string | null; description: string | null; link: string | null }>();
    leads.forEach((l: any) => {
      if (l.ad_account_id) accMap.set(l.ad_account_id, l.ad_account_name || l.ad_account_id);
      if (l.ad_id && !adMap.has(l.ad_id)) {
        adMap.set(l.ad_id, {
          name: l.nome_anuncio || l.titulo_anuncio || l.ad_id,
          ad_account_id: l.ad_account_id || null,
          image: l.imagem_origem || null,
          description: l.descricao_anuncio || l.titulo_anuncio || null,
          link: l.link_anuncio || null,
        });
      }
    });
    return {
      adAccounts: Array.from(accMap, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      ads: Array.from(adMap, ([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [leads]);

  // Overrides de pipeline do próprio usuário (user_permission_overrides, scope
  // "pipeline") — sem eles o filtro defensivo abaixo esconderia leads que o
  // backend CONCEDEU por override (caso recepcao), deixando a lista vazia.
  const [pipelineOverrides, setPipelineOverrides] = useState<Map<string, boolean>>(new Map());
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    supabase
      .from("user_permission_overrides")
      .select("resource_id, granted")
      .eq("user_id", user.id)
      .eq("scope", "pipeline")
      .then(({ data }) => {
        if (!cancelled) {
          setPipelineOverrides(new Map((data ?? []).map((o: any) => [o.resource_id, o.granted])));
        }
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  // Defensive: compute pipelines that this user's role should NOT see.
  // Mirrors backend can_access_pipeline() so the UI never leaks Pós-Venda leads
  // into CRC's Conversas list even if RLS is misconfigured or cache is stale.
  // Rule (same COALESCE semantics as the backend): explicit override wins;
  // otherwise pipeline is accessible if
  //   - user is superadmin, OR
  //   - pipeline.allowed_roles is NULL/empty AND user is crc/gerente, OR
  //   - user's role is in pipeline.allowed_roles
  const inaccessiblePipelineIds = useMemo(() => {
    const role = userRole;
    if (!role || role === "superadmin") return new Set<string>();
    const blocked = new Set<string>();
    for (const p of pipelines) {
      const roles = p.allowed_roles;
      const isOpen = !roles || roles.length === 0;
      const userInRoles = roles?.includes(role);
      const crcDefaults = isOpen && (role === "crc" || role === "gerente");
      const override = pipelineOverrides.get(p.id);
      const accessible = override !== undefined ? override : (crcDefaults || userInRoles);
      if (!accessible) blocked.add(p.id);
    }
    return blocked;
  }, [pipelines, userRole, pipelineOverrides]);

  // Apply filters
  const filtered = useMemo(() => {
    return leads.filter((l) => {
      // Defensive: hide leads from pipelines this role can't access
      if (l.pipeline_id && inaccessiblePipelineIds.has(l.pipeline_id)) return false;
      // Tab-level pipeline scoping (WhatsApp vs Instagram)
      if (pipelineFilter && l.pipeline_id !== pipelineFilter) return false;
      if (excludePipelines && excludePipelines.includes(l.pipeline_id)) return false;
      // Channel-based filtering (tenant-agnostic): IG leads have instagram_user_id
      if (channelFilter === "instagram" && getLeadChannel(l) !== "instagram") return false;
      if (channelFilter === "whatsapp" && getLeadChannel(l) !== "whatsapp") return false;
      if (channelFilter === "instagram" && getInstagramInteractionType(l) !== instagramInteractionFilter) return false;
      const normalizedSearch = search.trim().toLowerCase();
      if (normalizedSearch) {
        const searchDigits = normalizedSearch.replace(/\D/g, "");
        const phoneRaw = l.phone || "";
        const phoneDigits = phoneRaw.replace(/\D/g, "");
        const matchesText =
          l.name.toLowerCase().includes(normalizedSearch) ||
          phoneRaw.toLowerCase().includes(normalizedSearch) ||
          (l.last_message || "").toLowerCase().includes(normalizedSearch);

        // Build phone variants to handle BR mobile 9th-digit differences, country code, and local numbers without DDD
        const phoneVariants = new Set<string>();
        if (phoneDigits) {
          phoneVariants.add(phoneDigits);
          const noCountry = phoneDigits.startsWith("55") ? phoneDigits.slice(2) : phoneDigits;
          phoneVariants.add(noCountry);

          // Local number without DDD
          if (noCountry.length >= 10) phoneVariants.add(noCountry.slice(2));

          // Add/remove 9 after DDD
          if (noCountry.length === 10) {
            const withNinth = noCountry.slice(0, 2) + "9" + noCountry.slice(2);
            phoneVariants.add(withNinth);
            phoneVariants.add(withNinth.slice(2));
          }
          if (noCountry.length === 11 && noCountry[2] === "9") {
            const withoutNinth = noCountry.slice(0, 2) + noCountry.slice(3);
            phoneVariants.add(withoutNinth);
            phoneVariants.add(withoutNinth.slice(2));
          }
        }

        // Build search variants similarly
        const searchVariants = new Set<string>();
        if (searchDigits.length >= 3) {
          searchVariants.add(searchDigits);
          const sNoCountry = searchDigits.startsWith("55") && searchDigits.length >= 12 ? searchDigits.slice(2) : searchDigits;
          searchVariants.add(sNoCountry);
          if (sNoCountry.length === 11 && sNoCountry[2] === "9") searchVariants.add(sNoCountry.slice(0, 2) + sNoCountry.slice(3));
          if (sNoCountry.length === 10) searchVariants.add(sNoCountry.slice(0, 2) + "9" + sNoCountry.slice(2));
        }

        let matchesPhone = false;
        if (searchVariants.size > 0 && phoneVariants.size > 0) {
          for (const sv of searchVariants) {
            for (const pv of phoneVariants) {
              if (pv.includes(sv)) { matchesPhone = true; break; }
            }
            if (matchesPhone) break;
          }
        }
        const matchesMessage = !!messageMatchLeadIds && messageMatchLeadIds.has(l.id);
        if (!matchesText && !matchesPhone && !matchesMessage) return false;
      }
      if (filters.dateFilter.preset !== "all") {
        if (!l.last_message_at) return false;
        const msgDate = new Date(l.last_message_at);
        const range = getDateRangeFromFilter(filters.dateFilter);
        if (range && !isWithinInterval(msgDate, { start: range.start, end: range.end })) return false;
      }
      if (filters.pipelineId && l.pipeline_id !== filters.pipelineId) return false;
      if (filters.stageId && l.stage_id !== filters.stageId) return false;
      if (filters.assignedTo && l.assigned_to !== filters.assignedTo) return false;
      // Número de WhatsApp (pedido da sessão 29): lead sem número não entra
      // quando o filtro está ligado — mesma régua do .in('whatsapp_number_id', …).
      if (filters.whatsappNumberIds?.length) {
        const numero = (l as { whatsapp_number_id?: string | null }).whatsapp_number_id;
        const ok = numero ? filters.whatsappNumberIds.includes(numero) : filters.whatsappNumberIds.includes("__sem_numero__");
        if (!ok) return false;
      }
      // "Aberto" (não lida) usa a mesma janela de 60 dias dos contadores (badge/abas)
      if (filters.status === "open" && !isUnreadLead(l)) return false;
      if (filters.status === "replied" && l.last_direction !== "outbound") return false;
      if (filters.status === "no_reply" && !!l.last_direction) return false;
      if (filters.tags.length && !filters.tags.some((t) => l.tags?.includes(t))) return false;
      if (filters.hasPagamento) {
        const hasPag = leadsWithPagamento.has(l.id);
        if (filters.hasPagamento === "yes" && !hasPag) return false;
        if (filters.hasPagamento === "no" && hasPag) return false;
      }
      if (filters.labelIds?.length) {
        const leadLabelIds = labelsByLead(l.id).map((x) => x.id);
        if (!filters.labelIds.some((id) => leadLabelIds.includes(id))) return false;
      }
      if (filters.source) {
        if (!leadSourceMatchesFilter(l.source, filters.source)) return false;
      }

      if (filters.cidade && (l.cidade || "") !== filters.cidade) return false;
      if (filters.servicoInteresse && ((l as any).servico_interesse || "") !== filters.servicoInteresse) return false;
      if (filters.adAccountId && ((l as any).ad_account_id || "") !== filters.adAccountId) return false;
      if (filters.adId && ((l as any).ad_id || "") !== filters.adId) return false;
      if (filters.instagramAccountId) {
        const set = leadIgAccountMap.get(l.id);
        if (!set || !set.has(filters.instagramAccountId)) return false;
      }
      // Special URL filters
      if (urlGhost && ghostLeadIds && ghostLeadIds.has(l.id)) return false; // ghost = NOT in inbound set
      if (urlAppointmentStatus && appointmentLeadIds && !appointmentLeadIds.has(l.id)) return false;
      if (urlInactiveDays) {
        const days = parseInt(urlInactiveDays) || 3;
        const threshold = days * 86400000;
        const lastActivity = l.last_message_at ? new Date(l.last_message_at).getTime() : new Date(l.created_at).getTime();
        if (Date.now() - lastActivity < threshold) return false;
      }
      return true;
    });
  }, [leads, search, filters, user?.id, urlGhost, ghostLeadIds, urlAppointmentStatus, appointmentLeadIds, urlInactiveDays, pipelineFilter, excludePipelines, channelFilter, instagramInteractionFilter, leadIgAccountMap, inaccessiblePipelineIds, messageMatchLeadIds, leadsWithPagamento, labelsByLead]);

  // Balão da aba mostra só as conversas EM ABERTO (não lidas) — mesma regra do
  // balão do WhatsApp (isUnreadLead: inbound, dentro da janela, não fechada).
  const instagramInteractionCounts = useMemo(() => {
    const counts = { comment: 0, dm: 0 };
    if (channelFilter !== "instagram") return counts;
    leads.forEach((lead) => {
      if (lead.pipeline_id && inaccessiblePipelineIds.has(lead.pipeline_id)) return;
      if (pipelineFilter && lead.pipeline_id !== pipelineFilter) return;
      if (excludePipelines?.includes(lead.pipeline_id)) return;
      if (getLeadChannel(lead) !== "instagram") return;
      if (!isUnreadLead(lead)) return;
      counts[getInstagramInteractionType(lead)] += 1;
    });
    return counts;
  }, [channelFilter, excludePipelines, inaccessiblePipelineIds, leads, pipelineFilter]);

  // Sorting
  const [sortMode, setSortMode] = useState<"recent" | "longest_wait" | "featured" | "closed">("recent");

  const sortedFiltered = useMemo(() => {
    if (sortMode === "closed") {
      // Só conversas fechadas, da fechada há menos tempo para a mais antiga
      const closed = filtered.filter(l => !!l.conversa_fechada_em);
      closed.sort((a, b) => new Date(b.conversa_fechada_em!).getTime() - new Date(a.conversa_fechada_em!).getTime());
      return closed;
    }
    if (sortMode === "longest_wait") {
      // Apenas leads não lidos (inbound dentro da janela de 60 dias — igual aos
      // contadores), ordenados do last_inbound_at mais antigo para o mais novo
      const unread = filtered.filter(l => isUnreadLead(l));
      const rest = filtered.filter(l => !isUnreadLead(l));
      unread.sort((a, b) => {
        const aTime = a.last_inbound_at ? new Date(a.last_inbound_at).getTime() : 0;
        const bTime = b.last_inbound_at ? new Date(b.last_inbound_at).getTime() : 0;
        return aTime - bTime; // oldest first
      });
      return [...unread, ...rest];
    }
    // "recent" is the default sort (already sorted by last_message_at desc)
    return filtered;
  }, [filtered, sortMode]);

  // Lista virtualizada: renderiza só os itens visíveis no scroll, DOM permanece pequeno.
  const listScrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: sortedFiltered.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => 76,
    overscan: 8,
    getItemKey: (i) => sortedFiltered[i]?.id ?? i,
  });
  useEffect(() => {
    listScrollRef.current?.scrollTo({ top: 0 });
  }, [search, filters, sortMode]);


  const currentStage = chat.stages.find((s) => s.id === selectedLead?.stage_id);

  // POS-01: perfil sem nenhum funil acessível (ex.: pós-venda sem o funil de
  // pós-venda) — a lista vazia explica o porquê em vez de só "Nenhuma conversa".
  const semFunil =
    fullyLoaded && !erroLista && leads.length === 0 && !!userRole && userRole !== "superadmin" &&
    pipelines.every((p) => inaccessiblePipelineIds.has(p.id));
  const podeVerOrcamento = !!userRole && PAPEIS_DO_ORCAMENTO.has(userRole);

  return (
    <div className="flex h-full w-full min-w-0 min-h-0 max-w-full flex-col overflow-hidden">
      <ResizablePanelGroup key={isCrmMobile ? "m" : "d"} direction="horizontal" className="h-full w-full min-w-0 min-h-0 max-w-full overflow-hidden p-2 sm:px-4 sm:pb-4 sm:pt-3">
        {/* LEFT PANEL - Leads list */}
        {effLeftVisible && (
        <><ResizablePanel defaultSize={isCrmMobile ? 100 : 24} minSize={isCrmMobile ? 100 : 20} maxSize={isCrmMobile ? 100 : 28} className="min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card dark:border-border">
          <div className="flex min-w-0 min-h-0 h-full flex-col overflow-hidden">
              {/* URL filter banner */}
              {(urlGhost || urlAppointmentStatus || urlInactiveDays) && (
                <div className="flex flex-wrap items-center gap-1.5 px-4 pt-4">
                  {urlGhost && <Badge variant="soft-destructive">Leads Fantasma</Badge>}
                  {urlAppointmentStatus && <Badge variant="soft-info">Agendamento: {rotuloFiltroAgendamento(urlAppointmentStatus, userRole)}</Badge>}
                  {urlInactiveDays && <Badge variant="soft-slate">Inativos +{urlInactiveDays}d</Badge>}
                  <Button variant="ghost" size="sm" className="h-6 rounded-full px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setSearchParams(selectedLeadId ? { lead: selectedLeadId } : {}, { replace: true, state: location.state })}>✕ Limpar</Button>
                </div>
              )}
            <div className="flex-shrink-0 px-4 pt-4 pb-3">
              {channelFilter === "instagram" && (
                <div className="mb-3 grid grid-cols-2 rounded-xl bg-surface-sunken p-1" role="tablist" aria-label="Tipo de conversa do Instagram">
                  {([
                    ["dm", "Direct", instagramInteractionCounts.dm],
                    ["comment", "Comentários", instagramInteractionCounts.comment],
                  ] as const).map(([value, label, count]) => (
                    <Button
                      key={value}
                      type="button"
                      variant="ghost"
                      role="tab"
                      aria-selected={instagramInteractionFilter === value}
                      onClick={() => {
                        setInstagramInteractionFilter(value);
                        setSelectedLeadId(null);
                        setSelectedLead(null);
                      }}
                      className={`h-9 min-w-0 rounded-lg px-2 text-[13px] font-semibold ${
                        instagramInteractionFilter === value
                          ? "bg-card text-foreground shadow-xs hover:bg-card"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <span className="truncate">{label}</span>
                      <span className="ml-1.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                        {count > 999 ? "999+" : count}
                      </span>
                    </Button>
                  ))}
                </div>
              )}
              <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold tracking-tight text-foreground">Conversas</h2>
                <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                  <ConversationFilters
                    ocultarPagamentos={["sdr", "recepcao", "closer"].includes(userRole ?? "")}
                    stages={chat.stages}
                    profiles={perfisDoFiltro}
                    allTags={allTags}
                    filters={filters}
                    onApply={setFilters}
                    pipelines={pipelines}
                    adAccounts={adAccounts}
                    ads={ads}
                    channel={channel}
                    instagramAccounts={instagramAccounts}
                    numeros={numerosDoFiltro}
                  />
                   <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-2 text-[11px] font-semibold tabular-nums text-muted-foreground">{sortedFiltered.length}{!fullyLoaded ? "…" : ""}</span>
                   <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                       <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
                         <MoreHorizontal size={18} strokeWidth={1.75} />
                       </Button>
                     </DropdownMenuTrigger>
                     <DropdownMenuContent align="end" className="w-48 rounded-xl p-1.5 shadow-float">
                       <DropdownMenuLabel className="text-xs font-medium text-tertiary">Ordenar</DropdownMenuLabel>
                       <DropdownMenuItem onClick={() => setSortMode("recent")} className={sortMode === "recent" ? "rounded-lg bg-primary-soft-2 font-medium text-primary" : "rounded-lg"}>
                         Mais recentes {sortMode === "recent" && "✓"}
                       </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSortMode("longest_wait")} className={sortMode === "longest_wait" ? "rounded-lg bg-primary-soft-2 font-medium text-primary" : "rounded-lg"}>
                          Longa espera {sortMode === "longest_wait" && "✓"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSortMode("closed")} className={sortMode === "closed" ? "rounded-lg bg-primary-soft-2 font-medium text-primary" : "rounded-lg"}>
                          Fechadas {sortMode === "closed" && "✓"}
                        </DropdownMenuItem>
                     </DropdownMenuContent>
                   </DropdownMenu>
                </div>
              </div>
              <div className="relative">
                <Search size={18} strokeWidth={1.75} className="absolute left-3 top-5 -translate-y-1/2 text-tertiary z-10 pointer-events-none" />
                <Input
                  placeholder="Buscar por nome, telefone ou mensagem..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-10 rounded-xl border-transparent bg-surface-sunken pl-10 text-sm placeholder:text-tertiary focus-visible:bg-card"
                />
                {/* A busca por mensagem corta em 500 leads. Dizer isso é o que
                    separa "não existe mais nada" de "tem mais, refine". */}
                {buscaNoTeto && (
                  <p className="mt-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-[11px] leading-snug text-warning-soft-foreground">
                    Mostrando as 500 conversas com a mensagem mais recente. Há mais — use uma palavra
                    mais específica para chegar nas antigas.
                  </p>
                )}
                {/* Search autocomplete dropdown */}
                {search.trim().length >= 2 && sortedFiltered.length > 0 && sortedFiltered.length <= 8 && search.replace(/\D/g, "").length >= 3 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-border/60 bg-popover p-1 shadow-float">
                    {filtered.slice(0, 6).map((lead) => (
                      <button
                        key={lead.id}
                          onClick={() => { handleSelectLead(lead); setSearch(""); }}
                        className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-sunken"
                      >
                        <Avatar className="h-7 w-7">
                          <AvatarFallback className="bg-primary-soft text-primary-soft-fg text-[11px] font-semibold">
                            {lead.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <span className="text-[13px] font-medium text-foreground truncate block">{lead.name}</span>
                          <span className="text-[11px] text-tertiary tabular-nums">{lead.phone ? formatPhoneDisplayBR(lead.phone) : "Sem telefone"}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* REC-07: recepção/closer sem número liberado ficam sabendo ANTES de tentar. */}
            {semNumeroLiberado && (
              <p role="status" className="mx-4 mb-3 flex items-start gap-2 rounded-lg bg-warning-soft px-2.5 py-2 text-[12px] leading-snug text-warning-soft-foreground">
                <AlertTriangle size={14} strokeWidth={1.75} className="mt-px shrink-0" />
                {avisoSemNumero}
              </p>
            )}
            <div ref={listScrollRef} className="flex-1 overflow-y-auto px-2 pb-2" style={{ contain: "strict" }}>
              {loading ? (
                <div className="flex items-center justify-center h-32 text-tertiary text-[13px]">Carregando...</div>
              ) : erroLista && sortedFiltered.length === 0 ? (
                <div role="alert" className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
                  <AlertTriangle size={24} strokeWidth={1.75} className="box-content rounded-full bg-destructive-soft p-4 text-destructive" />
                  <p className="text-[15px] font-semibold text-foreground">Não foi possível carregar as conversas</p>
                  <p className="text-[13px] text-muted-foreground">{erroLista}</p>
                  <Button size="sm" variant="outline" className="h-9 rounded-xl px-4 text-[13px] font-medium" onClick={tentarCarregarDeNovo}>
                    Tentar novamente
                  </Button>
                </div>
              ) : sortedFiltered.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
                  <MessageSquare size={24} strokeWidth={1.75} className="box-content rounded-full bg-primary-soft p-4 text-primary-soft-fg" />
                  <p className="text-[15px] font-semibold text-foreground">{semFunil ? "Seu perfil ainda não tem funil" : "Nenhuma conversa"}</p>
                  {semFunil && <p className="text-[13px] text-muted-foreground">Peça ao(à) gestor(a) para criar ou liberar um funil para você.</p>}
                </div>
              ) : (
                <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}>
                  {rowVirtualizer.getVirtualItems().map((vRow) => {
                    const lead = sortedFiltered[vRow.index];
                    if (!lead) return null;
                    const initials = lead.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                    const isActive = lead.id === selectedLeadId;
                    // Menu "Marcar como respondida" segue o estado real (inbound);
                    // o destaque visual de não lida usa a janela de 60 dias dos contadores.
                    const isInbound = lead.last_direction === "inbound";
                    const isUnread = isUnreadLead(lead);
                     return (
                      <div
                        key={lead.id}
                        ref={rowVirtualizer.measureElement}
                        data-index={vRow.index}
                        style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vRow.start}px)` }}
                        className={`relative group flex items-start gap-0 rounded-xl border-b-2 border-transparent bg-clip-padding transition-colors ${
                          isActive
                            ? "bg-primary-soft shadow-xs ring-1 ring-inset ring-primary/50 before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-primary"
                            : isUnread
                              ? "bg-primary-soft/70 hover:bg-primary-soft dark:bg-primary-soft/80 dark:hover:bg-primary-soft before:absolute before:inset-y-5 before:left-0 before:w-[3px] before:rounded-full before:bg-primary"
                              : "hover:bg-surface-sunken"
                        }`}>
                        <button
                          onClick={() => handleSelectLead(lead)}
                          className="flex-1 flex items-start gap-3 rounded-xl py-3 pl-3.5 pr-3 text-left min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          <div className="relative flex-shrink-0">
                            <Avatar className="h-11 w-11">
                              {lead.instagram_profile_pic_url && (
                                <AvatarImage src={lead.instagram_profile_pic_url} alt={lead.name} />
                              )}
                              <AvatarFallback className="bg-primary-soft text-primary-soft-fg text-[15px] font-semibold">{initials}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-0.5 -right-0.5 flex rounded-full bg-card ring-2 ring-card">
                              <ChannelBadgeIcon source={getLeadChannel(lead)} size={16} />
                            </div>
                          </div>
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5">
                            <div className="contents">
                              <span className={`contents text-sm text-foreground ${isUnread ? "font-bold" : "font-semibold"}`}>
                                {(lead as any).is_blocked && (
                                  <Badge variant="soft-destructive" className="order-1 h-5 shrink-0 px-2 text-[10px]" title="Lead bloqueado — só aparece na busca">Bloqueado</Badge>
                                )}
                                <span className="order-2 min-w-0 flex-1 break-normal leading-snug line-clamp-2">{lead.name}</span>
                                {multiNumberTenant && getLeadChannel(lead) !== "instagram" && (() => {
                                  const numeroDoLead = (lead as any).whatsapp_number_id as string | null | undefined;
                                  const padrao = (numerosVisiveis ?? []).find((n: any) => n.is_default && n.is_active);
                                  const rotulo = numeroDoLead ? rotuloNumeroDoLead(numeroDoLead) : padrao ? `${nomeDoNumero(padrao)} (padrão)` : rotuloNumeroDoLead(null);
                                  if (!rotulo) return null;
                                  // S29P-3d: número com o WhatsApp pausado pelo suporte.
                                  const pausado = !!numeroDoLead && numerosPausados.has(numeroDoLead);
                                  return (
                                    <Badge
                                      variant={pausado ? "soft-warning" : "soft-slate"}
                                      className="order-6 mt-1.5 block h-5 min-w-0 max-w-fit flex-1 basis-0 truncate px-2 text-[10px] font-medium leading-5"
                                      title={pausado ? "Número de WhatsApp desta conversa — envio pausado pelo suporte" : "Número de WhatsApp desta conversa"}
                                    >
                                      {pausado ? `${rotulo} · Pausado` : rotulo}
                                    </Badge>
                                  );
                                })()}
                              </span>
                              {(() => {
                                // Na busca, o horário é o da MENSAGEM ENCONTRADA.
                                // Fora dela, o da última mensagem da conversa.
                                const termo = search.trim();
                                const achada = termo.length >= 3 ? messageMatchTimes?.get(lead.id) : null;
                                const ts = achada || lead.last_message_at || lead.created_at;
                                if (!ts) return null;
                                const d = new Date(ts);
                                const today = new Date();
                                const yest = new Date(Date.now() - 86400000);
                                let texto: string;
                                if (d.toDateString() === today.toDateString())
                                  texto = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                                else if (d.toDateString() === yest.toDateString()) texto = "Ontem";
                                else texto = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
                                return (
                                  <span
                                    className="order-3 ml-auto shrink-0 pl-1 text-xs text-tertiary whitespace-nowrap tabular-nums"
                                    title={achada
                                      ? `Mensagem encontrada: ${d.toLocaleString("pt-BR")}`
                                      : "Última mensagem"}
                                  >
                                    {texto}
                                  </span>
                                );
                              })()}
                            </div>
                            <div className="contents">
                              {lead.source && (
                                <Badge variant="soft-info" className="order-5 mt-1.5 block h-5 min-w-0 max-w-[60%] shrink-0 truncate px-2 text-[10px] leading-5">
                                  {rotuloOrigemLead(lead.source)}
                                </Badge>
                              )}
                            </div>
                            {(() => {
                              const basePreview = MARCADOR_MIDIA_DO_HISTORICO.test(lead.last_message || "")
                                ? "Mídia do histórico do WhatsApp"
                                : formatCallPermissionPreview(lead.last_message) ?? (lead.last_message || "");
                              const isOutbound = lead.last_direction === "outbound";
                              let preview: string;
                              if (isOutbound) {
                                preview = basePreview
                                  ? (basePreview.startsWith("Você:") ? basePreview : `Você: ${basePreview}`)
                                  : "Você: 🎤 Áudio";
                              } else {
                                preview = basePreview || "Sem mensagens";
                              }
                              return <p className={`order-4 basis-full truncate mt-0.5 text-[13px] ${isUnread ? "font-medium text-foreground" : "text-muted-foreground"}`}>{preview}</p>;
                            })()}
                            {(() => {
                              // Por que este lead apareceu: o termo está numa mensagem
                              // ANTIGA da conversa. Só mostramos quando o nome e a última
                              // mensagem não têm o termo — senão seria repetir o óbvio.
                              const termo = search.trim().toLowerCase();
                              if (termo.length < 3) return null;
                              const trecho = messageMatchSnippets?.get(lead.id);
                              if (!trecho) return null;
                              const alvo = semAcento(termo);
                              const jaExplicado =
                                semAcento(lead.name).includes(alvo) ||
                                semAcento(lead.last_message || "").includes(alvo);
                              if (jaExplicado) return null;
                              // Só usa o índice normalizado quando a normalização
                              // preservou a contagem de caracteres; senão o slice
                              // recortaria no lugar errado.
                              const trechoNorm = semAcento(trecho);
                              const corte = trechoNorm.length === trecho.length
                                ? trechoNorm.indexOf(alvo)
                                : trecho.toLowerCase().indexOf(termo);
                              return (
                                <p
                                  className="order-7 basis-full min-w-0 text-xs text-muted-foreground truncate mt-1.5 flex items-center gap-1.5 rounded-lg bg-card/70 px-2 py-1"
                                  title={trecho}
                                >
                                  <Search size={12} strokeWidth={1.75} className="flex-shrink-0 text-tertiary" />
                                  <span className="truncate italic">
                                    {corte < 0 ? trecho : (
                                      <>
                                        {trecho.slice(0, corte)}
                                        <mark className="bg-primary-soft text-primary-soft-fg font-medium rounded px-0.5 not-italic">
                                          {trecho.slice(corte, corte + termo.length)}
                                        </mark>
                                        {trecho.slice(corte + termo.length)}
                                      </>
                                    )}
                                  </span>
                                </p>
                              );
                            })()}
                          </div>
                        </button>
                        {/* Context menu */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-card shadow-xs opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
                              <MoreHorizontal size={16} strokeWidth={1.75} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5 shadow-float">
                            {isInbound && (
                              <DropdownMenuItem onClick={async (e) => {
                                e.stopPropagation();
                                const { data, error } = await supabase.from("crm_leads").update({ last_outbound_at: new Date().toISOString() }).eq("id", lead.id).select("id");
                                if (error) { toast.error("Erro ao marcar como respondida: " + mensagemDeErro(error)); return; }
                                if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para alterar este lead."); return; }
                                setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, last_direction: "outbound", last_outbound_at: new Date().toISOString() } as any : l));
                                if (selectedLeadId === lead.id) setSelectedLead(prev => prev ? { ...prev, last_direction: "outbound" } : prev);
                                toast.success("Conversa marcada como respondida");
                              }}>
                                <CheckCheck size={14} className="mr-2 text-primary" /> Marcar como respondida
                              </DropdownMenuItem>
                            )}
                            {isInbound && <DropdownMenuSeparator />}
                            <FecharConversaMenuItem
                              leadId={lead.id}
                              fechadaEm={lead.conversa_fechada_em}
                              responsavelId={lead.assigned_to}
                              onChange={(quando) => atualizarFechada(lead.id, quando)}
                            />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!window.confirm("Bloquear este lead? As mensagens dele serão descartadas e ele não aparecerá mais no Kanban nem na lista de conversas. Você pode desbloqueá-lo depois em Configurações → Bloqueados.")) return;
                                const { data, error } = await supabase.from("crm_leads").update({
                                  is_blocked: true,
                                  blocked_at: new Date().toISOString(),
                                  blocked_by: user?.id || null,
                                } as any).eq("id", lead.id).select("id");
                                if (error) { toast.error("Erro ao bloquear: " + mensagemDeErro(error)); return; }
                                if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para bloquear este lead."); return; }
                                setLeads(prev => prev.filter(l => l.id !== lead.id));
                                // CONV-13: fechar a conversa aberta de verdade (id e lead) — só
                                // zerar o lead deixava o centro girando.
                                if (selectedLeadId === lead.id) { setSelectedLeadId(null); setSelectedLead(null); }
                                toast.success("Lead bloqueado");
                                // Lead só do Instagram (sem telefone) não passa pela Meta do
                                // WhatsApp: o aviso "Não consegui falar com a Meta" seria falso.
                                if (papelBloqueiaNaMeta(userRole) && temTelefoneParaMeta(lead.phone)) await bloquearContatoNaMeta(lead.id, "bloquear");
                              }}
                            >
                              <Ban size={14} className="mr-2" /> Bloquear lead
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                     );
                  })}
                </div>
              )}
            </div>

          </div>
        </ResizablePanel>
        {!isCrmMobile && <ResizableHandle variant="gap" />}</>
        )}

        {/* CENTER PANEL - Chat */}
        {effCenterVisible && (
        <ResizablePanel defaultSize={isCrmMobile ? 100 : (rightPanelVisible ? 46 : 76)} minSize={isCrmMobile ? 100 : 38} className="min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card dark:border-border">
          {selectedLeadId && selectedLead && selectedLead.id === selectedLeadId ? (
            <div className="flex min-w-0 min-h-0 h-full flex-col overflow-hidden relative">
              {/* Chat header */}
               <div className="relative z-10 grid min-h-16 flex-shrink-0 grid-cols-[auto_auto_auto_minmax(0,1fr)_auto_auto] items-center gap-x-2.5 gap-y-1 border-b border-border/60 bg-card px-3 py-2.5 sm:px-4 [container-type:inline-size]">
                <Button
                  variant="ghost"
                  size="icon"
                  className="col-start-1 row-start-1 row-span-2 h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
                  onClick={() => isCrmMobile ? mobileBackToList() : setLeftPanelVisible(!leftPanelVisible)}
                  title={isCrmMobile ? "Voltar para conversas" : (leftPanelVisible ? "Ocultar lista" : "Mostrar lista")}
                >
                  {leftPanelVisible ? <PanelLeftClose size={18} strokeWidth={1.75} /> : <PanelLeftOpen size={18} strokeWidth={1.75} />}
                </Button>
                <div className="relative col-start-2 row-start-1 row-span-2 shrink-0">
                  <Avatar className="h-11 w-11">
                    {selectedLead.instagram_profile_pic_url && (
                      <AvatarImage src={selectedLead.instagram_profile_pic_url} alt={selectedLead.name} />
                    )}
                    <AvatarFallback className="bg-primary-soft text-primary-soft-fg font-semibold text-[15px]">
                      {selectedLead.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="absolute -bottom-0.5 -right-0.5 flex rounded-full bg-card ring-2 ring-card">
                    <ChannelBadgeIcon source={getLeadChannel(selectedLead)} size={16} />
                  </div>
                </div>
                <div className="contents">
                  <div className="col-start-3 col-span-2 row-start-1 flex items-center gap-1 min-w-0 [@container(max-width:29rem)]:col-span-4">
                    <div className="text-base font-semibold tracking-tight text-foreground truncate">{selectedLead.name}</div>
                    <button
                      type="button"
                      onClick={async () => {
                        try { await navigator.clipboard.writeText(selectedLead.name); toast.success("Nome copiado"); } catch { toast.error("Não foi possível copiar"); }
                      }}
                      title="Copiar nome"
                      aria-label="Copiar nome"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-muted hover:text-foreground shrink-0"
                    >
                      <Copy size={13} strokeWidth={1.75} />
                    </button>
                  </div>
                  <div className="contents text-[13px] text-muted-foreground">
                    {selectedLead.instagram_username ? (
                      <span className="col-start-3 row-start-2 min-w-0 truncate [@container(max-width:29rem)]:col-span-3">@{selectedLead.instagram_username}</span>
                    ) : selectedLead.phone ? (
                      <span className="col-start-3 row-start-2 inline-flex min-w-0 items-center gap-0.5 whitespace-nowrap tabular-nums [@container(max-width:29rem)]:col-span-3">
                        {/* Link tel: em formato BR — permite o click-to-call da extensão
                            Api4Com detectar o número e abrir a discagem já preenchida. */}
                        <a
                          href={`tel:${toE164BR(selectedLead.phone)}`}
                          className="text-muted-foreground hover:text-foreground hover:underline"
                          title="Ligar (via extensão de telefonia)"
                        >
                          {formatPhoneDisplayBR(selectedLead.phone)}
                        </a>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const phoneToCopy = selectedLead.phone!.replace(/^55/, "");
                              await navigator.clipboard.writeText(phoneToCopy);
                              toast.success("Número copiado");
                            } catch { toast.error("Não foi possível copiar"); }
                          }}
                          title="Copiar número"
                          aria-label="Copiar número"
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <Copy size={13} strokeWidth={1.75} />
                        </button>
                      </span>
                    ) : null}
                    {currentStage && (
                      <span className="col-start-6 row-start-1 justify-self-end inline-flex h-6 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-sunken px-2.5 text-xs font-medium text-foreground ring-1 ring-inset ring-border/70 [@container(max-width:29rem)]:col-start-1 [@container(max-width:29rem)]:col-span-6 [@container(max-width:29rem)]:row-start-3 [@container(max-width:29rem)]:mt-1 [@container(max-width:29rem)]:justify-self-start [@container(max-width:29rem)]:max-w-[calc(100%-14rem)] [@container(max-width:29rem)]:overflow-hidden">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: currentStage.color }} />
                        {currentStage.name}
                      </span>
                    )}
                    <ConversaFechadaBadge fechadaEm={selectedLead.conversa_fechada_em} />
                    {/* WhatsApp pausado/desconectado/sem acesso ao número deste lead (P14). */}
                    {getLeadChannel(selectedLead) !== "instagram" && chat.envio.bloqueio && (
                      <SeloDoEnvio bloqueio={chat.envio.bloqueio} />
                    )}
                  </div>
                </div>
                {/* Ações do lead — sempre compactas (ícone + tooltip) p/ não estourar o header em telas/painéis estreitos */}
                <div className="col-start-4 col-span-3 row-start-2 justify-self-end flex items-center gap-0 shrink-0 rounded-xl bg-surface-sunken p-0.5 [&>button]:h-8 [&>button]:rounded-lg [&>button]:border-transparent [&>button]:bg-transparent [&>button]:px-2 [&>button]:shadow-none [&>button:hover]:bg-card [&>button.w-8]:w-7 [@container(max-width:29rem)]:col-start-1 [@container(max-width:29rem)]:col-span-6 [@container(max-width:29rem)]:row-start-3 [@container(max-width:29rem)]:mt-1">
                {getLeadChannel(selectedLead) !== "instagram" && selectedLead.phone && podeLigarPorWhatsapp((selectedLead as any).whatsapp_number_id) && (
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-lg text-success hover:bg-success-soft hover:text-success"
                        disabled={callState.phase !== "idle"}
                        onClick={() =>
                          initiateCall({
                            toPhone: selectedLead.phone!,
                            leadId: selectedLead.id,
                            leadName: selectedLead.name,
                            whatsappNumberId: (selectedLead as any).whatsapp_number_id ?? undefined,
                          })
                        }
                        aria-label="Ligar via WhatsApp"
                      >
                        <Phone size={16} strokeWidth={1.75} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <span className="inline-flex items-center gap-1.5"><Phone size={14} className="text-success" /> Ligar via WhatsApp</span>
                    </TooltipContent>
                  </Tooltip>
                )}
                {/* SDR liga (decisão do dono, 09/09): api4com-dial só aceita lead dela. */}
                {getLeadChannel(selectedLead) !== "instagram" && selectedLead.phone && (
                  <Api4ComDialButton leadId={selectedLead.id} phone={selectedLead.phone} />
                )}
                {getLeadChannel(selectedLead) !== "instagram" && selectedLead.phone && podeLigarPorWhatsapp((selectedLead as any).whatsapp_number_id) && (
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
                        onClick={() => requestCallPermission({
                          toPhone: selectedLead.phone!,
                          leadId: selectedLead.id,
                          whatsappNumberId: (selectedLead as any).whatsapp_number_id ?? undefined,
                        })}
                        aria-label="Solicitar permissão de ligação"
                      >
                        <BellRing size={16} strokeWidth={1.75} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[220px]">
                      <span className="flex items-center gap-1.5 font-medium"><BellRing size={14} /> Solicitar permissão de ligação</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">O cliente aprova com 1 toque no WhatsApp</span>
                    </TooltipContent>
                  </Tooltip>
                )}
                {/* Fechar/reabrir conversa (Fase 2 do rodízio): dona do lead ou
                    gestão; some para os demais papéis e o banco repete a checagem. */}
                <FecharConversaButton
                  leadId={selectedLead.id}
                  fechadaEm={selectedLead.conversa_fechada_em}
                  responsavelId={selectedLead.assigned_to}
                  onChange={(quando) => atualizarFechada(selectedLead.id, quando)}
                />
                {/* SDR: IA fora do perfil — ai-conversation-assist devolve 403 e
                    ai_conversation_analysis está bloqueada. Sem isto, o botão ✨
                    ficava permanente e só produzia erro sem motivo (mesmo cerco já
                    feito no AiSuggestionStrip). CONV-4: e só com o módulo de IA
                    LIGADO (padrão de cliente novo é desligado) — enquanto a config
                    carrega, o botão que falharia não aparece. */}
                {userRole !== "sdr" && iaLigada === true && (
                  <LeadAiAssistPanel leadId={selectedLead.id} leadName={selectedLead.name} />
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-surface-sunken hover:text-foreground" title={rightPanelVisible ? "Ocultar detalhes" : "Mostrar detalhes"} aria-label={rightPanelVisible ? "Ocultar detalhes" : "Mostrar detalhes"} onClick={() => isCrmMobile ? setMobileShowDetails(true) : setRightPanelVisible(!rightPanelVisible)}>
                  {(isCrmMobile ? false : rightPanelVisible) ? <PanelRightClose size={16} strokeWidth={1.75} /> : <PanelRightOpen size={16} strokeWidth={1.75} />}
                </Button>
                </div>
              </div>


              {/* Notes Bar */}
              <NotesBar notes={selectedLead.notes} onUpdateNotes={handleSaveNotes} />

              {qtdHistorico > 0 && <AbasHistorico aba={abaHistorico} onChange={setAbaHistorico} />}
              {qtdHistorico > 0 && abaHistorico === "historico" && leadAbertoId && <ListaHistoricoAnterior leadId={leadAbertoId} />}

              {/* Messages */}
              <div className={`${qtdHistorico > 0 && abaHistorico === "historico" ? "hidden " : ""}flex-1 overflow-y-auto m-2 sm:m-3 rounded-2xl bg-surface-sunken dark:bg-background px-3 py-4 sm:p-5 space-y-3`}>
                <ChatActivityToast activities={chat.activityToasts} onDismiss={chat.dismissToast} />

                {chat.loading ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : chat.messages.length === 0 && (
                  <div className="flex items-center justify-center h-full text-tertiary text-[13px] font-medium">Nenhuma mensagem ainda</div>
                )}
                {/* A conversa abre com as mensagens mais recentes (P14); as
                    antigas vêm sob demanda. */}
                {!chat.loading && chat.temAnteriores && (
                  <div className="flex justify-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-card hover:text-foreground"
                      onClick={() => void chat.carregarAnteriores()}
                      disabled={chat.carregandoAnteriores}
                    >
                      {chat.carregandoAnteriores ? <Loader2 size={14} className="animate-spin" /> : <ChevronUp size={14} strokeWidth={1.75} />}
                      Carregar mensagens anteriores
                    </Button>
                  </div>
                )}
                {!chat.loading && chat.messages.map((msg, idx) => {
                  const msgDate = new Date(msg.created_at);
                  const prevMsg = idx > 0 ? chat.messages[idx - 1] : null;
                  const prevDate = prevMsg ? new Date(prevMsg.created_at) : null;
                  const showDateSep = !prevDate || msgDate.toDateString() !== prevDate.toDateString();

                  const dateSep = showDateSep ? <ChatDateSeparator key={`date-${msg.id}`} date={msgDate} /> : null;

                  const igAccountsMap = Object.fromEntries(instagramAccounts.map((a) => [a.id, a.username]));
                  const currIgAcc = (msg as any).channel === "instagram" ? (msg as any).instagram_account_id : null;
                  const prevIgAcc = prevMsg && (prevMsg as any).channel === "instagram" ? (prevMsg as any).instagram_account_id : null;
                  const showAccSep = !!currIgAcc && currIgAcc !== prevIgAcc && !!igAccountsMap[currIgAcc];
                  const accSepIg = showAccSep ? (
                    <ChatAccountSeparator key={`acc-${msg.id}`} username={igAccountsMap[currIgAcc]} />
                  ) : null;
                  // Divisória do número de WhatsApp: aparece quando muda o número que enviou/recebeu.
                  const ehWa = (m: any) => m && m.channel !== "instagram" && !chat.isSystemMessage(m);
                  let numSep: JSX.Element | null = null;
                  if ((numerosVisiveis?.length ?? 0) > 0 && ehWa(msg)) {
                    let anteriorWa: any = null;
                    for (let i = idx - 1; i >= 0; i--) { if (ehWa(chat.messages[i])) { anteriorWa = chat.messages[i]; break; } }
                    const atualNum = (msg as any).whatsapp_number_id ?? null;
                    const antNum = anteriorWa ? ((anteriorWa as any).whatsapp_number_id ?? null) : undefined;
                    if (antNum === undefined || antNum !== atualNum) {
                      const rotulo = atualNum ? (numberNames[atualNum] ?? "Outro número") : "Número principal";
                      numSep = <ChatNumberSeparator key={`num-${msg.id}`} label={rotulo} />;
                    }
                  }
                  const accSep = accSepIg || numSep ? <>{accSepIg}{numSep}</> : null;

                  if (chat.isSystemMessage(msg)) {
                    const cpr = parseCallPermissionReply(msg.content);
                    const displayContent = cpr ? formatCallPermissionReply(cpr) : (msg.content || "");
                    const destName = !cpr ? displayContent.split("→").pop()?.trim() : null;
                    const destStage = destName ? chat.stages.find(s => s.name === destName) : null;
                    return (
                      <div key={msg.id}>
                        {dateSep}
                        {accSep}
                        <ChatActivitySeparator
                          content={displayContent}
                          timestamp={msg.created_at}
                          stageColor={destStage?.color}
                          onDelete={cpr || !userRole || !PAPEIS_QUE_APAGAM_SISTEMA.has(userRole) ? undefined : () => chat.deleteSystemMessage(msg.id)}
                        />
                      </div>
                    );
                  }
                  return (
                    <div key={msg.id} className="group">
                      {dateSep}
                      {accSep}
                      <ChatMessageBubble
                        ref={(el) => { chat.messageRefs.current[msg.id] = el; }}
                        msg={msg}
                        leadName={selectedLead.name}
                        allMessages={chat.messages}
                        onReply={chat.setReplyTo}
                        onForward={chat.setForwardMsg}
                        onReact={(m, emoji) => chat.handleReact(m, emoji, selectedLead.phone, getLeadChannel(selectedLead))}
                        onMediaClick={(url, type) => chat.setMediaPreview({ url, type })}
                        onScrollToMessage={chat.scrollToMessage}
                        igAccountsMap={Object.fromEntries(instagramAccounts.map((a) => [a.id, a.username]))}
                        leadAd={{
                          source: selectedLead.source,
                          headline: selectedLead.titulo_anuncio,
                          body: selectedLead.descricao_anuncio,
                          imageUrl: selectedLead.imagem_origem,
                          sourceUrl: selectedLead.link_anuncio,
                          sourceId: selectedLead.ad_id,
                          accountName: (selectedLead as any).ad_account_name,
                        }}
                      />
                      {convNotes.notesByMessageId(msg.id).map((note) => (
                        <ConversationInlineNote
                          key={note.id}
                          note={note}
                          authorName={convNotes.profiles[note.author_id || ""]}
                          onDeleted={convNotes.removeNote}
                          onUpdated={convNotes.updateNote}
                          mencionaVoce={convNotes.mencoesMinhas.has(note.id)}
                        />
                      ))}
                      <AddInlineNoteButton
                        messageId={msg.id}
                        leadId={selectedLead.id}
                        onNoteAdded={convNotes.addNote}
                      />
                    </div>
                  );
                })}
                <div ref={chat.messagesEndRef} />
              </div>

              {chat.replyTo && (
                <ChatReplyPreview replyTo={chat.replyTo} leadName={selectedLead.name} onCancel={() => chat.setReplyTo(null)} />
              )}

              {/* Active Bot Badge */}
              {activeExecution && (
                <div className="mx-2 sm:mx-3 mb-2 flex items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2 shadow-xs">
                  <Badge variant="default" className="h-6 gap-1.5 rounded-full border border-primary/20 bg-primary-soft px-2.5 text-[11px] font-medium text-primary-soft-fg shadow-none hover:bg-primary-soft-2">
                    <span className="w-2 h-2 rounded-full bg-success ring-2 ring-primary-foreground/40 animate-pulse" />
                    <Bot size={12} strokeWidth={1.75} />
                    {activeExecution.bot_name || "Bot"}
                  </Badge>
                  <span className="text-xs font-medium text-muted-foreground flex-1 truncate">
                    {activeExecution.status === "waiting_reply" ? "Aguardando resposta" : "Executando"}
                  </span>
                  <Button variant="ghost" size="sm" className="h-7 rounded-lg px-2.5 text-xs font-medium text-destructive hover:bg-destructive-soft hover:text-destructive" onClick={handleStopBot}>
                    <Square size={10} className="mr-1" /> Parar
                  </Button>
                </div>
              )}

              {/* SDR: IA fora do perfil (generate-reply-suggestion devolve 403) — sem faixa de sugestões. */}
              {getLeadChannel(selectedLead) !== "instagram" && userRole !== "sdr" && (
                <AiSuggestionStrip leadId={selectedLeadId} leadPhone={selectedLead.phone} lastInboundWaAt={chat.lastInboundWaAt} />
              )}
              {getLeadChannel(selectedLead) !== "instagram" && (numerosVisiveis?.length ?? 0) > 0 && (
                <SeletorNumeroEnvio
                  leadId={selectedLeadId}
                  atual={(selectedLead as any).whatsapp_number_id ?? null}
                  numeros={(numerosVisiveis ?? []).filter((n) => n.is_active).map((n) => ({ id: n.id, nome: nomeDoNumero(n) }))}
                  onChange={(id) => { (selectedLead as any).whatsapp_number_id = id; }}
                />
              )}
              <ChatInput
                leadId={selectedLeadId}
                leadPhone={selectedLead.phone}
                onLoadTemplates={chat.loadTemplates}
                externalMessage=""
                onExternalMessageConsumed={() => {}}
                onMessageSent={chat.handleOptimisticMessage}
                onMessageError={chat.handleMessageError}
                onMessageSuccess={chat.handleMessageSuccess}
                replyTo={chat.replyTo}
                onReplySent={() => chat.setReplyTo(null)}
                lastInboundAt={chat.lastInboundAt}
                lastInboundWaAt={chat.lastInboundWaAt}
                lastInboundDmAt={chat.lastInboundDmAt}
                channel={getLeadChannel(selectedLead)}
                onSendTemplate={handleSendTemplate}
                leadName={selectedLead.name}
              />

            </div>
          ) : selectedLeadId && falhaAoAbrir?.id === selectedLeadId ? (
            <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 bg-card px-6 text-center">
              <AlertTriangle size={24} strokeWidth={1.75} className="box-content rounded-full bg-destructive-soft p-4 text-destructive" />
              <p className="text-[15px] font-semibold text-foreground">Não foi possível abrir a conversa agora</p>
              <p className="text-[13px] text-muted-foreground">{falhaAoAbrir.motivo}</p>
              <Button size="sm" variant="outline" className="h-9 rounded-xl px-4 text-[13px] font-medium" onClick={() => setTentativaAoAbrir((n) => n + 1)}>
                Tentar novamente
              </Button>
              {isCrmMobile && (
                <Button size="sm" variant="ghost" className="h-9 rounded-xl px-4 text-[13px] font-medium text-muted-foreground" onClick={mobileBackToList}>
                  Voltar para conversas
                </Button>
              )}
            </div>
          ) : selectedLeadId ? (
            <div className="flex items-center justify-center h-full text-muted-foreground bg-card">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center px-6">
                <MessageSquare size={28} strokeWidth={1.75} className="box-content mx-auto mb-4 rounded-full bg-primary-soft p-5 text-primary-soft-fg" />
                <p className="text-[15px] font-semibold text-foreground">Selecione uma conversa para visualizar</p>
              </div>
            </div>
          )}
        </ResizablePanel>
        )}

        {/* RIGHT PANEL - Lead details */}
        {effRightVisible && selectedLeadId && selectedLead && selectedLead.id === selectedLeadId && (
          <>
            {!isCrmMobile && <ResizableHandle variant="gap" />}
            <ResizablePanel defaultSize={isCrmMobile ? 100 : 30} minSize={isCrmMobile ? 100 : 24} maxSize={isCrmMobile ? 100 : 34} className="min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card dark:border-border">
              <Suspense fallback={<SidePanelFallback />}>
              <div className="flex min-w-0 min-h-0 h-full flex-col overflow-y-auto">
                {isCrmMobile && (
                  <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/60 bg-card/95 backdrop-blur sticky top-0 z-10">
                    <Button variant="ghost" size="sm" className="h-9 gap-1.5 rounded-xl px-3 font-medium text-muted-foreground hover:bg-surface-sunken hover:text-foreground" onClick={() => isCrmMobile ? setMobileShowDetails(false) : setRightPanelVisible(false)}>
                      <PanelLeftOpen size={16} /> Voltar ao chat
                    </Button>
                  </div>
                )}
                <div className="p-5 border-b border-border/60">
                  <div className="flex items-center gap-3.5 mb-4">
                    <Avatar className="h-14 w-14">
                      {selectedLead.instagram_profile_pic_url && (
                        <AvatarImage src={selectedLead.instagram_profile_pic_url} alt={selectedLead.name} />
                      )}
                      <AvatarFallback className="bg-primary-soft text-primary-soft-fg text-lg font-semibold">
                        {selectedLead.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-semibold leading-tight tracking-tight text-foreground [overflow-wrap:anywhere]">{selectedLead.name}</h2>
                      <p className="mt-0.5 text-[13px] text-muted-foreground tabular-nums">
                        {selectedLead.instagram_username
                          ? `@${selectedLead.instagram_username}`
                          : selectedLead.phone
                            ? <a href={`tel:${toE164BR(selectedLead.phone)}`} className="hover:text-foreground hover:underline" title="Ligar (via extensão de telefonia)">{formatPhoneDisplayBR(selectedLead.phone)}</a>
                            : "Sem telefone"}
                      </p>
                    </div>
                  </div>

                  <LeadEditPanel
                    lead={selectedLead as any}
                    onLeadUpdated={(updated) => {
                      setSelectedLead(updated as any);
                      setLeads((prev) => prev.map((l) => l.id === updated.id ? { ...l, ...updated } as any : l));
                    }}
                    onLeadDeleted={() => { setSelectedLeadId(null); setSelectedLead(null); }}
                  />

                  <SetorDoLead
                    leadId={selectedLead.id}
                    setorAtualId={(selectedLead as any).setor_atual_id ?? null}
                    onTransferido={async () => {
                      const { data } = await supabase.from("crm_leads").select("*").eq("id", selectedLead.id).maybeSingle();
                      if (!data) { setSelectedLeadId(null); setSelectedLead(null); return; }
                      setSelectedLead((prev) => (prev && prev.id === data.id ? { ...prev, ...(data as any) } : prev));
                      setLeads((prev) => prev.map((l) => (l.id === data.id ? ({ ...l, ...(data as any) } as any) : l)));
                    }}
                  />

                  <PipelineStageSelector
                    stages={chat.stages}
                    currentStageId={selectedLead.stage_id}
                    onStageChange={handleStageChange}
                  />

                  <LeadServiceField
                    leadId={selectedLead.id}
                    servicoInteresse={(selectedLead as any).servico_interesse || null}
                    especialidadeInteresseId={(selectedLead as any).especialidade_interesse_id || null}
                    procedimentoInteresseId={(selectedLead as any).procedimento_interesse_id || null}
                    onUpdated={(updates) => {
                      setSelectedLead((prev) => prev ? { ...prev, ...updates } as any : prev);
                      setLeads((prev) => prev.map((l) => l.id === selectedLead.id ? { ...l, ...updates } as any : l));
                    }}
                  />

                  {/* Responsible User Assignment */}
                  <div className="mt-4">
                    <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
                      <UserRoundCog size={14} strokeWidth={1.75} className="inline text-tertiary" />
                      Responsável
                    </label>
                    {userRole === "sdr" ? (
                      // SDR transfere só o lead DELA e só para SDR / administrador / pós-venda
                      // (RPC sdr_destinos_transferencia; a função transfer-lead revalida).
                      <Select
                        value={selectedLead.assigned_to || "unassigned"}
                        onValueChange={(val) => handleTransferLead(val)}
                      >
                        <SelectTrigger className="h-10 rounded-xl border-input bg-card text-sm">
                          <SelectValue placeholder="Selecionar responsável" />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedLead.assigned_to && !destinosSdr.some((d) => d.user_id === selectedLead.assigned_to) && (
                            <SelectItem value={selectedLead.assigned_to}>
                              {profiles.find((p) => p.id === selectedLead.assigned_to)?.nome || "Responsável atual"}
                            </SelectItem>
                          )}
                          {destinosSdr.map((d) => (
                            <SelectItem key={d.user_id} value={d.user_id}>
                              {d.nome}{d.papel === "gestor" ? " · Administrador" : d.papel === "posvenda" ? " · Pós-venda" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Select
                        value={selectedLead.assigned_to || "unassigned"}
                        onValueChange={(val) => handleTransferLead(val)}
                      >
                        <SelectTrigger className="h-10 rounded-xl border-input bg-card text-sm">
                          <SelectValue placeholder="Selecionar responsável" />
                        </SelectTrigger>
                        <SelectContent>
                          {/* O responsável atual bloqueado continua com o nome (CONV-21). */}
                          {selectedLead.assigned_to && !perfisAtivos.some((p) => p.id === selectedLead.assigned_to) && (
                            <SelectItem value={selectedLead.assigned_to} disabled>
                              {profiles.find((p) => p.id === selectedLead.assigned_to)?.nome || "Responsável atual"} (bloqueado)
                            </SelectItem>
                          )}
                          {perfisAtivos.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <SendToPosvendaButton
                    leadId={selectedLead.id}
                    stageId={selectedLead.stage_id}
                    assignedTo={selectedLead.assigned_to}
                    stages={chat.stages}
                    onTransferred={(payload) => {
                      setSelectedLead((prev) => prev ? {
                        ...prev,
                        assigned_to: payload.assigned_to,
                        pipeline_id: payload.pipeline_id || prev.pipeline_id,
                        stage_id: payload.stage_id || prev.stage_id,
                      } : prev);
                      setLeads((prev) => prev.map((l) => l.id === selectedLead.id ? {
                        ...l,
                        assigned_to: payload.assigned_to,
                        pipeline_id: payload.pipeline_id || l.pipeline_id,
                        stage_id: payload.stage_id || l.stage_id,
                      } : l));
                      chat.fetchMessages(true);
                    }}
                  />
                </div>

                <InlineTagsEditor
                  leadId={selectedLead.id}
                  tags={selectedLead.tags || []}
                  source={selectedLead.source}
                  adId={selectedLead.ad_id}
                  imagemOrigem={selectedLead.imagem_origem}
                  nomeAnuncio={selectedLead.nome_anuncio}
                  descricaoAnuncio={selectedLead.descricao_anuncio}
                  linkAnuncio={selectedLead.link_anuncio}
                  adAccountId={(selectedLead as any).ad_account_id}
                  adAccountName={(selectedLead as any).ad_account_name}
                  pipelineId={selectedLead.pipeline_id}
                  isInstagram={getLeadChannel(selectedLead) === "instagram"}
                  onUpdated={(updates) => {
                    setSelectedLead((prev) => prev ? { ...prev, ...updates } as any : prev);
                    setLeads((prev) => prev.map((l) => l.id === selectedLead.id ? { ...l, ...updates } as any : l));
                  }}
                />

                {userRole === "closer" ? (
                  <CloserLeadPacientePanel lead={selectedLead as any} />
                ) : !podeVerOrcamento ? null : (
                  // X-2: "Orçamento & Valor" só para crc, gerente e superadmin.
                  // SDR e recepção não acessam pacientes (RESTRICTIVE
                  // *_sem_acesso_pacientes) e a pós-venda lê mas não cria: o
                  // painel oferecia "Vincular"/"Criar" que o banco sempre recusava.
                  <LeadBudgetPanel
                    lead={selectedLead as any}
                    onLeadUpdated={(updates) => {
                      setSelectedLead((prev) => prev ? { ...prev, ...updates } : prev);
                      setLeads((prev) => prev.map((l) => l.id === selectedLead.id ? { ...l, ...updates } as any : l));
                    }}
                  />
                )}

                {/* AGENDA-21: sem o módulo de agenda, nada de barra de agendamento. */}
                {agendaLigada !== false && (
                <AppointmentConfirmBar
                  leadId={selectedLead.id}
                  onLeadStageChanged={(stageId, pipelineId) => {
                    const alvo = selectedLead.id;
                    setSelectedLead((prev) =>
                      prev && prev.id === alvo && (prev.stage_id !== stageId || (pipelineId && prev.pipeline_id !== pipelineId))
                        ? { ...prev, stage_id: stageId, pipeline_id: pipelineId || prev.pipeline_id }
                        : prev,
                    );
                    setLeads((prev) => prev.map((l) => (l.id === alvo && l.stage_id !== stageId ? { ...l, stage_id: stageId, pipeline_id: pipelineId || l.pipeline_id } : l)));
                  }}
                />
                )}

                <TaskPanel leadId={selectedLead.id} />

                <LeadResponseTimes messages={chat.messages} />

                {/* Histórico de Etapas — não é montado para a SDR, mesmo
                    critério do LeadBudgetPanel acima. O painel imprime o NOME de
                    cada etapa por onde o lead passou e, para as etapas que ela
                    não enxerga, resolve o nome por get_lead_stage_history_names —
                    RPC SECURITY DEFINER que não filtra visivel_para_sdr. Ela
                    leria "Contratado" / "Não contratado" em texto puro no
                    histórico de um lead DELA: caminho real, porque o dontus-sync
                    move o lead pago para a etapa de ganho enquanto ele ainda está
                    com ela na carência de 24 h. O componente também se protege
                    por dentro (LeadStageTimeline.tsx), mas aqui nem o chunk nem
                    as consultas saem. */}
                {!ehPapelSdr(userRole) && (
                  <LeadStageTimeline
                    leadId={selectedLead.id}
                    stages={chat.stages}
                    lastInboundAt={chat.lastInboundAt}
                  />
                )}

                {/* Cidade — o ÚNICO campo de cidade do painel, para todos os papéis
                    (CONV-19). Quem vê "Orçamento & Valor" também atualiza a
                    cidade do paciente principal, como o seletor de lá fazia. */}
                <LeadExtraFields
                  leadId={selectedLead.id}
                  cidade={(selectedLead as any).cidade || null}
                  pacienteId={podeVerOrcamento ? selectedLead.paciente_id ?? null : null}
                  onUpdated={(updates) => {
                    setSelectedLead((prev) => prev ? { ...prev, ...updates } as any : prev);
                    setLeads((prev) => prev.map((l) => l.id === selectedLead.id ? { ...l, ...updates } as any : l));
                  }}
                />

                <LeadCustomFields leadId={selectedLead.id} />

                {/* Notes input */}
                <div className="p-5 border-b border-border/60">
                  <h3 className="mb-3 text-[15px] font-semibold text-foreground">Adicionar Nota</h3>
                  <div className="flex gap-2">
                    <Input
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Adicionar nota..."
                      className="h-10 rounded-xl border-transparent bg-surface-sunken text-sm placeholder:text-tertiary focus-visible:bg-card"
                      onKeyDown={(e) => { if (e.key === "Enter" && newNote.trim()) { handleAddNote(newNote); setNewNote(""); } }}
                    />
                    <Button size="sm" variant="outline" onClick={() => { if (newNote.trim()) { handleAddNote(newNote); setNewNote(""); } }} disabled={!newNote.trim()} className="h-10 w-10 shrink-0 rounded-xl p-0 text-base">
                      +
                    </Button>
                  </div>
                </div>

                <div className="p-5">
                  <div className="text-[11px] text-tertiary text-center tabular-nums">
                    Criado em {new Date(selectedLead.created_at).toLocaleDateString("pt-BR")}
                  </div>
                </div>
              </div>
              </Suspense>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* Templates Sheet */}
      <Sheet open={chat.templatesOpen} onOpenChange={chat.setTemplatesOpen}>
        <SheetContent className="w-[380px] flex flex-col">
          <SheetHeader><SheetTitle className="text-lg font-semibold tracking-tight">Templates Aprovados</SheetTitle></SheetHeader>
          <div className="mt-4 relative">
            <Search size={18} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary pointer-events-none" />
            <Input
              placeholder="Buscar template..."
              value={chat.templateSearch}
              onChange={(e) => chat.setTemplateSearch(e.target.value)}
              className="h-10 rounded-xl border-transparent bg-surface-sunken pl-10 placeholder:text-tertiary focus-visible:bg-card"
            />
          </div>
          <div className="flex-1 overflow-y-auto mt-4 space-y-2.5 pr-1">
            {chat.filteredTemplates.length === 0 && <p className="text-[13px] text-muted-foreground py-6 text-center">Nenhum template encontrado.</p>}
            {chat.filteredTemplates.map((t) => (
              <button key={t.id} onClick={() => chat.pedirConfirmacaoDoModelo(t)} className="w-full text-left p-3.5 rounded-xl border border-border/60 bg-card shadow-xs hover:border-primary/40 hover:bg-primary-soft-2 transition-colors">
                <div className="font-semibold text-sm text-foreground">{cleanTemplateName(t.name)}</div>
                <div className="text-[13px] text-muted-foreground mt-1 line-clamp-2">{t.body_text}</div>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Confirmação do modelo escolhido no Sheet (CONV-15): prévia preenchida
          e um campo por variável; o que está nos campos é o que o paciente recebe. */}
      {leadAbertoId && (
        <EnviarModeloDialog
          open={!!chat.modeloEmConfirmacao}
          onOpenChange={(open) => { if (!open) chat.setModeloEmConfirmacao(null); }}
          leadId={leadAbertoId}
          modelo={chat.modeloEmConfirmacao}
          onEnviar={handleSendTemplate}
        />
      )}

      {/* Forward Dialog — a mensagem inteira (CONV-6: mídia vai como mídia). */}
      {chat.forwardMsg && (
        <ForwardMessageDialog
          open={!!chat.forwardMsg}
          onOpenChange={(open) => { if (!open) chat.setForwardMsg(null); }}
          mensagem={chat.forwardMsg}
          fromLeadId={selectedLeadId || ""}
        />
      )}

      <ChatMediaPreview mediaPreview={chat.mediaPreview} onClose={() => chat.setMediaPreview(null)} />
    </div>
  );
}

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import whatsappLogo from "@/assets/whatsapp-logo.png";

// Contador de não lidas por canal. O RPC aplica a janela de 60 dias por
// last_inbound_at (migração 20260708030000) — mesma regra do badge da sidebar
// e do destaque/filtro "Aberto" da lista. Desde a 20260929002300 o canal segue
// a regra da lista (active_channel manda) e conversa fechada não conta.
function useChannelUnreadCount(channel: "whatsapp" | "instagram") {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let refreshTimer: number | null = null;
    const fetch = async () => {
      const { data, error } = await (supabase as any).rpc("get_crm_unread_leads_count_by_channel", { _channel: channel });
      if (!error) setCount(Number(data || 0));
    };
    const scheduleFetch = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(fetch, 600);
    };
    fetch();
    const ch = supabase.channel(`unread-tab-${channel}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_leads" }, scheduleFetch)
      .subscribe();
    // Fechar/reabrir conversa na própria tela recontam na hora (CONV-10).
    window.addEventListener(EVENTO_NAO_LIDAS_MUDOU, scheduleFetch);
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      supabase.removeChannel(ch);
      window.removeEventListener(EVENTO_NAO_LIDAS_MUDOU, scheduleFetch);
    };
  }, [channel]);

  return count;
}

/**
 * Resposta de "existe lead do Instagram?" por cliente, guardada na memória da
 * aba do navegador (como o leadsListCache). A pergunta passa pela RLS de
 * crm_leads, que custa em cliente grande; sem cache ela rodava a cada abertura
 * da caixa justamente no caso comum (cliente sem conta do Instagram). Lead do
 * Instagram só nasce com conta conectada — e a conta é conferida a cada
 * abertura (consulta barata) — então a resposta guardada não esconde a aba de
 * quem acabou de conectar.
 */
const temLeadDoInstagramCache = new Map<string, boolean>();

/**
 * O cliente usa Instagram? (CONV-23) Conta do Instagram ativa OU algum lead
 * cujo canal é o Instagram (mesma regra de getLeadChannel). `undefined`
 * enquanto consulta; em erro, `true` — a aba nunca some por dúvida.
 */
function useClienteUsaInstagram(tenantId: string | null | undefined): boolean | undefined {
  const [usa, setUsa] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    (async () => {
      const contas = await supabase
        .from("ig_accounts")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("active", true);
      if (!vivo) return;
      if (!contas.error && (contas.count ?? 0) > 0) { setUsa(true); return; }
      const guardado = temLeadDoInstagramCache.get(tenantId);
      if (guardado !== undefined) { setUsa(guardado); return; }
      // Só a existência (limit 1), não a contagem exata.
      const leadsIg = await supabase
        .from("crm_leads")
        .select("id")
        .eq("tenant_id", tenantId)
        .or("active_channel.eq.instagram,and(active_channel.is.null,instagram_user_id.not.is.null)")
        .limit(1);
      if (!vivo) return;
      if (leadsIg.error) { setUsa(contas.error ? true : false); return; }
      const tem = (leadsIg.data ?? []).length > 0;
      temLeadDoInstagramCache.set(tenantId, tem);
      setUsa(tem);
    })();
    return () => { vivo = false; };
  }, [tenantId]);
  return usa;
}

export default function CrmConversas() {
  const whatsappUnread = useChannelUnreadCount("whatsapp");
  const instagramUnread = useChannelUnreadCount("instagram");
  // Recepção e closer atendem só WhatsApp — os hooks acima ficam incondicionais
  // (regra de hooks); apenas a aba deixa de ser renderizada.
  //
  // A SDR SAIU desta lista em 11/09/2026, a pedido do dono: "os leads do
  // instagram não estão aparecendo para as sdrs, não precisa fazer distribuição
  // neles apenas deixar aparecer pra todo mundo". A justificativa antiga era que
  // a aba ficaria sempre vazia — e era verdade, porque o funil do Instagram não
  // recebia override e os leads de lá não têm dona, então a régua da SDR (só o
  // que é dela) escondia todos. A migration 20260911010000 mudou as duas coisas:
  // o funil virou caixa comum, visível para toda a equipe de pré-venda.
  //
  // Recepção e closer continuam fora porque para eles nada mudou no banco.
  const { userRole } = useAuth();
  const { tenant } = useTenant();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const hideInstagramPorPapel = userRole === "recepcao" || userRole === "closer";
  // CONV-23: sem Instagram conectado (nem conversa do Instagram), a aba não
  // aparece — ficava sempre em "Nenhuma conversa". O gerente vê no lugar o
  // atalho para conectar.
  const clienteUsaInstagram = useClienteUsaInstagram(tenant.id);
  const mostrarAbaInstagram = !hideInstagramPorPapel && (clienteUsaInstagram === true || instagramUnread > 0);
  const atalhoConectarInstagram =
    !hideInstagramPorPapel && userRole === "gerente" && clienteUsaInstagram === false && instagramUnread === 0;
  const [aba, setAba] = useState<"whatsapp" | "instagram">("whatsapp");
  const abaAtiva = aba === "instagram" && !mostrarAbaInstagram ? "whatsapp" : aba;
  const trocarAba = (valor: string) => {
    setAba(valor === "instagram" ? "instagram" : "whatsapp");
    // A conversa aberta é da aba que ficou para trás: a nova aba abre sem ela.
    if (searchParams.get("lead")) {
      const next = new URLSearchParams(searchParams);
      next.delete("lead");
      setSearchParams(next, { replace: true, state: location.state });
    }
  };
  // CONV-29: quem chegou por /crm/conversa/:id (notificação, Kanban,
  // Calendário…) volta para a tela de onde veio. O redirecionamento usou
  // replace, então o "voltar" do histórico é a origem.
  const veioDeOutraTela = !!(location.state as { veioDeOutraTela?: boolean } | null)?.veioDeOutraTela;
  const voltar = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/crm");
  };

  const listaDeAbas = (
        <TabsList variant="pill" className="flex-shrink-0 mx-2 mt-2 sm:mx-4 sm:mt-4 self-start rounded-full border border-border/60 bg-card p-1 shadow-xs">
          <TabsTrigger value="whatsapp" className="gap-2 data-[state=active]:border data-[state=active]:border-primary/20 data-[state=active]:bg-primary-soft data-[state=active]:text-primary-soft-fg data-[state=active]:shadow-none data-[state=active]:hover:bg-primary-soft-2">
            <img src={whatsappLogo} alt="" width={16} height={16} className="rounded-full ring-2 ring-card" />
            WhatsApp
            {whatsappUnread > 0 && (
              <span
                title={`Conversas não lidas (${UNREAD_WINDOW_LABEL})`}
                className="tab-count"
              >
                {whatsappUnread > 99 ? "99+" : whatsappUnread}
              </span>
            )}
          </TabsTrigger>
          {mostrarAbaInstagram && (
            <TabsTrigger value="instagram" className="gap-2 data-[state=active]:border data-[state=active]:border-primary/20 data-[state=active]:bg-primary-soft data-[state=active]:text-primary-soft-fg data-[state=active]:shadow-none data-[state=active]:hover:bg-primary-soft-2">
              <svg className="rounded-[4px] bg-card p-px" width="16" height="16" viewBox="0 0 24 24" fill="#833AB4" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
              </svg>
              Instagram
              {instagramUnread > 0 && (
                <span
                  title={`Conversas não lidas (${UNREAD_WINDOW_LABEL})`}
                  className="tab-count"
                >
                  {instagramUnread > 99 ? "99+" : instagramUnread}
                </span>
              )}
            </TabsTrigger>
          )}
        </TabsList>
  );

  return (
    <div className="flex flex-col bg-background -m-2 sm:-m-4 lg:-m-6" style={{ height: "calc(100vh - 4rem)" }}>
      <Tabs value={abaAtiva} onValueChange={trocarAba} className="flex flex-col flex-1 overflow-hidden">
        {veioDeOutraTela || atalhoConectarInstagram ? (
          <div className="flex flex-shrink-0 flex-wrap items-center gap-x-1">
            {veioDeOutraTela && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-2 mt-2 h-9 gap-1 rounded-full px-3 text-[13px] font-medium text-muted-foreground hover:bg-card hover:text-foreground sm:ml-4 sm:mt-4"
                onClick={voltar}
              >
                <ChevronLeft size={16} strokeWidth={1.75} /> Voltar
              </Button>
            )}
            {listaDeAbas}
            {atalhoConectarInstagram && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-9 gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground hover:bg-card hover:text-foreground sm:mt-4"
                onClick={() => navigate("/crm/integracoes")}
                title="Conecte o Instagram da clínica para atender o Direct por aqui"
              >
                Conectar Instagram
              </Button>
            )}
          </div>
        ) : listaDeAbas}
        <TabsContent value="whatsapp" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex data-[state=active]:flex-col">
          <WhatsAppConversations channelFilter="whatsapp" channel="whatsapp" />
        </TabsContent>
        {mostrarAbaInstagram && (
          <TabsContent value="instagram" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex data-[state=active]:flex-col">
            <WhatsAppConversations channelFilter="instagram" channel="instagram" />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
