import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Mic, X, Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";
import AudioRecorderComposer from "@/components/chat/AudioRecorderComposer";
import { uploadAutomationMedia } from "./automationMediaUpload";

type Cfg = Record<string, unknown>;

interface FilePickerProps {
  config: Cfg;
  onChange: (patch: Cfg) => void;
  keyOf: (k: string) => string;
}

export function FilePicker({ config, onChange, keyOf }: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const currentUrl = (config[keyOf("file_url")] as string) || "";
  const currentName = (config[keyOf("file_name")] as string) || "";

  const handleSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    const res = await uploadAutomationMedia(file, "automation-files", { fileName: file.name });
    setUploading(false);
    if (!res) return;
    onChange({
      [keyOf("file_url")]: res.url,
      [keyOf("file_name")]: res.name,
      [keyOf("file_mime")]: res.mime,
    });
    toast.success("Arquivo enviado.");
  };

  const handleRemove = () => {
    onChange({
      [keyOf("file_url")]: "",
      [keyOf("file_name")]: "",
      [keyOf("file_mime")]: "",
    });
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-[13px] font-medium text-muted-foreground">Arquivo</Label>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
        className="hidden"
        onChange={handleSelect}
      />
      {currentUrl ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3 py-2 shadow-xs">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><Paperclip size={15} strokeWidth={1.75} /></span>
          <span className="min-w-0 flex-1 break-all text-[13px] font-medium leading-snug" title={currentName || currentUrl}>
            {currentName || "Arquivo enviado"}
          </span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
            disabled={uploading}
          >
            Trocar
          </button>
          <button
            type="button"
            onClick={handleRemove}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-tertiary transition-colors hover:bg-destructive-soft hover:text-destructive"
            title="Remover"
          >
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10 w-full rounded-xl border-dashed text-[13px] font-semibold gap-2"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {uploading ? "Enviando..." : "Selecionar arquivo"}
        </Button>
      )}
      <p className="text-[11px] text-tertiary">
        Imagem ≤5MB · Vídeo ≤16MB · Documento ≤100MB
      </p>
    </div>
  );
}

interface AudioPickerProps {
  config: Cfg;
  onChange: (patch: Cfg) => void;
  keyOf: (k: string) => string;
}

export function AudioPicker({ config, onChange, keyOf }: AudioPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState<"choose" | "record">("choose");

  const currentUrl = (config[keyOf("audio_url")] as string) || "";

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("audio/") && !/\.(ogg|opus|mp3|m4a|aac|wav|webm|amr)$/i.test(file.name)) {
      toast.error("Selecione um arquivo de áudio.");
      return;
    }
    setUploading(true);
    const res = await uploadAutomationMedia(file, "automation-audio", { fileName: file.name });
    setUploading(false);
    if (!res) return;
    onChange({ [keyOf("audio_url")]: res.url, [keyOf("audio_name")]: res.name });
    toast.success("Áudio enviado.");
  };

  const handleRecord = async (blob: Blob) => {
    setUploading(true);
    const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("webm") ? "webm" : "mp3";
    const file = new File([blob], `gravacao_${Date.now()}.${ext}`, { type: blob.type || "audio/ogg" });
    const res = await uploadAutomationMedia(file, "automation-audio", {
      fileName: file.name,
      contentType: file.type,
    });
    setUploading(false);
    if (!res) {
      throw new Error("upload_failed");
    }
    onChange({ [keyOf("audio_url")]: res.url, [keyOf("audio_name")]: res.name });
    setMode("choose");
    toast.success("Áudio gravado e enviado.");
  };

  const handleRemove = () => {
    onChange({ [keyOf("audio_url")]: "", [keyOf("audio_name")]: "" });
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-[13px] font-medium text-muted-foreground">Áudio</Label>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleUpload}
      />
      {currentUrl ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card px-2.5 py-2 shadow-xs">
            <audio src={currentUrl} controls className="h-8 flex-1 min-w-0" />
            <button
              type="button"
              onClick={handleRemove}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-tertiary transition-colors hover:bg-destructive-soft hover:text-destructive"
              title="Remover"
            >
              <X size={15} strokeWidth={1.75} />
            </button>
          </div>
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 flex-1 rounded-xl text-xs font-semibold"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              <Upload size={12} className="mr-1" /> Trocar arquivo
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 flex-1 rounded-xl text-xs font-semibold"
              onClick={() => { handleRemove(); setMode("record"); }}
              disabled={uploading}
            >
              <Mic size={12} className="mr-1" /> Regravar
            </Button>
          </div>
        </div>
      ) : mode === "record" ? (
        <div className="space-y-1.5">
          <AudioRecorderComposer
            showMicButton={false}
            autoStart
            onSendAudio={handleRecord}
            onModeChange={(active) => { if (!active && !uploading) setMode("choose"); }}
          />
          <button
            type="button"
            className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => setMode("choose")}
          >
            Cancelar gravação
          </button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 flex-1 rounded-xl text-[13px] font-semibold gap-2"
            onClick={() => setMode("record")}
            disabled={uploading}
          >
            <Mic size={14} /> Gravar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 flex-1 rounded-xl text-[13px] font-semibold gap-2"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? "Enviando..." : "Enviar arquivo"}
          </Button>
        </div>
      )}
      <p className="text-[11px] text-tertiary">Áudio ≤16MB · OGG/Opus, MP3, M4A, WAV</p>
    </div>
  );
}
