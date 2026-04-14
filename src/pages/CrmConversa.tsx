import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cleanTemplateName } from "@/lib/templateUtils";

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
import LeadExtraFields from "@/components/chat/LeadExtraFields";
import LeadStageTimeline from "@/components/chat/LeadStageTimeline";
import LeadResponseTimes from "@/components/chat/LeadResponseTimes";
import LeadBudgetPanel from "@/components/chat/LeadBudgetPanel";
import NotesBar from "@/components/chat/NotesBar";
import InlineTagsEditor from "@/components/chat/InlineTagsEditor";

import LeadFollowUpPanel from "@/components/chat/LeadFollowUpPanel";

import TaskPanel from "@/components/chat/TaskPanel";
import AppointmentConfirmBar from "@/components/chat/AppointmentConfirmBar";
import PipelineStageSelector from "@/components/chat/PipelineStageSelector";
import { ArrowLeft, FileText, Tag, Search, Bot, Square, Play, Loader2, UserRoundCog } from "lucide-react";

import { useChatConversation } from "@/hooks/useChatConversation";


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
  assigned_to?: string | null;
  imagem_origem?: string | null;
  titulo_anuncio?: string | null;
  descricao_anuncio?: string | null;
  link_anuncio?: string | null;
  ad_id?: string | null;
  nome_anuncio?: string | null;
  cidade?: string | null;
  servico_interesse?: string | null;
};

// Global profiles cache shared with CrmConversas
const profilesCacheConv = { data: null as { id: string; nome: string }[] | null, timestamp: 0 };
const PROFILES_CACHE_TTL = 5 * 60_000;

export default function CrmConversa() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [lead, setLead] = useState<Lead | null>(null);
  const [templateMessage, setTemplateMessage] = useState("");
  const [newNote, setNewNote] = useState("");
  const [profiles, setProfiles] = useState<{ id: string; nome: string }[]>(() => profilesCacheConv.data || []);

  const chat = useChatConversation(id);

  // Fetch lead + profiles in parallel (with profile cache)
  const [leadLoading, setLeadLoading] = useState(true);
  useEffect(() => {
    if (!id) return;
    setLeadLoading(true);

    const profilesPromise = profilesCacheConv.data && Date.now() - profilesCacheConv.timestamp < PROFILES_CACHE_TTL
      ? Promise.resolve({ data: profilesCacheConv.data })
      : supabase.from("profiles").select("id, nome");

    Promise.all([
      supabase.from("crm_leads").select("*").eq("id", id).single(),
      profilesPromise,
    ]).then(([leadRes, profilesRes]) => {
      if (leadRes.data) setLead(leadRes.data as Lead);
      if (profilesRes.data) {
        profilesCacheConv.data = profilesRes.data as any;
        profilesCacheConv.timestamp = Date.now();
        setProfiles(profilesRes.data as any);
      }
      setLeadLoading(false);
    });
  }, [id]);

  // Transfer lead to another user
  const handleTransferLead = useCallback(async (newUserId: string) => {
    if (!lead || !id) return;
    const oldUserId = lead.assigned_to;
    if (newUserId === oldUserId) return;

    const oldUserName = profiles.find(p => p.id === oldUserId)?.nome || "Não atribuído";
    const newUserName = profiles.find(p => p.id === newUserId)?.nome || "?";

    // Optimistic update for instant feedback
    setLead(prev => prev ? { ...prev, assigned_to: newUserId } : prev);
    chat.showActivityToast(`🔄 Lead transferido para ${newUserName}`);
    toast.success(`Lead transferido para ${newUserName}`);

    const updatePromise = supabase.from("crm_leads").update({ assigned_to: newUserId, updated_at: new Date().toISOString() }).eq("id", id);
    const msgPromise = supabase.from("messages").insert({ lead_id: id, direction: "outbound", type: "system", content: `🔄 Lead transferido: ${oldUserName} → ${newUserName}`, status: "system", sender_id: user?.id || null });
    const notifPromise = supabase.from("crm_notifications").insert({ user_id: newUserId, type: "transfer", title: `Lead transferido para você`, body: `${lead.name} foi transferido por ${profiles.find(p => p.id === user?.id)?.nome || "alguém"}`, lead_id: id });

    const [updateRes] = await Promise.all([updatePromise, msgPromise, notifPromise]);
    if (updateRes.error) {
      setLead(prev => prev ? { ...prev, assigned_to: oldUserId } : prev);
      toast.error("Erro ao transferir lead");
    }
  }, [lead, id, profiles, chat, user]);

  const handleStageChange = useCallback(async (stageId: string) => {
    if (!lead) return;
    const prevStageId = lead.stage_id;
    await chat.handleStageChange(stageId, prevStageId, () => {
      setLead((prev) => prev ? { ...prev, stage_id: stageId } : prev);
    });
  }, [lead, chat]);

  const handleSaveNotes = useCallback(async (updatedNotes: string) => {
    const ok = await chat.saveNotes(updatedNotes);
    if (ok) setLead((prev) => prev ? { ...prev, notes: updatedNotes } : prev);
  }, [chat]);

  const handleAddNote = useCallback(async (noteText: string) => {
    if (!noteText.trim() || !lead) return;
    const existingNotes = lead.notes || "";
    const timestamp = new Date().toLocaleString("pt-BR");
    const updatedNotes = `${existingNotes}\n[${timestamp}] ${noteText.trim()}`.trim();
    await handleSaveNotes(updatedNotes);
  }, [lead, handleSaveNotes]);

  const handleSendTemplate = useCallback(async (template: any) => {
    await chat.sendTemplate(template, lead?.phone || null);
  }, [chat, lead]);

  // ===== Bot Active Execution State =====
  const [activeExecution, setActiveExecution] = useState<{
    id: string;
    status: string;
    bot_name?: string;
  } | null>(null);

  const checkExecution = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase
      .from("bot_executions")
      .select("id, status, current_node_id, bots(name)")
      .eq("lead_id", id)
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
  }, [id]);

  useEffect(() => { checkExecution(); }, [checkExecution]);

  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`bot-exec-${id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "bot_executions",
        filter: `lead_id=eq.${id}`,
      }, () => checkExecution())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, checkExecution]);

  const handleStopBot = async () => {
    if (!activeExecution) return;
    await supabase
      .from("bot_executions")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", activeExecution.id);
    toast.success("Bot encerrado");
    setActiveExecution(null);
  };

  if (leadLoading || !lead || lead.id !== id) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const currentStage = chat.stages.find((s) => s.id === lead.stage_id);

  return (
    <div className="flex overflow-hidden bg-background -m-6" style={{ height: "calc(100vh - 4rem)" }}>
      {/* LEFT COLUMN - Chat (70%) */}
      <div className="flex flex-col w-[70%] border-r border-border relative">
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
        <NotesBar notes={lead.notes} onUpdateNotes={handleSaveNotes} />

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 relative" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, hsl(var(--primary) / 0.03) 0%, transparent 50%)" }}>
          <ChatActivityToast activities={chat.activityToasts} onDismiss={chat.dismissToast} />

          {chat.loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : chat.messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Nenhuma mensagem ainda. Inicie a conversa!
            </div>
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
                  leadName={lead.name}
                  allMessages={chat.messages}
                  onReply={chat.setReplyTo}
                  onForward={chat.setForwardMsg}
                  onReact={(m, emoji) => chat.handleReact(m, emoji, lead.phone)}
                  onMediaClick={(url, type) => chat.setMediaPreview({ url, type })}
                  onScrollToMessage={chat.scrollToMessage}
                />
              </div>
            );
          })}
          <div ref={chat.messagesEndRef} />
        </div>

        {/* Reply preview */}
        {chat.replyTo && (
          <ChatReplyPreview replyTo={chat.replyTo} leadName={lead.name} onCancel={() => chat.setReplyTo(null)} />
        )}

        {/* Input Area */}
        {id && (
          <ChatInput
            leadId={id}
            leadPhone={lead.phone}
            onLoadTemplates={chat.loadTemplates}
            externalMessage={templateMessage}
            onExternalMessageConsumed={() => setTemplateMessage("")}
            replyTo={chat.replyTo}
            onReplySent={() => chat.setReplyTo(null)}
            onMessageSent={chat.handleOptimisticMessage}
            onMessageError={chat.handleMessageError}
            lastInboundAt={chat.lastInboundAt}
          />
        )}

        {/* Active Bot Badge — bottom-right corner of chat area */}
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

          <LeadEditPanel
            lead={lead}
            onLeadUpdated={(updated) => setLead(updated as any)}
            onLeadDeleted={() => navigate("/crm")}
          />

          <PipelineStageSelector
            stages={chat.stages}
            currentStageId={lead.stage_id}
            onStageChange={handleStageChange}
          />

          {/* Responsible User Assignment */}
          <div className="mt-3">
            <label className="text-xs font-medium text-muted-foreground uppercase mb-1 block">
              <UserRoundCog size={12} className="inline mr-1" />
              Responsável
            </label>
            <Select
              value={lead.assigned_to || "unassigned"}
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

        {/* Inline Tags, Source & Ad Editor */}
        <InlineTagsEditor
          leadId={lead.id}
          tags={lead.tags || []}
          source={lead.source}
          adId={lead.ad_id}
          imagemOrigem={lead.imagem_origem}
          nomeAnuncio={lead.nome_anuncio}
          descricaoAnuncio={lead.descricao_anuncio}
          linkAnuncio={lead.link_anuncio}
          adAccountId={(lead as any).ad_account_id}
          adAccountName={(lead as any).ad_account_name}
          onUpdated={(updates) => setLead((prev) => prev ? { ...prev, ...updates } as Lead : prev)}
        />

        {/* Budget Panel */}
        <LeadBudgetPanel
          lead={lead as any}
          onLeadUpdated={(updates) => setLead((prev) => prev ? { ...prev, ...updates } : prev)}
        />

        {/* Appointment Confirmation */}
        <AppointmentConfirmBar leadId={lead.id} />

        {/* Task Panel */}
        <TaskPanel leadId={lead.id} />

        {/* Response Times */}
        <LeadResponseTimes messages={chat.messages} />

        {/* Stage History Timeline */}
        <LeadStageTimeline
          leadId={lead.id}
          stages={chat.stages}
          lastInboundAt={chat.lastInboundAt}
        />

        {/* Extra Fields (Cidade & Serviço de Interesse) */}
        <LeadExtraFields
          leadId={lead.id}
          cidade={lead.cidade || null}
          servicoInteresse={lead.servico_interesse || null}
          onUpdated={(updates) => setLead((prev) => prev ? { ...prev, ...updates } as Lead : prev)}
        />

        {/* Custom Fields */}
        <LeadCustomFields leadId={lead.id} />

        {/* Follow Up Panel */}
        <LeadFollowUpPanel leadId={lead.id} />

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
        open={!!chat.forwardMsg}
        onOpenChange={(open) => { if (!open) chat.setForwardMsg(null); }}
        messageContent={chat.forwardMsg?.content || null}
        messageType={chat.forwardMsg?.type || "text"}
        fromLeadId={id || ""}
      />

      {/* Templates Sheet */}
      <Sheet open={chat.templatesOpen} onOpenChange={chat.setTemplatesOpen}>
        <SheetContent className="w-[380px] flex flex-col">
          <SheetHeader>
            <SheetTitle>Templates Aprovados</SheetTitle>
          </SheetHeader>
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
            {chat.filteredTemplates.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhum template encontrado.</p>
            )}
            {chat.filteredTemplates.map((t) => (
              <button
                key={t.id}
                onClick={() => handleSendTemplate(t)}
                className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/30 bg-secondary/50 hover:bg-secondary transition-colors"
              >
                <div className="font-medium text-sm text-foreground">{cleanTemplateName(t.name)}</div>
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.body_text}</div>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <ChatMediaPreview mediaPreview={chat.mediaPreview} onClose={() => chat.setMediaPreview(null)} />
    </div>
  );
}
