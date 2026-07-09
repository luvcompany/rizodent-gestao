import { useState, useRef, useEffect, useCallback } from "react";
import { Play, Pause } from "lucide-react";

const SPEEDS = [1, 1.5, 2] as const;

// Global registry to ensure only one audio plays at a time across the app
let currentlyPlayingAudio: HTMLAudioElement | null = null;

export default function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      // While we're forcing duration resolution, currentTime jumps huge — ignore.
      if (isFinite(audio.duration)) setProgress(audio.currentTime);
    };
    const onMeta = () => {
      if (audio.duration === Infinity || isNaN(audio.duration)) {
        // Workaround: MediaRecorder-produced webm files often report Infinity duration.
        // Seeking past the end forces the browser to compute the real duration.
        const onDur = () => {
          if (isFinite(audio.duration)) {
            setDuration(audio.duration);
            audio.currentTime = 0;
            audio.removeEventListener("durationchange", onDur);
          }
        };
        audio.addEventListener("durationchange", onDur);
        try { audio.currentTime = 1e9; } catch { /* noop */ }
      } else {
        setDuration(audio.duration);
      }
    };
    const onEnd = () => {
      setPlaying(false);
      if (currentlyPlayingAudio === audio) currentlyPlayingAudio = null;
    };
    const onPlay = () => {
      audio.playbackRate = SPEEDS[speedIdx];
    };
    const onPause = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      if (currentlyPlayingAudio === audio) {
        currentlyPlayingAudio = null;
      }
    };
  }, [speedIdx]);

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      if (currentlyPlayingAudio === audio) currentlyPlayingAudio = null;
      setPlaying(false);
    } else {
      // Pause any other audio currently playing
      if (currentlyPlayingAudio && currentlyPlayingAudio !== audio) {
        currentlyPlayingAudio.pause();
      }
      audio.playbackRate = SPEEDS[speedIdx];
      audio.play();
      currentlyPlayingAudio = audio;
      setPlaying(true);
    }
  }, [playing, speedIdx]);

  const cycleSpeed = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = SPEEDS[next];
    }
  }, [speedIdx]);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    if (audioRef.current) audioRef.current.currentTime = pct * duration;
  }, [duration]);

  const fmt = (s: number) => {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-w-[220px] max-w-[280px]">
      <audio ref={audioRef} src={src} preload="metadata" />
      <div className="flex items-center gap-2">
        <button onClick={toggle} className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center hover:bg-primary/30 transition-colors">
          {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="h-1.5 bg-muted rounded-full cursor-pointer relative" onClick={seek}>
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: duration ? `${(progress / duration) * 100}%` : "0%" }} />
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="text-[10px] text-muted-foreground">{fmt(progress)}</span>
            <span className="text-[10px] text-muted-foreground">{fmt(duration)}</span>
          </div>
        </div>
        <button onClick={cycleSpeed} className="flex-shrink-0 text-[10px] font-bold text-primary bg-primary/10 rounded px-1.5 py-0.5 hover:bg-primary/20 transition-colors">
          {SPEEDS[speedIdx]}x
        </button>
      </div>
    </div>
  );
}
