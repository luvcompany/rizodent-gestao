import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Mic, Pause, Play, Send, Square, X } from "lucide-react";

type AudioRecorderComposerProps = {
  disabled?: boolean;
  onSendAudio: (audioBlob: Blob) => Promise<void> | void;
  onModeChange?: (active: boolean) => void;
  showMicButton?: boolean;
};

type RecorderMode = "idle" | "preparing" | "recording" | "preview" | "sending";

const BAR_COUNT = 48;
const MIN_LEVEL = 0.06;
const LIVE_SAMPLE_MS = 60;
const MAX_WAVEFORM_SAMPLES = 300;

let opusModulePromise: Promise<any> | null = null;

function preloadOpusRecorder() {
  if (!opusModulePromise) {
    opusModulePromise = import("opus-media-recorder").then((m) => m.default).catch(() => null);
  }
  return opusModulePromise;
}

const createEmptyBars = () => Array.from({ length: BAR_COUNT }, () => MIN_LEVEL);
const clampLevel = (v: number) => Math.min(1, Math.max(MIN_LEVEL, v));

const compressLevelsToBars = (levels: number[]) => {
  if (!levels.length) return createEmptyBars();
  if (levels.length <= BAR_COUNT) {
    return [
      ...Array.from({ length: BAR_COUNT - levels.length }, () => MIN_LEVEL),
      ...levels.map(clampLevel),
    ];
  }
  const bucket = levels.length / BAR_COUNT;
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    const start = Math.floor(i * bucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucket));
    const peak = levels.slice(start, end).reduce((m, v) => Math.max(m, v), MIN_LEVEL);
    return clampLevel(peak);
  });
};

/** Check if this browser supports native OGG/Opus recording */
function supportsNativeOgg(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof MediaRecorder.isTypeSupported === "function" &&
    MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
  );
}

export default function AudioRecorderComposer({
  disabled = false,
  onSendAudio,
  onModeChange,
  showMicButton = true,
}: AudioRecorderComposerProps) {
  const [mode, setMode] = useState<RecorderMode>("idle");
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [waveformBars, setWaveformBars] = useState<number[]>(() => createEmptyBars());
  const [draftBlob, setDraftBlob] = useState<Blob | null>(null);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sampleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement>(null);
  const waveformHistoryRef = useRef<number[]>([]);
  const currentDraftUrlRef = useRef<string | null>(null);
  const discardRecordingRef = useRef(false);
  const pausedRef = useRef(false);
  const mountedRef = useRef(true);

  // Track mounted state to avoid setState after unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const setManagedDraftUrl = useCallback((url: string | null) => {
    if (currentDraftUrlRef.current?.startsWith("blob:")) {
      URL.revokeObjectURL(currentDraftUrlRef.current);
    }
    currentDraftUrlRef.current = url;
    setDraftUrl(url);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const clearSampler = useCallback(() => {
    if (sampleTimerRef.current) { clearInterval(sampleTimerRef.current); sampleTimerRef.current = null; }
  }, []);

  const stopAudioProcessing = useCallback(() => {
    clearSampler();
    analyserRef.current = null;
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    if (ctx) {
      try {
        if (ctx.state !== "closed") ctx.close().catch(() => {});
      } catch {
        // already closed or invalid
      }
    }
  }, [clearSampler]);

  const killStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch {} });
      streamRef.current = null;
    }
  }, []);

  const resetToIdle = useCallback(() => {
    clearTimer();
    stopAudioProcessing();
    killStream();

    const audio = previewAudioRef.current;
    if (audio) { try { audio.pause(); audio.currentTime = 0; } catch {} }

    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    waveformHistoryRef.current = [];
    discardRecordingRef.current = false;
    pausedRef.current = false;

    if (mountedRef.current) {
      setRecordingPaused(false);
      setRecordingTime(0);
      setWaveformBars(createEmptyBars());
      setDraftBlob(null);
      setManagedDraftUrl(null);
      setPreviewPlaying(false);
      setPreviewProgress(0);
      setPreviewDuration(0);
      setMode("idle");
    }
  }, [clearTimer, setManagedDraftUrl, stopAudioProcessing, killStream]);

  const startMeter = useCallback(() => {
    clearSampler();
    const analyser = analyserRef.current;
    if (!analyser) return;

    const dataArray = new Uint8Array(analyser.fftSize);

    sampleTimerRef.current = setInterval(() => {
      try {
        analyser.getByteTimeDomainData(dataArray);
      } catch {
        return;
      }
      let peak = 0;
      for (let i = 0; i < dataArray.length; i++) {
        peak = Math.max(peak, Math.abs(dataArray[i] - 128) / 128);
      }
      const prev = waveformHistoryRef.current[waveformHistoryRef.current.length - 1] ?? MIN_LEVEL;
      const target = pausedRef.current ? MIN_LEVEL : Math.max(MIN_LEVEL, Math.min(1, peak * 2.8));
      const smooth = prev * 0.45 + target * 0.55;
      const next = [...waveformHistoryRef.current, clampLevel(smooth)].slice(-MAX_WAVEFORM_SAMPLES);
      waveformHistoryRef.current = next;
      if (mountedRef.current) setWaveformBars(compressLevelsToBars(next));
    }, LIVE_SAMPLE_MS);
  }, [clearSampler]);

  const startRecordingTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setInterval(() => {
      const rec = mediaRecorderRef.current;
      if (rec && rec.state === "recording" && !pausedRef.current) {
        setRecordingTime((t) => t + 1);
      }
    }, 1000);
  }, [clearTimer]);

  const finalizeDraft = useCallback(() => {
    if (discardRecordingRef.current) {
      discardRecordingRef.current = false;
      resetToIdle();
      return;
    }

    const mimeType = mediaRecorderRef.current?.mimeType || "audio/ogg;codecs=opus";
    const blob = new Blob(audioChunksRef.current, { type: mimeType });

    if (blob.size < 100) {
      toast.error("Gravação muito curta ou vazia.");
      resetToIdle();
      return;
    }
    if (blob.size > 15 * 1024 * 1024) {
      toast.warning("Áudio muito longo. Considere gravar em partes menores.");
      resetToIdle();
      return;
    }

    setDraftBlob(blob);
    setManagedDraftUrl(URL.createObjectURL(blob));
    setPreviewPlaying(false);
    setPreviewProgress(0);
    setPreviewDuration(0);
    setWaveformBars(compressLevelsToBars(waveformHistoryRef.current));
    setMode("preview");
  }, [resetToIdle, setManagedDraftUrl]);

  const startRecording = useCallback(async () => {
    if (disabled || mode !== "idle") return;

    setMode("preparing");
    setRecordingTime(0);
    setRecordingPaused(false);
    pausedRef.current = false;
    setWaveformBars(createEmptyBars());
    waveformHistoryRef.current = [];
    audioChunksRef.current = [];
    discardRecordingRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      // If user cancelled during mic permission dialog
      if (discardRecordingRef.current || !mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        if (mountedRef.current) resetToIdle();
        return;
      }

      streamRef.current = stream;

      // Set up audio analyser
      const ACtor = window.AudioContext || (window as any).webkitAudioContext;
      if (ACtor) {
        try {
          const ctx = new ACtor();
          await ctx.resume();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          analyser.smoothingTimeConstant = 0.72;
          source.connect(analyser);
          audioContextRef.current = ctx;
          analyserRef.current = analyser;
          startMeter();
        } catch {
          // Non-fatal: waveform won't animate but recording still works
        }
      }

      // Create recorder with best available mime type
      const mimeType = pickMimeType();
      let recorder: MediaRecorder;

      if (mimeType) {
        recorder = new MediaRecorder(stream, { mimeType });
      } else {
        // Last resort: let browser pick
        recorder = new MediaRecorder(stream);
      }

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onerror = () => {
        toast.error("Erro ao gravar áudio");
        resetToIdle();
      };
      recorder.onstop = () => {
        clearTimer();
        stopAudioProcessing();
        killStream();
        if (mountedRef.current) {
          setRecordingPaused(false);
          pausedRef.current = false;
          finalizeDraft();
        }
      };

      // Wait for microphone to fully initialize before starting capture
      await new Promise(resolve => setTimeout(resolve, 350));

      // Check again if user cancelled during warmup
      if (discardRecordingRef.current || !mountedRef.current) {
        killStream();
        stopAudioProcessing();
        if (mountedRef.current) resetToIdle();
        return;
      }

      recorder.start(250);

      if (!discardRecordingRef.current && mountedRef.current) {
        setMode("recording");
        startRecordingTimer();
      }
    } catch (err: any) {
      resetToIdle();
      const msg = err?.message || "Não foi possível acessar o microfone";
      if (!msg.includes("Erro ao carregar")) {
        toast.error(msg);
      } else {
        toast.error("Não foi possível acessar o microfone");
      }
    }
  }, [disabled, finalizeDraft, mode, resetToIdle, startMeter, startRecordingTimer, clearTimer, stopAudioProcessing, killStream]);

  const togglePauseRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (!rec || mode === "preparing") return;
    try {
      if (rec.state === "recording") {
        rec.pause();
        pausedRef.current = true;
        setRecordingPaused(true);
      } else if (rec.state === "paused") {
        rec.resume();
        pausedRef.current = false;
        setRecordingPaused(false);
      }
    } catch {
      // Recorder in invalid state, reset
      resetToIdle();
    }
  }, [mode, resetToIdle]);

  const stopRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (!rec) {
      resetToIdle();
      return;
    }
    try {
      // Resume first if paused, so onstop fires properly
      if (rec.state === "paused") {
        rec.resume();
      }
      if (rec.state === "recording") {
        try { rec.requestData(); } catch {}
        rec.stop();
      } else if (rec.state === "inactive") {
        // Already stopped, finalize
        finalizeDraft();
      }
    } catch {
      resetToIdle();
    }
  }, [resetToIdle, finalizeDraft]);

  const discardCurrentAudio = useCallback(() => {
    if (mode === "preview") { resetToIdle(); return; }
    if (mode === "preparing") {
      // During preparing, recorder may not exist yet (warmup delay)
      discardRecordingRef.current = true;
      // If recorder already exists, stop it; otherwise resetToIdle will be called after warmup
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== "inactive") {
        try { rec.stop(); } catch { resetToIdle(); }
      } else if (!rec) {
        resetToIdle();
      }
      return;
    }
    if (mode === "recording") {
      discardRecordingRef.current = true;
      const rec = mediaRecorderRef.current;
      if (rec) {
        try {
          if (rec.state === "paused") rec.resume();
          if (rec.state === "recording") rec.stop();
          else resetToIdle();
        } catch { resetToIdle(); }
      } else {
        resetToIdle();
      }
      return;
    }
    resetToIdle();
  }, [mode, resetToIdle]);

  const togglePreviewPlayback = useCallback(async () => {
    const audio = previewAudioRef.current;
    if (!audio || !draftUrl) return;
    if (previewPlaying) { audio.pause(); return; }
    if (previewDuration && previewProgress >= previewDuration) audio.currentTime = 0;
    try { await audio.play(); } catch { toast.error("Não foi possível reproduzir o áudio gravado"); }
  }, [draftUrl, previewDuration, previewPlaying, previewProgress]);

  const sendDraft = useCallback(async () => {
    if (!draftBlob || mode === "sending") return;
    setMode("sending");
    try {
      await onSendAudio(draftBlob);
      resetToIdle();
    } catch {
      setMode("preview");
    }
  }, [draftBlob, mode, onSendAudio, resetToIdle]);

  // Preview audio events
  useEffect(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    const onPlay = () => setPreviewPlaying(true);
    const onPause = () => setPreviewPlaying(false);
    const onMeta = () => setPreviewDuration(audio.duration || 0);
    const onTime = () => setPreviewProgress(audio.currentTime || 0);
    const onEnd = () => { setPreviewPlaying(false); setPreviewProgress(audio.duration || 0); };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
    };
  }, [draftUrl]);

  // Cleanup on unmount — use ref to avoid re-running on every resetToIdle change
  const resetRef = useRef(resetToIdle);
  resetRef.current = resetToIdle;
  useEffect(() => () => { resetRef.current(); }, []);

  // Notify parent
  useEffect(() => { onModeChange?.(mode !== "idle"); }, [mode, onModeChange]);

  const activePreviewBars = useMemo(() => {
    if (!previewDuration) return 0;
    return Math.min(waveformBars.length, Math.round((previewProgress / previewDuration) * waveformBars.length));
  }, [previewDuration, previewProgress, waveformBars.length]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  // ─── IDLE: just the mic button ───
  if (mode === "idle") {
    if (!showMicButton) return null;
    return (
      <button
        onClick={startRecording}
        className="p-2 text-muted-foreground transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        title="Gravar áudio"
        type="button"
      >
        <Mic size={20} />
      </button>
    );
  }

  // ─── PREVIEW / SENDING ───
  if (mode === "preview" || mode === "sending") {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 shadow-sm">
        <audio key={draftUrl || "d"} ref={previewAudioRef} src={draftUrl || undefined} preload="metadata" />

        <button
          type="button"
          onClick={discardCurrentAudio}
          className="rounded-full p-1.5 text-destructive transition-colors hover:bg-destructive/10"
          title="Descartar"
        >
          <X size={16} />
        </button>

        <button
          type="button"
          onClick={togglePreviewPlayback}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
          title={previewPlaying ? "Pausar prévia" : "Ouvir antes de enviar"}
        >
          {previewPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
        </button>

        {/* Waveform bars */}
        <div className="flex min-w-0 flex-1 items-center gap-[1.5px] overflow-hidden px-1 py-1">
          {waveformBars.map((level, i) => (
            <span
              key={i}
              className="rounded-full transition-colors duration-75"
              style={{
                width: "2.5px",
                minWidth: "2.5px",
                height: `${Math.max(3, Math.round(level * 24))}px`,
                backgroundColor: i < activePreviewBars
                  ? "hsl(var(--primary))"
                  : "hsl(var(--primary) / 0.25)",
              }}
            />
          ))}
        </div>

        <span className="w-10 flex-shrink-0 text-right text-xs font-medium text-muted-foreground tabular-nums">
          {formatTime(Math.round(previewDuration || recordingTime))}
        </span>

        <Button type="button" size="sm" onClick={sendDraft} disabled={mode === "sending"} className="gap-1.5">
          {mode === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send size={14} /> Enviar</>}
        </Button>
      </div>
    );
  }

  // ─── PREPARING / RECORDING ───
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 shadow-sm">
      <button
        type="button"
        onClick={discardCurrentAudio}
        className="rounded-full p-1.5 text-destructive transition-colors hover:bg-destructive/10"
        title="Cancelar gravação"
      >
        <X size={16} />
      </button>

      {/* Recording indicator dot */}
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            mode === "preparing" || recordingPaused ? "bg-muted-foreground" : "bg-destructive animate-pulse"
          }`}
        />
        <span className="text-xs font-medium tabular-nums text-foreground">
          {formatTime(recordingTime)}
        </span>
      </div>

      {/* Waveform bars */}
      <div className="flex min-w-0 flex-1 items-center gap-[1.5px] overflow-hidden px-1 py-1">
        {waveformBars.map((level, i) => (
          <span
            key={i}
            className="rounded-full transition-all duration-75"
            style={{
              width: "2.5px",
              minWidth: "2.5px",
              height: `${Math.max(3, Math.round(level * 24))}px`,
              backgroundColor:
                recordingPaused || mode === "preparing"
                  ? "hsl(var(--primary) / 0.2)"
                  : "hsl(var(--primary))",
            }}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={togglePauseRecording}
        className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
        disabled={mode === "preparing"}
        title={recordingPaused ? "Retomar gravação" : "Pausar gravação"}
      >
        {recordingPaused ? <Play size={16} /> : <Pause size={16} />}
      </button>

      <Button
        type="button"
        size="icon"
        className="h-8 w-8"
        onClick={stopRecording}
        disabled={mode === "preparing"}
        title="Finalizar e pré-ouvir"
      >
        <Square size={12} />
      </Button>
    </div>
  );
}
