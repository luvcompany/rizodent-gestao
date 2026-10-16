/**
 * Regra do vídeo para o WhatsApp (16/10/2026): o que copiar, o que
 * recodificar e em que resolução, para caber no limite da Meta.
 */
import { describe, it, expect } from "vitest";
import {
  LIMITE_VIDEO_BYTES,
  caberNaCaixa,
  melhorFormatoDeGravacao,
  nomeDoVideo,
  planejarVideo,
  type SondaDeVideo,
} from "@/lib/videoParaEnvio";

const sonda = (s: Partial<SondaDeVideo> = {}): SondaDeVideo => ({
  duracao: 20,
  bytes: 5_000_000,
  largura: 1280,
  altura: 720,
  videoCodec: "avc",
  videoBps: 1_800_000,
  temBFrames: false,
  audioCodec: "aac",
  audioBps: 128_000,
  audioCanais: 2,
  qtdAudio: 1,
  ...s,
});

describe("planejarVideo", () => {
  it("MP4 H.264 + AAC que cabe: só reembala (sem recodificar)", () => {
    expect(planejarVideo(sonda())).toEqual({ acao: "preparar", video: null, audio: "copiar" });
  });

  it("H.264 com B-frames (não toca no WhatsApp do Android): recodifica", () => {
    const p = planejarVideo(sonda({ temBFrames: true }));
    expect(p.acao).toBe("preparar");
    expect(p.acao === "preparar" && p.video).toMatchObject({ maxLongo: 1280, maxCurto: 720 });
  });

  it("HEVC do iPhone: recodifica o vídeo e copia o AAC", () => {
    const p = planejarVideo(sonda({ videoCodec: "hevc", videoBps: 8_000_000, duracao: 30 }));
    expect(p).toMatchObject({ acao: "preparar", audio: "copiar" });
    expect(p.acao === "preparar" && p.video?.bps).toBeLessThanOrEqual(2_000_000);
  });

  it("WebM VP9 + Opus do Chrome: recodifica vídeo e áudio", () => {
    const p = planejarVideo(sonda({ videoCodec: "vp9", audioCodec: "opus" }));
    expect(p).toMatchObject({ acao: "preparar", audio: "converter" });
    expect(p.acao === "preparar" && p.video).not.toBeNull();
  });

  it("MP4 H.264 com Opus (Chrome no Linux): copia o vídeo e converte só o áudio", () => {
    expect(planejarVideo(sonda({ audioCodec: "opus" }))).toEqual({ acao: "preparar", video: null, audio: "converter" });
  });

  it("H.264 que não cabe em 15 MB: recodifica com bitrate que cabe", () => {
    const s = sonda({ duracao: 90, videoBps: 2_400_000 }); // ~28 MB
    const p = planejarVideo(s);
    expect(p.acao).toBe("preparar");
    if (p.acao !== "preparar" || !p.video) throw new Error("esperava recodificar");
    const bytes = ((p.video.bps + 96_000) * s.duracao) / 8;
    expect(bytes).toBeLessThanOrEqual(LIMITE_VIDEO_BYTES);
  });

  it("áudio AAC pesado (256 kbps) é recodificado a 96 kbps", () => {
    expect(planejarVideo(sonda({ audioBps: 256_000 }))).toMatchObject({ audio: "converter" });
  });

  it("recodificando o vídeo, AAC acima de 128 kbps também cai para 96 kbps", () => {
    expect(planejarVideo(sonda({ videoCodec: "hevc", audioBps: 160_000 }))).toMatchObject({ audio: "converter" });
    // copiando o vídeo, AAC de 160 kbps continua copiado
    expect(planejarVideo(sonda({ audioBps: 160_000 }))).toEqual({ acao: "preparar", video: null, audio: "copiar" });
  });

  it("sem áudio: segue sem áudio", () => {
    expect(planejarVideo(sonda({ audioCodec: null, qtdAudio: 0, audioBps: 0 }))).toEqual({ acao: "preparar", video: null, audio: "sem" });
  });

  it("escada de resolução pela duração: 720p → 480p → 360p", () => {
    const res = (duracao: number) => {
      const p = planejarVideo(sonda({ videoCodec: "vp9", audioCodec: "opus", duracao }));
      return p.acao === "preparar" ? p.video?.maxCurto : null;
    };
    expect(res(30)).toBe(720);
    expect(res(120)).toBe(480);
    expect(res(180)).toBe(480); // 3 min, o teto da gravação pela câmera
    expect(res(300)).toBe(360);
  });

  it("todo plano recodificado cabe no limite, de 1 s a 6 min", () => {
    for (let duracao = 1; duracao <= 360; duracao += 7) {
      const p = planejarVideo(sonda({ videoCodec: "hevc", duracao }));
      if (p.acao !== "preparar" || !p.video) continue;
      expect(((p.video.bps + 96_000) * duracao) / 8).toBeLessThanOrEqual(LIMITE_VIDEO_BYTES);
    }
  });

  it("longo demais: recusa dizendo o máximo", () => {
    const p = planejarVideo(sonda({ videoCodec: "hevc", duracao: 20 * 60 }));
    expect(p.acao).toBe("impossivel");
    expect(p.acao === "impossivel" && p.motivo).toMatch(/longo demais para o WhatsApp \(20:00\)\. O máximo é de cerca de 4:5\d/);
  });

  it("recusado: o tempo do vídeo e o máximo nunca aparecem iguais", () => {
    for (let duracao = 300; duracao <= 480; duracao += 1) {
      const p = planejarVideo(sonda({ videoCodec: "hevc", duracao }));
      if (p.acao !== "impossivel") continue;
      const [, video, maximo] = p.motivo.match(/\((\d+:\d\d)\).*cerca de (\d+:\d\d)/) ?? [];
      expect(video).not.toBe(maximo);
    }
  });

  it("nova tentativa (reducao < 1) sempre recodifica com menos bitrate", () => {
    const p1 = planejarVideo(sonda({ videoCodec: "hevc", duracao: 60 }));
    const p2 = planejarVideo(sonda({ duracao: 60 }), 0.8);
    expect(p2.acao === "preparar" && p2.video).not.toBeNull();
    if (p1.acao !== "preparar" || p2.acao !== "preparar" || !p1.video || !p2.video) throw new Error();
    expect(p2.video.bps).toBeLessThan(p1.video.bps);
  });

  it("sem imagem ou vazio: recusa", () => {
    expect(planejarVideo(sonda({ videoCodec: null })).acao).toBe("impossivel");
    expect(planejarVideo(sonda({ duracao: 0 })).acao).toBe("impossivel");
  });
});

describe("caberNaCaixa", () => {
  it("reduz paisagem e retrato sem distorcer, sempre par", () => {
    expect(caberNaCaixa(1920, 1080, 1280, 720)).toEqual({ largura: 1280, altura: 720 });
    expect(caberNaCaixa(1080, 1920, 1280, 720)).toEqual({ largura: 720, altura: 1280 });
    expect(caberNaCaixa(1920, 1080, 854, 480)).toEqual({ largura: 854, altura: 480 });
    const r = caberNaCaixa(1001, 563, 640, 360);
    expect(r.largura % 2).toBe(0);
    expect(r.altura % 2).toBe(0);
  });

  it("não amplia vídeo pequeno", () => {
    expect(caberNaCaixa(640, 480, 1280, 720)).toEqual({ largura: 640, altura: 480 });
  });
});

describe("gravação", () => {
  it("prefere MP4 H.264/AAC e cai para WebM quando o navegador não grava MP4", () => {
    expect(melhorFormatoDeGravacao(() => true)).toBe("video/mp4;codecs=avc1.42E01F,mp4a.40.2");
    expect(melhorFormatoDeGravacao((m) => m.startsWith("video/webm"))).toBe("video/webm;codecs=vp9,opus");
    expect(melhorFormatoDeGravacao(() => false)).toBeUndefined();
    expect(
      melhorFormatoDeGravacao(() => {
        throw new Error("x");
      }),
    ).toBeUndefined();
  });

  it("nome do arquivo em ASCII com .mp4 (o servidor decide o tipo pela extensão)", () => {
    expect(nomeDoVideo(123)).toBe("video_123.mp4");
  });
});
