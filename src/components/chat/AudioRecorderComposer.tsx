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
const STOP_FAILSAFE_MS = 5000;

/* ── Dynamic MIME type selection ── */
function getBestMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const types = [
    "audio/ogg;codecs=opus",   // Firefox
    "audio/webm;codecs=opus",  // Chrome / Edge
    "audio/webm",
    "audio/mp4",               // Safari
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
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

  const mediaRecorderRef = useRef<any>(null);
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
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const clearStopTimeout = useCallback(() => {
    if (stopTimeoutRef.current) { clearTimeout(stopTimeoutRef.current); stopTimeoutRef.current = null; }
  }, []);

  const stopAudioProcessing = useCallback(() => {
    clearSampler();
    analyserRef.current = null;
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    if (ctx && ctx.state !== "closed") {
      ctx.close().catch(() => undefined);
    }
  }, [clearSampler]);

  const resetToIdle = useCallback(() => {
    clearTimer();
    clearStopTimeout();
    stopAudioProcessing();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    const audio = previewAudioRef.current;
    if (audio) { audio.pause(); audio.currentTime = 0; }

    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    waveformHistoryRef.current = [];
    discardRecordingRef.current = false;
    pausedRef.current = false;

    setRecordingPaused(false);
    setRecordingTime(0);
    setWaveformBars(createEmptyBars());
    setDraftBlob(null);
    setManagedDraftUrl(null);
    setPreviewPlaying(false);
    setPreviewProgress(0);
    setPreviewDuration(0);
    setMode("idle");
  }, [clearTimer, clearStopTimeout, setManagedDraftUrl, stopAudioProcessing]);

  const startMeter = useCallback(() => {
    clearSampler();
    const analyser = analyserRef.current;
    if (!analyser) return;

    const dataArray = new Uint8Array(analyser.fftSize);

    sampleTimerRef.current = setInterval(() => {
      analyser.getByteTimeDomainData(dataArray);
      let peak = 0;
      for (let i = 0; i < dataArray.length; i++) {
        peak = Math.max(peak, Math.abs(dataArray[i] - 128) / 128);
      }
      const prev = waveformHistoryRef.current[waveformHistoryRef.current.length - 1] ?? MIN_LEVEL;
      const target = pausedRef.current ? MIN_LEVEL : Math.max(MIN_LEVEL, Math.min(1, peak * 2.8));
      const smooth = prev * 0.45 + target * 0.55;
      const next = [...waveformHistoryRef.current, clampLevel(smooth)].slice(-MAX_WAVEFORM_SAMPLES);
      waveformHistoryRef.current = next;
      setWaveformBars(compressLevelsToBars(next));
    }, LIVE_SAMPLE_MS);
  }, [clearSampler]);

  const startRecordingTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setInterval(() => {
      if (mediaRecorderRef.current?.state === "recording" && !pausedRef.current) {
        setRecordingTime((t) => t + 1);
      }
    }, 1000);
  }, [clearTimer]);

  const finalizeDraft = useCallback(() => {
    clearStopTimeout();

    if (discardRecordingRef.current) {
      discardRecordingRef.current = false;
      resetToIdle();
      return;
    }

    const mimeType = mediaRecorderRef.current?.mimeType || getBestMimeType() || "audio/ogg;codecs=opus";
    const blob = new Blob(audioChunksRef.current, { type: mimeType });

    console.log(`[AudioRecorder] Draft finalized: size=${blob.size}, type=${blob.type}, chunks=${audioChunksRef.current.length}`);

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
  }, [clearStopTimeout, resetToIdle, setManagedDraftUrl]);

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
      streamRef.current = stream;

      const ACtor = window.AudioContext || (window as any).webkitAudioContext;
      if (ACtor) {
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
      }

      let recorder: any;

      try {
        const OpusMediaRecorder = (await import("opus-media-recorder")).default;
        const workerOptions = {
          OggOpusEncoderWasmPath: "/OggOpusEncoder.wasm",
          WebMOpusEncoderWasmPath: "/WebMOpusEncoder.wasm",
          encoderWorkerFactory: () => new Worker("/encoderWorker.umd.js"),
        };

        recorder = new OpusMediaRecorder(stream, { mimeType: "audio/ogg;codecs=opus" }, workerOptions);
        console.log("[AudioRecorder] Using Opus recorder: audio/ogg;codecs=opus");
      } catch (polyfillError) {
        const mimeType = getBestMimeType();
        const recorderOptions: MediaRecorderOptions = {};
        if (mimeType) recorderOptions.mimeType = mimeType;
        recorder = new MediaRecorder(stream, recorderOptions);
        console.warn("[AudioRecorder] Falling back to native MediaRecorder", polyfillError);
        console.log(`[AudioRecorder] Using fallback MIME type: ${mimeType || "(default)"}`);
      }

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onerror = () => { toast.error("Erro ao gravar áudio"); resetToIdle(); };
      recorder.onstop = () => {
        clearTimer();
        clearStopTimeout();
        stopAudioProcessing();
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        setRecordingPaused(false);
        pausedRef.current = false;
        finalizeDraft();
      };

      recorder.start();

      if (!discardRecordingRef.current) {
        setMode("recording");
        startRecordingTimer();
      }
    } catch (err: any) {
      resetToIdle();
      toast.error(err?.message || "Não foi possível acessar o microfone");
    }
  }, [disabled, finalizeDraft, mode, resetToIdle, startMeter, startRecordingTimer, clearTimer, clearStopTimeout, stopAudioProcessing]);

  const togglePauseRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (!rec || mode === "preparing") return;
    if (rec.state === "recording") {
      rec.pause();
      pausedRef.current = true;
      setRecordingPaused(true);
    } else if (rec.state === "paused") {
      rec.resume();
      pausedRef.current = false;
      setRecordingPaused(false);
    }
  }, [mode]);

  const stopRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;

    // Failsafe: if onstop never fires, force reset
    clearStopTimeout();
    stopTimeoutRef.current = setTimeout(() => {
      console.warn("[AudioRecorder] MediaRecorder hung — forcing reset");
      resetToIdle();
    }, STOP_FAILSAFE_MS);

    try { rec.requestData?.(); } catch {}
    try { rec.stop(); } catch { resetToIdle(); }
  }, [clearStopTimeout, resetToIdle]);

  const discardCurrentAudio = useCallback(() => {
    if (mode === "preview") { resetToIdle(); return; }
    if (mode === "preparing" || mode === "recording") {
      discardRecordingRef.current = true;
      try { mediaRecorderRef.current?.stop(); } catch { resetToIdle(); }
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

  // Cleanup on unmount
  useEffect(() => () => resetToIdle(), [resetToIdle]);

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
