import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import AudioPlayer from "@/components/chat/AudioPlayer";
import AudioRecorderComposer from "@/components/chat/AudioRecorderComposer";
import { supabase } from "@/integrations/supabase/client";
import { getSignedMediaUrl } from "@/lib/mediaUtils";
import { toast } from "sonner";
import { Mic, Trash2 } from "lucide-react";

type BotAudioRecorderProps = {
  value?: string | null;
  onChange: (url: string) => void;
};

export default function BotAudioRecorder({ value, onChange }: BotAudioRecorderProps) {
  const [savedPreviewUrl, setSavedPreviewUrl] = useState<string | null>(null);
  const [recorderActive, setRecorderActive] = useState(false);

  useEffect(() => {
    let active = true;
    if (!value) {
      setSavedPreviewUrl(null);
      return () => {
        active = false;
      };
    }
    getSignedMediaUrl(value)
      .then((signedUrl) => {
        if (active) setSavedPreviewUrl(signedUrl);
      })
      .catch(() => {
        if (active) setSavedPreviewUrl(value);
      });
    return () => {
      active = false;
    };
  }, [value]);

  const handleSendAudio = useCallback(
    async (audioBlob: Blob) => {
      try {
        const audioFile = new File([audioBlob], `audio_${Date.now()}.ogg`, { type: "audio/ogg" });
        const path = `audio/${Date.now()}_${Math.random().toString(36).slice(2)}.ogg`;

        console.log(`[BotAudioRecorder] Uploading: size=${audioFile.size}, type=${audioFile.type}, path=${path}`);

        const { error: uploadError } = await supabase.storage
          .from("chat-media")
          .upload(path, audioFile, { contentType: audioFile.type });

        if (uploadError) {
          throw new Error(uploadError.message || "Falha ao salvar áudio");
        }

        const { data: signedData, error: signError } = await supabase.storage
          .from("chat-media")
          .createSignedUrl(path, 3600);

        if (signError || !signedData?.signedUrl) {
          throw new Error(signError?.message || "Falha ao gerar URL do áudio");
        }

        const signedUrl = signedData.signedUrl;
        console.log(`[BotAudioRecorder] Audio saved successfully. Calling onChange.`);

        setSavedPreviewUrl(signedUrl);
        onChange(signedUrl);
        toast.success("Áudio salvo. Lembre-se de publicar o bot.");
      } catch (err: any) {
        console.error("[BotAudioRecorder] Error:", err);
        toast.error(err?.message || "Erro ao salvar áudio");
        throw err;
      }
    },
    [onChange],
  );

  const deleteAudio = () => {
    setSavedPreviewUrl(null);
    onChange("");
  };

  return (
    <div className="space-y-3">
      {savedPreviewUrl && !recorderActive && (
        <>
          <AudioPlayer src={savedPreviewUrl} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={deleteAudio}
            className="text-destructive gap-1.5"
          >
            <Trash2 size={14} /> Excluir áudio
          </Button>
        </>
      )}

      {recorderActive ? (
        <div className="flex w-full min-w-0">
          <AudioRecorderComposer
            onSendAudio={handleSendAudio}
            onModeChange={setRecorderActive}
            showMicButton={false}
          />
        </div>
      ) : (
        <div className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-secondary/30 px-2 py-1.5">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-0 truncate">
            <Mic size={14} className="shrink-0" />
            {savedPreviewUrl ? "Gravar novamente" : "Gravar áudio"}
          </span>
          <div className="ml-auto shrink-0">
            <AudioRecorderComposer
              onSendAudio={handleSendAudio}
              onModeChange={setRecorderActive}
            />
          </div>
        </div>
      )}
    </div>
  );
}
