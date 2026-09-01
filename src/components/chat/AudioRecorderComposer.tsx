import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { NATIVE_OPUS_MIME, abrirMicrofone, podeGravarOpusNativo, preloadRemuxer, remuxWebmParaOgg } from "@/lib/audioRemux";
import { Loader2, Mic, Pause, Play, Send, Square, X } from "lucide-react";

type AudioRecorderComposerProps = {
  disabled?: boolean;
  onSendAudio: (audioBlob: Blob) => Promise<void> | void;
  onModeChange?: (active: boolean) => void;
  showMicButton?: boolean;
  autoStart?: boolean;
  preferredMimeTypes?: string[];
  /**
   * Padrão do sistema: grava no formato nativo do navegador (WebM/Opus,
   * instantâneo) e reembala em Ogg/Opus depois de parar, em vez de esperar o
   * encoder WASM carregar — o que fazia os primeiros segundos se perderem.
   * Onde o navegador não grava Opus nativo (Safari) ou já grava Ogg (Firefox),
   * o caminho antigo continua valendo sozinho. Passe `false` só para reverter.
   */
  gravacaoNativa?: boolean;
};

type RecorderMode = "idle" | "preparing" | "recording" | "preview" | "sending";

const BAR_COUNT = 48;
const MIN_LEVEL = 0.06;
// 100 ms (não 60): em máquina fraca, redesenhar 48 barras a 16x por segundo
// disputava CPU com o próprio encoder. A 10x por segundo o visual não muda.
const LIVE_SAMPLE_MS = 100;
const MAX_WAVEFORM_SAMPLES = 300;
// Teto do "Preparando…": se em 12 s a captura não começou (microfone mudo,
// encoder que não carregou), a gravação é desfeita com o motivo na tela —
// antes ficava presa nesse estado para sempre, com o cancelar inerte.
const PREPARO_MAX_MS = 12_000;

let opusModulePromise: Promise<any> | null = null;
let opusWarmStarted = false;

function preloadOpusRecorder() {
  if (!opusModulePromise) {
    opusModulePromise = import("opus-media-recorder").then((m) => m.default).catch(() => null);
  }
  return opusModulePromise;
}

const supportsMime = (mime: string) =>
  typeof MediaRecorder !== "undefined" &&
  typeof MediaRecorder.isTypeSupported === "function" &&
  MediaRecorder.isTypeSupported(mime);

/**
 * Baixa o polyfill (chunk JS + worker + 225 KB de WASM) ANTES do clique.
 * Sem isso o download só começa dentro de startRecording e o encoder leva
 * segundos para ligar o microfone — tempo em que nada é capturado, embora as
 * barras de nível já reajam à voz. Idempotente e silencioso.
 */
function warmOpusRecorder() {
  if (opusWarmStarted) return;
  opusWarmStarted = true;
  void preloadOpusRecorder();
  try {
    void fetch("/encoderWorker.umd.js", { cache: "force-cache" }).catch(() => undefined);
    void fetch("/OggOpusEncoder.wasm", { cache: "force-cache" }).catch(() => undefined);
  } catch { /* noop */ }
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
  autoStart = false,
  preferredMimeTypes,
  gravacaoNativa = true,
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
  // Gravação nativa: o blob sai em WebM e precisa virar Ogg antes de ir ao chat.
  const precisaRemuxRef = useRef(false);
  // Só é verdade quando o encoder está de fato recebendo áudio. No polyfill o
  // `recorder.state` vira "recording" antes disso, e o medidor de nível passava
  // a reagir à voz enquanto nada era gravado.
  const captureStartedRef = useRef(false);
  const currentDraftUrlRef = useRef<string | null>(null);
  const discardRecordingRef = useRef(false);
  const pausedRef = useRef(false);
  // Cão de guarda do arranque (ver PREPARO_MAX_MS).
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (ctx && ctx.state !== "closed") {
      ctx.close().catch(() => undefined);
    }
  }, [clearSampler]);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
  }, []);

  const resetToIdle = useCallback(() => {
    clearTimer();
    clearWatchdog();
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
    captureStartedRef.current = false;
    precisaRemuxRef.current = false;
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
  }, [clearTimer, clearWatchdog, setManagedDraftUrl, stopAudioProcessing]);

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

  const finalizeDraft = useCallback(async () => {
    if (discardRecordingRef.current) {
      discardRecordingRef.current = false;
      precisaRemuxRef.current = false;
      resetToIdle();
      return;
    }

    const mimeType = mediaRecorderRef.current?.mimeType || "audio/ogg;codecs=opus";
    let blob = new Blob(audioChunksRef.current, { type: mimeType });

    // Gravação nativa: troca a embalagem WebM -> Ogg mantendo os pacotes Opus.
    // A Meta só entrega como MENSAGEM DE VOZ o que chega em Ogg/Opus; WebM ela
    // nem aceita. Se a reembalagem falhar, descartamos a gravação em vez de
    // enviar um arquivo que o paciente não conseguiria ouvir.
    if (precisaRemuxRef.current) {
      precisaRemuxRef.current = false;
      const ogg = await remuxWebmParaOgg(blob);
      if (!ogg) {
        toast.error("Não foi possível preparar o áudio. Grave novamente.");
        resetToIdle();
        return;
      }
      blob = ogg;
    }

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

  /**
   * Deixa pronto, antes do clique, o que a gravação vai precisar: o remuxer no
   * caminho nativo (JS puro, alguns KB) ou o codificador WASM no caminho padrão.
   * Não faz nada onde o navegador grava Ogg direto (Firefox) nem no Instagram,
   * que já usa formato nativo.
   */
  const aquecerCodificador = useCallback(() => {
    if (preferredMimeTypes?.some(supportsMime)) return;
    if (supportsMime("audio/ogg;codecs=opus")) return;
    if (gravacaoNativa && podeGravarOpusNativo()) {
      void preloadRemuxer();
      return;
    }
    warmOpusRecorder();
  }, [gravacaoNativa, preferredMimeTypes]);

  useEffect(() => {
    if (disabled) return;
    const t = setTimeout(aquecerCodificador, 400);
    return () => clearTimeout(t);
  }, [disabled, aquecerCodificador]);

  const startRecording = useCallback(async () => {
    if (disabled || mode !== "idle") return;

    // Dispara o carregamento do codificador em PARALELO com o microfone. Antes
    // as duas esperas eram em série: só depois de o microfone abrir é que os
    // ~270 KB começavam a baixar.
    aquecerCodificador();
    setMode("preparing");
    setRecordingTime(0);
    setRecordingPaused(false);
    pausedRef.current = false;
    setWaveformBars(createEmptyBars());
    waveformHistoryRef.current = [];
    audioChunksRef.current = [];
    discardRecordingRef.current = false;
    captureStartedRef.current = false;
    precisaRemuxRef.current = false;

    // Cão de guarda: nada abaixo pode prender o "Preparando…" para sempre.
    // Se a captura não começar no prazo, desfaz tudo e explica.
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      if (captureStartedRef.current || discardRecordingRef.current) return;
      try { mediaRecorderRef.current?.stop?.(); } catch { /* já vamos resetar */ }
      resetToIdle();
      toast.error("A gravação não conseguiu começar. Feche outros programas que usam o microfone e tente de novo.");
    }, PREPARO_MAX_MS);

    try {
      const stream = await abrirMicrofone();

      // O usuário pode ter clicado no X enquanto o microfone abria — antes
      // esse clique não fazia nada (não havia gravador para parar) e, pior, a
      // gravação começava depois do "cancelamento".
      if (discardRecordingRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        resetToIdle();
        return;
      }
      streamRef.current = stream;

      // Create recorder
      let recorder: any;
      const preferredNativeMime = preferredMimeTypes?.find((mimeType) =>
        typeof MediaRecorder !== "undefined" &&
        typeof MediaRecorder.isTypeSupported === "function" &&
        MediaRecorder.isTypeSupported(mimeType)
      );
      const nativeOgg =
        typeof MediaRecorder !== "undefined" &&
        typeof MediaRecorder.isTypeSupported === "function" &&
        MediaRecorder.isTypeSupported("audio/ogg;codecs=opus");

      // Caminho nativo (em avaliação no perfil closer): o navegador já grava em
      // Opus, só que em WebM. Gravar assim começa na hora — o container vira Ogg
      // depois de parar, em finalizeDraft. Perde-se nada de qualidade: os
      // pacotes são copiados, não recodificados.
      const usarNativo = gravacaoNativa && !preferredNativeMime && !nativeOgg && podeGravarOpusNativo();

      if (preferredNativeMime) {
        recorder = new MediaRecorder(stream, { mimeType: preferredNativeMime });
      } else if (usarNativo) {
        recorder = new MediaRecorder(stream, { mimeType: NATIVE_OPUS_MIME });
        precisaRemuxRef.current = true;
      } else if (nativeOgg) {
        recorder = new MediaRecorder(stream, { mimeType: "audio/ogg;codecs=opus" });
      } else {
        // O download do polyfill (~270 KB + WASM) também tem teto: em conexão
        // lenta ele podia pendurar o preparo indefinidamente.
        const OpusMediaRecorder = await Promise.race([
          preloadOpusRecorder(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
        ]);
        if (!OpusMediaRecorder) throw new Error("O gravador demorou a carregar (conexão lenta?). Tente de novo.");
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

      recorder.ondataavailable = (e: any) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onerror = (e: any) => {
        const detalhe = e?.error?.message || e?.error?.name;
        toast.error(detalhe ? `Erro ao gravar áudio: ${detalhe}` : "Erro ao gravar áudio");
        resetToIdle();
      };
      recorder.onstart = () => {
        if (discardRecordingRef.current) return;
        clearWatchdog();
        captureStartedRef.current = true;
        startMeter();
        setMode("recording");
        startRecordingTimer();
      };
      recorder.onstop = () => {
        clearTimer();
        stopAudioProcessing();
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        setRecordingPaused(false);
        pausedRef.current = false;
        finalizeDraft();
      };

      // Start recording immediately — no warmup delay
      recorder.start(500);

      // Set up audio analyser after the recorder starts so capture begins as early as possible
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
          // captureStartedRef, e não recorder.state: no polyfill o state já é
          // "recording" antes de o microfone ser ligado ao encoder, e as barras
          // reagiam à voz enquanto nada estava sendo gravado.
          if (captureStartedRef.current && !discardRecordingRef.current) {
            startMeter();
          }
        } catch {
          analyserRef.current = null;
        }
      }
    } catch (err: any) {
      resetToIdle();
      toast.error(err?.message || "Não foi possível acessar o microfone");
    }
  }, [aquecerCodificador, clearWatchdog, disabled, finalizeDraft, gravacaoNativa, mode, preferredMimeTypes, resetToIdle, startMeter, startRecordingTimer, clearTimer, stopAudioProcessing]);

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
    try { rec.requestData?.(); } catch { /* nem todo gravador implementa */ }
    // Um gravador em estado inválido (máquina travada no meio) lançava aqui e
    // deixava a UI presa em "gravando" sem gravador por trás.
    try { rec.stop(); } catch { resetToIdle(); }
  }, [resetToIdle]);

  const discardCurrentAudio = useCallback(() => {
    if (mode === "preview") { resetToIdle(); return; }
    if (mode === "preparing" || mode === "recording") {
      discardRecordingRef.current = true;
      // Sem gravador ainda (microfone abrindo): não há o que parar — o reset é
      // direto. Antes o `?.stop()` virava um não-fazer-nada silencioso e o X
      // parecia quebrado justamente quando o preparo travava.
      const rec = mediaRecorderRef.current;
      if (!rec) { resetToIdle(); return; }
      try { rec.stop(); } catch { resetToIdle(); }
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
      // Error toasts are shown by onSendAudio — just return to preview
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

  // Auto-start recording when requested by parent
  useEffect(() => {
    if (autoStart && mode === "idle" && !disabled) {
      startRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const activePreviewBars = useMemo(() => {
    if (!previewDuration) return 0;
    return Math.min(waveformBars.length, Math.round((previewProgress / previewDuration) * waveformBars.length));
  }, [previewDuration, previewProgress, waveformBars.length]);

  const formatTime = (s: number) => {
    const safe = Number.isFinite(s) ? Math.max(0, Math.round(s)) : 0;
    return `${Math.floor(safe / 60)}:${(safe % 60).toString().padStart(2, "0")}`;
  };

  // ─── IDLE: just the mic button ───
  if (mode === "idle") {
    if (!showMicButton) return null;
    return (
      <button
        onClick={startRecording}
        onPointerEnter={aquecerCodificador}
        onFocus={aquecerCodificador}
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
        <span className="min-w-[4.5rem] text-xs font-medium tabular-nums text-foreground">
          {mode === "preparing" ? "Preparando…" : formatTime(recordingTime)}
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
