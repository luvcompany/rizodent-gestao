// Converts browser-recorded audio (usually OGG/WebM Opus) to a Meta-supported
// WAV voice file without loading ffmpeg.wasm. Instagram accepts WAV audio.

const INSTAGRAM_AUDIO_SAMPLE_RATE = 16_000;
const MAX_INSTAGRAM_AUDIO_BYTES = 25 * 1024 * 1024;

function floatTo16BitPcm(output: DataView, offset: number, input: Float32Array) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function encodeMonoWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);
  floatTo16BitPcm(view, 44, samples);

  return new Blob([view], { type: "audio/wav" });
}

function mixToMono(audioBuffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(audioBuffer.length);
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let i = 0; i < channelData.length; i++) {
      mono[i] += channelData[i] / audioBuffer.numberOfChannels;
    }
  }
  return mono;
}

function resampleLinear(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, input.length - 1);
    const weight = sourceIndex - left;
    output[i] = input[left] * (1 - weight) + input[right] * weight;
  }

  return output;
}

export async function convertAudioBlobToInstagramWav(blob: Blob): Promise<Blob> {
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("Conversão de áudio não suportada neste navegador");
  }

  const audioContext = new AudioContextCtor();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const mono = mixToMono(decoded);
    const resampled = resampleLinear(mono, decoded.sampleRate, INSTAGRAM_AUDIO_SAMPLE_RATE);
    const wav = encodeMonoWav(resampled, INSTAGRAM_AUDIO_SAMPLE_RATE);

    if (wav.size > MAX_INSTAGRAM_AUDIO_BYTES) {
      throw new Error("Áudio maior que 25MB após conversão. Grave em partes menores.");
    }

    return wav;
  } finally {
    audioContext.close().catch(() => undefined);
  }
}
