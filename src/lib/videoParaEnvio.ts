/**
 * Vídeo pronto para o WhatsApp (e para o Direct do Instagram).
 *
 * A Meta só entrega vídeo MP4 com H.264 + AAC, uma faixa de áudio (ou
 * nenhuma), até 16 MB — e H.264 com B-frames não toca no WhatsApp do
 * Android. O que sai da câmera quase nunca é isso: o Chrome grava MP4
 * fragmentado ou WebM (VP8/VP9 + Opus), o iPhone grava .MOV em HEVC a
 * ~60 MB/min e qualquer vídeo de 1 minuto em boa qualidade passa de 16 MB.
 * E o servidor trata .webm como ÁUDIO (send-whatsapp-message), então mandar
 * o arquivo cru quebra o envio.
 *
 * Aqui todo vídeo passa por uma regra só:
 *  - já é H.264 sem B-frames + AAC e cabe → só reembala (moov no início,
 *    sem fragmentos), sem perder qualidade e em milissegundos;
 *  - senão → recodifica em H.264 + AAC, escolhendo resolução e bitrate pela
 *    duração para caber em LIMITE_VIDEO_BYTES (720p, 480p ou 360p);
 *  - e confere o arquivo final antes de liberar o envio.
 *
 * A conversão usa o mediabunny (WebCodecs, sem WASM) em import dinâmico; o
 * codificador AAC em WASM só é baixado no navegador que não tem AAC nativo
 * (Firefox, Chrome no Linux, Safari antes do 26) e só se o áudio precisar ser
 * recodificado.
 */
import type {
  ConversionAudioOptions,
  ConversionVideoOptions,
  Input as MbInput,
  InputAudioTrack,
  InputVideoTrack,
} from "mediabunny";

/** Alvo do arquivo final: abaixo dos 16 MB da Meta (16 MiB no servidor), com folga. */
export const LIMITE_VIDEO_BYTES = 15_000_000;
/** Teto de uma gravação feita pela câmera do CRM. */
export const GRAVACAO_MAX_SEGUNDOS = 180;
/** Bitrate de vídeo pedido ao MediaRecorder na gravação pela câmera. */
export const GRAVACAO_VIDEO_BPS = 2_500_000;
export const GRAVACAO_AUDIO_BPS = 128_000;

const AUDIO_BPS = 96_000;
const AUDIO_COPIA_MAX_BPS = 192_000;
const VIDEO_MAX_BPS = 2_000_000;
const VIDEO_MIN_BPS = 250_000;
const FPS = 30;
/** Fração do limite usada no cálculo do bitrate (o encoder oscila em torno do alvo). */
const FOLGA = 0.92;
const TAXAS_AAC = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** Erro com mensagem pronta para mostrar a quem atende. */
export class ErroDeVideo extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeVideo";
  }
}

/** Como está o arquivo de entrada (lido sem decodificar nada). */
export type SondaDeVideo = {
  duracao: number;
  bytes: number;
  largura: number;
  altura: number;
  videoCodec: string | null;
  videoBps: number;
  temBFrames: boolean;
  audioCodec: string | null;
  audioBps: number;
  audioCanais: number;
  qtdAudio: number;
};

export type PlanoDeVideo =
  | { acao: "impossivel"; motivo: string }
  | {
      acao: "preparar";
      /** null = copiar o vídeo como está (só reembalar). */
      video: null | { bps: number; maxLongo: number; maxCurto: number };
      /** "sem" = arquivo sem áudio; "copiar" = AAC já serve; "converter" = AAC 96 kbps. */
      audio: "sem" | "copiar" | "converter";
    };

/** "5:19" — o tempo do vídeo arredonda para cima e o máximo para baixo, para nunca empatarem. */
const mmss = (seg: number, arredonda: (n: number) => number) => {
  const s = Math.max(0, arredonda(seg));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Decide o que fazer com o vídeo. Função pura: toda a regra de tamanho,
 * resolução e codec está aqui (e nos testes).
 * @param reducao fator aplicado ao orçamento numa nova tentativa (< 1 quando o
 *   arquivo anterior passou do limite; sempre recodifica)
 */
export function planejarVideo(s: SondaDeVideo, reducao = 1): PlanoDeVideo {
  if (!s.videoCodec) return { acao: "impossivel", motivo: "O arquivo não tem imagem de vídeo." };
  if (!(s.duracao > 0.3)) return { acao: "impossivel", motivo: "O vídeo é curto demais ou está vazio. Grave de novo." };

  const temAudio = s.qtdAudio > 0 && !!s.audioCodec;
  const aacServe = temAudio && s.audioCodec === "aac" && s.audioCanais <= 2 && s.audioBps > 0;
  const bpsDoAudio = (a: "sem" | "copiar" | "converter") => (a === "sem" ? 0 : a === "copiar" ? s.audioBps : AUDIO_BPS);

  // Copiar o vídeo: só H.264 sem B-frames e se, com o áudio final, couber.
  const videoServe = s.videoCodec === "avc" && !s.temBFrames && s.videoBps > 0;
  if (reducao === 1 && videoServe) {
    const audio = !temAudio ? "sem" : aacServe && s.audioBps <= AUDIO_COPIA_MAX_BPS ? "copiar" : "converter";
    if (((s.videoBps + bpsDoAudio(audio)) * s.duracao) / 8 <= LIMITE_VIDEO_BYTES * 0.97) {
      return { acao: "preparar", video: null, audio };
    }
  }

  // Recodificando o vídeo, o áudio pesado também cai para 96 kbps (sobra mais para a imagem).
  const audio: "sem" | "copiar" | "converter" = !temAudio ? "sem" : aacServe && s.audioBps <= 128_000 ? "copiar" : "converter";
  const audioBpsFinal = bpsDoAudio(audio);
  const orcamentoBits = LIMITE_VIDEO_BYTES * 8 * FOLGA * reducao;
  const bps = Math.floor(Math.min(VIDEO_MAX_BPS * reducao, orcamentoBits / s.duracao - audioBpsFinal));
  if (bps < VIDEO_MIN_BPS) {
    const maxSeg = orcamentoBits / (VIDEO_MIN_BPS + audioBpsFinal);
    return {
      acao: "impossivel",
      motivo: `Vídeo longo demais para o WhatsApp (${mmss(s.duracao, Math.ceil)}). O máximo é de cerca de ${mmss(maxSeg, Math.floor)} — corte o vídeo e envie em partes.`,
    };
  }
  const [maxLongo, maxCurto] = bps >= 1_000_000 ? [1280, 720] : bps >= 500_000 ? [854, 480] : [640, 360];
  return { acao: "preparar", video: { bps, maxLongo, maxCurto }, audio };
}

/** Dimensões que cabem na caixa sem ampliar, sempre pares (exigência do H.264). */
export function caberNaCaixa(largura: number, altura: number, maxLongo: number, maxCurto: number) {
  const escala = Math.min(1, maxLongo / Math.max(largura, altura), maxCurto / Math.min(largura, altura));
  return {
    largura: Math.max(2, Math.round((largura * escala) / 2) * 2),
    altura: Math.max(2, Math.round((altura * escala) / 2) * 2),
  };
}

/** Nome em ASCII (o Instagram recusa acento no nome do anexo). */
export function nomeDoVideo(agora = Date.now()): string {
  return `video_${agora}.mp4`;
}

/** Formato de gravação da câmera, do mais pronto para o WhatsApp ao que precisa converter. */
export const FORMATOS_DE_GRAVACAO = [
  "video/mp4;codecs=avc1.42E01F,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

export function melhorFormatoDeGravacao(suporta: (mime: string) => boolean): string | undefined {
  return FORMATOS_DE_GRAVACAO.find((m) => {
    try {
      return suporta(m);
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Câmera

/**
 * Abre câmera + microfone com prazo e erros traduzidos (mesma ideia do
 * abrirMicrofone do áudio). Sem microfone, grava só a imagem.
 */
export async function abrirCamera(
  qual: { frente?: "user" | "environment" | null; deviceId?: string | null } = {},
  timeoutMs = 12_000,
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new ErroDeVideo("Este navegador não permite usar a câmera. Use o Chrome ou o Safari atualizado.");
  }
  const video: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
    // Computador com duas webcams não informa "frente/trás": troca pelo aparelho.
    ...(qual.deviceId ? { deviceId: { exact: qual.deviceId } } : qual.frente ? { facingMode: { ideal: qual.frente } } : {}),
  };
  const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  // O prazo só vale com a permissão já dada: enquanto o aviso "Permitir câmera?"
  // está na tela, o getUserMedia fica pendente pelo tempo que a pessoa levar.
  let jaPermitido = false;
  try {
    const st = await navigator.permissions?.query({ name: "camera" as PermissionName });
    jaPermitido = st?.state === "granted";
  } catch {
    /* Safari antigo / Firefox: sem consulta de permissão da câmera */
  }
  const prazo = jaPermitido ? timeoutMs : 120_000;

  const pedir = (c: MediaStreamConstraints) => {
    const gum = navigator.mediaDevices.getUserMedia(c);
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      gum,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // Se a câmera ainda abrir depois do prazo, desliga — senão a luz fica acesa sem dono.
          gum.then(pararStream, () => undefined);
          reject(new ErroDeVideo("A câmera demorou demais para responder. Feche outros programas que usam a câmera e tente de novo."));
        }, prazo);
      }),
    ]).finally(() => timer && clearTimeout(timer));
  };

  try {
    return await pedir({ video, audio });
  } catch (err: unknown) {
    const nome = (err as { name?: string } | null)?.name || "";
    // Sem microfone (ou microfone ocupado): grava só a imagem.
    if (nome === "NotFoundError" || nome === "NotReadableError" || nome === "OverconstrainedError") {
      try {
        return await pedir({ video, audio: false });
      } catch {
        /* cai na tradução abaixo */
      }
    }
    if (err instanceof ErroDeVideo) throw err;
    if (nome === "NotAllowedError" || nome === "SecurityError") {
      throw new ErroDeVideo("Permissão da câmera negada. Toque no cadeado ao lado do endereço do site e libere a câmera e o microfone.");
    }
    if (nome === "NotFoundError" || nome === "OverconstrainedError") {
      throw new ErroDeVideo("Nenhuma câmera foi encontrada neste aparelho.");
    }
    if (nome === "NotReadableError" || nome === "AbortError") {
      throw new ErroDeVideo("A câmera está em uso por outro programa (chamada de vídeo, outra aba). Feche-o e tente de novo.");
    }
    throw new ErroDeVideo("Não foi possível abrir a câmera.");
  }
}

export function pararStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      /* já parada */
    }
  });
}

// ---------------------------------------------------------------------------
// Conversão

type Mediabunny = typeof import("mediabunny");
let mbPromise: Promise<Mediabunny> | null = null;

/** Baixa o conversor antes de precisar (abrir a câmera já chama). */
export function preCarregarConversorDeVideo(): Promise<Mediabunny> {
  if (!mbPromise) {
    mbPromise = import("mediabunny").catch((err) => {
      mbPromise = null;
      throw err;
    });
  }
  return mbPromise;
}

/**
 * Baixa antes o codificador AAC em WASM quando o navegador não tem AAC nativo
 * (gravação em WebM/Opus: Firefox, Chrome no Linux) — para a conversão não
 * depender da rede depois de gravar.
 */
export async function preCarregarAac(): Promise<void> {
  const mb = await preCarregarConversorDeVideo();
  await garantirAac(mb, 2, 48000, false);
}

let aacPolyfill: Promise<void> | null = null;
async function garantirAac(mb: Mediabunny, canais: number, taxa: number, forcar: boolean) {
  const nativo = !forcar && (await mb.canEncodeAudio("aac", { numberOfChannels: canais, sampleRate: taxa, quality: new mb.Quality({ bitrate: AUDIO_BPS }) }).catch(() => false));
  if (nativo) return;
  if (!aacPolyfill) {
    aacPolyfill = import("@mediabunny/aac-encoder")
      .then(({ registerAacEncoder }) => registerAacEncoder())
      .catch((err) => {
        aacPolyfill = null;
        throw err;
      });
  }
  await aacPolyfill;
}

/** H.264 com B-frames tem pacotes fora de ordem de exibição (decodificação ≠ apresentação). */
async function temBFrames(mb: Mediabunny, track: InputVideoTrack, maxPacotes = 240): Promise<boolean> {
  const sink = new mb.EncodedPacketSink(track);
  let maior = -Infinity;
  let n = 0;
  for await (const p of sink.packets(undefined, undefined, { metadataOnly: true })) {
    if (p.timestamp < maior - 1e-6) return true;
    if (p.timestamp > maior) maior = p.timestamp;
    if (++n >= maxPacotes) break;
  }
  return false;
}

/**
 * Onde a saída começa: o primeiro instante das faixas usadas — mesmo negativo.
 * O AAC de MP4/MOV (ffmpeg, iPhone) começa em ~-0,02 s (priming); com o início
 * padrão (0) o mediabunny "corta" esse pedaço e, para isso, recodifica o áudio
 * que era para ser só copiado.
 */
async function inicioDasFaixas(input: MbInput): Promise<number> {
  const prim = [await input.getPrimaryVideoTrack(), await input.getPrimaryAudioTrack()].filter(
    (t): t is NonNullable<typeof t> => !!t,
  );
  return prim.length ? input.getFirstTimestamp(prim) : 0;
}

async function sondarEntrada(mb: Mediabunny, input: MbInput, bytes: number): Promise<SondaDeVideo> {
  const v = await input.getPrimaryVideoTrack();
  const a = await input.getPrimaryAudioTrack();
  const audios = await input.getAudioTracks();
  const prim = [v, a].filter((t): t is NonNullable<typeof t> => !!t);
  // computeDuration varre o arquivo (getDurationFromMetadata erra em MP4 fragmentado do
  // MediaRecorder) e devolve o FIM; a saída começa no início das faixas (TS, vídeo cortado).
  const duracao = prim.length ? (await input.computeDuration(prim)) - (await input.getFirstTimestamp(prim)) : 0;
  const videoCodec = v ? await v.getCodec() : null;
  const audioCodec = a ? await a.getCodec() : null;
  return {
    duracao,
    bytes,
    largura: v ? await v.getDisplayWidth() : 0,
    altura: v ? await v.getDisplayHeight() : 0,
    videoCodec,
    videoBps: v ? (await v.computePacketStats(600)).averageBitrate : 0,
    temBFrames: v && videoCodec === "avc" ? await temBFrames(mb, v) : false,
    audioCodec,
    audioBps: a ? (await a.computePacketStats(600)).averageBitrate : 0,
    audioCanais: a ? await a.getNumberOfChannels() : 0,
    qtdAudio: audios.length,
  };
}

export type ResultadoDoVideo = {
  arquivo: File;
  /** false = só reembalado (sem recodificar). */
  recodificado: boolean;
  duracao: number;
  largura: number;
  altura: number;
};

export type OpcoesDoVideo = {
  /** 0..1 */
  onProgresso?: (p: number) => void;
  signal?: AbortSignal;
  /** Só para teste: usa o AAC em WASM mesmo com AAC nativo. */
  aacEmWasm?: boolean;
};

const cancelado = () => new DOMException("Conversão cancelada", "AbortError");

/** O erro veio de um cancelamento (fechar a janela, botão cancelar)? */
export function foiCancelado(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === "AbortError" || (err as { name?: string } | null)?.name === "ConversionCanceledError";
}

/**
 * Deixa qualquer vídeo pronto para o WhatsApp: MP4 H.264 (sem B-frames) +
 * AAC, uma faixa de áudio, moov no início, até LIMITE_VIDEO_BYTES.
 * Lança ErroDeVideo com mensagem para quem atende; nunca devolve um arquivo
 * que não passou na conferência.
 */
export async function prepararVideoParaEnvio(entrada: Blob, opcoes: OpcoesDoVideo = {}): Promise<ResultadoDoVideo> {
  const { onProgresso, signal } = opcoes;
  if (signal?.aborted) throw cancelado();
  let mb: Mediabunny;
  try {
    mb = await preCarregarConversorDeVideo();
  } catch {
    throw new ErroDeVideo("Não foi possível carregar o conversor de vídeo. Confira a conexão e tente de novo.");
  }

  const input = new mb.Input({ source: new mb.BlobSource(entrada), formats: mb.ALL_FORMATS });
  try {
    let sonda: SondaDeVideo;
    try {
      sonda = await sondarEntrada(mb, input, entrada.size);
    } catch {
      throw new ErroDeVideo("Este arquivo de vídeo não pôde ser lido. Use um vídeo MP4 ou MOV.");
    }

    let reducao = 1;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      if (signal?.aborted) throw cancelado();
      const plano = planejarVideo(sonda, reducao);
      if (plano.acao === "impossivel") {
        throw new ErroDeVideo(
          tentativa === 0
            ? plano.motivo
            : "Não foi possível deixar o vídeo dentro do limite do WhatsApp. Envie um vídeo mais curto.",
        );
      }

      const buffer = await executarPlano(mb, input, plano, sonda, opcoes);
      if (buffer.byteLength > LIMITE_VIDEO_BYTES) {
        // O encoder passou do alvo (imagem muito movimentada): refaz com o
        // orçamento corrigido pela sobra medida.
        reducao *= Math.min(0.85, (LIMITE_VIDEO_BYTES / buffer.byteLength) * 0.9);
        continue;
      }

      if (signal?.aborted) throw cancelado();
      const arquivo = new File([buffer], nomeDoVideo(), { type: "video/mp4" });
      const conferido = await conferirVideo(mb, arquivo, sonda.duracao);
      if (signal?.aborted) throw cancelado();
      onProgresso?.(1);
      return { arquivo, recodificado: plano.video !== null || plano.audio === "converter", ...conferido };
    }
    throw new ErroDeVideo("Não foi possível reduzir o vídeo para o limite do WhatsApp. Grave um vídeo mais curto.");
  } finally {
    input.dispose();
  }
}

async function executarPlano(
  mb: Mediabunny,
  input: MbInput,
  plano: Extract<PlanoDeVideo, { acao: "preparar" }>,
  sonda: SondaDeVideo,
  { onProgresso, signal, aacEmWasm }: OpcoesDoVideo,
): Promise<ArrayBuffer> {
  const vPlano = plano.video;
  if (vPlano) {
    const alvo = caberNaCaixa(sonda.largura, sonda.altura, vPlano.maxLongo, vPlano.maxCurto);
    const podeH264 = await mb
      .canEncodeVideo("avc", { width: alvo.largura, height: alvo.altura, quality: new mb.Quality({ bitrate: vPlano.bps }) })
      .catch(() => false);
    if (!podeH264) {
      throw new ErroDeVideo("Este navegador não consegue converter vídeo. Use o Google Chrome ou o Safari atualizado.");
    }
  }
  // Também no "copiar": se por algum motivo o mediabunny precisar recodificar o
  // AAC, o codificador tem de existir (Safari antes do 26 não tem AAC nativo).
  if (plano.audio !== "sem") {
    const a = await input.getPrimaryAudioTrack();
    const canais = Math.min(Math.max((await a?.getNumberOfChannels()) ?? 2, 1), 2);
    const taxa = (await a?.getSampleRate()) ?? 48000;
    try {
      await garantirAac(mb, canais, TAXAS_AAC.includes(taxa) ? taxa : 48000, !!aacEmWasm);
    } catch {
      throw new ErroDeVideo("Não foi possível carregar o conversor de áudio. Confira a conexão e tente de novo.");
    }
  }

  const output = new mb.Output({
    format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new mb.BufferTarget(),
  });

  const video = async (track: InputVideoTrack): Promise<ConversionVideoOptions> => {
    if (!vPlano) return { codec: "avc" };
    const alvo = caberNaCaixa(await track.getDisplayWidth(), await track.getDisplayHeight(), vPlano.maxLongo, vPlano.maxCurto);
    return {
      codec: "avc",
      width: alvo.largura,
      height: alvo.altura,
      // "contain": se o celular girar no meio da gravação, o quadro novo não é esticado.
      fit: "contain",
      frameRate: FPS,
      keyFrameInterval: 2,
      quality: new mb.Quality({ bitrate: vPlano.bps }),
      // A rotação do celular vai para a imagem: nem todo player respeita o metadado.
      allowRotationMetadata: false,
      forceTranscode: true,
    };
  };
  const audio = async (track: InputAudioTrack): Promise<ConversionAudioOptions> => {
    if (plano.audio === "sem") return { discard: true };
    if (plano.audio === "copiar") return { codec: "aac" };
    const canais = Math.min(Math.max(await track.getNumberOfChannels(), 1), 2);
    const taxa = await track.getSampleRate();
    return {
      codec: "aac",
      numberOfChannels: canais,
      sampleRate: TAXAS_AAC.includes(taxa) ? taxa : 48000,
      quality: new mb.Quality({ bitrate: AUDIO_BPS }),
      forceTranscode: true,
    };
  };

  const conversion = await mb.Conversion.init({
    input,
    output,
    tracks: "primary",
    video,
    audio,
    trim: { start: await inicioDasFaixas(input) },
    showWarnings: false,
  });
  const videoUsado = conversion.utilizedTracks.some((t) => t.isVideoTrack());
  const audioPerdido = plano.audio !== "sem" && !conversion.utilizedTracks.some((t) => t.isAudioTrack());
  if (!conversion.isValid || !videoUsado || audioPerdido) {
    const motivos = conversion.discardedTracks.map((d) => `${d.track.isVideoTrack() ? "video" : "audio"}:${d.reason}`);
    console.warn("[videoParaEnvio] conversão impossível:", motivos);
    if (motivos.includes("video:undecodable_source_codec")) {
      throw new ErroDeVideo(
        "Este navegador não consegue abrir este formato de vídeo (provavelmente HEVC do iPhone). Envie pelo Safari do iPhone ou, no iPhone, use Ajustes > Câmera > Formatos > Mais Compatível.",
      );
    }
    if (motivos.includes("audio:undecodable_source_codec")) {
      throw new ErroDeVideo("O áudio deste vídeo está num formato que este navegador não consegue abrir. Use o Google Chrome atualizado.");
    }
    throw new ErroDeVideo("Este navegador não consegue converter este vídeo. Use o Google Chrome ou o Safari atualizado.");
  }

  conversion.onProgress = (p) => onProgresso?.(Math.min(0.99, p));
  const abortar = () => void conversion.cancel();
  signal?.addEventListener("abort", abortar, { once: true });
  try {
    // Cancelado enquanto preparava (canEncode, AAC, init): o "abort" já passou.
    if (signal?.aborted) throw cancelado();
    await conversion.execute();
    if (signal?.aborted) throw cancelado();
  } catch (err) {
    if (signal?.aborted || foiCancelado(err)) throw cancelado();
    console.warn("[videoParaEnvio] falha na conversão:", err);
    throw new ErroDeVideo("Não foi possível converter o vídeo. Tente gravar de novo.");
  } finally {
    signal?.removeEventListener("abort", abortar);
  }
  const buffer = (output.target as { buffer: ArrayBuffer | null }).buffer;
  if (!buffer || buffer.byteLength < 1000) throw new ErroDeVideo("O vídeo ficou vazio. Grave de novo.");
  return buffer;
}

/**
 * Confere o arquivo pronto como a Meta vai ler: MP4, H.264 sem B-frames,
 * AAC (ou sem áudio), uma faixa de áudio, duração preservada.
 */
async function conferirVideo(mb: Mediabunny, arquivo: File, duracaoEsperada: number) {
  const input = new mb.Input({ source: new mb.BlobSource(arquivo), formats: mb.ALL_FORMATS });
  try {
    const formato = await input.getFormat();
    const v = await input.getPrimaryVideoTrack();
    const audios = await input.getAudioTracks();
    const aCodec = audios[0] ? await audios[0].getCodec() : null;
    const duracao = (await input.computeDuration()) - Math.max(0, await input.getFirstTimestamp());
    const problemas: string[] = [];
    if (!(formato instanceof mb.Mp4InputFormat)) problemas.push(`formato ${formato.name}`);
    if (!v || (await v.getCodec()) !== "avc") problemas.push("vídeo não H.264");
    if (v && (await temBFrames(mb, v))) problemas.push("B-frames");
    if (audios.length > 1) problemas.push("mais de uma faixa de áudio");
    if (audios.length === 1 && aCodec !== "aac") problemas.push(`áudio ${aCodec}`);
    if (Math.abs(duracao - duracaoEsperada) > Math.max(1, duracaoEsperada * 0.1)) {
      problemas.push(`duração ${duracao.toFixed(1)}s (esperado ${duracaoEsperada.toFixed(1)}s)`);
    }
    if (problemas.length) {
      console.warn("[videoParaEnvio] arquivo final reprovado:", problemas);
      throw new ErroDeVideo("Não foi possível deixar este vídeo no formato do WhatsApp. Tente de novo ou use outro vídeo.");
    }
    return { duracao, largura: await v!.getDisplayWidth(), altura: await v!.getDisplayHeight() };
  } finally {
    input.dispose();
  }
}
