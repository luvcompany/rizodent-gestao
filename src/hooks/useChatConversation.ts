import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { deduplicateTemplates } from "@/lib/templateUtils";
import { supabase } from "@/integrations/supabase/client";
import { executeStageAutomations } from "@/lib/automationUtils";
import { toast } from "sonner";
import { batchSignMediaUrls } from "@/lib/mediaUtils";
import { useTenant } from "@/contexts/TenantContext";

// Global message cache to avoid re-fetching when switching between leads
const messageCache = new Map<string, { messages: any[]; timestamp: number }>();
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

export function useChatConversation(leadId: string | null | undefined) {
  const { tenant } = useTenant();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stages, setStages] = useState<ChatStage[]>([]);
  const [loading, setLoading] = useState(true);

  // Reply & Forward
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null);

  // Media preview
  const [mediaPreview, setMediaPreview] = useState<{ url: string; type: "image" | "video" } | null>(null);

  // Templates
  const [templates, setTemplates] = useState<any[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");

  // Activity toasts
  const [activityToasts, setActivityToasts] = useState<ActivityToast[]>([]);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const initialLoadDone = useRef(false);
  const activeLeadRef = useRef<string | null>(leadId ?? null);
  const fetchRequestRef = useRef(0);

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
  const fetchMessages = useCallback(async (skipCache = false) => {
    const targetLeadId = leadId;
    if (!targetLeadId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    const requestId = ++fetchRequestRef.current;
    const isCurrentRequest = () => activeLeadRef.current === targetLeadId && fetchRequestRef.current === requestId;
    const applyMessages = (nextMessages: ChatMessage[]) => {
      if (!isCurrentRequest()) return false;
      setMessages(nextMessages);
      setLoading(false);
      return true;
    };

    // Serve from cache instantly if available and fresh
    if (!skipCache) {
      const cached = messageCache.get(targetLeadId);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        applyMessages(cached.messages as ChatMessage[]);
        // Only refresh in background if cache is stale (>30s) to avoid wasting bandwidth
        if (Date.now() - cached.timestamp < 30_000) return;
        supabase.from("messages").select("*").eq("lead_id", targetLeadId).order("created_at", { ascending: true }).then(({ data }) => {
          if (data) {
            const nextMessages = (data as unknown as ChatMessage[]).map(normalizeOutboundStatus);
            messageCache.set(targetLeadId, { messages: nextMessages, timestamp: Date.now() });
            applyMessages(nextMessages);
          }
        });
        return;
      }
    }

    setLoading(true);
    try {
      const { data } = await supabase.from("messages").select("*").eq("lead_id", targetLeadId).order("created_at", { ascending: true });
      const msgs = ((data as unknown as ChatMessage[]) || []).map(normalizeOutboundStatus);
      messageCache.set(targetLeadId, { messages: msgs, timestamp: Date.now() });
      applyMessages(msgs);
      // Media URLs are signed on-demand by ChatMessageContent's useSignedUrl, no upfront batch needed.
    } catch (err) {
      console.error("[useChatConversation] Fetch error:", err);
      if (isCurrentRequest()) setLoading(false);
    }
  }, [leadId]);


  useEffect(() => { fetchMessages(); fetchStages(); }, [fetchMessages, fetchStages]);

  useEffect(() => {
    activeLeadRef.current = leadId ?? null;
    initialLoadDone.current = false;
    setReplyTo(null);
    setForwardMsg(null);
    setMediaPreview(null);
    setActivityToasts([]);

    if (!leadId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    const cached = messageCache.get(leadId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setMessages(cached.messages as ChatMessage[]);
      setLoading(false);
      return;
    }

    setMessages([]);
    setLoading(true);
  }, [leadId]);

  // ─── Repair legacy media (deferred, non-blocking) ───
  useEffect(() => {
    if (!leadId || repairedMediaLeadCache.has(leadId)) return;
    const timer = setTimeout(async () => {
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
    }, 3000); // Defer 3s to not block initial render
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
          // Find optimistic message to replace: must be outbound, not yet confirmed (no whatsapp_message_id),
          // and still in a transient status. Match by type loosely (audio/template may differ).
          const optimisticIdx = newMsg.direction === "outbound"
            ? prev.findIndex((m) =>
                m.direction === "outbound" &&
                !m.whatsapp_message_id &&
                !CONFIRMED_STATUSES.has(m.status) &&
                // Loose type match: text↔text, audio↔audio, template↔template, image↔image, etc.
                (m.type === newMsg.type || (m.type === "text" && newMsg.type === "text"))
              )
            : -1;
          if (optimisticIdx >= 0) {
            const updated = [...prev];
            updated[optimisticIdx] = newMsg;
            messageCache.set(targetLeadId, { messages: updated, timestamp: Date.now() });
            return updated;
          }
          const updated = [...prev, newMsg];
          messageCache.set(targetLeadId, { messages: updated, timestamp: Date.now() });
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
          messageCache.set(targetLeadId, { messages: updated, timestamp: Date.now() });
          return updated;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [leadId]);

  // ─── Polling fallback (very infrequent, realtime handles most updates) ───
  useEffect(() => {
    const targetLeadId = leadId;
    if (!targetLeadId) return;

    const interval = setInterval(async () => {
      if (activeLeadRef.current !== targetLeadId) return;
      const { data } = await supabase.from("messages").select("*").eq("lead_id", targetLeadId).order("created_at", { ascending: true });
      if (data && activeLeadRef.current === targetLeadId) {
        const nextMessages = (data as unknown as ChatMessage[]).map(normalizeOutboundStatus);
        setMessages((prev) => {
          if (activeLeadRef.current !== targetLeadId) return prev;
          if (nextMessages.length !== prev.length || nextMessages.some((message, index) => message.id !== prev[index]?.id || message.status !== prev[index]?.status)) {
            messageCache.set(targetLeadId, { messages: nextMessages, timestamp: Date.now() });
            return nextMessages;
          }
          return prev;
        });
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [leadId]);

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
  const handleStageChange = useCallback(async (newStageId: string, currentStageId: string, onSuccess?: (stageId: string, pipelineId?: string) => void, newPipelineId?: string) => {
    if (!leadId) return;

    const updatePayload: { stage_id: string; updated_at: string; pipeline_id?: string } = { stage_id: newStageId, updated_at: new Date().toISOString() };
    if (newPipelineId) updatePayload.pipeline_id = newPipelineId;

    const { error } = await supabase.from("crm_leads").update(updatePayload).eq("id", leadId);
    if (error) { toast.error("Erro ao mover lead"); return; }

    // Close previous stage history entry
    const { data: openEntry } = await supabase
      .from("crm_lead_stage_history")
      .select("id")
      .eq("lead_id", leadId)
      .eq("stage_id", currentStageId)
      .is("exited_at", null)
      .maybeSingle();

    if (openEntry) {
      await supabase.from("crm_lead_stage_history").update({ exited_at: new Date().toISOString() }).eq("id", openEntry.id);
    }

    // Insert new stage history entry (with from_stage_id)
    await supabase.from("crm_lead_stage_history").insert({
      lead_id: leadId,
      stage_id: newStageId,
      from_stage_id: currentStageId,
      entered_at: new Date().toISOString(),
    } as any);

    // Insert system message
    const fromName = stages.find(s => s.id === currentStageId)?.name || "?";
    const toName = stages.find(s => s.id === newStageId)?.name || "?";
    const systemContent = `📋 Etapa alterada: ${fromName} → ${toName}`;
    await supabase.from("messages").insert({
      lead_id: leadId,
      direction: "outbound",
      type: "system",
      content: systemContent,
      status: "system",
    });

    showActivityToast(`📋 Lead movido para ${toName}`);

    // Execute automations for the new stage (on_enter + on_create_or_enter)
    executeStageAutomations({
      leadId,
      stageId: newStageId,
      triggerTypes: ["on_enter", "on_create_or_enter"],
    });

    onSuccess?.(newStageId, newPipelineId);
    toast.success("Etapa atualizada");
  }, [leadId, stages, showActivityToast]);

  // ─── Reactions ───
  const handleReact = useCallback(async (msg: ChatMessage, emoji: string, leadPhone: string | null, channel: "whatsapp" | "instagram" = "whatsapp") => {
    if (channel === "instagram") {
      toast.info("Reações ainda não são suportadas no Instagram Direct");
      return;
    }
    if (!leadPhone) { toast.error("Lead sem telefone"); return; }

    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msg.id) return m;
        const existing = Array.isArray(m.reactions) ? m.reactions : [];
        const filtered = existing.filter((r) => r.from !== "me");
        return { ...m, reactions: [...filtered, { emoji, from: "me" }] };
      })
    );

    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp-message", {
        body: {
          lead_id: leadId,
          to: leadPhone,
          type: "reaction",
          reaction_emoji: emoji,
          reaction_to_message_id: msg.id,
        },
      });
      if (error || data?.error) toast.error("Erro ao enviar reação");
    } catch {
      toast.error("Erro ao enviar reação");
    }
  }, [leadId]);

  // ─── Optimistic message handling ───
  const handleOptimisticMessage = useCallback((optimisticMsg: any) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === optimisticMsg.id)) return prev;
      const updated = [...prev, optimisticMsg];
      const currentLeadId = activeLeadRef.current;
      if (currentLeadId) messageCache.set(currentLeadId, { messages: updated, timestamp: Date.now() });
      return updated;
    });
  }, []);

  const handleMessageError = useCallback((tempId: string) => {
    setMessages((prev) => {
      const updated = prev.map((m) => m.id === tempId ? { ...m, status: "error" } : m);
      const currentLeadId = activeLeadRef.current;
      if (currentLeadId) messageCache.set(currentLeadId, { messages: updated, timestamp: Date.now() });
      return updated;
    });
  }, []);

  const handleMessageSuccess = useCallback((tempId: string, confirmedMessage?: ChatMessage) => {
    setMessages((prev) => {
      const normalizedConfirmed = confirmedMessage ? normalizeOutboundStatus(confirmedMessage) : null;
      const updated = prev.map((m) => {
        if (m.id !== tempId) return m;
        if (normalizedConfirmed) return normalizedConfirmed;
        return m;
      });

      const currentLeadId = activeLeadRef.current;
      if (currentLeadId) messageCache.set(currentLeadId, { messages: updated, timestamp: Date.now() });
      return updated;
    });
  }, []);

  // ─── Templates ───
  const loadTemplates = useCallback(async () => {
    if (!tenant.id) return;
    const { data } = await supabase.from("crm_whatsapp_templates").select("*").eq("tenant_id", tenant.id).eq("status", "APPROVED").order("created_at", { ascending: false });
    setTemplates(deduplicateTemplates(data || []));
    setTemplatesOpen(true);
  }, [tenant.id]);

  const sendTemplate = useCallback(async (template: any, leadPhone: string | null, channel: "whatsapp" | "instagram" = "whatsapp") => {
    if (channel === "instagram") {
      toast.error("Templates só estão disponíveis no WhatsApp");
      return;
    }
    if (!leadPhone) { toast.error("Lead sem telefone configurado"); return; }
    setTemplatesOpen(false);

    // Optimistic: show template message instantly
    const tempId = crypto.randomUUID();
    const optimisticMsg: ChatMessage = {
      id: tempId,
      lead_id: leadId!,
      direction: "outbound",
      // Backend salva template como type "text" com prefixo "📋 Template:" no content,
      // então a mensagem otimista precisa espelhar exatamente esse formato para que a
      // reconciliação via realtime substitua (em vez de mostrar duas bubbles).
      type: "text",
      content: `📋 Template: ${template.name}`,
      media_url: null,
      status: "sending",
      created_at: new Date().toISOString(),
      whatsapp_message_id: null,
      reply_to_message_id: null,
    };
    handleOptimisticMessage(optimisticMsg);

    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp-message", {
        body: {
          lead_id: leadId,
          to: leadPhone,
          type: "template",
          template_name: template.name,
          template_language: template.language,
        },
      });
      if (error || data?.error) {
        handleMessageError(tempId);
        toast.error("Erro ao enviar template");
        return;
      }
      handleMessageSuccess(tempId);
      toast.success("Template enviado");
    } catch {
      handleMessageError(tempId);
      toast.error("Erro inesperado ao enviar template");
    }
  }, [leadId, handleOptimisticMessage, handleMessageError, handleMessageSuccess]);

  // ─── Notes ───
  const saveNotes = useCallback(async (updatedNotes: string) => {
    if (!leadId) return;
    const { error } = await supabase.from("crm_leads").update({ notes: updatedNotes }).eq("id", leadId);
    if (error) toast.error("Erro ao salvar nota");
    return !error;
  }, [leadId]);

  const addNote = useCallback(async (noteText: string, currentNotes: string | null) => {
    if (!noteText.trim()) return;
    const timestamp = new Date().toLocaleString("pt-BR");
    const updatedNotes = `${currentNotes || ""}\n[${timestamp}] ${noteText.trim()}`.trim();
    return saveNotes(updatedNotes);
  }, [saveNotes]);


  // ─── Helpers ───
  const isSystemMessage = useCallback((msg: ChatMessage) => msg.type === "system" || msg.status === "system", []);

  const deleteSystemMessage = useCallback(async (messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    const { error } = await supabase.from("messages").delete().eq("id", messageId);
    if (error) {
      toast.error("Erro ao excluir confirmação");
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
    lastInboundDmAt,

    // Refs
    messagesEndRef,
    messageRefs,

    // Setters
    setReplyTo,
    setForwardMsg,
    setMediaPreview,
    setTemplatesOpen,
    setTemplateSearch,

    // Actions
    fetchMessages,
    scrollToBottom,
    scrollToMessage,
    handleStageChange,
    handleReact,
    loadTemplates,
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
