import { Suspense, lazy, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLeadLabels } from "@/hooks/useLeadLabels";
import { getLeadChannel } from "@/lib/leadChannel";
import { Badge } from "@/components/ui/badge";
import { cleanTemplateName } from "@/lib/templateUtils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import ChatInput from "@/components/chat/ChatInput";
import AiSuggestionStrip from "@/components/chat/AiSuggestionStrip";
import ChatActivitySeparator from "@/components/chat/ChatActivitySeparator";
import ChatDateSeparator from "@/components/chat/ChatDateSeparator";
import ChatAccountSeparator from "@/components/chat/ChatAccountSeparator";
import SendToPosvendaButton from "@/components/chat/SendToPosvendaButton";
import ChatActivityToast from "@/components/chat/ChatActivityToast";
import ChatMessageBubble from "@/components/chat/ChatMessageBubble";
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
  Search, MessageSquare, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen, Bot, Square, UserRoundCog, Loader2, CheckCheck, MoreHorizontal, Star, Ban, Copy, Phone, BellRing
} from "lucide-react";
import { useWhatsappCall } from "@/contexts/WhatsappCallContext";
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
  instagram_username?: string | null;
  instagram_profile_pic_url?: string | null;
};

type PipelineWithRoles = { id: string; name: string; allowed_roles: string[] | null; is_instagram?: boolean | null };

// Global cache for leads list — survives component remounts
const leadsListCache = {
  cacheKey: null as string | null,
  leads: null as LeadConversation[] | null,
  profiles: null as { id: string; nome: string }[] | null,
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
  profiles: { id: string; nome: string }[];
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
const LeadCustomFields = lazy(() => import("@/components/chat/LeadCustomFields"));
const LeadExtraFields = lazy(() => import("@/components/chat/LeadExtraFields"));
const LeadServiceField = lazy(() => import("@/components/chat/LeadServiceField"));
const LeadStageTimeline = lazy(() => import("@/components/chat/LeadStageTimeline"));
const LeadResponseTimes = lazy(() => import("@/components/chat/LeadResponseTimes"));
const LeadBudgetPanel = lazy(() => import("@/components/chat/LeadBudgetPanel"));
const InlineTagsEditor = lazy(() => import("@/components/chat/InlineTagsEditor"));
const TaskPanel = lazy(() => import("@/components/chat/TaskPanel"));
const AppointmentConfirmBar = lazy(() => import("@/components/chat/AppointmentConfirmBar"));
const LeadFollowUpPanel = lazy(() => import("@/components/chat/LeadFollowUpPanel"));

const SidePanelFallback = () => (
  <div className="space-y-3 p-4">
    <div className="h-20 rounded-lg bg-secondary/60 animate-pulse" />
    <div className="h-24 rounded-lg bg-secondary/40 animate-pulse" />
    <div className="h-24 rounded-lg bg-secondary/40 animate-pulse" />
  </div>
);
const CONVERSATION_PAGE_SIZE = 1000;
const CONVERSATION_MAX_PAGES = 50; // teto de SEGURANÇA (loop para antes ao receber página incompleta)
// Colunas leves p/ a LISTA de conversas (sem campos pesados de anúncio/extras).
// Lista (sem `notes`/`value` que são pesados e só usados no painel direito; os campos de anúncio ficam
// porque os filtros derivam opções deles).
const LEAD_LIST_COLS = "id, name, phone, instagram_user_id, active_channel, instagram_username, instagram_profile_pic_url, last_message, last_message_at, last_inbound_at, last_outbound_at, tags, source, stage_id, pipeline_id, created_at, updated_at, assigned_to, paciente_id, cidade, servico_interesse, imagem_origem, titulo_anuncio, descricao_anuncio, link_anuncio, ad_id, nome_anuncio, ad_account_id, ad_account_name, is_blocked";
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
const isUnreadLead = (lead: LeadConversation) =>
  lead.last_direction === "inbound" &&
  !!lead.last_inbound_at &&
  Date.now() - new Date(lead.last_inbound_at).getTime() <= UNREAD_WINDOW_MS;

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
  const all: LeadConversation[] = [];
  for (let page = 0; page < CONVERSATION_MAX_PAGES; page++) {
    const from = page * CONVERSATION_PAGE_SIZE;
    const to = from + CONVERSATION_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("crm_leads")
      .select(LEAD_LIST_COLS)
      .eq("tenant_id", tenantId)
      .eq("is_blocked", false)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .range(from, to);

    if (error) throw error;
    const rows = ((data || []) as any as LeadConversation[]).map(normalizeLead);
    all.push(...rows);
    if (page === 0 && onFirstPage) onFirstPage([...rows]);
    if (rows.length < CONVERSATION_PAGE_SIZE) break;
  }
  return sortLeadsByLastActivity(all);
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
      supabase.from("profiles").select("id, nome").eq("tenant_id", tenantId),
      supabase.from("crm_pipelines").select("id, name, allowed_roles, is_instagram").eq("tenant_id", tenantId).order("created_at"),
    ]);
    const profs = (profilesRes.data as { id: string; nome: string }[]) || [];
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

function WhatsAppConversations({ pipelineFilter, excludePipelines, channel = "whatsapp", channelFilter }: ConversationsViewProps = {}) {
  const { user, userRole } = useAuth();
  const { tenant } = useTenant();
  const cacheKey = tenant.id && user?.id ? `${tenant.id}:${user.id}` : null;
  const [searchParams, setSearchParams] = useSearchParams();
  const canUseInitialCache = !!cacheKey && leadsListCache.cacheKey === cacheKey && Date.now() - leadsListCache.timestamp < LEADS_CACHE_TTL;
  // Lê localStorage uma vez no primeiro render — fallback quando módulo cache está frio (reload)
  const [_lsData] = useState<ConversasLSData | null>(() => canUseInitialCache || !cacheKey ? null : readConversasLS(cacheKey));
  const [leads, setLeads] = useState<LeadConversation[]>(() => canUseInitialCache ? (leadsListCache.leads || []) : (_lsData?.leads || []));
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(!canUseInitialCache && !_lsData);
  const [fullyLoaded, setFullyLoaded] = useState<boolean>(canUseInitialCache);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<LeadConversation | null>(null);
  const [newNote, setNewNote] = useState("");
  const isCrmMobile = useIsCrmMobile();
  const { initiateCall, requestCallPermission, state: callState } = useWhatsappCall();
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
  const [profiles, setProfiles] = useState<{ id: string; nome: string }[]>(() => canUseInitialCache ? (leadsListCache.profiles || []) : (_lsData?.profiles || []));
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




  // Unified chat hook
  const chat = useChatConversation(selectedLeadId);
  const convNotes = useConversationNotes(selectedLeadId);

  const handleSelectLead = useCallback((lead: LeadConversation) => {
    setSelectedLeadId(lead.id);
    setSelectedLead(lead);
    // On mobile: opening a lead should land on the chat view, not the details panel.
    setMobileShowDetails(false);
  }, []);

  // ===== Bot Active Execution State =====
  const checkExecution = useCallback(async () => {
    if (!selectedLeadId) { setActiveExecution(null); return; }
    const { data } = await supabase
      .from("bot_executions")
      .select("id, status, current_node_id, bots(name)")
      .eq("lead_id", selectedLeadId)
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
  }, [selectedLeadId]);

  useEffect(() => { checkExecution(); }, [checkExecution]);

  useEffect(() => {
    if (!selectedLeadId) return;
    const channel = supabase
      .channel(`bot-exec-conv-${selectedLeadId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "bot_executions",
        filter: `lead_id=eq.${selectedLeadId}`,
      }, () => checkExecution())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedLeadId, checkExecution]);

  const handleStopBot = async () => {
    if (!activeExecution) return;
    await supabase
      .from("bot_executions")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", activeExecution.id);
    toast.success("Bot encerrado");
    setActiveExecution(null);
  };

  // Fetch leads list with global cache
  useEffect(() => {
    if (!tenant.id || !cacheKey) return;
    // If cache is fresh, skip network fetch entirely
    if (leadsListCache.cacheKey === cacheKey && leadsListCache.leads && Date.now() - leadsListCache.timestamp < LEADS_CACHE_TTL) {
      setLeads(leadsListCache.leads);
      setProfiles(leadsListCache.profiles || []);
      setPipelines(leadsListCache.pipelines || []);
      setLoading(false);
      setFullyLoaded(true);
      // Só refaz fetch em background se o cache estiver com mais de 60s — evita roundtrip a cada navegação.
      const cacheAge = Date.now() - leadsListCache.timestamp;
      if (cacheAge < LEADS_BG_REFRESH_AFTER) return;
      setFullyLoaded(false);
      (async () => {
        const [rawLeads, profilesRes, pipelinesRes] = await Promise.all([
          fetchAllConversationLeads(tenant.id),
          supabase.from("profiles").select("id, nome").eq("tenant_id", tenant.id),
          supabase.from("crm_pipelines").select("id, name, allowed_roles, is_instagram").eq("tenant_id", tenant.id).order("created_at"),
        ]);
        const profs = (profilesRes.data as { id: string; nome: string }[]) || [];
        const pipes = (pipelinesRes.data as PipelineWithRoles[]) || [];
        leadsListCache.cacheKey = cacheKey;
        leadsListCache.leads = rawLeads;
        leadsListCache.profiles = profs;
        leadsListCache.pipelines = pipes;
        leadsListCache.timestamp = Date.now();
        writeConversasLS(cacheKey, { leads: rawLeads, profiles: profs, pipelines: pipes });
        setLeads(rawLeads);
        setProfiles(profs);
        setPipelines(pipes);
        setFullyLoaded(true);
      })();
      return;
    }

    setFullyLoaded(false);
    const fetchLeads = async () => {
      // First-paint rápido: mostra a UI assim que profiles + pipelines + 1ª página de leads chegam.
      let firstPainted = false;
      const [rawLeads, profilesRes, pipelinesRes] = await Promise.all([
        fetchAllConversationLeads(tenant.id, (firstPage) => {
          firstPainted = true;
          setLeads(firstPage);
          setLoading(false);
        }),
        supabase.from("profiles").select("id, nome").eq("tenant_id", tenant.id),
        supabase.from("crm_pipelines").select("id, name, allowed_roles, is_instagram").eq("tenant_id", tenant.id).order("created_at"),
      ]);
      const profs = (profilesRes.data as { id: string; nome: string }[]) || [];
      const pipes = (pipelinesRes.data as PipelineWithRoles[]) || [];

      leadsListCache.cacheKey = cacheKey;
      leadsListCache.leads = rawLeads;
      leadsListCache.profiles = profs;
      leadsListCache.pipelines = pipes;
      leadsListCache.timestamp = Date.now();
      writeConversasLS(cacheKey, { leads: rawLeads, profiles: profs, pipelines: pipes });

      setLeads(rawLeads);
      setProfiles(profs);
      setPipelines(pipes);
      if (!firstPainted) setLoading(false);
      setFullyLoaded(true);
    };
    fetchLeads();
  }, [tenant.id, cacheKey]);


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

  // Server-side search inside message content (texto de mensagens antigas)
  useEffect(() => {
    const term = search.trim();
    if (!tenant.id) { setMessageMatchLeadIds(null); return; }
    if (term.length < 3) { setMessageMatchLeadIds(null); return; }
    let cancelled = false;
    const handle = setTimeout(async () => {
      // Escape special chars for ilike pattern
      const safe = term.replace(/[%_\\]/g, (c) => `\\${c}`);
      const { data, error } = await supabase
        .from("messages")
        .select("lead_id")
        .eq("tenant_id", tenant.id)
        .not("lead_id", "is", null)
        .ilike("content", `%${safe}%`)
        .order("created_at", { ascending: false })
        .limit(500);
      if (cancelled || error) return;
      const ids = new Set<string>();
      (data ?? []).forEach((r: any) => { if (r.lead_id) ids.add(r.lead_id); });
      setMessageMatchLeadIds(ids);

      // Fetch any matching leads not present in current cache so they show up in results
      const missing = Array.from(ids).filter((id) => !leads.some((l) => l.id === id));
      if (missing.length) {
        const { data: leadRows } = await supabase
          .from("crm_leads")
          .select(LEAD_LIST_COLS)
          .eq("tenant_id", tenant.id)
          // Busca por conteúdo de mensagem também retorna bloqueados.
          .in("id", missing.slice(0, 100));
        if (cancelled || !leadRows?.length) return;
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
        const statuses = urlAppointmentStatus === "rescheduled" ? ["rescheduled"]
          : urlAppointmentStatus === "missed" ? ["missed", "faltou"]
          : urlAppointmentStatus === "attended" ? ["completed", "contratou", "nao_contratou"]
          : [urlAppointmentStatus];
        const apts = await fetchAll<{ lead_id: string }>((f, t) =>
          supabase.from("crm_appointments").select("lead_id").in("status", statuses).range(f, t)
        );
        setAppointmentLeadIds(new Set(apts.map((a) => a.lead_id)));
      }
    };
    loadSpecialFilters();
  }, [urlGhost, urlAppointmentStatus, urlInactiveDays]);

  useEffect(() => {
    if (!selectedLeadId) {
      setSelectedLead(null);
      return;
    }
    const lead = leads.find((l) => l.id === selectedLeadId) || null;
    setSelectedLead(lead);
    // Hidrata campos pesados ausentes na lista (notes/value) sob demanda.
    if (lead && ((lead as any).notes === undefined || (lead as any).value === undefined)) {
      let cancelled = false;
      supabase
        .from("crm_leads")
        .select("id, notes, value")
        .eq("id", selectedLeadId)
        .maybeSingle()
        .then(({ data }) => {
          if (cancelled || !data) return;
          setSelectedLead((prev) => prev && prev.id === selectedLeadId ? { ...prev, ...(data as any) } : prev);
        });
      return () => { cancelled = true; };
    }
  }, [selectedLeadId, leads]);


  // Realtime - leads list
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
          setLeads((prev) => {
            const exists = prev.some((l) => l.id === updated.id);
            const newList = exists
              ? prev.map((l) => l.id === updated.id ? { ...l, ...updated } : l)
              : [updated, ...prev];
            return sortLeadsByLastActivity(newList);
          });
          if (updated.id === selectedLeadId) {
            setSelectedLead((prev) => prev ? { ...prev, ...updated } : prev);
          }
        } else if (payload.eventType === "DELETE") {
          const deletedId = (payload.old as any).id;
          setLeads((prev) => prev.filter((l) => l.id !== deletedId));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedLeadId]);

  const handleStageChange = useCallback(async (stageId: string, pipelineId: string) => {
    if (!selectedLeadId || !selectedLead) return;
    const previousStageId = selectedLead.stage_id;
    await chat.handleStageChange(stageId, previousStageId, (newStageId, newPipelineId) => {
      setSelectedLead((prev) => prev ? { ...prev, stage_id: newStageId, pipeline_id: newPipelineId || prev.pipeline_id } : prev);
      setLeads((prev) => prev.map((l) => l.id === selectedLeadId ? { ...l, stage_id: newStageId, pipeline_id: newPipelineId || l.pipeline_id } : l));
    }, pipelineId);
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

  const handleSendTemplate = useCallback(async (template: any) => {
    const ch: "whatsapp" | "instagram" = getLeadChannel(selectedLead);
    await chat.sendTemplate(template, selectedLead?.phone || null, ch);
  }, [chat, selectedLead, channel]);

  // Transfer lead to another user
  const handleTransferLead = useCallback(async (newUserId: string) => {
    if (!selectedLead || !selectedLeadId) return;
    const oldUserId = selectedLead.assigned_to;
    if (newUserId === oldUserId) return;

    const newUserName = profiles.find(p => p.id === newUserId)?.nome || "?";

    // Optimistic update first for instant UI feedback
    setSelectedLead(prev => prev ? { ...prev, assigned_to: newUserId } : prev);
    setLeads(prev => prev.map(l => l.id === selectedLeadId ? { ...l, assigned_to: newUserId } : l));
    chat.showActivityToast(`🔄 Lead transferido para ${newUserName}`);
    toast.success(`Lead transferido para ${newUserName}`);

    // Remove from list after 10s since it's no longer assigned to current user
    const capturedLeadId = selectedLeadId;
    setTimeout(() => {
      setLeads(prev => prev.filter(l => l.id !== capturedLeadId));
      setSelectedLeadId(prev => prev === capturedLeadId ? null : prev);
      setSelectedLead(prev => prev?.id === capturedLeadId ? null : prev);
    }, 10000);

    // Call edge function — it handles automatic pipeline/stage restoration
    const { data, error } = await supabase.functions.invoke("transfer-lead", {
      body: { leadId: selectedLeadId, newUserId },
    });

    if (error || data?.error) {
      // Rollback on failure
      setSelectedLead(prev => prev ? { ...prev, assigned_to: oldUserId } : prev);
      setLeads(prev => prev.map(l => l.id === selectedLeadId ? { ...l, assigned_to: oldUserId ?? null } : l));
      toast.error("Erro ao transferir lead");
      return;
    }

    // If the function moved the lead to another pipeline/stage, update local state
    if (data?.pipeline_id || data?.stage_id) {
      setSelectedLead(prev => prev ? {
        ...prev,
        assigned_to: newUserId,
        ...(data.pipeline_id ? { pipeline_id: data.pipeline_id } : {}),
        ...(data.stage_id ? { stage_id: data.stage_id } : {}),
      } : prev);
      setLeads(prev => prev.map(l => l.id === selectedLeadId ? {
        ...l,
        assigned_to: newUserId,
        ...(data.pipeline_id ? { pipeline_id: data.pipeline_id } : {}),
        ...(data.stage_id ? { stage_id: data.stage_id } : {}),
      } : l));
      if (data.moved_pipeline && data.moved_stage) {
        chat.showActivityToast(`📂 Movido para: ${data.moved_pipeline} • ${data.moved_stage}`);
      }
    }
  }, [selectedLead, selectedLeadId, profiles, chat]);

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

  // Defensive: compute pipelines that this user's role should NOT see.
  // Mirrors backend can_access_pipeline() so the UI never leaks Pós-Venda leads
  // into CRC's Conversas list even if RLS is misconfigured or cache is stale.
  // Rule: pipeline is accessible if
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
      const accessible = crcDefaults || userInRoles;
      if (!accessible) blocked.add(p.id);
    }
    return blocked;
  }, [pipelines, userRole]);

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
        if (filters.source === "anuncio") {
          const s = (l.source || "").toLowerCase();
          if (!s.includes("_ad") && s !== "anuncio" && s !== "anúncio") return false;
        } else if (l.source?.toLowerCase() !== filters.source.toLowerCase()) return false;
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
  }, [leads, search, filters, user?.id, urlGhost, ghostLeadIds, urlAppointmentStatus, appointmentLeadIds, urlInactiveDays, pipelineFilter, excludePipelines, channelFilter, leadIgAccountMap, inaccessiblePipelineIds, messageMatchLeadIds, leadsWithPagamento, labelsByLead]);

  // Sorting
  const [sortMode, setSortMode] = useState<"recent" | "longest_wait" | "featured">("recent");

  const sortedFiltered = useMemo(() => {
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

  return (
    <div className="flex h-full w-full min-w-0 min-h-0 max-w-full flex-col overflow-hidden bg-background">
      <ResizablePanelGroup key={isCrmMobile ? "m" : "d"} direction="horizontal" className="h-full w-full min-w-0 min-h-0 max-w-full overflow-hidden">
        {/* LEFT PANEL - Leads list */}
        {effLeftVisible && (
        <><ResizablePanel defaultSize={isCrmMobile ? 100 : 24} minSize={isCrmMobile ? 100 : 20} maxSize={isCrmMobile ? 100 : 28} className="min-w-0 overflow-hidden">
          <div className="flex min-w-0 min-h-0 h-full flex-col bg-card overflow-hidden">
              {/* URL filter banner */}
              {(urlGhost || urlAppointmentStatus || urlInactiveDays) && (
                <div className="flex items-center gap-1 mb-2 flex-wrap">
                  {urlGhost && <Badge variant="destructive" className="text-[10px]">Leads Fantasma</Badge>}
                  {urlAppointmentStatus && <Badge variant="secondary" className="text-[10px]">Agendamento: {urlAppointmentStatus}</Badge>}
                  {urlInactiveDays && <Badge variant="secondary" className="text-[10px]">Inativos +{urlInactiveDays}d</Badge>}
                  <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px]" onClick={() => setSearchParams({})}>✕ Limpar</Button>
                </div>
              )}
            <div className="flex-shrink-0 px-4 py-3 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-bold text-foreground text-sm">Conversas</h2>
                <div className="flex items-center gap-1">
                  <ConversationFilters
                    stages={chat.stages}
                    profiles={profiles}
                    allTags={allTags}
                    filters={filters}
                    onApply={setFilters}
                    pipelines={pipelines}
                    adAccounts={adAccounts}
                    ads={ads}
                    channel={channel}
                    instagramAccounts={instagramAccounts}
                  />
                   <span className="text-xs text-muted-foreground">{sortedFiltered.length}{!fullyLoaded ? "…" : ""}</span>
                   <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                       <Button variant="ghost" size="icon" className="h-7 w-7">
                         <MoreHorizontal size={16} />
                       </Button>
                     </DropdownMenuTrigger>
                     <DropdownMenuContent align="end" className="w-48">
                       <DropdownMenuLabel className="text-xs text-muted-foreground">Ordenar</DropdownMenuLabel>
                       <DropdownMenuItem onClick={() => setSortMode("recent")} className={sortMode === "recent" ? "text-primary font-medium" : ""}>
                         Mais recentes {sortMode === "recent" && "✓"}
                       </DropdownMenuItem>
                       <DropdownMenuItem onClick={() => setSortMode("longest_wait")} className={sortMode === "longest_wait" ? "text-primary font-medium" : ""}>
                         Longa espera {sortMode === "longest_wait" && "✓"}
                       </DropdownMenuItem>
                     </DropdownMenuContent>
                   </DropdownMenu>
                </div>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground z-10" />
                <Input
                  placeholder="Buscar por nome, telefone ou mensagem..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm bg-secondary"
                />
                {/* Search autocomplete dropdown */}
                {search.trim().length >= 2 && sortedFiltered.length > 0 && sortedFiltered.length <= 8 && search.replace(/\D/g, "").length >= 3 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {filtered.slice(0, 6).map((lead) => (
                      <button
                        key={lead.id}
                          onClick={() => { handleSelectLead(lead); setSearch(""); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-secondary/50 transition-colors border-b border-border last:border-b-0"
                      >
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="bg-primary/20 text-primary text-[10px] font-bold">
                            {lead.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-foreground truncate block">{lead.name}</span>
                          <span className="text-[10px] text-muted-foreground">{lead.phone || "Sem telefone"}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div ref={listScrollRef} className="flex-1 overflow-y-auto" style={{ contain: "strict" }}>
              {loading ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Carregando...</div>
              ) : sortedFiltered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
                  <MessageSquare size={24} className="opacity-50" />
                  <p className="text-sm">Nenhuma conversa</p>
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
                        className={`relative group flex items-start gap-0 border-b border-border transition-colors ${
                          isActive
                            ? "bg-primary/15 border-l-2 border-l-primary"
                            : isUnread
                              ? "bg-orange-500/15 dark:bg-orange-400/20 border-l-[3px] border-l-orange-500 dark:border-l-orange-400 hover:bg-orange-500/25 dark:hover:bg-orange-400/30"
                              : "hover:bg-secondary/50"
                        }`}>
                        <button
                          onClick={() => handleSelectLead(lead)}
                          className="flex-1 flex items-start gap-3 px-4 py-3 text-left min-w-0"
                        >
                          <div className="relative flex-shrink-0 mt-0.5">
                            <Avatar className="h-9 w-9">
                              {lead.instagram_profile_pic_url && (
                                <AvatarImage src={lead.instagram_profile_pic_url} alt={lead.name} />
                              )}
                              <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">{initials}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-0.5 -left-0.5">
                              <ChannelBadgeIcon source={lead.source} size={16} />
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-sm text-foreground truncate flex items-center gap-1.5">
                                {(lead as any).is_blocked && (
                                  <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4 shrink-0" title="Lead bloqueado — só aparece na busca">Bloqueado</Badge>
                                )}
                                <span className="truncate">{lead.name}</span>
                              </span>
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap" title="Última mensagem">
                                {(() => {
                                  const ts = lead.last_message_at || lead.created_at;
                                  if (!ts) return "";
                                  const d = new Date(ts);
                                  const today = new Date();
                                  const yest = new Date(Date.now() - 86400000);
                                  if (d.toDateString() === today.toDateString())
                                    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                                  if (d.toDateString() === yest.toDateString()) return "Ontem";
                                  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
                                })()}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {lead.source && (
                                <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                                  {["facebook_ad", "instagram_ad"].includes(lead.source.toLowerCase()) ? "anúncio" : lead.source}
                                </Badge>
                              )}
                            </div>
                            {(() => {
                              const basePreview = formatCallPermissionPreview(lead.last_message) ?? (lead.last_message || "");
                              const isOutbound = lead.last_direction === "outbound";
                              let preview: string;
                              if (isOutbound) {
                                preview = basePreview
                                  ? (basePreview.startsWith("Você:") ? basePreview : `Você: ${basePreview}`)
                                  : "Você: 🎤 Áudio";
                              } else {
                                preview = basePreview || "Sem mensagens";
                              }
                              return <p className="text-xs text-muted-foreground truncate mt-0.5">{preview}</p>;
                            })()}
                          </div>
                        </button>
                        {/* Context menu */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="flex-shrink-0 p-2 mt-3 mr-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
                              <MoreHorizontal size={16} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            {isInbound && (
                              <DropdownMenuItem onClick={async (e) => {
                                e.stopPropagation();
                                await supabase.from("crm_leads").update({ last_outbound_at: new Date().toISOString() }).eq("id", lead.id);
                                setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, last_direction: "outbound", last_outbound_at: new Date().toISOString() } as any : l));
                                if (selectedLeadId === lead.id) setSelectedLead(prev => prev ? { ...prev, last_direction: "outbound" } : prev);
                                toast.success("Conversa marcada como respondida");
                              }}>
                                <CheckCheck size={14} className="mr-2 text-primary" /> Marcar como respondida
                              </DropdownMenuItem>
                            )}
                            {isInbound && <DropdownMenuSeparator />}
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!window.confirm("Bloquear este lead? As mensagens dele serão descartadas e ele não aparecerá mais no Kanban nem na lista de conversas. Você pode desbloqueá-lo depois em Configurações → Bloqueados.")) return;
                                const { error } = await supabase.from("crm_leads").update({
                                  is_blocked: true,
                                  blocked_at: new Date().toISOString(),
                                  blocked_by: user?.id || null,
                                } as any).eq("id", lead.id);
                                if (error) { toast.error("Erro ao bloquear: " + error.message); return; }
                                setLeads(prev => prev.filter(l => l.id !== lead.id));
                                if (selectedLeadId === lead.id) setSelectedLead(null as any);
                                toast.success("Lead bloqueado");
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
        {!isCrmMobile && <ResizableHandle />}</>
        )}

        {/* CENTER PANEL - Chat */}
        {effCenterVisible && (
        <ResizablePanel defaultSize={isCrmMobile ? 100 : (rightPanelVisible ? 46 : 76)} minSize={isCrmMobile ? 100 : 38} className="min-w-0 overflow-hidden">
          {selectedLeadId && selectedLead && selectedLead.id === selectedLeadId ? (
            <div className="flex min-w-0 min-h-0 h-full flex-col overflow-hidden relative">
              {/* Chat header */}
              <div className="flex-shrink-0 bg-card border-b border-border px-4 py-3 flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => isCrmMobile ? mobileBackToList() : setLeftPanelVisible(!leftPanelVisible)}
                  title={isCrmMobile ? "Voltar para conversas" : (leftPanelVisible ? "Ocultar lista" : "Mostrar lista")}
                >
                  {leftPanelVisible ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
                </Button>
                <div className="relative">
                  <Avatar className="h-9 w-9">
                    {selectedLead.instagram_profile_pic_url && (
                      <AvatarImage src={selectedLead.instagram_profile_pic_url} alt={selectedLead.name} />
                    )}
                    <AvatarFallback className="bg-primary/20 text-primary font-semibold text-sm">
                      {selectedLead.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="absolute -bottom-0.5 -left-0.5">
                    <ChannelBadgeIcon source={selectedLead.source} size={16} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="font-semibold text-foreground text-sm truncate">{selectedLead.name}</div>
                    <button
                      type="button"
                      onClick={async () => {
                        try { await navigator.clipboard.writeText(selectedLead.name); toast.success("Nome copiado"); } catch { toast.error("Não foi possível copiar"); }
                      }}
                      title="Copiar nome"
                      aria-label="Copiar nome"
                      className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    {selectedLead.instagram_username ? (
                      <span>@{selectedLead.instagram_username}</span>
                    ) : selectedLead.phone ? (
                      <span className="inline-flex items-center gap-1">
                        <span>{selectedLead.phone}</span>
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
                          className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Copy size={12} />
                        </button>
                      </span>
                    ) : null}
                    {currentStage && (
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: currentStage.color }} />
                        {currentStage.name}
                      </span>
                    )}
                  </div>
                </div>
                {/* Ações do lead — sempre compactas (ícone + tooltip) p/ não estourar o header em telas/painéis estreitos */}
                <div className="flex items-center gap-1 shrink-0">
                {getLeadChannel(selectedLead) !== "instagram" && selectedLead.phone && (
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                        disabled={callState.phase !== "idle"}
                        onClick={() =>
                          initiateCall({
                            toPhone: selectedLead.phone!,
                            leadId: selectedLead.id,
                            leadName: selectedLead.name,
                          })
                        }
                        aria-label="Ligar via WhatsApp"
                      >
                        <Phone size={16} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <span className="inline-flex items-center gap-1.5"><Phone size={14} className="text-emerald-600" /> Ligar via WhatsApp</span>
                    </TooltipContent>
                  </Tooltip>
                )}
                {getLeadChannel(selectedLead) !== "instagram" && selectedLead.phone && (
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => requestCallPermission({ toPhone: selectedLead.phone!, leadId: selectedLead.id })}
                        aria-label="Solicitar permissão de ligação"
                      >
                        <BellRing size={16} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[220px]">
                      <span className="flex items-center gap-1.5 font-medium"><BellRing size={14} /> Solicitar permissão de ligação</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">O cliente aprova com 1 toque no WhatsApp</span>
                    </TooltipContent>
                  </Tooltip>
                )}
                <LeadAiAssistPanel leadId={selectedLead.id} leadName={selectedLead.name} />
                <Button variant="ghost" size="icon" className="h-8 w-8" title={rightPanelVisible ? "Ocultar detalhes" : "Mostrar detalhes"} aria-label={rightPanelVisible ? "Ocultar detalhes" : "Mostrar detalhes"} onClick={() => isCrmMobile ? setMobileShowDetails(true) : setRightPanelVisible(!rightPanelVisible)}>
                  {(isCrmMobile ? false : rightPanelVisible) ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                </Button>
                </div>
              </div>


              {/* Notes Bar */}
              <NotesBar notes={selectedLead.notes} onUpdateNotes={handleSaveNotes} />

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, hsl(var(--primary) / 0.03) 0%, transparent 50%)" }}>
                <ChatActivityToast activities={chat.activityToasts} onDismiss={chat.dismissToast} />

                {chat.loading ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : chat.messages.length === 0 && (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Nenhuma mensagem ainda</div>
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
                  const accSep = showAccSep ? (
                    <ChatAccountSeparator key={`acc-${msg.id}`} username={igAccountsMap[currIgAcc]} />
                  ) : null;

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
                          onDelete={cpr ? undefined : () => chat.deleteSystemMessage(msg.id)}
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
                      />
                      {convNotes.notesByMessageId(msg.id).map((note) => (
                        <ConversationInlineNote
                          key={note.id}
                          note={note}
                          authorName={convNotes.profiles[note.author_id || ""]}
                          onDeleted={convNotes.removeNote}
                          onUpdated={convNotes.updateNote}
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
                <div className="flex items-center gap-2 border-t border-border bg-muted/40 px-3 py-1.5">
                  <Badge variant="default" className="gap-1.5 bg-primary">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <Bot size={12} />
                    {activeExecution.bot_name || "Bot"}
                  </Badge>
                  <span className="text-xs text-muted-foreground flex-1 truncate">
                    {activeExecution.status === "waiting_reply" ? "Aguardando resposta" : "Executando"}
                  </span>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-destructive hover:text-destructive" onClick={handleStopBot}>
                    <Square size={10} className="mr-1" /> Parar
                  </Button>
                </div>
              )}

              {getLeadChannel(selectedLead) !== "instagram" && (
                <AiSuggestionStrip leadId={selectedLeadId} leadPhone={selectedLead.phone} />
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
              />

            </div>
          ) : selectedLeadId ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <MessageSquare size={48} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">Selecione uma conversa para visualizar</p>
              </div>
            </div>
          )}
        </ResizablePanel>
        )}

        {/* RIGHT PANEL - Lead details */}
        {effRightVisible && selectedLeadId && selectedLead && selectedLead.id === selectedLeadId && (
          <>
            {!isCrmMobile && <ResizableHandle />}
            <ResizablePanel defaultSize={isCrmMobile ? 100 : 30} minSize={isCrmMobile ? 100 : 24} maxSize={isCrmMobile ? 100 : 34} className="min-w-0 overflow-hidden">
              <Suspense fallback={<SidePanelFallback />}>
              <div className="flex min-w-0 min-h-0 h-full flex-col bg-card overflow-y-auto">
                {isCrmMobile && (
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card sticky top-0 z-10">
                    <Button variant="ghost" size="sm" className="h-8 gap-1 -ml-1" onClick={() => isCrmMobile ? setMobileShowDetails(false) : setRightPanelVisible(false)}>
                      <PanelLeftOpen size={16} /> Voltar ao chat
                    </Button>
                  </div>
                )}
                <div className="p-4 border-b border-border">
                  <div className="flex items-center gap-3 mb-3">
                    <Avatar className="h-12 w-12">
                      {selectedLead.instagram_profile_pic_url && (
                        <AvatarImage src={selectedLead.instagram_profile_pic_url} alt={selectedLead.name} />
                      )}
                      <AvatarFallback className="bg-primary/20 text-primary text-lg font-bold">
                        {selectedLead.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <h2 className="font-bold text-foreground text-sm">{selectedLead.name}</h2>
                      <p className="text-xs text-muted-foreground">
                        {selectedLead.instagram_username
                          ? `@${selectedLead.instagram_username}`
                          : selectedLead.phone || "Sem telefone"}
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

                  <PipelineStageSelector
                    stages={chat.stages}
                    currentStageId={selectedLead.stage_id}
                    onStageChange={handleStageChange}
                  />

                  <LeadServiceField
                    leadId={selectedLead.id}
                    servicoInteresse={(selectedLead as any).servico_interesse || null}
                    onUpdated={(updates) => {
                      setSelectedLead((prev) => prev ? { ...prev, ...updates } as any : prev);
                      setLeads((prev) => prev.map((l) => l.id === selectedLead.id ? { ...l, ...updates } as any : l));
                    }}
                  />

                  {/* Responsible User Assignment */}
                  <div className="mt-3">
                    <label className="text-xs font-medium text-muted-foreground uppercase mb-1 block">
                      <UserRoundCog size={12} className="inline mr-1" />
                      Responsável
                    </label>
                    <Select
                      value={selectedLead.assigned_to || "unassigned"}
                      onValueChange={(val) => handleTransferLead(val)}
                    >
                      <SelectTrigger className="bg-secondary border-border text-sm h-9">
                        <SelectValue placeholder="Selecionar responsável" />
                      </SelectTrigger>
                      <SelectContent>
                        {profiles.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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

                <LeadBudgetPanel
                  lead={selectedLead as any}
                  onLeadUpdated={(updates) => {
                    setSelectedLead((prev) => prev ? { ...prev, ...updates } : prev);
                    setLeads((prev) => prev.map((l) => l.id === selectedLead.id ? { ...l, ...updates } as any : l));
                  }}
                />

                <AppointmentConfirmBar leadId={selectedLead.id} />

                <TaskPanel leadId={selectedLead.id} />

                <LeadResponseTimes messages={chat.messages} />

                <LeadStageTimeline
                  leadId={selectedLead.id}
                  stages={chat.stages}
                  lastInboundAt={chat.lastInboundAt}
                />

                {/* Cidade */}
                <LeadExtraFields
                  leadId={selectedLead.id}
                  cidade={(selectedLead as any).cidade || null}
                  onUpdated={(updates) => {
                    setSelectedLead((prev) => prev ? { ...prev, ...updates } as any : prev);
                    setLeads((prev) => prev.map((l) => l.id === selectedLead.id ? { ...l, ...updates } as any : l));
                  }}
                />

                <LeadCustomFields leadId={selectedLead.id} />

                

                {getLeadChannel(selectedLead) !== "instagram" && <LeadFollowUpPanel leadId={selectedLead.id} />}

                {/* Notes input */}
                <div className="p-4 border-b border-border">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase mb-2">Adicionar Nota</h3>
                  <div className="flex gap-2">
                    <Input
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Adicionar nota..."
                      className="bg-secondary border-border text-xs h-8"
                      onKeyDown={(e) => { if (e.key === "Enter" && newNote.trim()) { handleAddNote(newNote); setNewNote(""); } }}
                    />
                    <Button size="sm" variant="outline" onClick={() => { if (newNote.trim()) { handleAddNote(newNote); setNewNote(""); } }} disabled={!newNote.trim()} className="h-8 px-2">
                      +
                    </Button>
                  </div>
                </div>

                <div className="p-4">
                  <div className="text-[10px] text-muted-foreground text-center">
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
          <SheetHeader><SheetTitle>Templates Aprovados</SheetTitle></SheetHeader>
          <div className="mt-3 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar template..."
              value={chat.templateSearch}
              onChange={(e) => chat.setTemplateSearch(e.target.value)}
              className="pl-9 bg-secondary border-border"
            />
          </div>
          <div className="flex-1 overflow-y-auto mt-3 space-y-2 pr-1">
            {chat.filteredTemplates.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Nenhum template encontrado.</p>}
            {chat.filteredTemplates.map((t) => (
              <button key={t.id} onClick={() => handleSendTemplate(t)} className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/30 bg-secondary/50 hover:bg-secondary transition-colors">
                <div className="font-medium text-sm text-foreground">{cleanTemplateName(t.name)}</div>
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.body_text}</div>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Forward Dialog */}
      {chat.forwardMsg && (
        <ForwardMessageDialog
          open={!!chat.forwardMsg}
          onOpenChange={(open) => { if (!open) chat.setForwardMsg(null); }}
          messageContent={chat.forwardMsg.content}
          messageType={chat.forwardMsg.type}
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
// e do destaque/filtro "Aberto" da lista.
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
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      supabase.removeChannel(ch);
    };
  }, [channel]);

  return count;
}

export default function CrmConversas() {
  const whatsappUnread = useChannelUnreadCount("whatsapp");
  const instagramUnread = useChannelUnreadCount("instagram");

  return (
    <div className="flex flex-col bg-background -m-6" style={{ height: "calc(100vh - 4rem)" }}>
      <Tabs defaultValue="whatsapp" className="flex flex-col flex-1 overflow-hidden">
        <TabsList className="flex-shrink-0 mx-3 mt-2 self-start">
          <TabsTrigger value="whatsapp" className="gap-2">
            <img src={whatsappLogo} alt="" width={16} height={16} className="rounded-full" />
            WhatsApp
            {whatsappUnread > 0 && (
              <span
                title={`Conversas não lidas (${UNREAD_WINDOW_LABEL})`}
                className="ml-1 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1"
              >
                {whatsappUnread > 99 ? "99+" : whatsappUnread}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="instagram" className="gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#833AB4" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
            </svg>
            Instagram
            {instagramUnread > 0 && (
              <span
                title={`Conversas não lidas (${UNREAD_WINDOW_LABEL})`}
                className="ml-1 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1"
              >
                {instagramUnread > 99 ? "99+" : instagramUnread}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="whatsapp" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex data-[state=active]:flex-col">
          <WhatsAppConversations channelFilter="whatsapp" channel="whatsapp" />
        </TabsContent>
        <TabsContent value="instagram" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex data-[state=active]:flex-col">
          <WhatsAppConversations channelFilter="instagram" channel="instagram" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
