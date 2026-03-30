import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import ChatInput from "@/components/chat/ChatInput";
import ChatActivitySeparator from "@/components/chat/ChatActivitySeparator";
import ChatMessageBubble from "@/components/chat/ChatMessageBubble";
import ChatMediaPreview from "@/components/chat/ChatMediaPreview";
import ChatReplyPreview from "@/components/chat/ChatReplyPreview";
import ForwardMessageDialog from "@/components/chat/ForwardMessageDialog";
import LeadEditPanel from "@/components/chat/LeadEditPanel";
import LeadCustomFields from "@/components/chat/LeadCustomFields";
import LeadStageTimeline from "@/components/chat/LeadStageTimeline";
import LeadResponseTimes from "@/components/chat/LeadResponseTimes";
import LeadBudgetPanel from "@/components/chat/LeadBudgetPanel";
import NotesBar from "@/components/chat/NotesBar";
import InlineTagsEditor from "@/components/chat/InlineTagsEditor";
import TaskPanel from "@/components/chat/TaskPanel";
import ConversationFilters, { type ConversationFilterValues, emptyFilters } from "@/components/chat/ConversationFilters";
import {
  Search, MessageSquare, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen
} from "lucide-react";
import { formatDistanceToNow, isToday, isYesterday, subDays, isAfter, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";

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
  last_direction?: string;
};

type Message = {
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
};

type Stage = {
  id: string;
  name: string;
  color: string;
  position: number;
  pipeline_id: string;
};

export default function CrmConversas() {
  const [leads, setLeads] = useState<LeadConversation[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<LeadConversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [filters, setFilters] = useState<ConversationFilterValues>(emptyFilters);
  const [profiles, setProfiles] = useState<{ id: string; nome: string }[]>([]);
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [mediaPreview, setMediaPreview] = useState<{ url: string; type: "image" | "video" } | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const scrollToMessage = (msgId: string) => {
    const el = messageRefs.current[msgId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary/50");
      setTimeout(() => el.classList.remove("ring-2", "ring-primary/50"), 2000);
    }
  };

  // Fetch leads list with last message direction
  useEffect(() => {
    const fetchLeads = async () => {
      const [leadsRes, stagesRes, profilesRes, pipelinesRes] = await Promise.all([
        supabase
          .from("crm_leads")
          .select("id, name, phone, last_message, last_message_at, last_inbound_at, last_outbound_at, tags, source, stage_id, pipeline_id, value, notes, created_at, updated_at")
          .order("last_message_at", { ascending: false, nullsFirst: false }),
        supabase.from("crm_stages").select("*").order("position"),
        supabase.from("profiles").select("id, nome"),
        supabase.from("crm_pipelines").select("id, name").order("created_at"),
      ]);
      const rawLeads = (leadsRes.data || []) as (LeadConversation & { last_inbound_at?: string; last_outbound_at?: string })[];

      // Derive last_direction from existing columns instead of fetching all messages
      rawLeads.forEach((l) => {
        if (l.last_inbound_at && l.last_outbound_at) {
          l.last_direction = new Date(l.last_inbound_at) > new Date(l.last_outbound_at) ? "inbound" : "outbound";
        } else if (l.last_inbound_at) {
          l.last_direction = "inbound";
        } else if (l.last_outbound_at) {
          l.last_direction = "outbound";
        }
      });

      setLeads(rawLeads);
      setStages((stagesRes.data as Stage[]) || []);
      setProfiles((profilesRes.data as { id: string; nome: string }[]) || []);
      setPipelines((pipelinesRes.data as { id: string; name: string }[]) || []);
      setLoading(false);
    };
    fetchLeads();
  }, []);

  const fetchMessages = useCallback(async (leadId: string) => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true });
    setMessages((data as Message[]) || []);
  }, []);

  useEffect(() => {
    if (!selectedLeadId) return;
    const lead = leads.find((l) => l.id === selectedLeadId) || null;
    setSelectedLead(lead);
    fetchMessages(selectedLeadId);
    setReplyTo(null);
  }, [selectedLeadId, leads, fetchMessages]);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (!initialLoadDone.current && messages.length > 0) {
      scrollToBottom();
      initialLoadDone.current = true;
    }
  }, [messages]);
  useEffect(() => { initialLoadDone.current = false; }, [selectedLeadId]);

  // Realtime - selected conversation messages
  useEffect(() => {
    if (!selectedLeadId) return;
    const channel = supabase
      .channel("conv-messages-" + selectedLeadId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `lead_id=eq.${selectedLeadId}` }, (payload) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === (payload.new as Message).id)) return prev;
          return [...prev, payload.new as Message];
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `lead_id=eq.${selectedLeadId}` }, (payload) => {
        setMessages((prev) => prev.map((m) => m.id === (payload.new as Message).id ? (payload.new as Message) : m));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedLeadId]);

  // Realtime - leads list (new leads, updated last_message, etc.)
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
          const updated = payload.new as LeadConversation;
          setLeads((prev) => {
            const newList = prev.map((l) => l.id === updated.id ? { ...l, ...updated } : l);
            // Re-sort by last_message_at
            return newList.sort((a, b) => {
              if (!a.last_message_at) return 1;
              if (!b.last_message_at) return -1;
              return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
            });
          });
          // Also update selectedLead if it's the one that changed
          if (updated.id === selectedLeadId) {
            setSelectedLead((prev) => prev ? { ...prev, ...updated } : prev);
          }
        } else if (payload.eventType === "DELETE") {
          const deletedId = (payload.old as any).id;
          setLeads((prev) => prev.filter((l) => l.id !== deletedId));
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        // Update last_direction for the lead when a new message arrives
        const msg = payload.new as any;
        setLeads((prev) => prev.map((l) => l.id === msg.lead_id ? { ...l, last_direction: msg.direction } : l));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedLeadId]);

  const handleStageChange = async (stageId: string) => {
    if (!selectedLeadId || !selectedLead) return;
    const previousStageId = selectedLead.stage_id;
    const { error } = await supabase.from("crm_leads").update({ stage_id: stageId, updated_at: new Date().toISOString() }).eq("id", selectedLeadId);
    if (error) { toast.error("Erro ao mover lead"); return; }
    const { data: openEntry } = await supabase.from("crm_lead_stage_history").select("id").eq("lead_id", selectedLeadId).eq("stage_id", previousStageId).is("exited_at", null).maybeSingle();
    if (openEntry) await supabase.from("crm_lead_stage_history").update({ exited_at: new Date().toISOString() }).eq("id", openEntry.id);
    await supabase.from("crm_lead_stage_history").insert({ lead_id: selectedLeadId, stage_id: stageId });
    const fromName = stages.find((s) => s.id === previousStageId)?.name || "?";
    const toName = stages.find((s) => s.id === stageId)?.name || "?";
    await supabase.from("messages").insert({ lead_id: selectedLeadId, direction: "outbound", type: "system", content: `📋 Etapa alterada: ${fromName} → ${toName}`, status: "system" });
    setSelectedLead((prev) => prev ? { ...prev, stage_id: stageId } : prev);
    setLeads((prev) => prev.map((l) => l.id === selectedLeadId ? { ...l, stage_id: stageId } : l));
    toast.success("Etapa atualizada");
  };

  const handleAddNote = async (noteText: string) => {
    if (!noteText.trim() || !selectedLead) return;
    const existingNotes = selectedLead.notes || "";
    const timestamp = new Date().toLocaleString("pt-BR");
    const updatedNotes = `${existingNotes}\n[${timestamp}] ${noteText.trim()}`.trim();
    await saveNotes(updatedNotes);
  };

  const saveNotes = async (updatedNotes: string) => {
    if (!selectedLead) return;
    const { error } = await supabase.from("crm_leads").update({ notes: updatedNotes }).eq("id", selectedLead.id);
    if (error) { toast.error("Erro ao salvar nota"); return; }
    setSelectedLead((prev) => prev ? { ...prev, notes: updatedNotes } : prev);
  };

  const loadTemplates = async () => {
    const { data } = await supabase.from("crm_whatsapp_templates").select("*").eq("status", "APPROVED");
    setTemplates(data || []);
    setTemplatesOpen(true);
  };

  const sendTemplate = async (template: any) => {
    if (!selectedLead?.phone) { toast.error("Lead sem telefone"); return; }
    setTemplatesOpen(false);
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp-message", {
        body: { lead_id: selectedLeadId, to: selectedLead.phone, type: "template", template_name: template.name, template_language: template.language },
      });
      if (error || data?.error) { toast.error("Erro ao enviar template"); return; }
      toast.success("Template enviado");
    } catch { toast.error("Erro inesperado"); }
  };

  const handleReply = (msg: Message) => setReplyTo(msg);
  const handleReact = async (msg: Message, emoji: string) => {
    if (!selectedLead?.phone) { toast.error("Lead sem telefone"); return; }
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msg.id) return m;
        const existing = Array.isArray((m as any).reactions) ? (m as any).reactions as any[] : [];
        const filtered = existing.filter((r: any) => r.from !== "me");
        return { ...m, reactions: [...filtered, { emoji, from: "me" }] } as any;
      })
    );
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp-message", {
        body: { lead_id: selectedLeadId, to: selectedLead.phone, type: "reaction", reaction_emoji: emoji, reaction_to_message_id: msg.id },
      });
      if (error || data?.error) toast.error("Erro ao enviar reação");
    } catch { toast.error("Erro ao enviar reação"); }
  };
  const handleForward = (msg: Message) => setForwardMsg(msg);
  const isSystemMessage = (msg: Message) => msg.type === "system" || msg.status === "system";
  const handleOptimisticMessage = (optimisticMsg: any) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === optimisticMsg.id)) return prev;
      return [...prev, optimisticMsg];
    });
  };
  const handleMessageError = (tempId: string) => {
    setMessages((prev) => prev.map((m) => m.id === tempId ? { ...m, status: "error" } : m));
  };

  // Collect all tags for filters
  const allTags = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => l.tags?.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [leads]);

  // Apply filters
  const filtered = useMemo(() => {
    return leads.filter((l) => {
      // Search
      const normalizedSearch = search.trim().toLowerCase();
      if (normalizedSearch) {
        const searchDigits = normalizedSearch.replace(/\D/g, "");
        const phoneRaw = l.phone || "";
        const phoneDigits = phoneRaw.replace(/\D/g, "");
        const matchesText =
          l.name.toLowerCase().includes(normalizedSearch) ||
          phoneRaw.toLowerCase().includes(normalizedSearch) ||
          (l.last_message || "").toLowerCase().includes(normalizedSearch);
        const matchesPhone = searchDigits.length >= 3 && phoneDigits.includes(searchDigits);

        if (!matchesText && !matchesPhone) return false;
      }
      // Date filter
      if (filters.dateRange) {
        if (!l.last_message_at) return false;
        const msgDate = new Date(l.last_message_at);
        if (filters.dateRange === "today" && !isToday(msgDate)) return false;
        if (filters.dateRange === "yesterday" && !isYesterday(msgDate)) return false;
        if (filters.dateRange === "7days" && !isAfter(msgDate, subDays(new Date(), 7))) return false;
        if (filters.dateRange === "this_month") {
          const start = startOfMonth(new Date());
          if (msgDate < start) return false;
        }
        if (filters.dateRange === "last_month") {
          const start = startOfMonth(subMonths(new Date(), 1));
          const end = endOfMonth(subMonths(new Date(), 1));
          if (msgDate < start || msgDate > end) return false;
        }
        if (filters.dateRange === "custom") {
          if (filters.customDateFrom && msgDate < filters.customDateFrom) return false;
          if (filters.customDateTo) {
            const end = new Date(filters.customDateTo);
            end.setHours(23, 59, 59, 999);
            if (msgDate > end) return false;
          }
        }
      }
      // Pipeline filter
      if (filters.pipelineId && l.pipeline_id !== filters.pipelineId) return false;
      if (filters.stageId && l.stage_id !== filters.stageId) return false;
      if (filters.status === "open" && l.last_direction !== "inbound") return false;
      if (filters.status === "replied" && l.last_direction !== "outbound") return false;
      if (filters.status === "no_reply" && !!l.last_direction) return false;
      if (filters.tags.length && !filters.tags.some((t) => l.tags?.includes(t))) return false;
      if (filters.source && l.source?.toLowerCase() !== filters.source.toLowerCase()) return false;
      return true;
    });
  }, [leads, search, filters]);

  const currentStage = stages.find((s) => s.id === selectedLead?.stage_id);

  return (
    <div className="flex flex-col overflow-hidden bg-background -m-6" style={{ height: "calc(100vh - 4rem)" }}>
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* LEFT PANEL - Leads list */}
        {leftPanelVisible && (
        <><ResizablePanel defaultSize={22} minSize={20} maxSize={35}>
          <div className="flex flex-col h-full bg-card">
            <div className="flex-shrink-0 px-4 py-3 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-bold text-foreground text-sm">Conversas</h2>
                <div className="flex items-center gap-1">
                  <ConversationFilters
                    stages={stages}
                    profiles={profiles}
                    allTags={allTags}
                    filters={filters}
                    onApply={setFilters}
                    pipelines={pipelines}
                  />
                  <span className="text-xs text-muted-foreground">{filtered.length}</span>
                </div>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm bg-secondary"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Carregando...</div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
                  <MessageSquare size={24} className="opacity-50" />
                  <p className="text-sm">Nenhuma conversa</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filtered.map((lead) => {
                    const initials = lead.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                    const isActive = lead.id === selectedLeadId;
                    const stageDot = stages.find((s) => s.id === lead.stage_id);
                    const isInbound = lead.last_direction === "inbound";
                    return (
                      <button
                        key={lead.id}
                        onClick={() => setSelectedLeadId(lead.id)}
                        className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
                          isActive
                            ? "bg-primary/15 border-l-2 border-l-primary"
                            : isInbound
                              ? "bg-primary/5 hover:bg-primary/10"
                              : "hover:bg-secondary/50"
                        }`}
                      >
                        <Avatar className="h-9 w-9 flex-shrink-0 mt-0.5">
                          <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">{initials}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm text-foreground truncate">{lead.name}</span>
                            {lead.last_message_at && (
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                {new Date(lead.last_message_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {lead.source && (
                              <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">{lead.source}</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{lead.last_message || "Sem mensagens"}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle /></>
        )}

        {/* CENTER PANEL - Chat */}
        <ResizablePanel defaultSize={rightPanelVisible ? 50 : 78} minSize={30}>
          {selectedLeadId && selectedLead ? (
            <div className="flex flex-col h-full">
              {/* Chat header */}
              <div className="flex-shrink-0 bg-card border-b border-border px-4 py-3 flex items-center gap-3">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLeftPanelVisible(!leftPanelVisible)}>
                  {leftPanelVisible ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
                </Button>
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="bg-primary/20 text-primary font-semibold text-sm">
                    {selectedLead.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-foreground text-sm truncate">{selectedLead.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    {selectedLead.phone && <span>{selectedLead.phone}</span>}
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
              <NotesBar notes={selectedLead.notes} onUpdateNotes={saveNotes} />

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, hsl(var(--primary) / 0.03) 0%, transparent 50%)" }}>
                {messages.length === 0 && (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Nenhuma mensagem ainda</div>
                )}
                {messages.map((msg) => {
                  if (isSystemMessage(msg)) {
                    const destName = msg.content?.split("→").pop()?.trim();
                    const destStage = destName ? stages.find(s => s.name === destName) : null;
                    return (
                      <ChatActivitySeparator
                        key={msg.id}
                        content={msg.content || ""}
                        timestamp={msg.created_at}
                        stageColor={destStage?.color}
                      />
                    );
                  }
                  return (
                    <ChatMessageBubble
                      key={msg.id}
                      ref={(el) => { messageRefs.current[msg.id] = el; }}
                      msg={msg}
                      leadName={selectedLead.name}
                      allMessages={messages}
                      onReply={handleReply}
                      onForward={handleForward}
                      onReact={handleReact}
                      onMediaClick={(url, type) => setMediaPreview({ url, type })}
                      onScrollToMessage={scrollToMessage}
                    />
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {replyTo && (
                <ChatReplyPreview replyTo={replyTo} leadName={selectedLead.name} onCancel={() => setReplyTo(null)} />
              )}

              <ChatInput
                leadId={selectedLeadId}
                leadPhone={selectedLead.phone}
                onLoadTemplates={loadTemplates}
                externalMessage=""
                onExternalMessageConsumed={() => {}}
                onMessageSent={handleOptimisticMessage}
                onMessageError={handleMessageError}
                replyTo={replyTo}
                onReplySent={() => setReplyTo(null)}
                lastInboundAt={[...messages].reverse().find((m) => m.direction === "inbound")?.created_at || null}
              />
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
        {rightPanelVisible && selectedLeadId && selectedLead && (
          <>
            <ResizableHandle />
            <ResizablePanel defaultSize={28} minSize={20} maxSize={35}>
              <div className="flex flex-col h-full bg-card overflow-y-auto">
                <div className="p-4 border-b border-border">
                  <div className="flex items-center gap-3 mb-3">
                    <Avatar className="h-12 w-12">
                      <AvatarFallback className="bg-primary/20 text-primary text-lg font-bold">
                        {selectedLead.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <h2 className="font-bold text-foreground text-sm">{selectedLead.name}</h2>
                      <p className="text-xs text-muted-foreground">{selectedLead.phone || "Sem telefone"}</p>
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

                  <div className="mt-3 mb-3">
                    <label className="text-xs text-muted-foreground mb-1 block">Etapa do Funil</label>
                    <Select value={selectedLead.stage_id} onValueChange={handleStageChange}>
                      <SelectTrigger className="bg-secondary border-border h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {stages.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            <span className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                              {s.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <InlineTagsEditor
                  leadId={selectedLead.id}
                  tags={selectedLead.tags || []}
                  source={selectedLead.source}
                  onUpdated={(updates) => {
                    setSelectedLead((prev) => prev ? { ...prev, ...updates } as any : prev);
                    setLeads((prev) => prev.map((l) => l.id === selectedLead.id ? { ...l, ...updates } as any : l));
                  }}
                />

                <LeadBudgetPanel
                  lead={selectedLead as any}
                  onLeadUpdated={(updates) => setSelectedLead((prev) => prev ? { ...prev, ...updates } : prev)}
                />

                <TaskPanel leadId={selectedLead.id} />

                <LeadResponseTimes messages={messages} />

                <LeadStageTimeline
                  leadId={selectedLead.id}
                  stages={stages}
                  lastInboundAt={[...messages].reverse().find((m) => m.direction === "inbound")?.created_at || null}
                />

                <LeadCustomFields leadId={selectedLead.id} />

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
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* Templates Sheet */}
      <Sheet open={templatesOpen} onOpenChange={setTemplatesOpen}>
        <SheetContent className="w-[380px]">
          <SheetHeader><SheetTitle>Templates Aprovados</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-2">
            {templates.length === 0 && <p className="text-sm text-muted-foreground">Nenhum template aprovado.</p>}
            {templates.map((t) => (
              <button key={t.id} onClick={() => sendTemplate(t)} className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/30 bg-secondary/50 hover:bg-secondary transition-colors">
                <div className="font-medium text-sm text-foreground">{t.name}</div>
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.body_text}</div>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Forward Dialog */}
      {forwardMsg && (
        <ForwardMessageDialog
          open={!!forwardMsg}
          onOpenChange={(open) => { if (!open) setForwardMsg(null); }}
          messageContent={forwardMsg.content}
          messageType={forwardMsg.type}
          fromLeadId={selectedLeadId || ""}
        />
      )}

      <ChatMediaPreview mediaPreview={mediaPreview} onClose={() => setMediaPreview(null)} />
    </div>
  );
}
