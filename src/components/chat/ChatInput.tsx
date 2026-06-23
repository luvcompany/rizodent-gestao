import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cleanTemplateName, deduplicateTemplates } from "@/lib/templateUtils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Send, Paperclip, FileText, Image, File, Video, X,
  Loader2, Clock, AlertTriangle, Bot, MessageCircle, Reply
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { compressImage } from "./imageCompressor";
import SlashCommandMenu from "./SlashCommandMenu";
import AudioRecorderComposer from "./AudioRecorderComposer";
import EmojiPickerButton from "./EmojiPickerButton";
import { convertAudioBlobToInstagramWav } from "@/lib/audioConverter";

const getInvokeErrorMessage = (data: any, error: any) => {
  if (data?.user_message) return data.user_message;
  if (data?.error) return data.error;
  return error?.message || "Erro ao enviar mensagem";
};

type ReplyMessage = {
  id: string;
  whatsapp_message_id?: string | null;
  content: string | null;
  type: string;
  direction: string;
};

type InstagramMediaKind = "image" | "video" | "audio";
type SendBody = Record<string, unknown>;

type ChatInputProps = {
  leadId: string;
  leadPhone: string | null;
  onLoadTemplates: () => void;
  externalMessage?: string;
  onExternalMessageConsumed?: () => void;
  onMessageSent?: (optimisticMsg: any) => void;
  onMessageError?: (tempId: string) => void;
  onMessageSuccess?: (tempId: string, confirmedMessage?: any) => void;
  replyTo?: ReplyMessage | null;
  onReplySent?: () => void;
  lastInboundAt?: string | null;
  /** For Instagram: timestamp of the last inbound DM specifically (comments don't open the 24h window). */
  lastInboundDmAt?: string | null;
  channel?: "whatsapp" | "instagram";
};

export default function ChatInput({ leadId, leadPhone, onLoadTemplates, externalMessage, onExternalMessageConsumed, onMessageSent, onMessageError, onMessageSuccess, replyTo, onReplySent, lastInboundAt, lastInboundDmAt, channel = "whatsapp" }: ChatInputProps) {
  const isInstagram = channel === "instagram";
  const sendFnName = isInstagram ? "instagram-send-message" : "send-whatsapp-message";

  const buildSendBody = async (params: { type: string; message?: string; media_url?: string; reply?: ReplyMessage | null; replyMode?: "direct" | "comment"; commentTarget?: { comment_id: string; post_id: string | null } | null }): Promise<SendBody> => {
    if (isInstagram) {
      const igType: InstagramMediaKind | undefined = params.type === "text" ? undefined : (params.type === "image" || params.type === "video" || params.type === "audio" ? params.type : undefined);
      const resolvedIgAccountId = await resolveInstagramAccountId();
      if (params.replyMode === "comment" && params.commentTarget?.comment_id) {
        return {
          lead_id: leadId,
          instagram_account_id: resolvedIgAccountId ?? undefined,
          message: params.message,
          message_type: "comment",
          comment_id: params.commentTarget.comment_id,
          post_id: params.commentTarget.post_id ?? undefined,
        };
      }
      return {
        lead_id: leadId,
        instagram_account_id: resolvedIgAccountId ?? undefined,
        message: params.message,
        message_type: igType ?? "dm",
        media_type: igType,
        media_url: params.media_url,
      };
    }
    const body: SendBody = { lead_id: leadId, to: leadPhone, message: params.message, type: params.type, media_url: params.media_url };
    if (params.reply) {
      body.reply_to_message_id = params.reply.id;
      if (params.reply.whatsapp_message_id) body.reply_to_wamid = params.reply.whatsapp_message_id;
    }
    return body;
  };

  const { profile } = useAuth();
  const [newMessage, setNewMessage] = useState(externalMessage || "");
  const [attachedFile, setAttachedFile] = useState<{ file: globalThis.File; type: string } | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [uploading] = useState(false);
  const [botPopoverOpen, setBotPopoverOpen] = useState(false);
  const [bots, setBots] = useState<{ id: string; name: string }[]>([]);
  const [startingBotId, setStartingBotId] = useState<string | null>(null);
  const [recorderActive, setRecorderActive] = useState(false);
  const [igAccountId, setIgAccountId] = useState<string | null>(null);
  const [igAccounts, setIgAccounts] = useState<{ id: string; username: string }[]>([]);
  const [igReplyMode, setIgReplyMode] = useState<"direct" | "comment">("direct");
  const [igCommentTarget, setIgCommentTarget] = useState<{ comment_id: string; post_id: string | null; preview: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resolveInstagramAccountId = useCallback(async () => {
    if (!isInstagram) return null;
    if (igAccountId) return igAccountId;

    const { data } = await supabase
      .from("instagram_messages")
      .select("instagram_account_id")
      .eq("lead_id", leadId)
      .not("instagram_account_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const resolved = (data as { instagram_account_id?: string | null } | null)?.instagram_account_id ?? null;
    if (resolved) setIgAccountId(resolved);
    return resolved;
  }, [isInstagram, igAccountId, leadId]);

  // Resolve Instagram ig_account_id from the LAST INBOUND message of this lead.
  // Re-runs whenever a new inbound arrives (lastInboundAt changes), so the
  // composer always defaults to the profile that received the most recent message.
  useEffect(() => {
    if (!isInstagram || !leadId) {
      setIgAccountId(null);
      return;
    }
    supabase
      .from("instagram_messages")
      .select("instagram_account_id")
      .eq("lead_id", leadId)
      .eq("is_outbound", false)
      .not("instagram_account_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const last = (data as { instagram_account_id?: string | null } | null)?.instagram_account_id ?? null;
        if (last) setIgAccountId(last);
      });
  }, [isInstagram, leadId, lastInboundAt]);

  // Load all active Instagram accounts so the user can choose which one to send from
  useEffect(() => {
    if (!isInstagram) return;
    supabase
      .from("ig_accounts")
      .select("ig_user_id, username, active")
      .eq("active", true)
      .then(({ data }) => {
        const list = (data ?? [])
          .filter((a: any) => a.ig_user_id && a.username)
          .map((a: any) => ({ id: a.ig_user_id as string, username: a.username as string }));
        setIgAccounts(list);
        // If none was resolved from history, default to first available
        setIgAccountId((prev) => prev ?? list[0]?.id ?? null);
      });
  }, [isInstagram]);

  // Reset Instagram reply mode/comment target when switching leads
  useEffect(() => {
    setIgReplyMode("direct");
    setIgCommentTarget(null);
  }, [leadId]);

  // Listen for "Responder este comentário" clicks on bubbles
  useEffect(() => {
    if (!isInstagram) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { comment_id?: string; post_id?: string | null; preview?: string } | undefined;
      if (!detail?.comment_id) return;
      setIgCommentTarget({
        comment_id: detail.comment_id,
        post_id: detail.post_id ?? null,
        preview: detail.preview ?? "",
      });
      setIgReplyMode("comment");
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    window.addEventListener("ig:set-comment-target", handler);
    return () => window.removeEventListener("ig:set-comment-target", handler);
  }, [isInstagram]);

  // Fetch published bots
  useEffect(() => {
    supabase
      .from("bots")
      .select("id, name")
      .eq("status", "published")
      .order("name")
      .then(({ data }) => { if (data) setBots(data); });
  }, []);

  const handleStartBot = (botId: string) => {
    setStartingBotId(botId);
    setBotPopoverOpen(false);

    void supabase.functions.invoke("bot-engine", {
      body: { leadId, botId, trigger: "manual_start" },
    }).then(({ data, error }) => {
      if (error || data?.error) {
        throw error || new Error(data?.error || "Erro ao iniciar bot");
      }
      toast.success("Bot iniciado!");
    }).catch((err: any) => {
      toast.error(err.message || "Erro ao iniciar bot");
    }).finally(() => {
      setStartingBotId(null);
    });
  };

  // Slash commands
  const [slashActive, setSlashActive] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashTemplates, setSlashTemplates] = useState<any[]>([]);

  useEffect(() => {
    const loadSlashData = async () => {
      const { data: t } = await supabase.from("crm_whatsapp_templates").select("id, name, body_text, category").eq("status", "APPROVED").order("created_at", { ascending: false });
      setSlashTemplates(deduplicateTemplates(t || []));
    };
    loadSlashData();
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [newMessage]);

  useEffect(() => {
    if (externalMessage) {
      setNewMessage(externalMessage);
      onExternalMessageConsumed?.();
    }
  }, [externalMessage, onExternalMessageConsumed]);

  const uploadFile = async (file: globalThis.File, folder: string, contentType?: string): Promise<string | null> => {
    const ext = file.name.split(".").pop() || "bin";
    const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("chat-media").upload(path, file, {
      contentType: contentType || file.type || undefined,
    });
    if (error) {
      toast.error(`Erro ao fazer upload: ${error.message}`);
      return null;
    }
    const { data } = await supabase.storage.from("chat-media").createSignedUrl(path, 3600);
    return data?.signedUrl || null;
  };

  const getMessageType = (file: globalThis.File): string => {
    const lowerName = file.name.toLowerCase();
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("audio/")) return "audio";
    if (file.type.startsWith("video/")) return "video";
    if (/\.(ogg|opus|mp3|m4a|aac|wav|webm|amr)$/i.test(lowerName)) return "audio";
    return "document";
  };

  const handleSendMessage = async () => {
    if ((!newMessage.trim() && !attachedFile) || (!leadPhone && !isInstagram)) return;

    // Block if 24h window expired (WhatsApp only — IG has its own 24h logic but no template fallback)
    if (!isInstagram && windowInfo.expired) {
      toast.error("Janela de 24h expirada. Use um template para reabrir a conversa.");
      return;
    }

    let type = "text";
    let rawMessage = newMessage.trim();
    // Prepend signature if enabled
    const sigEnabled = profile?.signature_enabled && profile?.nome;
    let message = sigEnabled ? `*${profile.nome}:*\n${rawMessage}` : rawMessage;
    let fileToUpload = attachedFile?.file;
    const originalFileName = attachedFile?.file.name;

    // Clear input immediately for optimistic UX
    const currentReplyTo = replyTo;
    setNewMessage("");
    onReplySent?.();

    if (attachedFile && fileToUpload) {
      type = attachedFile.type;
      setAttachedFile(null);

      // Create optimistic message immediately with blob URL
      const blobUrl = URL.createObjectURL(fileToUpload);
      const tempId = crypto.randomUUID();
      const optimisticMsg = {
        id: tempId,
        lead_id: leadId,
        direction: "outbound",
        type,
        content: message || (type === "document" ? originalFileName : null) || null,
        media_url: blobUrl,
        status: "sending",
        created_at: new Date().toISOString(),
        whatsapp_message_id: null,
        reply_to_message_id: currentReplyTo?.id || null,
      };
      onMessageSent?.(optimisticMsg);

      // Upload and send in background (non-blocking)
      (async () => {
        try {
          // Compress images if needed
          if (type === "image") {
            try { fileToUpload = await compressImage(fileToUpload!); } catch {}
          }
          if (isInstagram && type === "audio") {
            const wavBlob = await convertAudioBlobToInstagramWav(fileToUpload!);
            fileToUpload = new globalThis.File([wavBlob], `audio_${Date.now()}.wav`, { type: "audio/wav" });
          }

          const url = await uploadFile(fileToUpload!, type);
          if (!url) { URL.revokeObjectURL(blobUrl); onMessageError?.(tempId); return; }

          const body = await buildSendBody({ type, message: message || undefined, media_url: url, reply: currentReplyTo, replyMode: igReplyMode, commentTarget: igCommentTarget });

          const { data, error } = await supabase.functions.invoke(sendFnName, { body });
          URL.revokeObjectURL(blobUrl);
          if (error || data?.error || data?.ok === false) {
            if (data?.message) {
              onMessageSuccess?.(tempId, data.message);
            } else {
              onMessageError?.(tempId);
            }
            toast.error(getInvokeErrorMessage(data, error));
          } else {
            onMessageSuccess?.(tempId, data?.message);
          }
        } catch (err: any) {
          URL.revokeObjectURL(blobUrl);
          onMessageError?.(tempId);
          toast.error(`Erro inesperado: ${err.message}`);
        }
      })();
      return;
    }

    if (type === "text" && !message) return;

    // Text-only optimistic message
    const tempId = crypto.randomUUID();
    const optimisticMsg = {
      id: tempId,
      lead_id: leadId,
      direction: "outbound",
      type,
      content: message || null,
      media_url: null,
      status: "sending",
      created_at: new Date().toISOString(),
      whatsapp_message_id: null,
      reply_to_message_id: currentReplyTo?.id || null,
    };
    onMessageSent?.(optimisticMsg);

    // Send in background
    const body = await buildSendBody({ type, message: message || undefined, reply: currentReplyTo, replyMode: igReplyMode, commentTarget: igCommentTarget });

    try {
      const { data, error } = await supabase.functions.invoke(sendFnName, { body });
      if (error || data?.error || data?.ok === false) {
        if (data?.message) {
          onMessageSuccess?.(tempId, data.message);
        } else {
          onMessageError?.(tempId);
        }
        toast.error(getInvokeErrorMessage(data, error));
      } else {
        onMessageSuccess?.(tempId, data?.message);
      }
    } catch (err: any) {
      onMessageError?.(tempId);
      toast.error(`Erro inesperado: ${err.message}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleFileSelect = (accept: string) => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept;
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const type = getMessageType(file);

    if (type === "audio" && file.size > 15 * 1024 * 1024) {
      toast.warning("Áudio muito longo. Considere enviar em partes menores.");
      return;
    }

    if (type === "document" && file.size > 100 * 1024 * 1024) {
      toast.error("Documento muito grande. Máximo: 100MB");
      return;
    }

    if (file.type === "image/webp" && file.size < 512 * 1024) {
      setAttachedFile({ file, type: "sticker" });
      return;
    }

    if (type === "image" && file.size > 4 * 1024 * 1024) {
      setOptimizing(true);
      try {
        const compressed = await compressImage(file);
        setAttachedFile({ file: compressed, type });
        const saved = ((file.size - compressed.size) / 1024 / 1024).toFixed(1);
        toast.success(`Imagem otimizada (${saved}MB reduzidos)`);
      } catch {
        toast.error("Erro ao otimizar imagem");
        setAttachedFile({ file, type });
      } finally {
        setOptimizing(false);
      }
      return;
    }

    setAttachedFile({ file, type });
  };

  // 24h window logic
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  const windowInfo = useMemo(() => {
    if (!lastInboundAt) return { expired: true, remaining: "" };
    const inboundTime = new Date(lastInboundAt).getTime();
    const expiresAt = inboundTime + 24 * 60 * 60 * 1000;
    const diff = expiresAt - now;
    if (diff <= 0) return { expired: true, remaining: "" };
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return { expired: false, remaining: `${hours}h ${mins.toString().padStart(2, "0")}m` };
  }, [lastInboundAt, now]);

  // Instagram DM window: only actual DMs (not comments) keep the 24h window open.
  const igDmWindowInfo = useMemo(() => {
    if (!isInstagram) return { expired: false, remaining: "" };
    if (!lastInboundDmAt) return { expired: true, remaining: "" };
    const dmTime = new Date(lastInboundDmAt).getTime();
    const expiresAt = dmTime + 24 * 60 * 60 * 1000;
    const diff = expiresAt - now;
    if (diff <= 0) return { expired: true, remaining: "" };
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return { expired: false, remaining: `${hours}h ${mins.toString().padStart(2, "0")}m` };
  }, [isInstagram, lastInboundDmAt, now]);

  const isWindowExpired = windowInfo.expired;

  const sendRecordedAudio = useCallback(async (oggBlob: Blob) => {
    if (!leadPhone && !isInstagram) {
      toast.error("Lead sem telefone para envio do áudio");
      throw new Error("Lead sem telefone");
    }

    if (!isInstagram && windowInfo.expired) {
      toast.error("Janela de 24h expirada. Use um template para reabrir a conversa.");
      throw new Error("Janela expirada");
    }

    let uploadBlob: Blob;
    try {
      uploadBlob = isInstagram ? await convertAudioBlobToInstagramWav(oggBlob) : oggBlob;
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Não foi possível preparar o áudio para o Instagram");
      throw err;
    }

    // Pick a sensible extension/content-type from the upload blob's mime.
    const rawType = (oggBlob.type || "").toLowerCase();
    let ext = "ogg";
    let contentType = rawType || "audio/ogg";
    if (isInstagram) {
      ext = "wav";
      contentType = "audio/wav";
    } else if (rawType.includes("mp4") || rawType.includes("aac") || rawType.includes("m4a")) {
      ext = "m4a";
      contentType = "audio/mp4";
    } else if (rawType.includes("mpeg") || rawType.includes("mp3")) {
      ext = "mp3";
      contentType = "audio/mpeg";
    } else if (rawType.includes("wav")) {
      ext = "wav";
      contentType = "audio/wav";
    } else if (rawType.includes("webm")) {
      ext = "webm";
      contentType = "audio/webm";
    } else if (rawType.includes("ogg")) {
      ext = "ogg";
      contentType = "audio/ogg";
    }

    const audioFile = new globalThis.File(
      [uploadBlob],
      `audio_${Date.now()}.${ext}`,
      { type: contentType }
    );
    const uploadContentType = contentType;

    const tempId = crypto.randomUUID();
    const optimisticUrl = URL.createObjectURL(oggBlob);

    onMessageSent?.({
      id: tempId,
      lead_id: leadId,
      direction: "outbound",
      type: "audio",
      content: null,
      media_url: optimisticUrl,
      status: "sending",
      created_at: new Date().toISOString(),
      whatsapp_message_id: null,
      reply_to_message_id: null,
    });

    try {
      console.log(`[ChatInput] Sending audio: size=${audioFile.size}, type=${audioFile.type}`);

      const url = await uploadFile(audioFile, "audio", uploadContentType);
      if (!url) {
        URL.revokeObjectURL(optimisticUrl);
        onMessageError?.(tempId);
        toast.error("Falha no upload do áudio");
        return;
      }

      const resolvedIgAccountId = isInstagram ? await resolveInstagramAccountId() : null;
      const audioBody = isInstagram
        ? { lead_id: leadId, instagram_account_id: resolvedIgAccountId ?? undefined, message_type: "audio" as const, media_type: "audio" as const, media_url: url }
        : { lead_id: leadId, to: leadPhone, type: "audio", media_url: url, audio_voice: true };

      const { data, error } = await supabase.functions.invoke(sendFnName, { body: audioBody });

      URL.revokeObjectURL(optimisticUrl);
      if (error || data?.error || data?.ok === false) {
        if (data?.message) {
          onMessageSuccess?.(tempId, data.message);
        } else {
          onMessageError?.(tempId);
        }
        toast.error(data?.error || error?.message || "Erro ao enviar áudio");
        return;
      }

      onMessageSuccess?.(tempId, data?.message);
    } catch (err: any) {
      URL.revokeObjectURL(optimisticUrl);
      onMessageError?.(tempId);
      toast.error(err?.message || "Erro ao enviar áudio");
    }
  }, [leadId, leadPhone, windowInfo.expired, onMessageSent, onMessageError, onMessageSuccess, isInstagram, sendFnName, resolveInstagramAccountId]);

  return (
    <div className="flex-shrink-0 bg-card border-t border-border px-4 py-3">
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />

      {/* Optimizing/uploading indicator */}
      {(optimizing || uploading) && (
        <div className="flex items-center gap-2 mb-2 bg-primary/10 rounded-lg px-3 py-2 text-sm text-primary">
          <Loader2 size={16} className="animate-spin" />
          <span>{optimizing ? "Otimizando arquivo..." : "Enviando arquivo..."}</span>
        </div>
      )}

      {/* Attached file preview */}
      {attachedFile && !optimizing && (
        <div className="flex items-center gap-2 mb-2 bg-secondary rounded-lg px-3 py-2 text-sm">
          {attachedFile.type === "image" ? <Image size={16} className="text-primary" /> :
           attachedFile.type === "video" ? <Video size={16} className="text-primary" /> :
           attachedFile.type === "sticker" ? <span className="text-lg">🎨</span> :
           <File size={16} className="text-primary" />}
          <span className="flex-1 truncate text-foreground">
            {attachedFile.file.name}
            <span className="text-muted-foreground ml-1">
              ({(attachedFile.file.size / 1024 / 1024).toFixed(1)}MB)
            </span>
          </span>
          <button onClick={() => setAttachedFile(null)} className="text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Expired window state */}
      {isWindowExpired && !isInstagram ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 bg-destructive/10 rounded-lg px-3 py-2.5 text-sm text-destructive">
            <AlertTriangle size={16} className="flex-shrink-0" />
            <span className="flex-1">A sessão de 24h expirou. Envie um template para reabrir a conversa.</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Sessão expirada — use um template"
                className="pr-10 bg-secondary border-border opacity-50 min-h-[40px] max-h-[40px] resize-none py-2"
                disabled
                rows={1}
              />
            </div>
            {!isInstagram && (
              <Button size="sm" variant="outline" onClick={onLoadTemplates} className="gap-1.5">
                <FileText size={16} />
                Enviar Template
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
        {isInstagram && (
          <div className="flex items-center gap-2 mb-2">
            <div className="inline-flex rounded-md border border-border bg-secondary p-0.5">
              <button
                type="button"
                onClick={() => setIgReplyMode("direct")}
                className={`text-xs px-2.5 py-1 rounded inline-flex items-center gap-1 transition-colors ${igReplyMode === "direct" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Send size={12} /> Direct
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!igCommentTarget) {
                    toast.info("Clique em \"Responder comentário\" numa bolha de comentário para escolher qual responder.");
                    return;
                  }
                  setIgReplyMode("comment");
                }}
                disabled={!igCommentTarget}
                className={`text-xs px-2.5 py-1 rounded inline-flex items-center gap-1 transition-colors ${igReplyMode === "comment" ? "bg-purple-500/15 text-purple-700 dark:text-purple-300" : "text-muted-foreground hover:text-foreground"} disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <MessageCircle size={12} /> Comentário
              </button>
            </div>
            {igAccounts.length > 0 && (
              <Select value={igAccountId ?? ""} onValueChange={(v) => setIgAccountId(v)}>
                <SelectTrigger className="h-7 text-xs w-auto min-w-[140px] gap-1">
                  <SelectValue placeholder="Conta IG" />
                </SelectTrigger>
                <SelectContent>
                  {igAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">@{a.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {igReplyMode === "comment" && igCommentTarget && (
              <div className="flex-1 min-w-0 flex items-center gap-1.5 text-[11px] text-muted-foreground bg-purple-500/5 border border-purple-500/20 rounded px-2 py-1">
                <Reply size={11} className="text-purple-500 flex-shrink-0" />
                <span className="truncate">Respondendo: {igCommentTarget.preview || "(sem texto)"}</span>
                <button
                  type="button"
                  onClick={() => { setIgReplyMode("direct"); setIgCommentTarget(null); }}
                  className="ml-auto p-0.5 hover:text-foreground flex-shrink-0"
                >
                  <X size={11} />
                </button>
              </div>
            )}
          </div>
        )}
        {/* Instagram DM 24h window warning */}
        {isInstagram && igReplyMode === "direct" && igDmWindowInfo.expired && (
          <div className="flex items-start gap-2 mb-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <span>
              <strong>Janela de DM expirada.</strong> O Instagram só permite enviar Direct enquanto o usuário enviou um DM nas últimas 24h.
              {igCommentTarget ? " Use a aba Comentário para responder." : " Aguarde o usuário enviar uma nova mensagem."}
            </span>
          </div>
        )}
        <div className="flex items-end gap-2">
          {/* Hide normal controls when recorder is active, but NEVER unmount the recorder */}
          {!recorderActive && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-2 text-muted-foreground hover:text-primary transition-colors" disabled={optimizing || uploading}>
                    <Paperclip size={20} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => handleFileSelect("image/*")}>
                    <Image size={16} className="mr-2" /> Imagem
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleFileSelect("video/*")}>
                    <Video size={16} className="mr-2" /> Vídeo
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleFileSelect(".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv")}>
                    <File size={16} className="mr-2" /> Documento
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleFileSelect("image/webp")}>
                    <span className="mr-2 text-base">🎨</span> Figurinha (WebP)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="flex-1 relative">
                <SlashCommandMenu
                  query={slashQuery}
                  templates={slashTemplates}
                  bots={[]}
                  visible={slashActive}
                  onSelectTemplate={(t) => {
                    setNewMessage(`[Template: ${t.name}]`);
                    setSlashActive(false);
                    toast.info(`Template "${cleanTemplateName(t.name)}" selecionado. Pressione Enter para enviar.`);
                  }}
                  onSelectBot={() => {}}
                  onClose={() => setSlashActive(false)}
                />
                <Textarea
                  ref={textareaRef}
                  value={newMessage}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewMessage(val);
                    if (val.startsWith("/")) {
                      setSlashActive(true);
                      setSlashQuery(val.slice(1));
                    } else {
                      setSlashActive(false);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (slashActive && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                      e.preventDefault();
                      return;
                    }
                    handleKeyDown(e);
                  }}
                  placeholder="Digite / para atalhos ou uma mensagem..."
                  className="bg-secondary border-border min-h-[40px] max-h-[120px] resize-none py-2"
                  disabled={optimizing || uploading}
                  rows={1}
                />
              </div>

              <EmojiPickerButton
                disabled={optimizing || uploading}
                onEmojiSelect={(emoji) => setNewMessage((prev) => prev + emoji)}
              />

              {!isInstagram && (
                <button onClick={onLoadTemplates} className="p-2 text-muted-foreground hover:text-primary transition-colors" title="Templates">
                  <FileText size={20} />
                </button>
              )}

              <Popover open={botPopoverOpen} onOpenChange={setBotPopoverOpen}>
                <PopoverTrigger asChild>
                  <button className="p-2 text-muted-foreground hover:text-primary transition-colors" title="Iniciar Bot">
                    <Bot size={20} />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" sideOffset={8} className="w-64 p-2">
                  <p className="text-xs font-medium text-muted-foreground px-2 mb-1">Iniciar Bot</p>
                  {bots.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-2 py-3">Nenhum bot publicado</p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-0.5">
                      {bots.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => handleStartBot(b.id)}
                          disabled={startingBotId === b.id}
                          className="flex w-full items-center rounded-md px-3 py-2 text-sm text-left hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          {startingBotId === b.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Bot className="mr-2 h-4 w-4 text-muted-foreground" />
                          )}
                          {b.name}
                        </button>
                      ))}
                    </div>
                  )}
                </PopoverContent>
              </Popover>

              {(newMessage.trim() || attachedFile) && (
                <Button size="icon" onClick={handleSendMessage} disabled={optimizing || uploading}>
                  <Send size={18} />
                </Button>
              )}
            </>
          )}

          {/* Single stable recorder instance — never unmounts during recording */}
          <AudioRecorderComposer
            disabled={optimizing || uploading}
            onSendAudio={sendRecordedAudio}
            onModeChange={setRecorderActive}
            showMicButton={!newMessage.trim() && !attachedFile}
            preferredMimeTypes={isInstagram ? ["audio/mp4", "audio/mp4;codecs=mp4a.40.2", "audio/wav"] : undefined}
          />
        </div>
        </>
      )}

      {/* 24h window countdown (WhatsApp only) */}
      {!isInstagram && !isWindowExpired && lastInboundAt && (
        <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
          <Clock size={12} />
          <span>A sessão de mensagens termina em: <span className="font-medium text-foreground">{windowInfo.remaining}</span></span>
        </div>
      )}
    </div>
  );
}
