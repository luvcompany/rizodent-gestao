import { Suspense, lazy, useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cleanTemplateName } from "@/lib/templateUtils";

import ChatInput from "@/components/chat/ChatInput";
import AiSuggestionStrip from "@/components/chat/AiSuggestionStrip";
import ChatActivitySeparator from "@/components/chat/ChatActivitySeparator";
import ChatDateSeparator from "@/components/chat/ChatDateSeparator";
import ChatAccountSeparator from "@/components/chat/ChatAccountSeparator";
import ChatActivityToast from "@/components/chat/ChatActivityToast";
import ChatMessageBubble from "@/components/chat/ChatMessageBubble";
import { parseCallPermissionReply, formatCallPermissionReply } from "@/lib/callPermissionReply";
import ChatMediaPreview from "@/components/chat/ChatMediaPreview";
import ChatReplyPreview from "@/components/chat/ChatReplyPreview";
import ForwardMessageDialog from "@/components/chat/ForwardMessageDialog";
import ConversationInlineNote, { AddInlineNoteButton } from "@/components/chat/ConversationInlineNote";
import { useConversationNotes } from "@/hooks/useConversationNotes";
import NotesBar from "@/components/chat/NotesBar";
import PipelineStageSelector from "@/components/chat/PipelineStageSelector";
import SendToPosvendaButton from "@/components/chat/SendToPosvendaButton";
import { ArrowLeft, FileText, Tag, Search, Bot, Square, Play, Loader2, UserRoundCog, Ban, Copy, Check, Phone, BellRing } from "lucide-react";
import { getLeadChannel } from "@/lib/leadChannel";
import { useWhatsappCall } from "@/contexts/WhatsappCallContext";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

import { useChatConversation } from "@/hooks/useChatConversation";


type Lead = {
  id: string;
  name: string;
  phone: string | null;
  instagram_user_id?: string | null;
  stage_id: string;
  pipeline_id: string;
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
const LeadEditPanel = lazy(() => import("@/components/chat/LeadEditPanel"));
const LeadCustomFields = lazy(() => import("@/components/chat/LeadCustomFields"));
const LeadExtraFields = lazy(() => import("@/components/chat/LeadExtraFields"));
const LeadServiceField = lazy(() => import("@/components/chat/LeadServiceField"));
const LeadStageTimeline = lazy(() => import("@/components/chat/LeadStageTimeline"));
const LeadResponseTimes = lazy(() => import("@/components/chat/LeadResponseTimes"));
const LeadBudgetPanel = lazy(() => import("@/components/chat/LeadBudgetPanel"));
const InlineTagsEditor = lazy(() => import("@/components/chat/InlineTagsEditor"));
const LeadFollowUpPanel = lazy(() => import("@/components/chat/LeadFollowUpPanel"));
const TaskPanel = lazy(() => import("@/components/chat/TaskPanel"));
const LeadAiAssistPanel = lazy(() => import("@/components/chat/LeadAiAssistPanel"));
const AppointmentConfirmBar = lazy(() => import("@/components/chat/AppointmentConfirmBar"));

const SidePanelFallback = () => (
  <div className="space-y-3 p-4">
    <div className="h-20 rounded-lg bg-secondary/60 animate-pulse" />
    <div className="h-24 rounded-lg bg-secondary/40 animate-pulse" />
    <div className="h-24 rounded-lg bg-secondary/40 animate-pulse" />
  </div>
);

export default function CrmConversa() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [lead, setLead] = useState<Lead | null>(null);
  const [templateMessage, setTemplateMessage] = useState("");
  const [newNote, setNewNote] = useState("");
  const [profiles, setProfiles] = useState<{ id: string; nome: string }[]>(() => profilesCacheConv.data || []);
  const [igAccountsMap, setIgAccountsMap] = useState<Record<string, string>>({});

  useEffect(() => {
    supabase
      .from("ig_accounts")
      .select("ig_user_id, username, active")
      .eq("active", true)
      .then(({ data }) => {
        const map: Record<string, string> = {};
        (data ?? []).forEach((a: any) => {
          if (a.ig_user_id && a.username) map[a.ig_user_id] = a.username;
        });
        setIgAccountsMap(map);
      });
  }, []);

  const chat = useChatConversation(id);
  const convNotes = useConversationNotes(id);

  // Fetch lead + profiles in parallel (with profile cache)
  const [leadLoading, setLeadLoading] = useState(true);
  const [phoneCopied, setPhoneCopied] = useState(false);
  const [nameCopied, setNameCopied] = useState(false);
  const { initiateCall, requestCallPermission, state: callState } = useWhatsappCall();


  const copyPhone = async () => {
    if (!lead?.phone) return;
    try {
      const phoneToCopy = lead.phone.replace(/^55/, "");
      await navigator.clipboard.writeText(phoneToCopy);
      setPhoneCopied(true);
      toast.success("Número copiado");
      setTimeout(() => setPhoneCopied(false), 1500);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };
  const copyName = async () => {
    if (!lead?.name) return;
    try {
      await navigator.clipboard.writeText(lead.name);
      setNameCopied(true);
      toast.success("Nome copiado");
      setTimeout(() => setNameCopied(false), 1500);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };
  useEffect(() => {
    if (!id) return;
    setLeadLoading(true);

    const profilesPromise = profilesCacheConv.data && Date.now() - profilesCacheConv.timestamp < PROFILES_CACHE_TTL
      ? Promise.resolve({ data: profilesCacheConv.data })
      : supabase.from("profiles").select("id, nome");

    // Use SECURITY DEFINER RPC to bypass crm_leads RLS for leads in restricted
    // pipelines (e.g. Pós-Venda). Falls back to direct query if RPC unavailable.
    const leadPromise = supabase
      .rpc("get_lead_for_conversation", { _lead_id: id })
      .then(async (res: any) => {
        if (!res.error && res.data && res.data.length > 0) {
          return { data: res.data[0] };
        }
        return await supabase
          .from("crm_leads")
          .select("id, name, phone, instagram_user_id, active_channel, stage_id, pipeline_id, tags, source, value, notes, created_at, updated_at, assigned_to, imagem_origem, titulo_anuncio, descricao_anuncio, link_anuncio, ad_id, nome_anuncio, cidade, servico_interesse, ad_account_id, ad_account_name")
          .eq("id", id)
          .single();
      });

    Promise.all([leadPromise, profilesPromise]).then(([leadRes, profilesRes]) => {
      if (leadRes.data) setLead(leadRes.data as Lead);
      if (profilesRes.data) {
        profilesCacheConv.data = profilesRes.data as any;
        profilesCacheConv.timestamp = Date.now();
        setProfiles(profilesRes.data as any);
      }
      setLeadLoading(false);
    });
  }, [id]);

  // Transfer lead to another user — uses the transfer-lead edge function which
  // automatically moves the lead back to the correct pipeline/stage (e.g. when
  // returning a lead from Pós-Venda to a CRC user it restores the last CRC stage).
  const handleTransferLead = useCallback(async (newUserId: string) => {
    if (!lead || !id) return;
    const oldUserId = lead.assigned_to;
    if (newUserId === oldUserId) return;

    const newUserName = profiles.find(p => p.id === newUserId)?.nome || "?";

    // Optimistic: update assigned_to immediately for instant feedback
    setLead(prev => prev ? { ...prev, assigned_to: newUserId } : prev);
    chat.showActivityToast(`🔄 Lead transferido para ${newUserName}`);
    toast.success(`Lead transferido para ${newUserName}`);

    const { data, error } = await supabase.functions.invoke("transfer-lead", {
      body: { leadId: id, newUserId },
    });

    if (error || data?.error) {
      // Rollback optimistic update
      setLead(prev => prev ? { ...prev, assigned_to: oldUserId } : prev);
      toast.error("Erro ao transferir lead");
      return;
    }

    // If the function moved the lead to another pipeline/stage, update local state
    if (data?.pipeline_id || data?.stage_id) {
      setLead(prev => prev ? {
        ...prev,
        assigned_to: newUserId,
        ...(data.pipeline_id ? { pipeline_id: data.pipeline_id } : {}),
        ...(data.stage_id ? { stage_id: data.stage_id } : {}),
      } : prev);
      if (data.moved_pipeline && data.moved_stage) {
        chat.showActivityToast(`📂 Movido para: ${data.moved_pipeline} • ${data.moved_stage}`);
      }
    }
  }, [lead, id, profiles, chat]);

  const handleStageChange = useCallback(async (stageId: string, pipelineId: string) => {
    if (!lead) return;
    const prevStageId = lead.stage_id;
    await chat.handleStageChange(stageId, prevStageId, (newStageId, newPipelineId) => {
      setLead((prev) => prev ? { ...prev, stage_id: newStageId, pipeline_id: newPipelineId || prev.pipeline_id } : prev);
    }, pipelineId);
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
    const ch: "whatsapp" | "instagram" = getLeadChannel(lead);
    await chat.sendTemplate(template, lead?.phone || null, ch);
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
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="font-semibold text-foreground truncate">{lead.name}</div>
              <button
                type="button"
                onClick={copyName}
                title="Copiar nome"
                aria-label="Copiar nome"
                className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                {nameCopied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
              </button>
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
              {lead.phone && (
                <span className="inline-flex items-center gap-1">
                  <span>{lead.phone}</span>
                  <button
                    type="button"
                    onClick={copyPhone}
                    title="Copiar número"
                    aria-label="Copiar número"
                    className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {phoneCopied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                  </button>
                </span>
              )}
              {currentStage && (
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: currentStage.color }} />
                  {currentStage.name}
                </span>
              )}
            </div>
          </div>
          {/* Ações do lead — ícone compacto + tooltip (ícone+nome no hover) p/ não estourar o header em telas/painéis estreitos */}
          <div className="flex items-center gap-1 shrink-0">
          {getLeadChannel(lead) !== "instagram" && lead.phone && (
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                  disabled={callState.phase !== "idle"}
                  onClick={() =>
                    initiateCall({
                      toPhone: lead.phone!,
                      leadId: lead.id,
                      leadName: lead.name,
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
          {getLeadChannel(lead) !== "instagram" && lead.phone && (
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => requestCallPermission({ toPhone: lead.phone!, leadId: lead.id })}
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
          <AlertDialog>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" aria-label="Bloquear lead">
                    <Ban size={16} />
                  </Button>
                </AlertDialogTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <span className="inline-flex items-center gap-1.5"><Ban size={14} className="text-destructive" /> Bloquear lead</span>
              </TooltipContent>
            </Tooltip>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Bloquear este lead?</AlertDialogTitle>
                <AlertDialogDescription>
                  As mensagens recebidas deste lead serão descartadas e ele não aparecerá mais no Kanban nem na lista de conversas. Você pode desbloqueá-lo depois em Configurações → Bloqueados.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={async () => {
                    if (!id) return;
                    const { error } = await supabase.from("crm_leads").update({
                      is_blocked: true,
                      blocked_at: new Date().toISOString(),
                      blocked_by: user?.id || null,
                    } as any).eq("id", id);
                    if (error) { toast.error("Erro ao bloquear: " + error.message); return; }
                    toast.success("Lead bloqueado");
                    navigate("/crm");
                  }}
                >
                  Bloquear
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
            const prevMsg = idx > 0 ? chat.messages[idx - 1] : null;
            const prevDate = prevMsg ? new Date(prevMsg.created_at) : null;
            const showDateSep = !prevDate || msgDate.toDateString() !== prevDate.toDateString();

            const dateSep = showDateSep ? <ChatDateSeparator key={`date-${msg.id}`} date={msgDate} /> : null;

            // Instagram account separator: shown when the account in use changes
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
                  leadName={lead.name}
                  allMessages={chat.messages}
                  onReply={chat.setReplyTo}
                  onForward={chat.setForwardMsg}
                  onReact={(m, emoji) => chat.handleReact(m, emoji, lead.phone, getLeadChannel(lead))}
                  onMediaClick={(url, type) => chat.setMediaPreview({ url, type })}
                  onScrollToMessage={chat.scrollToMessage}
                  igAccountsMap={igAccountsMap}
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
                  leadId={lead.id}
                  onNoteAdded={convNotes.addNote}
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
          <>
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
            {getLeadChannel(lead) !== "instagram" && (
              <AiSuggestionStrip leadId={id} leadPhone={lead.phone} />
            )}
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
              onMessageSuccess={chat.handleMessageSuccess}
              lastInboundAt={chat.lastInboundAt}
              lastInboundDmAt={chat.lastInboundDmAt}
              channel={getLeadChannel(lead)}
            />
          </>
        )}

      </div>

      {/* RIGHT COLUMN - Lead Panel (30%) */}
      <div className="w-[30%] flex flex-col bg-card overflow-y-auto">
        <Suspense fallback={<SidePanelFallback />}>
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
            <LeadAiAssistPanel leadId={lead.id} leadName={lead.name} />
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

          <LeadServiceField
            leadId={lead.id}
            servicoInteresse={lead.servico_interesse || null}
            onUpdated={(updates) => setLead((prev) => prev ? { ...prev, ...updates } as Lead : prev)}
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

          <SendToPosvendaButton
            leadId={lead.id}
            stageId={lead.stage_id}
            assignedTo={lead.assigned_to}
            stages={chat.stages}
            onTransferred={(payload) => {
              setLead((prev) => prev ? {
                ...prev,
                assigned_to: payload.assigned_to,
                pipeline_id: payload.pipeline_id || prev.pipeline_id,
                stage_id: payload.stage_id || prev.stage_id,
              } : prev);
              chat.fetchMessages(true);
            }}
          />
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
          isInstagram={getLeadChannel(lead) === "instagram"}
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

        {/* Cidade */}
        <LeadExtraFields
          leadId={lead.id}
          cidade={lead.cidade || null}
          onUpdated={(updates) => setLead((prev) => prev ? { ...prev, ...updates } as Lead : prev)}
        />

        {/* Custom Fields */}
        <LeadCustomFields leadId={lead.id} />

        {/* Follow Up Panel */}
        {getLeadChannel(lead) !== "instagram" && <LeadFollowUpPanel leadId={lead.id} />}

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
        </Suspense>
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
