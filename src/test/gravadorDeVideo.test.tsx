/**
 * Janela "Gravar vídeo" do chat (16/10/2026): abre a câmera, grava, converte
 * para o formato do WhatsApp, mostra para conferir e envia com a legenda.
 * A câmera é desligada ao parar e ao fechar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const preparar = vi.fn();
vi.mock("@/lib/videoParaEnvio", async (original) => {
  const real = await original<typeof import("@/lib/videoParaEnvio")>();
  return {
    ...real,
    preCarregarConversorDeVideo: () => Promise.resolve({}),
    preCarregarAac: () => Promise.resolve(),
    prepararVideoParaEnvio: (...a: unknown[]) => preparar(...a),
  };
});

import GravadorDeVideoDialog from "@/components/chat/GravadorDeVideoDialog";

type FakeTrack = {
  kind: string;
  readyState: string;
  stop: ReturnType<typeof vi.fn>;
  getSettings: () => object;
  addEventListener: (ev: string, fn: () => void) => void;
  ouvintes: Record<string, (() => void)[]>;
};
const faixa = (kind: string, ajustes: object = {}): FakeTrack => {
  const f: FakeTrack = {
    kind,
    readyState: "live",
    stop: vi.fn(() => {
      f.readyState = "ended";
    }),
    getSettings: () => ajustes,
    ouvintes: {},
    addEventListener: (ev, fn) => {
      (f.ouvintes[ev] ??= []).push(fn);
    },
  };
  return f;
};
let faixas: FakeTrack[] = [];
let getUserMedia: ReturnType<typeof vi.fn>;
let gravadores: FakeRecorder[] = [];

class FakeRecorder {
  static isTypeSupported = (m: string) => m.startsWith("video/mp4");
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_s: unknown, o: { mimeType?: string }) {
    this.mimeType = o.mimeType ?? "";
    gravadores.push(this);
  }
  start() {
    this.state = "recording";
  }
  requestData() {}
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(5000)], { type: this.mimeType }) });
    this.onstop?.();
  }
}

beforeEach(() => {
  preparar.mockReset();
  gravadores = [];
  faixas = [];
  getUserMedia = vi.fn(async () => {
    const novas: FakeTrack[] = [faixa("video", { facingMode: "user" }), faixa("audio")];
    faixas.push(...novas);
    return { getTracks: () => novas, getVideoTracks: () => [novas[0]] } as unknown as MediaStream;
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia, enumerateDevices: async () => [{ kind: "videoinput" }] },
  });
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  URL.createObjectURL = vi.fn(() => "blob:pronto");
  URL.revokeObjectURL = vi.fn();
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
});

const pronto = () => ({
  arquivo: new File([new Uint8Array(10)], "video_1.mp4", { type: "video/mp4" }),
  recodificado: true,
  duracao: 12,
  largura: 1280,
  altura: 720,
});

describe("GravadorDeVideoDialog", () => {
  it("grava, converte, mostra para conferir e envia com a legenda", async () => {
    preparar.mockResolvedValue(pronto());
    const onEnviar = vi.fn(async () => true);
    const onOpenChange = vi.fn();
    render(<GravadorDeVideoDialog open onOpenChange={onOpenChange} onEnviar={onEnviar} />);

    const gravar = await screen.findByRole("button", { name: /gravar$/i });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    fireEvent.click(gravar);
    expect(gravadores[0].mimeType).toBe("video/mp4;codecs=avc1.42E01F,mp4a.40.2");

    fireEvent.click(await screen.findByRole("button", { name: /parar/i }));
    // Parou: a câmera desliga e o arquivo gravado vai para a conversão.
    await waitFor(() => expect(preparar).toHaveBeenCalledTimes(1));
    expect(faixas.every((f) => f.stop.mock.calls.length > 0)).toBe(true);
    expect((preparar.mock.calls[0][0] as Blob).type).toMatch(/^video\/mp4/i);

    expect(await screen.findByText(/Pronto para enviar · 0:12 · 0,0 MB · 1280×720/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/legenda/i), { target: { value: "  Olha só  " } });
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));

    await waitFor(() => expect(onEnviar).toHaveBeenCalledTimes(1));
    const [arquivo, legenda] = onEnviar.mock.calls[0] as unknown as [File, string];
    expect(arquivo.type).toBe("video/mp4");
    expect(legenda).toBe("Olha só");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("envio barrado (janela fechou, número pausado): a janela fica aberta com o vídeo", async () => {
    preparar.mockResolvedValue(pronto());
    const onEnviar = vi.fn(async () => false);
    const onOpenChange = vi.fn();
    render(<GravadorDeVideoDialog open onOpenChange={onOpenChange} onEnviar={onEnviar} />);
    fireEvent.click(await screen.findByRole("button", { name: /gravar$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /parar/i }));
    fireEvent.click(await screen.findByRole("button", { name: /enviar/i }));
    await waitFor(() => expect(onEnviar).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: /enviar/i })).toBeEnabled();
  });

  it("sem permissão da câmera: explica e oferece escolher um vídeo", async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    render(<GravadorDeVideoDialog open onOpenChange={() => {}} onEnviar={async () => true} />);
    expect(await screen.findByText(/Permissão da câmera negada/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /escolher um vídeo/i })).toBeInTheDocument();
  });

  it("vídeo longo demais: mostra o motivo da conversão", async () => {
    const { ErroDeVideo } = await import("@/lib/videoParaEnvio");
    preparar.mockRejectedValue(new ErroDeVideo("Vídeo longo demais para o WhatsApp (20 min)."));
    render(<GravadorDeVideoDialog open onOpenChange={() => {}} onEnviar={async () => true} />);
    fireEvent.click(await screen.findByRole("button", { name: /gravar$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /parar/i }));
    expect(await screen.findByText(/longo demais/)).toBeInTheDocument();
    // A gravação continua guardada: dá para converter de novo sem regravar.
    preparar.mockResolvedValueOnce(pronto());
    fireEvent.click(screen.getByRole("button", { name: /tentar converter de novo/i }));
    expect(await screen.findByText(/Pronto para enviar/)).toBeInTheDocument();
    expect(preparar).toHaveBeenCalledTimes(2);
    expect(preparar.mock.calls[1][0]).toBe(preparar.mock.calls[0][0]);
  });

  it("fechar no meio da gravação desliga a câmera e não converte nada", async () => {
    const { rerender } = render(<GravadorDeVideoDialog open onOpenChange={() => {}} onEnviar={async () => true} />);
    fireEvent.click(await screen.findByRole("button", { name: /gravar$/i }));
    await screen.findByRole("button", { name: /parar/i });
    act(() => {
      rerender(<GravadorDeVideoDialog open={false} onOpenChange={() => {}} onEnviar={async () => true} />);
    });
    expect(faixas.every((f) => f.stop.mock.calls.length > 0)).toBe(true);
    expect(preparar).not.toHaveBeenCalled();
  });

  it("vídeo do app da câmera do celular passa pela mesma conversão", async () => {
    preparar.mockResolvedValue(pronto());
    render(<GravadorDeVideoDialog open onOpenChange={() => {}} onEnviar={async () => true} />);
    await screen.findByRole("button", { name: /gravar$/i });
    const input = screen.getByTestId("video-app-camera") as HTMLInputElement;
    const mov = new File([new Uint8Array(20)], "IMG_0001.MOV", { type: "video/quicktime" });
    fireEvent.change(input, { target: { files: [mov] } });
    await waitFor(() => expect(preparar).toHaveBeenCalledWith(mov, expect.anything()));
    expect(await screen.findByText(/Pronto para enviar/)).toBeInTheDocument();
  });
});
