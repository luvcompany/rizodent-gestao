import { useState } from "react";
import { Loader2, FileText, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  messageId?: string;
  callId?: string;
  api4comCallId?: string;
  initialTranscription?: string | null;
}

export default function AudioTranscriptionToggle({ messageId, callId, api4comCallId, initialTranscription }: Props) {
  const [text, setText] = useState<string | null>(initialTranscription || null);
  const [open, setOpen] = useState(!!initialTranscription);
  const [loading, setLoading] = useState(false);

  if (!messageId && !callId && !api4comCallId) return null;

  const handleClick = async () => {
    if (text) {
      setOpen((v) => !v);
      return;
    }
    setLoading(true);
    try {
      const body: Record<string, string> = {};
      if (api4comCallId) body.api4com_call_id = api4comCallId;
      else if (callId) body.call_id = callId;
      else if (messageId) body.message_id = messageId;
      const { data, error } = await supabase.functions.invoke("transcribe-audio", { body });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const t = (data as any)?.transcription as string;
      setText(t);
      setOpen(true);
    } catch (e: any) {
      toast.error(e.message || "Erro ao transcrever áudio");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-1.5 min-w-[220px] max-w-[280px]">
      <button
        onClick={handleClick}
        disabled={loading}
        className="flex items-center gap-1.5 text-[11px] text-primary hover:text-primary/80 font-medium transition-colors disabled:opacity-60"
      >
        {loading ? (
          <Loader2 size={12} className="animate-spin" />
        ) : text ? (
          <FileText size={12} />
        ) : (
          <Sparkles size={12} />
        )}
        {loading
          ? "Transcrevendo..."
          : text
            ? open
              ? "Ocultar transcrição"
              : "Mostrar transcrição"
            : "Transcrever áudio"}
      </button>
      {open && text && (
        <div className="mt-1 rounded-md bg-secondary/60 border border-border p-2 text-[12px] leading-relaxed text-foreground whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}
