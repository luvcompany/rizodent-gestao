import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Send, Paperclip, Mic, FileText, Image, File, Video,
  Square, X
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ChatInputProps = {
  leadId: string;
  leadPhone: string | null;
  onLoadTemplates: () => void;
  externalMessage?: string;
  onExternalMessageConsumed?: () => void;
  onApiLog?: (log: { type: "success" | "error"; payload: any }) => void;
};

export default function ChatInput({ leadId, leadPhone, onLoadTemplates, externalMessage, onExternalMessageConsumed, onApiLog }: ChatInputProps) {
  const [newMessage, setNewMessage] = useState(externalMessage || "");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [attachedFile, setAttachedFile] = useState<{ file: File; type: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (externalMessage) {
      setNewMessage(externalMessage);
      onExternalMessageConsumed?.();
    }
  }, [externalMessage, onExternalMessageConsumed]);

  const uploadFile = async (file: File, folder: string): Promise<string | null> => {
    const ext = file.name.split(".").pop() || "bin";
    const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("chat-media").upload(path, file);
    if (error) {
      toast.error(`Erro ao fazer upload: ${error.message}`);
      return null;
    }
    const { data } = supabase.storage.from("chat-media").getPublicUrl(path);
    return data.publicUrl;
  };

  const getMessageType = (file: File): string => {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("audio/")) return "audio";
    if (file.type.startsWith("video/")) return "video";
    return "document";
  };

  const handleSendMessage = async () => {
    if ((!newMessage.trim() && !attachedFile) || !leadPhone) return;
    setSending(true);

    try {
      let type = "text";
      let media_url: string | undefined;
      let message = newMessage.trim();

      if (attachedFile) {
        type = attachedFile.type;
        const url = await uploadFile(attachedFile.file, type);
        if (!url) { setSending(false); return; }
        media_url = url;
        if (!message && type === "document") message = attachedFile.file.name;
      }

      if (type === "text" && !message) { setSending(false); return; }

      const { data, error } = await supabase.functions.invoke("send-whatsapp-message", {
        body: { lead_id: leadId, to: leadPhone, message: message || undefined, type, media_url },
      });

      if (error) {
        const errPayload = { edge_error: error.message, raw: error };
        onApiLog?.({ type: "error", payload: errPayload });
        toast.error(`Erro ao enviar: ${error.message}`);
        return;
      }
      if (data?.error) {
        onApiLog?.({ type: "error", payload: data });
        toast.error(`Erro WhatsApp: ${JSON.stringify(data.details || data.error)}`);
        return;
      }

      onApiLog?.({ type: "success", payload: data });
      setNewMessage("");
      setAttachedFile(null);
      toast.success("Mensagem enviada");
    } catch (err: any) {
      toast.error(`Erro inesperado: ${err.message}`);
    } finally {
      setSending(false);
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) {
      toast.error("Arquivo muito grande. Máximo: 16MB");
      return;
    }
    const type = getMessageType(file);
    // Treat webp stickers separately
    if (file.type === "image/webp" && file.size < 512 * 1024) {
      setAttachedFile({ file, type: "sticker" });
    } else {
      setAttachedFile({ file, type });
    }
    e.target.value = "";
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        setRecordingTime(0);

        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/ogg" });
        const audioFile = new globalThis.File([audioBlob], `audio_${Date.now()}.ogg`, { type: "audio/ogg" });

        setSending(true);
        const url = await uploadFile(audioFile, "audio");
        if (!url) { setSending(false); return; }

        const { data, error } = await supabase.functions.invoke("send-whatsapp-message", {
          body: { lead_id: leadId, to: leadPhone, type: "audio", media_url: url },
        });

        if (error || data?.error) {
          const errPayload = error ? { edge_error: error.message, raw: error } : data;
          onApiLog?.({ type: "error", payload: errPayload });
          toast.error(`Erro ao enviar áudio: ${error?.message || JSON.stringify(data?.error)}`);
        } else {
          onApiLog?.({ type: "success", payload: data });
          toast.success("Áudio enviado");
        }
        setSending(false);
      };

      mediaRecorder.start();
      setRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } catch {
      toast.error("Não foi possível acessar o microfone");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream?.getTracks().forEach((t) => t.stop());
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    setRecordingTime(0);
    audioChunksRef.current = [];
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="flex-shrink-0 bg-card border-t border-border px-4 py-3">
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />

      {/* Attached file preview */}
      {attachedFile && (
        <div className="flex items-center gap-2 mb-2 bg-secondary rounded-lg px-3 py-2 text-sm">
          {attachedFile.type === "image" ? <Image size={16} className="text-primary" /> :
           attachedFile.type === "video" ? <Video size={16} className="text-primary" /> :
           attachedFile.type === "sticker" ? <span className="text-lg">🎨</span> :
           <File size={16} className="text-primary" />}
          <span className="flex-1 truncate text-foreground">{attachedFile.file.name}</span>
          <button onClick={() => setAttachedFile(null)} className="text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>
      )}

      {recording ? (
        <div className="flex items-center gap-3">
          <button onClick={cancelRecording} className="p-2 text-destructive hover:text-destructive/80">
            <X size={20} />
          </button>
          <div className="flex-1 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-destructive animate-pulse" />
            <span className="text-sm font-medium text-foreground">Gravando... {formatTime(recordingTime)}</span>
          </div>
          <Button size="icon" onClick={stopRecording} variant="default">
            <Square size={16} />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-2 text-muted-foreground hover:text-primary transition-colors">
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
            <Input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite uma mensagem..."
              className="pr-10 bg-secondary border-border"
              disabled={sending}
            />
          </div>

          <button onClick={onLoadTemplates} className="p-2 text-muted-foreground hover:text-primary transition-colors" title="Templates">
            <FileText size={20} />
          </button>

          {newMessage.trim() || attachedFile ? (
            <Button size="icon" onClick={handleSendMessage} disabled={sending}>
              <Send size={18} />
            </Button>
          ) : (
            <button
              onClick={startRecording}
              className="p-2 text-muted-foreground hover:text-primary transition-colors"
              disabled={sending}
            >
              <Mic size={20} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
