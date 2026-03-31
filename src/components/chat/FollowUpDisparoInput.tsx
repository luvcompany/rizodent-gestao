import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Mic, Paperclip, Trash2, Square, Pause, Play, X, Loader2 } from "lucide-react";
import AudioPlayer from "./AudioPlayer";

export interface DisparoData {
  delay_minutes: number;
  content: string;
  audio_url: string | null;
  file_url: string | null;
  file_name: string | null;
  template_id: string | null;
}

interface Props {
  index: number;
  disparo: DisparoData;
  onChange: (d: DisparoData) => void;
  onRemove: () => void;
  canRemove: boolean;
}

export default function FollowUpDisparoInput({ index, disparo, onChange, onRemove, canRemove }: Props) {
  const [recording, setRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [uploading, setUploading] = useState(false);
  const mediaRecorderRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingDiscardedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File, folder: string): Promise<string | null> => {
    const ext = file.name.split(".").pop() || "bin";
    const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("chat-media").upload(path, file);
    if (error) { toast.error(`Erro upload: ${error.message}`); return null; }
    const { data } = supabase.storage.from("chat-media").getPublicUrl(path);
    return data.publicUrl;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      recordingDiscardedRef.current = false;
      setRecordingPaused(false);

      const OpusMediaRecorder = (await import("opus-media-recorder")).default;
      const workerOptions = {
        OggOpusEncoderWasmPath: "/OggOpusEncoder.wasm",
        WebMOpusEncoderWasmPath: "/WebMOpusEncoder.wasm",
        encoderWorkerFactory: () => new Worker("/encoderWorker.umd.js"),
      };

      const recorder = new OpusMediaRecorder(stream, { mimeType: "audio/ogg;codecs=opus" }, workerOptions);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e: any) => {
        if (e.data?.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        streamRef.current = null;
        if (timerRef.current) clearInterval(timerRef.current);
        setRecording(false);
        setRecordingPaused(false);
        setRecordingTime(0);

        if (recordingDiscardedRef.current) {
          recordingDiscardedRef.current = false;
          audioChunksRef.current = [];
          return;
        }

        const oggBlob = new Blob(audioChunksRef.current, { type: "audio/ogg;codecs=opus" });
        if (oggBlob.size < 100) { toast.error("Gravação muito curta."); return; }

        setUploading(true);
        const audioFile = new File([oggBlob], `followup_audio_${Date.now()}.ogg`, { type: "audio/ogg" });
        const url = await uploadFile(audioFile, "audio");
        setUploading(false);
        if (url) onChange({ ...disparo, audio_url: url });
      };

      recorder.start();
      setRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        if (mediaRecorderRef.current?.state === "recording") setRecordingTime(t => t + 1);
      }, 1000);
    } catch {
      toast.error("Não foi possível acessar o microfone");
    }
  };

  const togglePause = () => {
    if (!mediaRecorderRef.current) return;
    if (mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
      setRecordingPaused(true);
    } else if (mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
      setRecordingPaused(false);
    }
  };

  const stopRecording = () => mediaRecorderRef.current?.stop();

  const cancelRecording = () => {
    recordingDiscardedRef.current = true;
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    setRecordingTime(0);
    audioChunksRef.current = [];
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > 100 * 1024 * 1024) { toast.error("Arquivo muito grande (max 100MB)"); return; }
    setUploading(true);
    const url = await uploadFile(file, "documents");
    setUploading(false);
    if (url) onChange({ ...disparo, file_url: url, file_name: file.name });
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="space-y-3 rounded-lg border border-border p-4 bg-secondary/20 relative">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Disparo {index + 1}</h4>
        {canRemove && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={onRemove}>
            <Trash2 size={14} />
          </Button>
        )}
      </div>

      {/* Delay */}
      <div>
        <Label className="text-xs text-muted-foreground">
          {index === 0 ? "Aguardar sem resposta" : "Se não responder, aguardar mais"}
        </Label>
        <div className="flex items-center gap-2">
          <Input
            type="number" min={1} className="h-8 text-sm w-32"
            value={disparo.delay_minutes}
            onChange={e => onChange({ ...disparo, delay_minutes: parseInt(e.target.value) || 1 })}
          />
          <span className="text-xs text-muted-foreground">minutos</span>
        </div>
      </div>

      {/* Text content */}
      <div>
        <Label className="text-xs text-muted-foreground">Mensagem de texto</Label>
        <Textarea
          className="text-sm min-h-[60px]"
          placeholder="Escreva a mensagem de follow up..."
          value={disparo.content}
          onChange={e => onChange({ ...disparo, content: e.target.value })}
        />
      </div>

      {/* Audio */}
      <div>
        <Label className="text-xs text-muted-foreground">Áudio</Label>
        {recording ? (
          <div className="flex items-center gap-2 bg-destructive/10 rounded-lg px-3 py-2">
            <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
            <span className="text-sm font-mono text-foreground flex-1">{formatTime(recordingTime)}</span>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={togglePause}>
              {recordingPaused ? <Play size={14} /> : <Pause size={14} />}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={cancelRecording}>
              <X size={14} />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-primary" onClick={stopRecording}>
              <Square size={14} />
            </Button>
          </div>
        ) : uploading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 size={14} className="animate-spin" /> Enviando...
          </div>
        ) : disparo.audio_url ? (
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <AudioPlayer src={disparo.audio_url} />
            </div>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => onChange({ ...disparo, audio_url: null })}>
              <Trash2 size={14} />
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={startRecording}>
            <Mic size={14} /> Gravar áudio
          </Button>
        )}
      </div>

      {/* File */}
      <div>
        <Label className="text-xs text-muted-foreground">Arquivo</Label>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
        {disparo.file_url ? (
          <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 text-sm">
            <Paperclip size={14} className="text-primary" />
            <span className="flex-1 truncate text-foreground">{disparo.file_name || "Arquivo"}</span>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => onChange({ ...disparo, file_url: null, file_name: null })}>
              <Trash2 size={14} />
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => fileInputRef.current?.click()}>
            <Paperclip size={14} /> Anexar arquivo
          </Button>
        )}
      </div>
    </div>
  );
}
