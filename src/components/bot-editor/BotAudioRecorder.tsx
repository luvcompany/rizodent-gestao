import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import AudioPlayer from "@/components/chat/AudioPlayer";
import AudioRecorderComposer from "@/components/chat/AudioRecorderComposer";
import { supabase } from "@/integrations/supabase/client";
import { getSignedMediaUrl, getUploadedFileUrl } from "@/lib/mediaUtils";
import { toast } from "sonner";
import { Mic } from "lucide-react";

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
        const path = `audio/${Date.now()}_${crypto.randomUUID()}.ogg`;

        const { data, error } = await supabase.storage
          .from("chat-media")
          .upload(path, audioFile, { contentType: audioFile.type });

        if (error || !data) {
          throw new Error(error?.message || "Falha ao salvar áudio");
        }

        const signedUrl = await getUploadedFileUrl(data.path);
        setSavedPreviewUrl(signedUrl);
        onChange(signedUrl);
        toast.success("Áudio salvo no bloco");
      } catch (err: any) {
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

  // Active recording / preview takes the full row
  if (recorderActive) {
    return (
      <div className="flex w-full">
        <AudioRecorderComposer
          onSendAudio={handleSendAudio}
          onModeChange={setRecorderActive}
          showMicButton={false}
        />
      </div>
    );
  }

  if (savedPreviewUrl) {
    return (
      <div className="space-y-3">
        <AudioPlayer src={savedPreviewUrl} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRecorderActive(true)}
            className="gap-1.5"
          >
            <Mic size={14} /> Gravar novamente
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={deleteAudio} className="text-destructive">
            Excluir áudio
          </Button>
        </div>
        {/* Hidden composer that activates when user clicks "Gravar novamente" via state */}
        <div className="hidden">
          <AudioRecorderComposer onSendAudio={handleSendAudio} onModeChange={setRecorderActive} />
        </div>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setRecorderActive(true)}
      className="w-full gap-1.5"
    >
      <Mic size={14} /> Gravar áudio
    </Button>
  );
}
