import { Suspense, lazy, useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cleanTemplateName } from "@/lib/templateUtils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import ChatInput from "@/components/chat/ChatInput";
import ChatActivitySeparator from "@/components/chat/ChatActivitySeparator";
import ChatDateSeparator from "@/components/chat/ChatDateSeparator";
import ChatActivityToast from "@/components/chat/ChatActivityToast";
import ChatMessageBubble from "@/components/chat/ChatMessageBubble";
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
  Search, MessageSquare, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen, Bot, Square, UserRoundCog, Loader2, CheckCheck, MoreHorizontal, Star
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { getDateRangeFromFilter } from "@/components/ui/date-range-filter";
import { isWithinInterval } from "date-fns";

import { useChatConversation } from "@/hooks/useChatConversation";

type LeadConversation = {
  id: string;
  name: string;
  phone: string | null;
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

// Global cache for leads list — survives component remounts
const leadsListCache = {
  leads: null as LeadConversation[] | null,
  profiles: null as { id: string; nome: string }[] | null,
  pipelines: null as { id: string; name: string }[] | null,
  timestamp: 0,
};
const LEADS_CACHE_TTL = 2 * 60_000; // 2 minutes
const LeadEditPanel = lazy(() => import("@/components/chat/LeadEditPanel"));
const LeadCustomFields = lazy(() => import("@/components/chat/LeadCustomFields"));
const LeadExtraFields = lazy(() => import("@/components/chat/LeadExtraFields"));
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
const INSTAGRAM_PIPELINE_ID = "c2d3e4f5-0001-4000-8000-000000000002";

interface ConversationsViewProps {
  pipelineFilter?: string;          // include only this pipeline
  excludePipelines?: string[];      // exclude these pipelines
  channel?: "whatsapp" | "instagram";
}

function WhatsAppConversations({ pipelineFilter, excludePipelines, channel = "whatsapp" }: ConversationsViewProps = {}) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [leads, setLeads] = useState<LeadConversation[]>(() => leadsListCache.leads || []);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(!leadsListCache.leads);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<LeadConversation | null>(null);
  const [newNote, setNewNote] = useState("");
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
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
  const [profiles, setProfiles] = useState<{ id: string; nome: string }[]>(() => leadsListCache.profiles || []);
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>(() => leadsListCache.pipelines || []);
  const [activeExecution, setActiveExecution] = useState<{
    id: string; status: string; bot_name?: string;
  } | null>(null);

  // Unified chat hook
  const chat = useChatConversation(selectedLeadId);
  const convNotes = useConversationNotes(selectedLeadId);

  const handleSelectLead = useCallback((lead: LeadConversation) => {
    setSelectedLeadId(lead.id);
    setSelectedLead(lead);
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
    const processLeads = (rawLeads: (LeadConversation & { last_inbound_at?: string; last_outbound_at?: string })[]) => {
      rawLeads.forEach((l) => {
        if (l.last_inbound_at && l.last_outbound_at) {
          l.last_direction = new Date(l.last_inbound_at) > new Date(l.last_outbound_at) ? "inbound" : "outbound";
        } else if (l.last_inbound_at) {
          l.last_direction = "inbound";
        } else if (l.last_outbound_at) {
          l.last_direction = "outbound";
        }
      });
      return rawLeads;
    };

    // If cache is fresh, skip network fetch entirely
    if (leadsListCache.leads && Date.now() - leadsListCache.timestamp < LEADS_CACHE_TTL) {
      setLeads(leadsListCache.leads);
      setProfiles(leadsListCache.profiles || []);
      setPipelines(leadsListCache.pipelines || []);
      setLoading(false);
      // Still refresh in background
      (async () => {
        const [leadsRes, profilesRes, pipelinesRes] = await Promise.all([
          supabase.from("crm_leads")
          .select("id, name, phone, last_message, last_message_at, last_inbound_at, last_outbound_at, tags, source, stage_id, pipeline_id, value, notes, created_at, updated_at, assigned_to, imagem_origem, titulo_anuncio, descricao_anuncio, link_anuncio, ad_id, nome_anuncio, paciente_id, cidade, servico_interesse, instagram_username, instagram_profile_pic_url")
            .order("last_message_at", { ascending: false, nullsFirst: false })
            .limit(500),
          supabase.from("profiles").select("id, nome"),
          supabase.from("crm_pipelines").select("id, name").order("created_at"),
        ]);
        const rawLeads = processLeads((leadsRes.data || []) as any);
        const profs = (profilesRes.data as { id: string; nome: string }[]) || [];
        const pipes = (pipelinesRes.data as { id: string; name: string }[]) || [];
        leadsListCache.leads = rawLeads;
        leadsListCache.profiles = profs;
        leadsListCache.pipelines = pipes;
        leadsListCache.timestamp = Date.now();
        setLeads(rawLeads);
        setProfiles(profs);
        setPipelines(pipes);
      })();
      return;
    }

    const fetchLeads = async () => {
      const [leadsRes, profilesRes, pipelinesRes] = await Promise.all([
        supabase.from("crm_leads")
          .select("id, name, phone, last_message, last_message_at, last_inbound_at, last_outbound_at, tags, source, stage_id, pipeline_id, value, notes, created_at, updated_at, assigned_to, imagem_origem, titulo_anuncio, descricao_anuncio, link_anuncio, ad_id, nome_anuncio, paciente_id, cidade, servico_interesse, instagram_username, instagram_profile_pic_url")
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(500),
        supabase.from("profiles").select("id, nome"),
        supabase.from("crm_pipelines").select("id, name").order("created_at"),
      ]);
      const rawLeads = processLeads((leadsRes.data || []) as any);
      const profs = (profilesRes.data as { id: string; nome: string }[]) || [];
      const pipes = (pipelinesRes.data as { id: string; name: string }[]) || [];

      leadsListCache.leads = rawLeads;
      leadsListCache.profiles = profs;
      leadsListCache.pipelines = pipes;
      leadsListCache.timestamp = Date.now();

      setLeads(rawLeads);
      setProfiles(profs);
      setPipelines(pipes);
      setLoading(false);
    };
    fetchLeads();
  }, []);

  // Load special URL filter data (ghost leads, appointment leads)
  useEffect(() => {
    if (!urlGhost && !urlAppointmentStatus && !urlInactiveDays) return;
    const loadSpecialFilters = async () => {
      if (urlGhost) {
        const { data: msgs } = await supabase.from("messages").select("lead_id").eq("direction", "inbound").neq("status", "system");
        const inboundIds = new Set((msgs || []).map((m: any) => m.lead_id));
        // Ghost = leads NOT in inboundIds → we store inbound ids and invert in filter
        setGhostLeadIds(inboundIds);
      }
      if (urlAppointmentStatus) {
        const statuses = urlAppointmentStatus === "rescheduled" ? ["rescheduled"]
          : urlAppointmentStatus === "missed" ? ["missed", "faltou"]
          : urlAppointmentStatus === "attended" ? ["completed", "contratou", "nao_contratou"]
          : [urlAppointmentStatus];
        const { data: apts } = await supabase.from("crm_appointments").select("lead_id").in("status", statuses);
        setAppointmentLeadIds(new Set((apts || []).map((a: any) => a.lead_id)));
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
  }, [selectedLeadId, leads]);

  // Realtime - leads list
  useEffect(() => {
    const channel = supabase
      .channel("conv-leads-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_leads" }, (payload) => {
        if (payload.eventType === "INSERT") {
          const newLead = payload.new as LeadConversation;
          setLeads((prev) => {
            if (prev.some((l) => l.id === newLead.id)) return prev;
            return [newLead, ...prev];
          });
        } else if (payload.eventType === "UPDATE") {
          const updated = payload.new as any;
          if (updated.last_inbound_at && updated.last_outbound_at) {
            updated.last_direction = new Date(updated.last_inbound_at) > new Date(updated.last_outbound_at) ? "inbound" : "outbound";
          } else if (updated.last_inbound_at) {
            updated.last_direction = "inbound";
          } else if (updated.last_outbound_at) {
            updated.last_direction = "outbound";
          }
          setLeads((prev) => {
            const newList = prev.map((l) => l.id === updated.id ? { ...l, ...updated } : l);
            return newList.sort((a, b) => {
              if (!a.last_message_at) return 1;
              if (!b.last_message_at) return -1;
              return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
            });
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
    await chat.sendTemplate(template, selectedLead?.phone || null);
  }, [chat, selectedLead]);

  // Transfer lead to another user
  const handleTransferLead = useCallback(async (newUserId: string) => {
    if (!selectedLead || !selectedLeadId) return;
    const oldUserId = selectedLead.assigned_to;
    if (newUserId === oldUserId) return;

    const oldUserName = profiles.find(p => p.id === oldUserId)?.nome || "Não atribuído";
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

    // Fire DB update + system message + notification in parallel
    const updatePromise = supabase.from("crm_leads").update({ assigned_to: newUserId, updated_at: new Date().toISOString() }).eq("id", selectedLeadId);
    const msgPromise = supabase.from("messages").insert({ lead_id: selectedLeadId, direction: "outbound", type: "system", content: `🔄 Lead transferido: ${oldUserName} → ${newUserName}`, status: "system", sender_id: user?.id || null });
    const notifPromise = supabase.from("crm_notifications").insert({ user_id: newUserId, type: "transfer", title: `Lead transferido para você`, body: `${selectedLead.name} foi transferido por ${profiles.find(p => p.id === user?.id)?.nome || "alguém"}`, lead_id: selectedLeadId });

    const [updateRes] = await Promise.all([updatePromise, msgPromise, notifPromise]);
    if (updateRes.error) {
      // Rollback on failure
      setSelectedLead(prev => prev ? { ...prev, assigned_to: oldUserId } : prev);
      setLeads(prev => prev.map(l => l.id === selectedLeadId ? { ...l, assigned_to: oldUserId ?? null } : l));
      toast.error("Erro ao transferir lead");
    }
  }, [selectedLead, selectedLeadId, profiles, chat, user]);

  // Collect all tags for filters
  const allTags = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => l.tags?.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [leads]);

  // Apply filters
  const filtered = useMemo(() => {
    return leads.filter((l) => {
      // Tab-level pipeline scoping (WhatsApp vs Instagram)
      if (pipelineFilter && l.pipeline_id !== pipelineFilter) return false;
      if (excludePipelines && excludePipelines.includes(l.pipeline_id)) return false;
      // Filter by assigned user - skip when drill-down filter is active
      const hasUrlFilters = urlGhost || urlAppointmentStatus || urlInactiveDays || searchParams.get("assigned_to") || searchParams.get("stage_id") || searchParams.get("pipeline");
      if (!hasUrlFilters && user?.id && l.assigned_to && l.assigned_to !== user.id) return false;
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
        if (!matchesText && !matchesPhone) return false;
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
      if (filters.status === "open" && l.last_direction !== "inbound") return false;
      if (filters.status === "replied" && l.last_direction !== "outbound") return false;
      if (filters.status === "no_reply" && !!l.last_direction) return false;
      if (filters.tags.length && !filters.tags.some((t) => l.tags?.includes(t))) return false;
      if (filters.source) {
        if (filters.source === "anuncio") {
          const s = (l.source || "").toLowerCase();
          if (!s.includes("_ad") && s !== "anuncio" && s !== "anúncio") return false;
        } else if (l.source?.toLowerCase() !== filters.source.toLowerCase()) return false;
      }
      if (filters.cidade && (l.cidade || "") !== filters.cidade) return false;
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
  }, [leads, search, filters, user?.id, urlGhost, ghostLeadIds, urlAppointmentStatus, appointmentLeadIds, urlInactiveDays, pipelineFilter, excludePipelines]);

  // Sorting
  const [sortMode, setSortMode] = useState<"recent" | "longest_wait" | "featured">("recent");

  const sortedFiltered = useMemo(() => {
    if (sortMode === "longest_wait") {
      // Only unread (inbound) leads, sorted by oldest last_inbound_at first
      const unread = filtered.filter(l => l.last_direction === "inbound");
      const rest = filtered.filter(l => l.last_direction !== "inbound");
      unread.sort((a, b) => {
        const aTime = (a as any).last_inbound_at ? new Date((a as any).last_inbound_at).getTime() : 0;
        const bTime = (b as any).last_inbound_at ? new Date((b as any).last_inbound_at).getTime() : 0;
        return aTime - bTime; // oldest first
      });
      return [...unread, ...rest];
    }
    // "recent" is the default sort (already sorted by last_message_at desc)
    return filtered;
  }, [filtered, sortMode]);

  // Render limit for performance — show more on scroll
  const [visibleCount, setVisibleCount] = useState(50);
  useEffect(() => { setVisibleCount(50); }, [search, filters]);
  const visibleLeads = useMemo(() => sortedFiltered.slice(0, visibleCount), [sortedFiltered, visibleCount]);

  const currentStage = chat.stages.find((s) => s.id === selectedLead?.stage_id);

  return (
    <div className="flex h-full w-full min-w-0 min-h-0 max-w-full flex-col overflow-hidden bg-background">
      <ResizablePanelGroup direction="horizontal" className="h-full w-full min-w-0 min-h-0 max-w-full overflow-hidden">
        {/* LEFT PANEL - Leads list */}
        {leftPanelVisible && (
        <><ResizablePanel defaultSize={24} minSize={20} maxSize={28} className="min-w-0 overflow-hidden">
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
                  />
                   <span className="text-xs text-muted-foreground">{sortedFiltered.length}</span>
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
                  placeholder="Buscar por nome ou telefone..."
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
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Carregando...</div>
              ) : sortedFiltered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
                  <MessageSquare size={24} className="opacity-50" />
                  <p className="text-sm">Nenhuma conversa</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {visibleLeads.map((lead) => {
                    const initials = lead.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                    const isActive = lead.id === selectedLeadId;
                    const stageDot = chat.stages.find((s) => s.id === lead.stage_id);
                    const isInbound = lead.last_direction === "inbound";
                     return (
                      <div key={lead.id} className={`relative group flex items-start gap-0 transition-colors ${
                          isActive
                            ? "bg-primary/15 border-l-2 border-l-primary"
                            : isInbound
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
                              <span className="font-medium text-sm text-foreground truncate">{lead.name}</span>
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
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{lead.last_message || "Sem mensagens"}</p>
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
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                     );
                  })}
                  {visibleCount < sortedFiltered.length && (
                    <button
                      className="w-full py-3 text-xs text-primary hover:bg-secondary/50 transition-colors"
                      onClick={() => setVisibleCount((c) => c + 50)}
                    >
                      Carregar mais ({sortedFiltered.length - visibleCount} restantes)
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle /></>
        )}

        {/* CENTER PANEL - Chat */}
        <ResizablePanel defaultSize={rightPanelVisible ? 46 : 76} minSize={38} className="min-w-0 overflow-hidden">
          {selectedLeadId && selectedLead && selectedLead.id === selectedLeadId ? (
            <div className="flex min-w-0 min-h-0 h-full flex-col overflow-hidden relative">
              {/* Chat header */}
              <div className="flex-shrink-0 bg-card border-b border-border px-4 py-3 flex items-center gap-3">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLeftPanelVisible(!leftPanelVisible)}>
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
                  <div className="font-semibold text-foreground text-sm truncate">{selectedLead.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    {selectedLead.instagram_username ? (
                      <span>@{selectedLead.instagram_username}</span>
                    ) : selectedLead.phone ? (
                      <span>{selectedLead.phone}</span>
                    ) : null}
                    {currentStage && (
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: currentStage.color }} />
                        {currentStage.name}
                      </span>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setRightPanelVisible(!rightPanelVisible)}>
                  {rightPanelVisible ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                </Button>
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
                  const prevDate = idx > 0 ? new Date(chat.messages[idx - 1].created_at) : null;
                  const showDateSep = !prevDate || msgDate.toDateString() !== prevDate.toDateString();

                  const dateSep = showDateSep ? <ChatDateSeparator key={`date-${msg.id}`} date={msgDate} /> : null;

                  if (chat.isSystemMessage(msg)) {
                    const destName = msg.content?.split("→").pop()?.trim();
                    const destStage = destName ? chat.stages.find(s => s.name === destName) : null;
                    return (
                      <div key={msg.id}>
                        {dateSep}
                        <ChatActivitySeparator
                          content={msg.content || ""}
                          timestamp={msg.created_at}
                          stageColor={destStage?.color}
                          onDelete={() => chat.deleteSystemMessage(msg.id)}
                        />
                      </div>
                    );
                  }
                  return (
                    <div key={msg.id} className="group">
                      {dateSep}
                      <ChatMessageBubble
                        ref={(el) => { chat.messageRefs.current[msg.id] = el; }}
                        msg={msg}
                        leadName={selectedLead.name}
                        allMessages={chat.messages}
                        onReply={chat.setReplyTo}
                        onForward={chat.setForwardMsg}
                        onReact={(m, emoji) => chat.handleReact(m, emoji, selectedLead.phone)}
                        onMediaClick={(url, type) => chat.setMediaPreview({ url, type })}
                        onScrollToMessage={chat.scrollToMessage}
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
                channel={channel === "instagram" || selectedLead.pipeline_id === INSTAGRAM_PIPELINE_ID ? "instagram" : "whatsapp"}
              />

              {/* Active Bot Badge */}
              {activeExecution && (
                <div className="absolute bottom-20 right-4 z-10 flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
                  <Badge variant="default" className="gap-1.5 bg-primary">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <Bot size={12} />
                    {activeExecution.bot_name || "Bot"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {activeExecution.status === "waiting_reply" ? "Aguardando resposta" : "Executando"}
                  </span>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-destructive hover:text-destructive" onClick={handleStopBot}>
                    <Square size={10} className="mr-1" /> Parar
                  </Button>
                </div>
              )}
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

        {/* RIGHT PANEL - Lead details */}
        {rightPanelVisible && selectedLeadId && selectedLead && selectedLead.id === selectedLeadId && (
          <>
            <ResizableHandle />
            <ResizablePanel defaultSize={30} minSize={24} maxSize={34} className="min-w-0 overflow-hidden">
              <Suspense fallback={<SidePanelFallback />}>
              <div className="flex min-w-0 min-h-0 h-full flex-col bg-card overflow-y-auto">
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

                <LeadExtraFields
                  leadId={selectedLead.id}
                  cidade={(selectedLead as any).cidade || null}
                  servicoInteresse={(selectedLead as any).servico_interesse || null}
                  onUpdated={(updates) => {
                    setSelectedLead((prev) => prev ? { ...prev, ...updates } as any : prev);
                    setLeads((prev) => prev.map((l) => l.id === selectedLead.id ? { ...l, ...updates } as any : l));
                  }}
                />

                <LeadCustomFields leadId={selectedLead.id} />

                

                <LeadFollowUpPanel leadId={selectedLead.id} />

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
import InstagramComments from "@/components/chat/InstagramComments";

export default function CrmConversas() {
  return (
    <div className="flex flex-col bg-background -m-6" style={{ height: "calc(100vh - 4rem)" }}>
      <Tabs defaultValue="whatsapp" className="flex flex-col flex-1 overflow-hidden">
        <TabsList className="flex-shrink-0 mx-3 mt-2 self-start">
          <TabsTrigger value="whatsapp" className="gap-2">
            <img src={whatsappLogo} alt="" width={16} height={16} className="rounded-full" />
            WhatsApp
          </TabsTrigger>
          <TabsTrigger value="instagram" className="gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#833AB4" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
            </svg>
            Instagram
          </TabsTrigger>
        </TabsList>
        <TabsContent value="whatsapp" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex data-[state=active]:flex-col">
          <WhatsAppConversations excludePipelines={["c2d3e4f5-0001-4000-8000-000000000002"]} channel="whatsapp" />
        </TabsContent>
        <TabsContent value="instagram" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex data-[state=active]:flex-col">
          <Tabs defaultValue="direct" className="flex flex-col flex-1 overflow-hidden">
            <TabsList className="flex-shrink-0 mx-3 mt-2 self-start h-8">
              <TabsTrigger value="direct" className="gap-1 text-xs h-7">
                <MessageSquare size={13} /> Direct
              </TabsTrigger>
              <TabsTrigger value="comments" className="gap-1 text-xs h-7">
                <Star size={13} /> Comentários
              </TabsTrigger>
            </TabsList>
            <TabsContent value="direct" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex data-[state=active]:flex-col">
              <WhatsAppConversations pipelineFilter="c2d3e4f5-0001-4000-8000-000000000002" channel="instagram" />
            </TabsContent>
            <TabsContent value="comments" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex data-[state=active]:flex-col">
              <InstagramComments />
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}
