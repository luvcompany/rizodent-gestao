import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import AudioPlayer from "@/components/chat/AudioPlayer";
import { supabase } from "@/integrations/supabase/client";
import { getSignedMediaUrl, getUploadedFileUrl } from "@/lib/mediaUtils";
import { toast } from "sonner";
import { Mic, Pause, Play, Square, Trash2, Save } from "lucide-react";

type BotAudioRecorderProps = {
  value?: string | null;
  onChange: (url: string) => void;
};

export default function BotAudioRecorder({ value, onChange }: BotAudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [savedPreviewUrl, setSavedPreviewUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingDiscardedRef = useRef(false);
  const localPreviewUrlRef = useRef<string | null>(null);

  const setManagedLocalPreviewUrl = useCallback((nextUrl: string | null) => {
    if (localPreviewUrlRef.current?.startsWith("blob:")) {
      URL.revokeObjectURL(localPreviewUrlRef.current);
    }
    localPreviewUrlRef.current = nextUrl;
    setLocalPreviewUrl(nextUrl);
  }, []);

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

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (localPreviewUrlRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(localPreviewUrlRef.current);
      }
    };
  }, []);

  const resetDraftAudio = useCallback(() => {
    setAudioBlob(null);
    setManagedLocalPreviewUrl(null);
    setRecordingTime(0);
    setRecordingPaused(false);
    audioChunksRef.current = [];
  }, [setManagedLocalPreviewUrl]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      recordingDiscardedRef.current = false;
      resetDraftAudio();

      const OpusMediaRecorder = (await import("opus-media-recorder")).default;
      const workerOptions = {
        OggOpusEncoderWasmPath: "/OggOpusEncoder.wasm",
        WebMOpusEncoderWasmPath: "/WebMOpusEncoder.wasm",
        encoderWorkerFactory: () => new Worker("/encoderWorker.umd.js"),
      };

      const recorder = new OpusMediaRecorder(
        stream,
        { mimeType: "audio/ogg;codecs=opus" },
        workerOptions
      );

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event: any) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        streamRef.current = null;

        if (timerRef.current) clearInterval(timerRef.current);

        setRecording(false);
        setRecordingPaused(false);

        if (recordingDiscardedRef.current) {
          recordingDiscardedRef.current = false;
          resetDraftAudio();
          return;
        }

        const oggBlob = new Blob(audioChunksRef.current, { type: "audio/ogg;codecs=opus" });

        if (oggBlob.size > 15 * 1024 * 1024) {
          toast.warning("Áudio muito longo. Considere gravar em partes menores.");
          resetDraftAudio();
          return;
        }

        if (oggBlob.size < 100) {
          toast.error("Gravação muito curta ou vazia.");
          resetDraftAudio();
          return;
        }

        setAudioBlob(oggBlob);
        setManagedLocalPreviewUrl(URL.createObjectURL(oggBlob));
      };

      recorder.start();
      setRecording(true);
      timerRef.current = setInterval(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          setRecordingTime((time) => time + 1);
        }
      }, 1000);
    } catch {
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
  };

  const discardCurrentRecording = () => {
    if (recording) {
      recordingDiscardedRef.current = true;
      mediaRecorderRef.current?.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (timerRef.current) clearInterval(timerRef.current);

    setRecording(false);
    resetDraftAudio();
  };

  const deleteAudio = () => {
    discardCurrentRecording();
    setSavedPreviewUrl(null);
    onChange("");
  };

  const saveRecording = async () => {
    if (!audioBlob) return;

    setUploading(true);
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
      resetDraftAudio();
      toast.success("Áudio salvo no bloco");
    } catch (error: any) {
      toast.error(error.message || "Erro ao salvar áudio");
    } finally {
      setUploading(false);
    }
  };

  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
  const previewSource = localPreviewUrl || savedPreviewUrl;

  return (
    <div className="space-y-3">
      {recording ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 px-3 py-2">
          <button
            type="button"
            onClick={discardCurrentRecording}
            className="rounded-full p-2 text-destructive transition-colors hover:bg-destructive/10"
            title="Descartar gravação"
          >
            <Trash2 size={16} />
          </button>

          <div className="flex flex-1 items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${recordingPaused ? "bg-muted-foreground" : "bg-destructive animate-pulse"}`} />
            <span className="text-sm font-medium text-foreground">
              {recordingPaused ? "Pausado" : "Gravando"} {formatTime(recordingTime)}
            </span>
          </div>

          <button
            type="button"
            onClick={togglePauseRecording}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
            title={recordingPaused ? "Retomar gravação" : "Pausar gravação"}
          >
            {recordingPaused ? <Play size={16} /> : <Pause size={16} />}
          </button>

          <Button type="button" size="icon" onClick={stopRecording} title="Finalizar gravação">
            <Square size={14} />
          </Button>
        </div>
      ) : previewSource ? (
        <>
          <AudioPlayer src={previewSource} />

          <div className="flex flex-wrap items-center gap-2">
            {audioBlob ? (
              <Button type="button" size="sm" onClick={saveRecording} disabled={uploading} className="gap-1.5">
                <Save size={14} /> {uploading ? "Salvando..." : "Salvar no bloco"}
              </Button>
            ) : null}

            <Button type="button" variant="outline" size="sm" onClick={startRecording} disabled={uploading}>
              Gravar novamente
            </Button>

            <Button type="button" variant="ghost" size="sm" onClick={deleteAudio} className="text-destructive">
              Excluir áudio
            </Button>
          </div>
        </>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={startRecording} className="w-full gap-1.5">
          <Mic size={14} /> Gravar áudio
        </Button>
      )}
    </div>
  );
}