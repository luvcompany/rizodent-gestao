import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Mic, Pause, Play, Send, Square, X } from "lucide-react";

type AudioRecorderComposerProps = {
  disabled?: boolean;
  onSendAudio: (audioBlob: Blob) => Promise<void> | void;
  onModeChange?: (active: boolean) => void;
};

type RecorderMode = "idle" | "preparing" | "recording" | "preview" | "sending";

const BAR_COUNT = 88;
const MIN_LEVEL = 0.08;
const LIVE_SAMPLE_MS = 70;
const RECORDER_WARMUP_MS = 320;
const MAX_WAVEFORM_SAMPLES = 320;

let opusModulePromise: Promise<any> | null = null;

function preloadOpusRecorder() {
  if (!opusModulePromise) {
    opusModulePromise = import("opus-media-recorder").then((module) => module.default).catch(() => null);
  }

  return opusModulePromise;
}

const createEmptyBars = () => Array.from({ length: BAR_COUNT }, () => MIN_LEVEL);

const clampLevel = (level: number) => Math.min(1, Math.max(MIN_LEVEL, level));

const compressLevelsToBars = (levels: number[]) => {
  if (!levels.length) return createEmptyBars();

  if (levels.length <= BAR_COUNT) {
    return [...Array.from({ length: BAR_COUNT - levels.length }, () => MIN_LEVEL), ...levels.map(clampLevel)];
  }

  const bucketSize = levels.length / BAR_COUNT;
  return Array.from({ length: BAR_COUNT }, (_, index) => {
    const start = Math.floor(index * bucketSize);
    const end = Math.max(start + 1, Math.floor((index + 1) * bucketSize));
    const slice = levels.slice(start, end);
    const peak = slice.reduce((max, value) => Math.max(max, value), MIN_LEVEL);
    return clampLevel(peak);
  });
};

export default function AudioRecorderComposer({ disabled = false, onSendAudio, onModeChange }: AudioRecorderComposerProps) {
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
  const warmupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement>(null);
  const waveformHistoryRef = useRef<number[]>([]);
  const currentDraftUrlRef = useRef<string | null>(null);
  const discardRecordingRef = useRef(false);
  const pausedRef = useRef(false);

  const setManagedDraftUrl = useCallback((nextUrl: string | null) => {
    if (currentDraftUrlRef.current?.startsWith("blob:")) {
      URL.revokeObjectURL(currentDraftUrlRef.current);
    }

    currentDraftUrlRef.current = nextUrl;
    setDraftUrl(nextUrl);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearSampler = useCallback(() => {
    if (sampleTimerRef.current) {
      clearInterval(sampleTimerRef.current);
      sampleTimerRef.current = null;
    }
  }, []);

  const clearWarmup = useCallback(() => {
    if (warmupTimerRef.current) {
      clearTimeout(warmupTimerRef.current);
      warmupTimerRef.current = null;
    }
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
    clearWarmup();
    stopAudioProcessing();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    const previewAudio = previewAudioRef.current;
    if (previewAudio) {
      previewAudio.pause();
      previewAudio.currentTime = 0;
    }

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
  }, [clearTimer, clearWarmup, setManagedDraftUrl, stopAudioProcessing]);

  const startMeter = useCallback(() => {
    clearSampler();

    const analyser = analyserRef.current;
    if (!analyser) return;

    const dataArray = new Uint8Array(analyser.fftSize);

    sampleTimerRef.current = setInterval(() => {
      analyser.getByteTimeDomainData(dataArray);

      let peak = 0;
      for (let index = 0; index < dataArray.length; index += 1) {
        peak = Math.max(peak, Math.abs(dataArray[index] - 128) / 128);
      }

      const previousLevel = waveformHistoryRef.current[waveformHistoryRef.current.length - 1] ?? MIN_LEVEL;
      const targetLevel = pausedRef.current ? MIN_LEVEL : Math.max(MIN_LEVEL, Math.min(1, peak * 2.8));
      const smoothedLevel = previousLevel * 0.5 + targetLevel * 0.5;
      const nextHistory = [...waveformHistoryRef.current, clampLevel(smoothedLevel)].slice(-MAX_WAVEFORM_SAMPLES);

      waveformHistoryRef.current = nextHistory;
      setWaveformBars(compressLevelsToBars(nextHistory));
    }, LIVE_SAMPLE_MS);
  }, [clearSampler]);

  const startRecordingTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setInterval(() => {
      if (mediaRecorderRef.current?.state === "recording" && !pausedRef.current) {
        setRecordingTime((currentTime) => currentTime + 1);
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
    const recordedBlob = new Blob(audioChunksRef.current, { type: mimeType });

    if (recordedBlob.size < 100) {
      toast.error("Gravação muito curta ou vazia.");
      resetToIdle();
      return;
    }

    if (recordedBlob.size > 15 * 1024 * 1024) {
      toast.warning("Áudio muito longo. Considere gravar em partes menores.");
      resetToIdle();
      return;
    }

    setDraftBlob(recordedBlob);
    setManagedDraftUrl(URL.createObjectURL(recordedBlob));
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
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextConstructor) {
        const audioContext = new AudioContextConstructor();
        await audioContext.resume();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.72;
        source.connect(analyser);
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
        startMeter();
      }

      let recorder: any;
      const nativeOggSupported = typeof MediaRecorder !== "undefined"
        && typeof MediaRecorder.isTypeSupported === "function"
        && MediaRecorder.isTypeSupported("audio/ogg;codecs=opus");

      if (nativeOggSupported) {
        recorder = new MediaRecorder(stream, { mimeType: "audio/ogg;codecs=opus" });
      } else {
        const OpusMediaRecorder = await preloadOpusRecorder();
        if (!OpusMediaRecorder) {
          throw new Error("Erro ao carregar gravador de áudio");
        }

        recorder = new OpusMediaRecorder(
          stream,
          { mimeType: "audio/ogg;codecs=opus" },
          {
            OggOpusEncoderWasmPath: "/OggOpusEncoder.wasm",
            WebMOpusEncoderWasmPath: "/WebMOpusEncoder.wasm",
            encoderWorkerFactory: () => new Worker("/encoderWorker.umd.js"),
          },
        );
      }

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent | { data?: Blob }) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        toast.error("Erro ao gravar áudio");
        resetToIdle();
      };

      recorder.onstop = () => {
        clearTimer();
        clearWarmup();
        stopAudioProcessing();

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }

        setRecordingPaused(false);
        pausedRef.current = false;
        finalizeDraft();
      };

      recorder.start(100);
      warmupTimerRef.current = setTimeout(() => {
        if (!discardRecordingRef.current) {
          setMode("recording");
          startRecordingTimer();
        }
      }, RECORDER_WARMUP_MS);
    } catch (error: any) {
      resetToIdle();
      toast.error(error?.message || "Não foi possível acessar o microfone");
    }
  }, [disabled, finalizeDraft, mode, resetToIdle, startMeter, startRecordingTimer]);

  const togglePauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || mode === "preparing") return;

    if (recorder.state === "recording") {
      recorder.pause();
      pausedRef.current = true;
      setRecordingPaused(true);
      return;
    }

    if (recorder.state === "paused") {
      recorder.resume();
      pausedRef.current = false;
      setRecordingPaused(false);
    }
  }, [mode]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    try {
      recorder.requestData?.();
    } catch {
      // noop
    }

    recorder.stop();
  }, []);

  const discardCurrentAudio = useCallback(() => {
    if (mode === "preview") {
      resetToIdle();
      return;
    }

    if (mode === "preparing" || mode === "recording") {
      discardRecordingRef.current = true;
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        resetToIdle();
      }
      return;
    }

    resetToIdle();
  }, [mode, resetToIdle]);

  const togglePreviewPlayback = useCallback(async () => {
    const audio = previewAudioRef.current;
    if (!audio || !draftUrl) return;

    if (previewPlaying) {
      audio.pause();
      return;
    }

    if (previewDuration && previewProgress >= previewDuration) {
      audio.currentTime = 0;
    }

    try {
      await audio.play();
    } catch {
      toast.error("Não foi possível reproduzir o áudio gravado");
    }
  }, [draftUrl, previewDuration, previewPlaying, previewProgress]);

  const sendDraft = useCallback(async () => {
    if (!draftBlob || mode === "sending") return;

    setMode("sending");

    try {
      await onSendAudio(draftBlob);
      resetToIdle();
    } catch (error: any) {
      setMode("preview");
      toast.error(error?.message || "Erro ao enviar áudio");
    }
  }, [draftBlob, mode, onSendAudio, resetToIdle]);

  useEffect(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;

    const handlePlay = () => setPreviewPlaying(true);
    const handlePause = () => setPreviewPlaying(false);
    const handleLoadedMetadata = () => setPreviewDuration(audio.duration || 0);
    const handleTimeUpdate = () => setPreviewProgress(audio.currentTime || 0);
    const handleEnded = () => {
      setPreviewPlaying(false);
      setPreviewProgress(audio.duration || 0);
    };

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [draftUrl]);

  useEffect(() => () => resetToIdle(), [resetToIdle]);

  useEffect(() => {
    onModeChange?.(mode !== "idle");
  }, [mode, onModeChange]);

  const activePreviewBars = useMemo(() => {
    if (!previewDuration) return 0;
    return Math.min(waveformBars.length, Math.round((previewProgress / previewDuration) * waveformBars.length));
  }, [previewDuration, previewProgress, waveformBars.length]);

  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;

  if (mode === "idle") {
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

  if (mode === "preview" || mode === "sending") {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2 shadow-sm">
        <audio key={draftUrl || "draft"} ref={previewAudioRef} src={draftUrl || undefined} preload="metadata" />

        <Button type="button" size="sm" onClick={sendDraft} disabled={mode === "sending"}>
          {mode === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar"}
        </Button>

        <button
          type="button"
          onClick={togglePreviewPlayback}
          className="rounded-xl border border-border bg-secondary p-2 text-primary transition-colors hover:bg-secondary/80"
          title={previewPlaying ? "Pausar prévia" : "Ouvir antes de enviar"}
        >
          {previewPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-[2px] overflow-hidden rounded-xl bg-secondary/40 px-2 py-2">
          {waveformBars.map((level, index) => (
            <span
              key={`preview-bar-${index}`}
              className={index < activePreviewBars ? "rounded-full bg-primary" : "rounded-full bg-primary/35"}
              style={{
                width: "3px",
                minWidth: "3px",
                height: `${Math.max(4, Math.round(level * 28))}px`,
              }}
            />
          ))}
        </div>

        <span className="w-10 flex-shrink-0 text-right text-sm font-medium text-muted-foreground">
          {formatTime(previewDuration || recordingTime)}
        </span>

        <button
          type="button"
          onClick={discardCurrentAudio}
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2 shadow-sm">
      <button
        type="button"
        onClick={discardCurrentAudio}
        className="rounded-full bg-destructive/10 p-2 text-destructive transition-colors hover:bg-destructive/20"
        title="Cancelar gravação"
      >
        <X size={16} />
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{mode === "preparing" ? "Preparando microfone..." : recordingPaused ? "Gravação pausada" : "Gravando áudio"}</span>
          <span className="font-medium text-foreground">{formatTime(recordingTime)}</span>
        </div>

        <div className="flex h-10 min-w-0 items-center gap-[2px] overflow-hidden rounded-xl bg-secondary/40 px-2 py-1.5">
          {waveformBars.map((level, index) => (
            <span
              key={`record-bar-${index}`}
              className={recordingPaused || mode === "preparing" ? "rounded-full bg-primary/35" : "rounded-full bg-primary"}
              style={{
                width: "3px",
                minWidth: "3px",
                height: `${Math.max(4, Math.round(level * 28))}px`,
              }}
            />
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={togglePauseRecording}
        className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
        disabled={mode === "preparing"}
        title={recordingPaused ? "Retomar gravação" : "Pausar gravação"}
      >
        {recordingPaused ? <Play size={18} /> : <Pause size={18} />}
      </button>

      <Button type="button" size="icon" onClick={stopRecording} disabled={mode === "preparing"} title="Finalizar gravação">
        <Square size={14} />
      </Button>
    </div>
  );
}