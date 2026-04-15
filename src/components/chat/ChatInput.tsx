import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cleanTemplateName, deduplicateTemplates } from "@/lib/templateUtils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Send, Paperclip, Mic, FileText, Image, File, Video,
  Square, X, Loader2, Clock, AlertTriangle, Pause, Play, Bot
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

type ReplyMessage = {
  id: string;
  whatsapp_message_id?: string | null;
  content: string | null;
  type: string;
  direction: string;
};

type ChatInputProps = {
  leadId: string;
  leadPhone: string | null;
  onLoadTemplates: () => void;
  externalMessage?: string;
  onExternalMessageConsumed?: () => void;
  onMessageSent?: (optimisticMsg: any) => void;
  onMessageError?: (tempId: string) => void;
  onMessageSuccess?: (tempId: string) => void;
  replyTo?: ReplyMessage | null;
  onReplySent?: () => void;
  lastInboundAt?: string | null;
};

// Pre-load opus-media-recorder module
let opusModulePromise: Promise<any> | null = null;
function preloadOpusRecorder() {
  if (!opusModulePromise) {
    opusModulePromise = import("opus-media-recorder").then(m => m.default).catch(() => null);
  }
  return opusModulePromise;
}

export default function ChatInput({ leadId, leadPhone, onLoadTemplates, externalMessage, onExternalMessageConsumed, onMessageSent, onMessageError, onMessageSuccess, replyTo, onReplySent, lastInboundAt }: ChatInputProps) {
  const { profile } = useAuth();
  const [newMessage, setNewMessage] = useState(externalMessage || "");
  const [recording, setRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [attachedFile, setAttachedFile] = useState<{ file: globalThis.File; type: string } | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [uploading] = useState(false);
  const [botPopoverOpen, setBotPopoverOpen] = useState(false);
  const [bots, setBots] = useState<{ id: string; name: string }[]>([]);
  const [startingBotId, setStartingBotId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingDiscardedRef = useRef(false);

  // Waveform refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Pre-load opus module on mount
  useEffect(() => { preloadOpusRecorder(); }, []);

  // Waveform drawing
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      ctx.lineWidth = 2;
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim()
        ? `hsl(${getComputedStyle(document.documentElement).getPropertyValue("--primary").trim()})`
        : "#f97316";
      ctx.beginPath();

      const sliceWidth = w / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * h) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(w, h / 2);
      ctx.stroke();
    };
    draw();
  }, []);

  const stopWaveform = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  }, []);

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

  useEffect(() => {
    if (externalMessage) {
      setNewMessage(externalMessage);
      onExternalMessageConsumed?.();
    }
  }, [externalMessage, onExternalMessageConsumed]);

  const uploadFile = async (file: globalThis.File, folder: string): Promise<string | null> => {
    const ext = file.name.split(".").pop() || "bin";
    const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("chat-media").upload(path, file);
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
    if ((!newMessage.trim() && !attachedFile) || !leadPhone) return;

    // Block if 24h window expired
    if (windowInfo.expired) {
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

          const url = await uploadFile(fileToUpload!, type);
          if (!url) { onMessageError?.(tempId); return; }

          const body: any = { lead_id: leadId, to: leadPhone, message: message || undefined, type, media_url: url };
          if (currentReplyTo) {
            body.reply_to_message_id = currentReplyTo.id;
            if (currentReplyTo.whatsapp_message_id) body.reply_to_wamid = currentReplyTo.whatsapp_message_id;
          }

          const { data, error } = await supabase.functions.invoke("send-whatsapp-message", { body });
          if (error || data?.error) {
            onMessageError?.(tempId);
            toast.error(`Erro ao enviar: ${error?.message || JSON.stringify(data?.error)}`);
          } else {
            onMessageSuccess?.(tempId);
          }
        } catch (err: any) {
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
    const body: any = { lead_id: leadId, to: leadPhone, message: message || undefined, type };
    if (currentReplyTo) {
      body.reply_to_message_id = currentReplyTo.id;
      if (currentReplyTo.whatsapp_message_id) body.reply_to_wamid = currentReplyTo.whatsapp_message_id;
    }

    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp-message", { body });
      if (error || data?.error) {
        onMessageError?.(tempId);
        toast.error(`Erro ao enviar: ${error?.message || JSON.stringify(data?.error)}`);
      } else {
        onMessageSuccess?.(tempId);
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

  const sendRecordedAudio = async (oggBlob: Blob) => {
    if (!leadPhone) return;

    const audioFile = new globalThis.File(
      [oggBlob],
      `audio_${Date.now()}.ogg`,
      { type: "audio/ogg" }
    );

    const tempId = crypto.randomUUID();
    const optimisticUrl = URL.createObjectURL(oggBlob);

    // Show message instantly in chat
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

    // Upload and send fully in background — no banner, no blocking
    (async () => {
      try {
        console.log(`[ChatInput] OGG/OPUS audio recorded: size=${audioFile.size}, type=${audioFile.type}`);

        const url = await uploadFile(audioFile, "audio");
        if (!url) { onMessageError?.(tempId); return; }

        const { data, error } = await supabase.functions.invoke("send-whatsapp-message", {
          body: { lead_id: leadId, to: leadPhone, type: "audio", media_url: url, audio_voice: true },
        });

        if (error || data?.error) {
          onMessageError?.(tempId);
          toast.error(`Erro ao enviar áudio: ${error?.message || JSON.stringify(data?.error)}`);
        } else {
          onMessageSuccess?.(tempId);
        }
      } catch {
        onMessageError?.(tempId);
        toast.error("Erro ao enviar áudio");
      }
    })();
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      recordingDiscardedRef.current = false;
      setRecordingPaused(false);

      // Setup waveform analyser
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;

      // Try native MediaRecorder with OGG/OPUS first (Firefox)
      let recorder: any;
      const nativeOgg = typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/ogg;codecs=opus");

      if (nativeOgg) {
        recorder = new MediaRecorder(stream, { mimeType: "audio/ogg;codecs=opus" });
      } else {
        // Fall back to opus-media-recorder (WASM polyfill)
        const OpusMediaRecorder = await preloadOpusRecorder();
        if (!OpusMediaRecorder) {
          toast.error("Erro ao carregar gravador de áudio");
          stream.getTracks().forEach(t => t.stop());
          stopWaveform();
          return;
        }
        const workerOptions = {
          OggOpusEncoderWasmPath: "/OggOpusEncoder.wasm",
          WebMOpusEncoderWasmPath: "/WebMOpusEncoder.wasm",
          encoderWorkerFactory: () => new Worker("/encoderWorker.umd.js"),
        };
        recorder = new OpusMediaRecorder(
          stream,
          { mimeType: "audio/ogg;codecs=opus" },
          workerOptions
        );
      }

      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e: any) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        streamRef.current = null;
        if (timerRef.current) clearInterval(timerRef.current);
        stopWaveform();
        setRecording(false);
        setRecordingPaused(false);
        setRecordingTime(0);

        if (recordingDiscardedRef.current) {
          recordingDiscardedRef.current = false;
          audioChunksRef.current = [];
          return;
        }

        const oggBlob = new Blob(audioChunksRef.current, { type: "audio/ogg;codecs=opus" });

        if (oggBlob.size > 15 * 1024 * 1024) {
          toast.warning("Áudio muito longo. Considere enviar em partes menores.");
          return;
        }

        if (oggBlob.size < 100) {
          toast.error("Gravação muito curta ou vazia.");
          return;
        }

        await sendRecordedAudio(oggBlob);
      };

      recorder.start(1000); // Request data every 1s for faster finalization
      setRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          setRecordingTime((t) => t + 1);
        }
      }, 1000);

      // Start waveform after state update
      requestAnimationFrame(() => drawWaveform());
    } catch (err) {
      console.error("Recording start failed:", err);
      stopWaveform();
      toast.error("Não foi possível acessar o microfone");
    }
  };

  const togglePauseRecording = () => {
    if (!mediaRecorderRef.current) return;

    if (mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
      setRecordingPaused(true);
      return;
    }

    if (mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
      setRecordingPaused(false);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    setRecordingPaused(false);
  };

  const cancelRecording = () => {
    recordingDiscardedRef.current = true;
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (timerRef.current) clearInterval(timerRef.current);
    stopWaveform();
    setRecording(false);
    setRecordingTime(0);
    audioChunksRef.current = [];
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

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

  const isWindowExpired = windowInfo.expired;

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
      {isWindowExpired ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 bg-destructive/10 rounded-lg px-3 py-2.5 text-sm text-destructive">
            <AlertTriangle size={16} className="flex-shrink-0" />
            <span className="flex-1">A sessão de 24h expirou. Envie um template para reabrir a conversa.</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Sessão expirada — use um template"
                className="pr-10 bg-secondary border-border opacity-50"
                disabled
              />
            </div>
            <Button size="sm" variant="outline" onClick={onLoadTemplates} className="gap-1.5">
              <FileText size={16} />
              Enviar Template
            </Button>
          </div>
        </div>
      ) : recording ? (
        <div className="flex items-center gap-3">
          <button onClick={cancelRecording} className="p-2 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors" title="Cancelar gravação">
            <Square size={18} />
          </button>
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className={`w-3 h-3 rounded-full flex-shrink-0 ${recordingPaused ? "bg-muted-foreground" : "bg-destructive animate-pulse"}`} />
            <canvas
              ref={canvasRef}
              width={200}
              height={32}
              className="flex-1 min-w-0 max-w-[200px] h-8 rounded"
            />
            <span className="text-sm font-medium text-foreground flex-shrink-0">
              {formatTime(recordingTime)}
            </span>
          </div>
          <button onClick={togglePauseRecording} className="p-2 text-muted-foreground hover:text-primary transition-colors" title={recordingPaused ? "Retomar" : "Pausar"}>
            {recordingPaused ? <Play size={18} /> : <Pause size={18} />}
          </button>
          <Button size="icon" onClick={stopRecording} variant="default" title="Enviar áudio">
            <Send size={16} />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
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
            <Input
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
              className="pr-10 bg-secondary border-border"
              disabled={optimizing || uploading}
            />
          </div>

          <button onClick={onLoadTemplates} className="p-2 text-muted-foreground hover:text-primary transition-colors" title="Templates">
            <FileText size={20} />
          </button>

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

          {newMessage.trim() || attachedFile ? (
            <Button size="icon" onClick={handleSendMessage} disabled={optimizing || uploading}>
              <Send size={18} />
            </Button>
          ) : (
            <button
              onClick={startRecording}
              className="p-2 text-muted-foreground hover:text-primary transition-colors"
              disabled={optimizing || uploading}
            >
              <Mic size={20} />
            </button>
          )}
        </div>
      )}

      {/* 24h window countdown */}
      {!isWindowExpired && lastInboundAt && (
        <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
          <Clock size={12} />
          <span>A sessão de mensagens termina em: <span className="font-medium text-foreground">{windowInfo.remaining}</span></span>
        </div>
      )}
    </div>
  );
}
