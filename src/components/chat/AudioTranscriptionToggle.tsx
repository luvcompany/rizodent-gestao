import { useState } from "react";
import { Loader2, FileText, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { motivoDoServidor } from "@/lib/erroDeFuncao";

interface Props {
  messageId?: string;
  callId?: string;
  api4comCallId?: string;
  initialTranscription?: string | null;
}

export default function AudioTranscriptionToggle({ messageId, callId, api4comCallId, initialTranscription }: Props) {
  const { userRole } = useAuth();
  const [text, setText] = useState<string | null>(initialTranscription || null);
  const [open, setOpen] = useState(!!initialTranscription);
  const [loading, setLoading] = useState(false);

  if (!messageId && !callId && !api4comCallId) return null;

  // SDR: `transcribe-audio` devolve 403 ("Transcrição por IA não faz parte do
  // perfil SDR"), e ela lida com áudio o tempo todo — seria o botão que mais
  // encontraria quebrado. Some o botão QUE SÓ FALHA; a transcrição que já
  // existe continua legível (mostrar/ocultar não chama function nenhuma).
  if (userRole === "sdr" && !text) return null;
  const podeTranscrever = userRole !== "sdr";

  const handleClick = async () => {
    if (text) {
      setOpen((v) => !v);
      return;
    }
    if (!podeTranscrever) return;
    setLoading(true);
    try {
      const body: Record<string, string> = {};
      if (api4comCallId) body.api4com_call_id = api4comCallId;
      else if (callId) body.call_id = callId;
      else if (messageId) body.message_id = messageId;
      const { data, error } = await supabase.functions.invoke("transcribe-audio", { body });
      // Motivo real do 4xx vem no corpo (error.context), não em error.message.
      if (error) throw new Error(await motivoDoServidor(data, error, "Erro ao transcrever áudio"));
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
