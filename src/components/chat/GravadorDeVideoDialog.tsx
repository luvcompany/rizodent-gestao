import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Camera, Loader2, RefreshCw, RotateCcw, Send, Smartphone, Square, SwitchCamera, VideoOff } from "lucide-react";
import {
  ErroDeVideo,
  GRAVACAO_AUDIO_BPS,
  GRAVACAO_MAX_SEGUNDOS,
  GRAVACAO_VIDEO_BPS,
  abrirCamera,
  foiCancelado,
  melhorFormatoDeGravacao,
  pararStream,
  preCarregarAac,
  preCarregarConversorDeVideo,
  prepararVideoParaEnvio,
  type ResultadoDoVideo,
} from "@/lib/videoParaEnvio";

/**
 * Gravar vídeo pela câmera (webcam no computador, câmera do celular no
 * navegador do celular) e mandar já no formato do WhatsApp.
 *
 * Fluxo: abre a câmera → grava (até GRAVACAO_MAX_SEGUNDOS) → converte com
 * prepararVideoParaEnvio (MP4 H.264 + AAC, até 15 MB) → mostra o vídeo
 * pronto para conferir → Enviar. No celular também dá para usar o app de
 * câmera do aparelho (melhor qualidade); o arquivo passa pela mesma
 * conversão. A câmera é desligada assim que a gravação para ou a janela fecha.
 */

type Etapa = "abrindo" | "pronto" | "gravando" | "app" | "preparando" | "revisao" | "erro";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Envia o vídeo pronto. true = enviado (fecha a janela); false = barrado (fica aberta). */
  onEnviar: (arquivo: File, legenda: string) => Promise<boolean>;
  /** Legenda vai junto (o Direct do Instagram não mostra legenda em mídia). */
  aceitaLegenda?: boolean;
};

const relogio = (seg: number) => {
  const s = Math.max(0, Math.floor(seg));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const tamanho = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

/** Celular/tablet: oferece o app de câmera do aparelho além da gravação no navegador. */
const ehToque = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

const suportaGravacao = (m: string) =>
  typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(m);

export default function GravadorDeVideoDialog({ open, onOpenChange, onEnviar, aceitaLegenda = true }: Props) {
  const [etapa, setEtapa] = useState<Etapa>("abrindo");
  const [erro, setErro] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [progresso, setProgresso] = useState(0);
  const [resultado, setResultado] = useState<ResultadoDoVideo | null>(null);
  const [urlPronta, setUrlPronta] = useState<string | null>(null);
  const [legenda, setLegenda] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [varias, setVariasCameras] = useState(false);
  const [espelhar, setEspelhar] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  /** A gravação bruta continua guardada: se a conversão falhar, dá para tentar de novo sem regravar. */
  const [temBruto, setTemBruto] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const brutoRef = useRef<Blob | null>(null);
  const urlRef = useRef<string | null>(null);
  const inicioRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const descartarRef = useRef(false);
  const geracaoRef = useRef(0);
  /** Câmera em uso: lado (celular) e aparelho (computador com mais de uma webcam). */
  const cameraRef = useRef<{ frente: "user" | "environment"; deviceId: string | null }>({ frente: "user", deviceId: null });
  const videoAoVivoRef = useRef<HTMLVideoElement | null>(null);
  const appCameraRef = useRef<HTMLInputElement | null>(null);

  const limparTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const desligarCamera = useCallback(() => {
    pararStream(streamRef.current);
    streamRef.current = null;
    setStream(null);
  }, []);

  /** Revoga a URL anterior direto (no desmonte o React não roda updaters de estado). */
  const trocarUrl = useCallback((url: string | null) => {
    if (urlRef.current && urlRef.current !== url) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setUrlPronta(url);
  }, []);

  const guardarBruto = (bruto: Blob | null) => {
    brutoRef.current = bruto;
    setTemBruto(!!bruto);
  };

  const falhar = useCallback((mensagem: string) => {
    setErro(mensagem);
    setEtapa("erro");
  }, []);

  /** Para tudo: gravação (descartando), conversão, câmera, timer, prévia. */
  const encerrarTudo = useCallback(() => {
    geracaoRef.current++;
    descartarRef.current = true;
    limparTimer();
    abortRef.current?.abort();
    abortRef.current = null;
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* já parado */
      }
    }
    pedacosRef.current = [];
    brutoRef.current = null;
    desligarCamera();
    trocarUrl(null);
  }, [desligarCamera, trocarUrl]);

  const ligarCamera = useCallback(async () => {
    const geracao = ++geracaoRef.current;
    setEtapa("abrindo");
    setErro(null);
    desligarCamera(); // Android: a câmera anterior precisa estar parada antes de abrir outra
    try {
      const { frente, deviceId } = cameraRef.current;
      const s = await abrirCamera(deviceId ? { deviceId } : { frente });
      if (geracao !== geracaoRef.current) {
        pararStream(s); // fechou ou trocou enquanto abria
        return;
      }
      streamRef.current = s;
      setStream(s);
      const faixa = s.getVideoTracks()[0];
      const ajustes = faixa?.getSettings?.() ?? {};
      setEspelhar(ajustes.facingMode !== "environment");
      // Câmera caiu antes de gravar (webcam desconectada, outro app tomou a câmera).
      faixa?.addEventListener("ended", () => {
        if (streamRef.current === s && !recorderRef.current) {
          desligarCamera();
          falhar("A câmera foi desligada. Toque em “Tentar de novo”.");
        }
      });
      setEtapa("pronto");
      navigator.mediaDevices
        ?.enumerateDevices?.()
        .then((lista) => setVariasCameras(lista.filter((d) => d.kind === "videoinput").length > 1))
        .catch(() => undefined);
      // Vai gravar em WebM (Firefox, Chrome no Linux)? Já baixa o AAC, se o navegador não tiver.
      if (!melhorFormatoDeGravacao(suportaGravacao)?.startsWith("video/mp4")) void preCarregarAac().catch(() => undefined);
    } catch (err) {
      if (geracao !== geracaoRef.current) return;
      falhar(err instanceof Error ? err.message : "Não foi possível abrir a câmera.");
    }
  }, [desligarCamera, falhar]);

  // Abrir/fechar a janela.
  useEffect(() => {
    if (!open) {
      encerrarTudo();
      return;
    }
    descartarRef.current = false;
    setLegenda("");
    setSegundos(0);
    setProgresso(0);
    setEnviando(false);
    setResultado(null);
    guardarBruto(null);
    void preCarregarConversorDeVideo().catch(() => undefined);
    void ligarCamera();
    return () => encerrarTudo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Prévia ao vivo.
  useEffect(() => {
    const el = videoAoVivoRef.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => undefined);
  }, [stream, etapa]);

  const preparar = useCallback(
    async (bruto: Blob) => {
      const geracao = geracaoRef.current;
      guardarBruto(bruto);
      setEtapa("preparando");
      setProgresso(0);
      const controle = new AbortController();
      abortRef.current = controle;
      try {
        const pronto = await prepararVideoParaEnvio(bruto, {
          signal: controle.signal,
          onProgresso: (p) => {
            if (geracao === geracaoRef.current) setProgresso(p);
          },
        });
        if (geracao !== geracaoRef.current) return;
        setResultado(pronto);
        trocarUrl(URL.createObjectURL(pronto.arquivo));
        setEtapa("revisao");
      } catch (err) {
        if (geracao !== geracaoRef.current || foiCancelado(err)) return;
        falhar(err instanceof ErroDeVideo ? err.message : "Não foi possível preparar o vídeo. Tente gravar de novo.");
      } finally {
        if (abortRef.current === controle) abortRef.current = null;
      }
    },
    [falhar, trocarUrl],
  );

  const pararGravacao = useCallback(() => {
    limparTimer();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.requestData?.();
      } catch {
        /* nem todo navegador aceita aqui */
      }
      try {
        rec.stop();
      } catch {
        /* já parado */
      }
    }
  }, []);

  const iniciarGravacao = useCallback(() => {
    const s = streamRef.current;
    if (!s) return;
    if (s.getVideoTracks()[0]?.readyState !== "live") {
      desligarCamera();
      falhar("A câmera foi desligada. Toque em “Tentar de novo”.");
      return;
    }
    const mime = melhorFormatoDeGravacao(suportaGravacao);
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(s, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: GRAVACAO_VIDEO_BPS,
        audioBitsPerSecond: GRAVACAO_AUDIO_BPS,
      });
    } catch {
      desligarCamera();
      falhar("Este navegador não consegue gravar vídeo. Use o Chrome ou o Safari atualizado.");
      return;
    }
    descartarRef.current = false;
    pedacosRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) pedacosRef.current.push(e.data);
    };
    rec.onerror = () => {
      limparTimer();
      descartarRef.current = true;
      recorderRef.current = null;
      desligarCamera();
      falhar("A gravação falhou. Tente de novo.");
    };
    rec.onstop = () => {
      limparTimer();
      if (recorderRef.current === rec) recorderRef.current = null;
      const pedacos = pedacosRef.current;
      pedacosRef.current = [];
      desligarCamera(); // luz da câmera apaga enquanto confere
      if (descartarRef.current) return;
      const bruto = new Blob(pedacos, { type: rec.mimeType || mime || "video/webm" });
      if (bruto.size < 1000) {
        falhar("A gravação ficou vazia. Tente de novo.");
        return;
      }
      void preparar(bruto);
    };
    // Câmera caiu no meio (aba em segundo plano no iPhone, cabo da webcam): salva o que já gravou.
    s.getTracks().forEach((t) => {
      t.addEventListener("ended", () => {
        if (recorderRef.current === rec) pararGravacao();
      });
    });

    recorderRef.current = rec;
    try {
      rec.start(1000);
    } catch {
      recorderRef.current = null;
      desligarCamera();
      falhar("Não foi possível começar a gravação. Tente de novo.");
      return;
    }
    inicioRef.current = Date.now();
    setSegundos(0);
    setEtapa("gravando");
    timerRef.current = setInterval(() => {
      const seg = (Date.now() - inicioRef.current) / 1000;
      setSegundos(seg);
      if (seg >= GRAVACAO_MAX_SEGUNDOS) pararGravacao();
    }, 250);
  }, [desligarCamera, falhar, pararGravacao, preparar]);

  const regravar = () => {
    trocarUrl(null);
    setResultado(null);
    guardarBruto(null);
    setSegundos(0);
    descartarRef.current = false;
    void ligarCamera();
  };

  const converterDeNovo = () => {
    if (brutoRef.current) void preparar(brutoRef.current);
  };

  const trocarCamera = async () => {
    const atual = streamRef.current?.getVideoTracks()[0]?.getSettings?.() ?? {};
    if (atual.facingMode) {
      // Celular: alterna frente/trás.
      cameraRef.current = { frente: atual.facingMode === "environment" ? "user" : "environment", deviceId: null };
    } else {
      // Computador: as webcams não dizem o lado — passa para o próximo aparelho.
      const lista = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === "videoinput" && d.deviceId);
      const i = lista.findIndex((d) => d.deviceId === atual.deviceId);
      const proximo = lista[(i + 1) % Math.max(lista.length, 1)];
      cameraRef.current = { ...cameraRef.current, deviceId: proximo?.deviceId ?? null };
    }
    void ligarCamera();
  };

  const usarAppDaCamera = () => {
    // Solta a câmera antes: no Android o app de câmera não abre com ela presa ao navegador.
    geracaoRef.current++;
    desligarCamera();
    setEtapa("app");
    appCameraRef.current?.click();
  };

  // Voltou do app/seletor sem escolher nada: religa a câmera daqui.
  useEffect(() => {
    const el = appCameraRef.current;
    if (!el) return;
    const aoCancelar = () => {
      if (etapa === "app") void ligarCamera();
    };
    el.addEventListener("cancel", aoCancelar);
    return () => el.removeEventListener("cancel", aoCancelar);
  }, [etapa, ligarCamera]);

  const onArquivoDaCamera = (e: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    geracaoRef.current++; // invalida uma abertura de câmera em andamento
    desligarCamera();
    void preparar(arquivo);
  };

  const enviar = async () => {
    if (!resultado || enviando) return;
    setEnviando(true);
    try {
      const ok = await onEnviar(resultado.arquivo, aceitaLegenda ? legenda.trim() : "");
      if (ok) onOpenChange(false);
    } finally {
      setEnviando(false);
    }
  };

  const fechar = (aberto: boolean) => {
    if (!aberto && enviando) return;
    onOpenChange(aberto);
  };

  const mostrarAoVivo = etapa === "abrindo" || etapa === "pronto" || etapa === "gravando";
  const restante = GRAVACAO_MAX_SEGUNDOS - segundos;
  const toque = ehToque();

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent
        className="flex max-h-[95vh] w-[calc(100vw-1rem)] max-w-2xl flex-col gap-0 overflow-y-auto rounded-2xl border-border/60 p-0"
        // Sem foco automático no primeiro botão (no celular ele aparecia destacado sem motivo).
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="border-b border-border/60 px-5 py-4 text-left">
          <DialogTitle>Gravar vídeo</DialogTitle>
          <DialogDescription>
            O vídeo é ajustado sozinho ao tamanho do WhatsApp antes de enviar (até {GRAVACAO_MAX_SEGUNDOS / 60} min).
          </DialogDescription>
        </DialogHeader>

        <input
          ref={appCameraRef}
          type="file"
          accept="video/*"
          capture="environment"
          className="hidden"
          onChange={onArquivoDaCamera}
          data-testid="video-app-camera"
        />

        <div className="flex flex-col gap-3 px-5 py-4">
          {mostrarAoVivo && (
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video
                ref={videoAoVivoRef}
                autoPlay
                muted
                playsInline
                className={`mx-auto max-h-[60vh] w-full object-contain ${espelhar ? "-scale-x-100" : ""}`}
                aria-label="Imagem da câmera"
              />
              {etapa === "abrindo" && (
                <div className="absolute inset-0 flex min-h-48 items-center justify-center gap-2 text-sm text-white/80">
                  <Loader2 size={18} className="animate-spin" /> Abrindo a câmera…
                </div>
              )}
              {etapa === "gravando" && (
                <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-sm font-medium tabular-nums text-white">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                  {relogio(segundos)} / {relogio(GRAVACAO_MAX_SEGUNDOS)}
                </div>
              )}
              {etapa === "pronto" && varias && (
                <button
                  type="button"
                  onClick={() => void trocarCamera()}
                  className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/75"
                  title="Trocar de câmera"
                  aria-label="Trocar de câmera"
                >
                  <SwitchCamera size={20} />
                </button>
              )}
            </div>
          )}

          {etapa === "app" && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-surface-sunken px-4 py-8 text-center">
              <Smartphone size={22} className="text-primary" />
              <p className="text-sm text-foreground">
                {toque
                  ? "Grave no app da câmera. Ao terminar, o vídeo aparece aqui para enviar."
                  : "Escolha o vídeo na janela que abriu. Ele aparece aqui para enviar."}
              </p>
            </div>
          )}

          {etapa === "preparando" && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-surface-sunken px-4 py-8 text-center">
              <Loader2 size={22} className="animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">Ajustando o vídeo para o WhatsApp…</p>
              <Progress value={Math.round(progresso * 100)} className="w-full max-w-xs" />
              <p className="text-xs tabular-nums text-muted-foreground">{Math.round(progresso * 100)}%</p>
            </div>
          )}

          {etapa === "revisao" && resultado && urlPronta && (
            <>
              <div className="overflow-hidden rounded-xl bg-black">
                <video src={urlPronta} controls playsInline className="mx-auto max-h-[55vh] w-full object-contain" aria-label="Vídeo gravado" />
              </div>
              <p className="text-xs text-muted-foreground">
                Pronto para enviar · {relogio(resultado.duracao)} · {tamanho(resultado.arquivo.size)} · {resultado.largura}×{resultado.altura}
              </p>
              {aceitaLegenda && (
                <Input
                  value={legenda}
                  onChange={(e) => setLegenda(e.target.value)}
                  placeholder="Legenda (opcional)"
                  maxLength={1000}
                  disabled={enviando}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void enviar();
                    }
                  }}
                />
              )}
            </>
          )}

          {etapa === "erro" && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-6 text-center">
              <VideoOff size={22} className="text-destructive" />
              <p className="text-sm text-foreground">{erro}</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            {(etapa === "pronto" || etapa === "abrindo" || etapa === "erro") && (toque || etapa === "erro") && (
              <Button type="button" variant="outline" size="sm" onClick={usarAppDaCamera} className="gap-1.5">
                <Smartphone size={16} /> {toque ? "Usar o app da câmera" : "Escolher um vídeo"}
              </Button>
            )}
            {etapa === "app" && (
              <Button type="button" variant="outline" size="sm" onClick={() => void ligarCamera()} className="gap-1.5">
                <Camera size={16} /> Gravar por aqui
              </Button>
            )}
            {etapa === "erro" && temBruto && (
              <Button type="button" variant="outline" size="sm" onClick={converterDeNovo} className="gap-1.5">
                <RefreshCw size={16} /> Tentar converter de novo
              </Button>
            )}
            {(etapa === "revisao" || etapa === "erro") && (
              <Button type="button" variant="ghost" size="sm" onClick={regravar} disabled={enviando} className="gap-1.5">
                <RotateCcw size={16} /> {etapa === "erro" ? (temBruto ? "Gravar de novo" : "Tentar de novo") : "Gravar de novo"}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {etapa === "pronto" && (
              <Button type="button" onClick={iniciarGravacao} className="gap-2 rounded-full bg-red-600 px-5 text-white hover:bg-red-700">
                <span className="h-3 w-3 rounded-full bg-white" /> Gravar
              </Button>
            )}
            {etapa === "gravando" && (
              <Button type="button" onClick={pararGravacao} className="gap-2 rounded-full bg-red-600 px-5 text-white hover:bg-red-700">
                <Square size={14} className="fill-current" /> Parar
                {restante <= 15 && <span className="tabular-nums text-white/80">({Math.ceil(restante)}s)</span>}
              </Button>
            )}
            {etapa === "preparando" && (
              <Button type="button" variant="outline" onClick={() => fechar(false)}>
                Cancelar
              </Button>
            )}
            {etapa === "revisao" && (
              <Button type="button" onClick={() => void enviar()} disabled={enviando} className="gap-1.5">
                {enviando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Enviar
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
