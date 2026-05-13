// Loads ffmpeg.wasm from CDN and converts arbitrary audio blobs to MP3.
// Used for Instagram audio sending — Instagram's API does not accept WebM/Opus.

declare global {
  interface Window {
    FFmpeg?: any;
    FFmpegUtil?: any;
    __ffmpegInstance?: any;
    __ffmpegLoadingPromise?: Promise<any>;
  }
}

const FFMPEG_UMD = "https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/umd/ffmpeg.js";
const FFMPEG_UTIL_UMD = "https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/index.js";
const FFMPEG_CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(s);
  });
}

async function getFFmpeg(): Promise<{ ffmpeg: any; util: any }> {
  if (window.__ffmpegInstance) {
    return { ffmpeg: window.__ffmpegInstance, util: window.FFmpegUtil };
  }
  if (window.__ffmpegLoadingPromise) {
    const ff = await window.__ffmpegLoadingPromise;
    return { ffmpeg: ff, util: window.FFmpegUtil };
  }

  window.__ffmpegLoadingPromise = (async () => {
    await Promise.all([loadScript(FFMPEG_UMD), loadScript(FFMPEG_UTIL_UMD)]);
    const FFmpegCtor = window.FFmpeg?.FFmpeg;
    if (!FFmpegCtor) throw new Error("FFmpeg UMD não disponível");
    const ffmpeg = new FFmpegCtor();
    await ffmpeg.load({
      coreURL: `${FFMPEG_CORE_BASE}/ffmpeg-core.js`,
      wasmURL: `${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`,
    });
    window.__ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  const ffmpeg = await window.__ffmpegLoadingPromise;
  return { ffmpeg, util: window.FFmpegUtil };
}

export async function convertAudioBlobToMp3(blob: Blob): Promise<Blob> {
  const { ffmpeg, util } = await getFFmpeg();
  const inputName = `input_${Date.now()}.webm`;
  const outputName = `output_${Date.now()}.mp3`;
  const data = await util.fetchFile(blob);
  await ffmpeg.writeFile(inputName, data);
  await ffmpeg.exec(["-i", inputName, "-vn", "-acodec", "libmp3lame", "-b:a", "128k", outputName]);
  const out = await ffmpeg.readFile(outputName);
  try { await ffmpeg.deleteFile(inputName); } catch {}
  try { await ffmpeg.deleteFile(outputName); } catch {}
  const buffer = (out as Uint8Array).buffer;
  return new Blob([buffer], { type: "audio/mpeg" });
}
