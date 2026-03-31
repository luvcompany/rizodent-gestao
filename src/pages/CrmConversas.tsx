import { useState, useEffect, useCallback, useMemo } from "react";
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
import ChatDateSeparator from "@/components/chat/ChatDateSeparator";
import ChatActivityToast from "@/components/chat/ChatActivityToast";
import ChatMessageBubble from "@/components/chat/ChatMessageBubble";
import ChatMediaPreview from "@/components/chat/ChatMediaPreview";
import ChatReplyPreview from "@/components/chat/ChatReplyPreview";
import ForwardMessageDialog from "@/components/chat/ForwardMessageDialog";
import LeadEditPanel from "@/components/chat/LeadEditPanel";
import LeadCustomFields from "@/components/chat/LeadCustomFields";
import LeadAdInfo from "@/components/chat/LeadAdInfo";
import LeadStageTimeline from "@/components/chat/LeadStageTimeline";
import LeadResponseTimes from "@/components/chat/LeadResponseTimes";
import LeadBudgetPanel from "@/components/chat/LeadBudgetPanel";
import NotesBar from "@/components/chat/NotesBar";
import InlineTagsEditor from "@/components/chat/InlineTagsEditor";
import TaskPanel from "@/components/chat/TaskPanel";
import LeadAutomationPanel from "@/components/chat/LeadAutomationPanel";
import LeadFollowUpPanel from "@/components/chat/LeadFollowUpPanel";
import ConversationFilters, { type ConversationFilterValues, emptyFilters } from "@/components/chat/ConversationFilters";
import {
  Search, MessageSquare, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen
} from "lucide-react";
import { isToday, isYesterday, subDays, isAfter, startOfMonth, endOfMonth, subMonths } from "date-fns";

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
  last_direction?: string;
  imagem_origem?: string | null;
  titulo_anuncio?: string | null;
  descricao_anuncio?: string | null;
  link_anuncio?: string | null;
  ad_id?: string | null;
  nome_anuncio?: string | null;
};

export default function CrmConversas() {
  const [leads, setLeads] = useState<LeadConversation[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<LeadConversation | null>(null);
  const [newNote, setNewNote] = useState("");
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [filters, setFilters] = useState<ConversationFilterValues>(emptyFilters);
  const [profiles, setProfiles] = useState<{ id: string; nome: string }[]>([]);
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);

  // Unified chat hook
  const chat = useChatConversation(selectedLeadId);

  // Fetch leads list
  useEffect(() => {
    const fetchLeads = async () => {
      const [leadsRes, profilesRes, pipelinesRes] = await Promise.all([
        supabase
          .from("crm_leads")
          .select("id, name, phone, last_message, last_message_at, last_inbound_at, last_outbound_at, tags, source, stage_id, pipeline_id, value, notes, created_at, updated_at, imagem_origem, titulo_anuncio, descricao_anuncio, link_anuncio, ad_id, nome_anuncio")
          .order("last_message_at", { ascending: false, nullsFirst: false }),
        supabase.from("profiles").select("id, nome"),
        supabase.from("crm_pipelines").select("id, name").order("created_at"),
      ]);
      const rawLeads = (leadsRes.data || []) as (LeadConversation & { last_inbound_at?: string; last_outbound_at?: string })[];

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
      setProfiles((profilesRes.data as { id: string; nome: string }[]) || []);
      setPipelines((pipelinesRes.data as { id: string; name: string }[]) || []);
      setLoading(false);
    };
    fetchLeads();
  }, []);

  // Sync selected lead when leads or selection changes
  useEffect(() => {
    if (!selectedLeadId) return;
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

  const handleStageChange = useCallback(async (stageId: string) => {
    if (!selectedLeadId || !selectedLead) return;
    const previousStageId = selectedLead.stage_id;
    await chat.handleStageChange(stageId, previousStageId, (newStageId) => {
      setSelectedLead((prev) => prev ? { ...prev, stage_id: newStageId } : prev);
      setLeads((prev) => prev.map((l) => l.id === selectedLeadId ? { ...l, stage_id: newStageId } : l));
    });
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

  // Collect all tags for filters
  const allTags = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => l.tags?.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [leads]);

  // Apply filters
  const filtered = useMemo(() => {
    return leads.filter((l) => {
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

  const currentStage = chat.stages.find((s) => s.id === selectedLead?.stage_id);

  return (
    <div className="flex h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] w-full min-w-0 min-h-0 max-w-full flex-col overflow-hidden bg-background">
      <ResizablePanelGroup direction="horizontal" className="h-full w-full min-w-0 min-h-0 max-w-full overflow-hidden">
        {/* LEFT PANEL - Leads list */}
        {leftPanelVisible && (
        <><ResizablePanel defaultSize={24} minSize={20} maxSize={28} className="min-w-0 overflow-hidden">
          <div className="flex min-w-0 min-h-0 h-full flex-col bg-card overflow-hidden">
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
                    const stageDot = chat.stages.find((s) => s.id === lead.stage_id);
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
        <ResizablePanel defaultSize={rightPanelVisible ? 46 : 76} minSize={38} className="min-w-0 overflow-hidden">
          {selectedLeadId && selectedLead ? (
            <div className="flex min-w-0 min-h-0 h-full flex-col overflow-hidden">
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
              <NotesBar notes={selectedLead.notes} onUpdateNotes={handleSaveNotes} />

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, hsl(var(--primary) / 0.03) 0%, transparent 50%)" }}>
                <ChatActivityToast activities={chat.activityToasts} onDismiss={chat.dismissToast} />

                {chat.messages.length === 0 && (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Nenhuma mensagem ainda</div>
                )}
                {chat.messages.map((msg, idx) => {
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
                        />
                      </div>
                    );
                  }
                  return (
                    <div key={msg.id}>
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
                replyTo={chat.replyTo}
                onReplySent={() => chat.setReplyTo(null)}
                lastInboundAt={chat.lastInboundAt}
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
            <ResizablePanel defaultSize={30} minSize={24} maxSize={34} className="min-w-0 overflow-hidden">
              <div className="flex min-w-0 min-h-0 h-full flex-col bg-card overflow-y-auto">
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
                        {chat.stages.map((s) => (
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

                <LeadResponseTimes messages={chat.messages} />

                <LeadStageTimeline
                  leadId={selectedLead.id}
                  stages={chat.stages}
                  lastInboundAt={chat.lastInboundAt}
                />

                <LeadCustomFields leadId={selectedLead.id} />

                <LeadAdInfo
                  imagemOrigem={selectedLead.imagem_origem}
                  tituloAnuncio={selectedLead.titulo_anuncio}
                  descricaoAnuncio={selectedLead.descricao_anuncio}
                  linkAnuncio={selectedLead.link_anuncio}
                  adId={selectedLead.ad_id}
                  source={selectedLead.source}
                />

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
                <div className="font-medium text-sm text-foreground">{t.name}</div>
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
