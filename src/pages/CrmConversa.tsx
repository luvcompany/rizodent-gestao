import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

import ChatInput from "@/components/chat/ChatInput";
import ChatActivitySeparator from "@/components/chat/ChatActivitySeparator";
import ChatActivityToast from "@/components/chat/ChatActivityToast";
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
import LeadAutomationPanel from "@/components/chat/LeadAutomationPanel";
import LeadFollowUpPanel from "@/components/chat/LeadFollowUpPanel";
import {
  ArrowLeft, FileText, Tag, Search
} from "lucide-react";
import LeadAdInfo from "@/components/chat/LeadAdInfo";

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

type Lead = {
  id: string;
  name: string;
  phone: string | null;
  stage_id: string;
  tags: string[] | null;
  source: string | null;
  value: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  imagem_origem?: string | null;
  titulo_anuncio?: string | null;
  descricao_anuncio?: string | null;
  link_anuncio?: string | null;
  ad_id?: string | null;
  nome_anuncio?: string | null;
};

type Stage = {
  id: string;
  name: string;
  color: string;
  position: number;
  pipeline_id: string;
};

type ActivityToast = { id: string; content: string };

export default function CrmConversa() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [lead, setLead] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [templateMessage, setTemplateMessage] = useState("");
  const [newNote, setNewNote] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateSearch, setTemplateSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const filteredTemplates = useMemo(() => {
    if (!templateSearch.trim()) return templates;
    const q = templateSearch.toLowerCase();
    return templates.filter(t => t.name.toLowerCase().includes(q) || (t.body_text || "").toLowerCase().includes(q));
  }, [templates, templateSearch]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Reply state
  const [replyTo, setReplyTo] = useState<Message | null>(null);

  // Forward state
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);

  // Media preview modal
  const [mediaPreview, setMediaPreview] = useState<{ url: string; type: "image" | "video" } | null>(null);

  // Activity toasts
  const [activityToasts, setActivityToasts] = useState<ActivityToast[]>([]);
  const dismissToast = useCallback((toastId: string) => {
    setActivityToasts((prev) => prev.filter((t) => t.id !== toastId));
  }, []);
  const showActivityToast = useCallback((content: string) => {
    const toastItem: ActivityToast = { id: Date.now().toString(), content };
    setActivityToasts((prev) => [...prev, toastItem]);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [leadRes, messagesRes, stagesRes] = await Promise.all([
        supabase.from("crm_leads").select("*").eq("id", id).single(),
        supabase.from("messages").select("*").eq("lead_id", id).order("created_at", { ascending: true }),
        supabase.from("crm_stages").select("*").order("position"),
      ]);
      if (leadRes.error) console.error("[CRM] Erro ao buscar lead:", leadRes.error);
      if (messagesRes.error) console.error("[CRM] Erro ao buscar mensagens:", messagesRes.error);
      if (stagesRes.error) console.error("[CRM] Erro ao buscar stages:", stagesRes.error);

      if (leadRes.data) setLead(leadRes.data as Lead);
      console.log(`[CRM] Mensagens carregadas: ${messagesRes.data?.length ?? 0} para lead_id=${id}`);
      setMessages((messagesRes.data as Message[]) || []);
      setStages((stagesRes.data as Stage[]) || []);
    } catch (err) {
      console.error("[CRM] Erro inesperado ao buscar dados:", err);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Only scroll to bottom on initial load
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (!initialLoadDone.current && messages.length > 0) {
      scrollToBottom();
      initialLoadDone.current = true;
    }
  }, [messages]);

  useEffect(() => {
    if (!id) return;

    const repairLegacyMedia = async () => {
      const { data, error } = await supabase.functions.invoke("repair-chat-media", {
        body: { leadId: id },
      });

      if (error) {
        console.error("[CRM] Erro ao reparar mídias antigas:", error);
        return;
      }

      if (data?.repaired?.length) {
        console.log(`[CRM] Mídias antigas reparadas: ${data.repaired.length}`);
        fetchData();
      }

      if (data?.failed?.length) {
        console.error("[CRM] Falhas ao reparar mídias antigas:", data.failed);
      }
    };

    repairLegacyMedia();
  }, [id, fetchData]);

  // Realtime subscription for new/updated messages
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel('messages-' + id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `lead_id=eq.${id}`,
      }, (payload) => {
        console.log("[CRM] Realtime INSERT:", payload.new);
        setMessages((prev) => {
          if (prev.some((m) => m.id === (payload.new as Message).id)) return prev;
          return [...prev, payload.new as Message];
        });
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `lead_id=eq.${id}`,
      }, (payload) => {
        setMessages((prev) =>
          prev.map((m) => m.id === (payload.new as Message).id ? (payload.new as Message) : m)
        );
      })
      .subscribe((status) => {
        console.log(`[CRM] Realtime status: ${status}`);
      });
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  // Fallback polling every 5s
  useEffect(() => {
    if (!id) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("messages").select("*").eq("lead_id", id).order("created_at", { ascending: true });
      if (data) {
        setMessages((prev) => {
          const newIds = data.map(m => `${m.id}:${m.media_url ?? ""}:${m.content ?? ""}:${m.type}`).join("|");
          const oldIds = prev.map(m => `${m.id}:${m.media_url ?? ""}:${m.content ?? ""}:${m.type}`).join("|");
          return newIds !== oldIds ? (data as Message[]) : prev;
        });
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [id]);

  const handleStageChange = async (stageId: string) => {
    if (!id || !lead) return;
    const previousStageId = lead.stage_id;

    const { error } = await supabase.from("crm_leads").update({ stage_id: stageId, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error("Erro ao mover lead"); return; }

    // Close previous stage history entry
    const { data: openEntry } = await supabase
      .from("crm_lead_stage_history")
      .select("id")
      .eq("lead_id", id)
      .eq("stage_id", previousStageId)
      .is("exited_at", null)
      .maybeSingle();

    if (openEntry) {
      await supabase.from("crm_lead_stage_history").update({ exited_at: new Date().toISOString() }).eq("id", openEntry.id);
    }

    // Insert new stage history entry
    await supabase.from("crm_lead_stage_history").insert({
      lead_id: id,
      stage_id: stageId,
      entered_at: new Date().toISOString(),
    });

    // Insert a system message to show as activity separator
    const fromStageName = stages.find(s => s.id === previousStageId)?.name || "?";
    const toStageName = stages.find(s => s.id === stageId)?.name || "?";
    const systemContent = `📋 Etapa alterada: ${fromStageName} → ${toStageName}`;
    await supabase.from("messages").insert({
      lead_id: id,
      direction: "outbound",
      type: "system",
      content: systemContent,
      status: "system",
    });

    // Show activity toast
    showActivityToast(`📋 Lead movido para ${toStageName}`);

    // Trigger bot-engine for stage change
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      fetch(`https://${projectId}.supabase.co/functions/v1/bot-trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ leadId: id, newStageId: stageId }),
      }).catch(() => {});
    } catch {}

    setLead((prev) => prev ? { ...prev, stage_id: stageId } : prev);
    toast.success("Etapa atualizada");
  };

  const handleAddNote = async (noteText: string) => {
    if (!noteText.trim() || !lead) return;
    const existingNotes = lead.notes || "";
    const timestamp = new Date().toLocaleString("pt-BR");
    const updatedNotes = `${existingNotes}\n[${timestamp}] ${noteText.trim()}`.trim();
    await saveNotes(updatedNotes);
  };

  const saveNotes = async (updatedNotes: string) => {
    if (!lead) return;
    const { error } = await supabase.from("crm_leads").update({ notes: updatedNotes }).eq("id", lead.id);
    if (error) { toast.error("Erro ao salvar nota"); return; }
    setLead((prev) => prev ? { ...prev, notes: updatedNotes } : prev);
  };

  const loadTemplates = async () => {
    const { data } = await supabase.from("crm_whatsapp_templates").select("*").eq("status", "APPROVED");
    setTemplates(data || []);
    setTemplatesOpen(true);
  };

  const sendTemplate = async (template: any) => {
    if (!lead?.phone) {
      toast.error("Lead sem telefone configurado");
      return;
    }
    setTemplatesOpen(false);
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp-message", {
        body: {
          lead_id: id,
          to: lead.phone,
          type: "template",
          template_name: template.name,
          template_language: template.language,
        },
      });
      if (error || data?.error) {
        toast.error("Erro ao enviar template");
        return;
      }
      toast.success("Template enviado");
    } catch {
      toast.error("Erro inesperado ao enviar template");
    }
  };


  // Message interactions
  const handleReply = (msg: Message) => {
    setReplyTo(msg);
  };

  const handleReact = async (msg: Message, emoji: string) => {
    if (!lead?.phone) { toast.error("Lead sem telefone"); return; }

    // Optimistic: update local reactions immediately
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msg.id) return m;
        const existing = Array.isArray((m as any).reactions) ? (m as any).reactions as any[] : [];
        // Replace existing reaction from "me" instead of appending
        const filtered = existing.filter((r: any) => r.from !== "me");
        return { ...m, reactions: [...filtered, { emoji, from: "me" }] } as any;
      })
    );

    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp-message", {
        body: {
          lead_id: id,
          to: lead.phone,
          type: "reaction",
          reaction_emoji: emoji,
          reaction_to_message_id: msg.id,
        },
      });
      if (error || data?.error) {
        toast.error("Erro ao enviar reação");
      }
    } catch {
      toast.error("Erro ao enviar reação");
    }
  };

  const handleForward = (msg: Message) => {
    setForwardMsg(msg);
  };

  const scrollToMessage = (msgId: string) => {
    const el = messageRefs.current[msgId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary/50");
      setTimeout(() => el.classList.remove("ring-2", "ring-primary/50"), 2000);
    }
  };

  const isSystemMessage = (msg: Message) => msg.type === "system" || msg.status === "system";

  const currentStage = stages.find((s) => s.id === lead?.stage_id);
  const formatCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground">Carregando conversa...</div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground">Lead não encontrado</div>
      </div>
    );
  }

  return (
    <div className="flex overflow-hidden bg-background -m-6" style={{ height: "calc(100vh - 4rem)" }}>
      {/* LEFT COLUMN - Chat (70%) */}
      <div className="flex flex-col w-[70%] border-r border-border">
        {/* Chat Header */}
        <div className="flex-shrink-0 bg-card border-b border-border px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate("/crm")} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={20} />
          </button>
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-primary/20 text-primary font-semibold">
              {lead.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-foreground truncate">{lead.name}</div>
            <div className="text-xs text-muted-foreground">
              {lead.phone && <span>{lead.phone}</span>}
            </div>
          </div>
        </div>

        {/* Notes Bar */}
        <NotesBar notes={lead.notes} onUpdateNotes={saveNotes} />

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 relative" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, hsl(var(--primary) / 0.03) 0%, transparent 50%)" }}>
          {/* Activity toasts */}
          <ChatActivityToast activities={activityToasts} onDismiss={dismissToast} />

          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Nenhuma mensagem ainda. Inicie a conversa!
            </div>
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
                leadName={lead.name}
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

        {/* Reply preview */}
        {replyTo && (
          <ChatReplyPreview replyTo={replyTo} leadName={lead.name} onCancel={() => setReplyTo(null)} />
        )}

        {/* Input Area */}
        {id && <ChatInput leadId={id} leadPhone={lead.phone} onLoadTemplates={loadTemplates} externalMessage={templateMessage} onExternalMessageConsumed={() => setTemplateMessage("")} replyTo={replyTo} onReplySent={() => setReplyTo(null)} onMessageSent={(msg) => setMessages(prev => [...prev, msg])} onMessageError={(tempId) => setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: "error" } : m))} lastInboundAt={[...messages].reverse().find((m) => m.direction === "inbound")?.created_at || null} />}
      </div>

      {/* RIGHT COLUMN - Lead Panel (30%) */}
      <div className="w-[30%] flex flex-col bg-card overflow-y-auto">
        {/* Lead Info Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-3 mb-3">
            <Avatar className="h-14 w-14">
              <AvatarFallback className="bg-primary/20 text-primary text-xl font-bold">
                {lead.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-foreground">{lead.name}</h2>
              <p className="text-sm text-muted-foreground">{lead.phone || "Sem telefone"}</p>
            </div>
          </div>

          {/* Edit / Delete buttons */}
          <LeadEditPanel
            lead={lead}
            onLeadUpdated={(updated) => setLead(updated as any)}
            onLeadDeleted={() => navigate("/crm")}
          />

          {/* Stage selector */}
          <div className="mt-3 mb-3">
            <label className="text-xs text-muted-foreground mb-1 block">Etapa do Funil</label>
            <Select value={lead.stage_id} onValueChange={handleStageChange}>
              <SelectTrigger className="bg-secondary border-border">
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

        {/* Inline Tags & Source Editor */}
        <InlineTagsEditor
          leadId={lead.id}
          tags={lead.tags || []}
          source={lead.source}
          onUpdated={(updates) => setLead((prev) => prev ? { ...prev, ...updates } as Lead : prev)}
        />

        {/* Ad Info */}
        <LeadAdInfo
          imagemOrigem={(lead as any).imagem_origem}
          tituloAnuncio={(lead as any).titulo_anuncio}
          descricaoAnuncio={(lead as any).descricao_anuncio}
          linkAnuncio={(lead as any).link_anuncio}
          adId={(lead as any).ad_id}
          nomeAnuncio={(lead as any).nome_anuncio}
        />

        {/* Budget Panel */}
        <LeadBudgetPanel
          lead={lead as any}
          onLeadUpdated={(updates) => setLead((prev) => prev ? { ...prev, ...updates } : prev)}
        />

        {/* Response Times */}
        <LeadResponseTimes messages={messages} />

        {/* Stage History Timeline */}
        <LeadStageTimeline
          leadId={lead.id}
          stages={stages}
          lastInboundAt={
            [...messages].reverse().find((m) => m.direction === "inbound")?.created_at || null
          }
        />

        {/* Custom Fields */}
        <LeadCustomFields leadId={lead.id} />

        {/* Automation Panel */}
        <LeadAutomationPanel leadId={lead.id} />

        {/* Notes input */}
        <div className="p-4 border-b border-border">
          <h3 className="text-xs font-medium text-muted-foreground uppercase mb-2">Adicionar Nota</h3>
          <div className="flex gap-2">
            <Input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Adicionar nota..."
              className="bg-secondary border-border text-sm"
              onKeyDown={(e) => { if (e.key === "Enter" && newNote.trim()) { handleAddNote(newNote); setNewNote(""); } }}
            />
            <Button size="sm" variant="outline" onClick={() => { if (newNote.trim()) { handleAddNote(newNote); setNewNote(""); } }} disabled={!newNote.trim()}>
              +
            </Button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4">
          <div className="text-xs text-muted-foreground text-center">
            Criado em {new Date(lead.created_at).toLocaleDateString("pt-BR")}
          </div>
        </div>
      </div>

      {/* Forward Dialog */}
      <ForwardMessageDialog
        open={!!forwardMsg}
        onOpenChange={(open) => { if (!open) setForwardMsg(null); }}
        messageContent={forwardMsg?.content || null}
        messageType={forwardMsg?.type || "text"}
        fromLeadId={id || ""}
      />

      {/* Templates Sheet */}
      <Sheet open={templatesOpen} onOpenChange={setTemplatesOpen}>
        <SheetContent className="w-[380px] flex flex-col">
          <SheetHeader>
            <SheetTitle>Templates Aprovados</SheetTitle>
          </SheetHeader>
          <div className="mt-3 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar template..."
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              className="pl-9 bg-secondary border-border"
            />
          </div>
          <div className="flex-1 overflow-y-auto mt-3 space-y-2 pr-1">
            {filteredTemplates.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhum template encontrado.</p>
            )}
            {filteredTemplates.map((t) => (
              <button
                key={t.id}
                onClick={() => sendTemplate(t)}
                className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/30 bg-secondary/50 hover:bg-secondary transition-colors"
              >
                <div className="font-medium text-sm text-foreground">{t.name}</div>
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.body_text}</div>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <ChatMediaPreview mediaPreview={mediaPreview} onClose={() => setMediaPreview(null)} />
    </div>
  );
}
