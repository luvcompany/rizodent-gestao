/**
 * Gravação nativa + troca de embalagem (WebM/Opus -> Ogg/Opus).
 *
 * Por que existe: o Chrome não grava `audio/ogg;codecs=opus` (só WebM/Opus e
 * MP4/AAC), então o app cai no polyfill WASM (opus-media-recorder). Esse
 * polyfill só liga o microfone ao encoder depois de baixar ~270 KB
 * (OggOpusEncoder.wasm + encoderWorker.umd.js) — e, por isso, os primeiros
 * segundos após o clique não são capturados.
 *
 * A saída: o Chrome JÁ grava em Opus, só que dentro de um container WebM. O
 * codec é o mesmo que o WhatsApp exige; muda apenas a embalagem. Gravar nativo
 * (instantâneo) e reembalar para Ogg depois de parar mantém o arquivo final em
 * Ogg/Opus — que é o único formato que a Meta aceita como MENSAGEM DE VOZ
 * ("Voice messages must be Ogg files encoded with the OPUS codec"). Enviar
 * MP4/AAC entregaria um anexo de áudio, não uma nota de voz.
 *
 * A reembalagem copia os pacotes de áudio sem recodificar, roda depois da
 * gravação (não atrasa o início) e nada muda no servidor: o arquivo continua
 * chegando como Ogg/Opus.
 */

/** MIME nativo preferido para gravar antes da reembalagem. */
export const NATIVE_OPUS_MIME = "audio/webm;codecs=opus";

const supportsMime = (mime: string) =>
  typeof MediaRecorder !== "undefined" &&
  typeof MediaRecorder.isTypeSupported === "function" &&
  MediaRecorder.isTypeSupported(mime);

/** O navegador grava Opus nativo em WebM? (Chrome/Edge sim; Firefox já tem Ogg nativo.) */
export function podeGravarOpusNativo(): boolean {
  return supportsMime(NATIVE_OPUS_MIME);
}

let mediabunnyPromise: Promise<typeof import("mediabunny") | null> | null = null;

/**
 * Carrega o remuxer. É JS puro (sem WASM) e ordens de grandeza menor que o
 * encoder do polyfill; ainda assim é pré-carregado para não custar nada no envio.
 */
export function preloadRemuxer() {
  if (!mediabunnyPromise) {
    mediabunnyPromise = import("mediabunny").catch(() => null);
  }
  return mediabunnyPromise;
}

/**
 * Reembala WebM/Opus em Ogg/Opus. Devolve `null` se algo falhar — quem chama
 * deve cair no caminho antigo (polyfill), nunca enviar o WebM cru: a Meta não
 * aceita esse container e o transcritor interno o trata como gravação de ligação.
 */
export async function remuxWebmParaOgg(webm: Blob): Promise<Blob | null> {
  try {
    const mb = await preloadRemuxer();
    if (!mb) return null;

    const input = new mb.Input({
      source: new mb.BlobSource(webm),
      formats: [new mb.WebMInputFormat()],
    });
    const output = new mb.Output({
      format: new mb.OggOutputFormat(),
      target: new mb.BufferTarget(),
    });

    const conversion = await mb.Conversion.init({ input, output });
    await conversion.execute();

    const buffer = (output.target as { buffer: ArrayBuffer | null }).buffer;
    if (!buffer || buffer.byteLength < 100) return null;

    return new Blob([buffer], { type: "audio/ogg" });
  } catch (err) {
    console.warn("[audioRemux] falha ao reembalar em Ogg, usando o caminho padrão:", err);
    return null;
  }
}
