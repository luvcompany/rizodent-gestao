import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import {
  Search, MessageSquare, Phone, MoreVertical,
  Plus, Tag, X
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
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
  value: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
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
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Reply state
  const [replyTo, setReplyTo] = useState<Message | null>(null);

  // Forward state
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);

  // Media preview modal
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

  // Fetch leads list
  useEffect(() => {
    const fetchLeads = async () => {
      const [leadsRes, stagesRes] = await Promise.all([
        supabase
          .from("crm_leads")
          .select("id, name, phone, last_message, last_message_at, tags, source, stage_id, value, notes, created_at, updated_at")
          .order("last_message_at", { ascending: false, nullsFirst: false }),
        supabase.from("crm_stages").select("*").order("position"),
      ]);
      setLeads((leadsRes.data as LeadConversation[]) || []);
      setStages((stagesRes.data as Stage[]) || []);
      setLoading(false);
    };
    fetchLeads();
  }, []);

  // Fetch messages when lead selected
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

  useEffect(() => { scrollToBottom(); }, [messages]);

  // Realtime for selected lead
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

  // Polling fallback
  useEffect(() => {
    if (!selectedLeadId) return;
    const interval = setInterval(() => fetchMessages(selectedLeadId), 5000);
    return () => clearInterval(interval);
  }, [selectedLeadId, fetchMessages]);

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

  const handleAddNote = async () => {
    if (!newNote.trim() || !selectedLead) return;
    const existingNotes = selectedLead.notes || "";
    const timestamp = new Date().toLocaleString("pt-BR");
    const updatedNotes = `${existingNotes}\n[${timestamp}] ${newNote.trim()}`.trim();
    const { error } = await supabase.from("crm_leads").update({ notes: updatedNotes }).eq("id", selectedLead.id);
    if (error) { toast.error("Erro ao salvar nota"); return; }
    setSelectedLead((prev) => prev ? { ...prev, notes: updatedNotes } : prev);
    setNewNote("");
    toast.success("Nota adicionada");
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


  // Message interactions
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

  const filtered = leads.filter((l) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return l.name.toLowerCase().includes(s) || l.phone?.includes(s) || l.last_message?.toLowerCase().includes(s);
  });

  const currentStage = stages.find((s) => s.id === selectedLead?.stage_id);

  return (
    <div className="flex overflow-hidden bg-background -m-6" style={{ height: "calc(100vh - 4rem)" }}>
      {/* LEFT PANEL - Leads list */}
      <div className="w-[320px] flex-shrink-0 flex flex-col border-r border-border bg-card">
        <div className="flex-shrink-0 px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-foreground text-sm">Conversas abertas</h2>
            <span className="text-xs text-muted-foreground">Total: {filtered.length}</span>
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
                return (
                  <button
                    key={lead.id}
                    onClick={() => setSelectedLeadId(lead.id)}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${isActive ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-secondary/50"}`}
                  >
                    <Avatar className="h-9 w-9 flex-shrink-0 mt-0.5">
                      <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm text-foreground truncate">{lead.name}</span>
                        {lead.last_message_at && (
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {formatDistanceToNow(new Date(lead.last_message_at), { addSuffix: false, locale: ptBR })}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {stageDot && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: stageDot.color }} />}
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

      {/* CENTER PANEL - Chat */}
      {selectedLeadId && selectedLead ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat header */}
          <div className="flex-shrink-0 bg-card border-b border-border px-4 py-3 flex items-center gap-3">
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
            <div className="flex items-center gap-1">
              <button className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-secondary">
                <Phone size={16} />
              </button>
              <button className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-secondary">
                <MoreVertical size={16} />
              </button>
            </div>
          </div>

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
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <MessageSquare size={48} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Selecione uma conversa para visualizar</p>
          </div>
        </div>
      )}

      {/* RIGHT PANEL - Lead details */}
      {selectedLeadId && selectedLead && (
        <div className="w-[300px] flex-shrink-0 flex flex-col bg-card border-l border-border overflow-y-auto">
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

            {selectedLead.source && (
              <div className="mt-2">
                <span className="text-xs text-muted-foreground">Origem</span>
                <p className="text-sm text-foreground capitalize">{selectedLead.source}</p>
              </div>
            )}
          </div>

          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2 mb-2">
              <Tag size={12} className="text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase">Tags</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {selectedLead.tags && selectedLead.tags.length > 0 ? (
                selectedLead.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">#{t}</Badge>)
              ) : (
                <span className="text-xs text-muted-foreground">Nenhuma tag</span>
              )}
            </div>
          </div>

          <LeadBudgetPanel
            lead={selectedLead as any}
            onLeadUpdated={(updates) => setSelectedLead((prev) => prev ? { ...prev, ...updates } : prev)}
          />

          <LeadResponseTimes messages={messages} />

          <LeadStageTimeline
            leadId={selectedLead.id}
            stages={stages}
            lastInboundAt={[...messages].reverse().find((m) => m.direction === "inbound")?.created_at || null}
          />

          <LeadCustomFields leadId={selectedLead.id} />

          <div className="p-4 border-b border-border">
            <h3 className="text-xs font-medium text-muted-foreground uppercase mb-2">Notas</h3>
            <div className="text-xs text-foreground whitespace-pre-wrap mb-2 max-h-32 overflow-y-auto">
              {selectedLead.notes || "Sem notas"}
            </div>
            <div className="flex gap-2">
              <Input
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Adicionar nota..."
                className="bg-secondary border-border text-xs h-8"
                onKeyDown={(e) => { if (e.key === "Enter") handleAddNote(); }}
              />
              <Button size="sm" variant="outline" onClick={handleAddNote} disabled={!newNote.trim()} className="h-8 px-2">
                <Plus size={12} />
              </Button>
            </div>
          </div>

          <div className="p-4">
            <div className="text-[10px] text-muted-foreground text-center">
              Criado em {new Date(selectedLead.created_at).toLocaleDateString("pt-BR")}
            </div>
          </div>
        </div>
      )}

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
