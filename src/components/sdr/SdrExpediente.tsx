import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensagemDeErroRpc } from "@/lib/relatorioSdr";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Clock, Coffee, Loader2, LogIn, LogOut, MoreHorizontal, Pause, Play, RefreshCw, Utensils } from "lucide-react";

/**
 * Cartão de expediente da SDR (Fase 2 do rodízio) — topo da home /crm/sdr.
 *
 * Tudo é evento em crm_ponto_eventos, gravado pelas RPCs ponto_abrir /
 * ponto_pausar / ponto_retomar / ponto_encerrar (SECURITY DEFINER: a tabela
 * continua sem policy de escrita). O estado vem de ponto_meu_estado(), que
 * devolve também o RELÓGIO DO SERVIDOR: o cronômetro corre a partir dele, não
 * do relógio do navegador (um PC com hora errada mostraria horas erradas).
 * Resincroniza a cada minuto e ao voltar para a aba.
 *
 * Pausa é só relógio de ponto: a SDR continua recebendo lead. Pausa acima de
 * pausa_alerta_min avisa o gestor (cron ponto-vigia, a cada 5 min, só com
 * gestor nomeado) — a tela só diz "foi avisado" quando ponto_meu_estado
 * confirma que a notificação existe (gestor_avisado_pausa); até lá, "será
 * avisado". Expediente esquecido encerra sozinho às 23:59 da clínica (mesmo
 * cron, origem 'auto').
 *
 * "Leads desde o último encerramento": sem encerramento anterior o servidor
 * conta desde o início do dia da clínica (leads_desde_base = "hoje") e o texto
 * acompanha — o primeiro "Abrir" não fala de um encerramento que não existiu.
 *
 * Erro NUNCA vira estado "fechado": um erro de rede mostraria o botão
 * "Abrir" para quem já está em expediente. Erro fica visível, com "Tentar de novo".
 * RPC ainda não publicada (PGRST202, janela entre o site e a migration da
 * Fase 2): o aviso diz isso em PT-BR (mensagemDeErroRpc, a mesma detecção do
 * relatório) em vez de vazar "could not find the function".
 */

type Estado = "fechado" | "aberto" | "pausado";
type Motivo = "cafe" | "almoco" | "outro";

type PontoEstado = {
  servidor_agora: string;
  estado: Estado;
  abriu_em: string | null;
  encerrou_em: string | null;
  encerrado_auto: boolean;
  segundos_trabalhados: number;
  segundos_pausa: number;
  pausas: number;
  pausa_desde: string | null;
  motivo_pausa: Motivo | null;
  ultimo_encerramento: string | null;
  ultimo_encerramento_auto: boolean;
  pausa_alerta_min: number;
  leads_desde_ultimo_encerramento: number;
  /** "hoje" quando ainda não há encerramento anterior. */
  leads_desde_base?: "hoje" | "encerramento";
  /** A notificação de pausa longa já existe para o gestor. */
  gestor_avisado_pausa?: boolean;
  /** Só no retorno de ponto_abrir. */
  leads_aplicados_agora?: number;
  lote_erro?: string | null;
};

type RespostaRpc = { data: unknown; error: unknown };
// RPCs da Fase 2 ainda não estão em types.ts (gerado pelo Lovable) — mesmo
// padrão do resto do projeto para RPC não tipada.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (nome: string, args?: Record<string, unknown>): Promise<RespostaRpc> => (supabase as any).rpc(nome, args);

const TEXTO_RPC_AUSENTE = "O ponto de expediente ainda não está instalado no banco (migration da Fase 2 pendente).";
const mensagemDe = (e: unknown, fallback: string): string => mensagemDeErroRpc(e, fallback, TEXTO_RPC_AUSENTE);

const MOTIVOS: { valor: Motivo; rotulo: string; Icone: typeof Coffee }[] = [
  { valor: "cafe", rotulo: "Café", Icone: Coffee },
  { valor: "almoco", rotulo: "Almoço", Icone: Utensils },
  { valor: "outro", rotulo: "Outro", Icone: MoreHorizontal },
];
const rotuloMotivo = (m: Motivo | null) => MOTIVOS.find((x) => x.valor === m)?.rotulo ?? "Pausa";

const hhmmss = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};
const hhmm = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 3600)}h${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}`;
};
const horaLocal = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
const dataHoraLocal = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const desdeQuando = (e: PontoEstado) => (e.leads_desde_base === "hoje" ? "hoje" : "desde o último encerramento");

export default function SdrExpediente() {
  const [estado, setEstado] = useState<PontoEstado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null); // ação em curso
  const [tique, setTique] = useState(0);
  // Instante (relógio local) em que a última resposta do servidor chegou e o
  // "agora" do servidor naquele instante — o cronômetro é a diferença.
  const snapshot = useRef<{ localMs: number; servidorMs: number } | null>(null);

  const aplicar = useCallback((data: unknown) => {
    const e = data as PontoEstado;
    snapshot.current = { localMs: Date.now(), servidorMs: new Date(e.servidor_agora).getTime() };
    setEstado(e);
    setErro(null);
  }, []);

  const carregar = useCallback(async () => {
    const { data, error } = await rpc("ponto_meu_estado");
    if (error) {
      setErro(mensagemDe(error, "Não foi possível carregar o expediente."));
      return;
    }
    aplicar(data);
  }, [aplicar]);

  useEffect(() => {
    void carregar();
    const resync = window.setInterval(() => void carregar(), 60_000);
    const aoVoltar = () => { if (document.visibilityState === "visible") void carregar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    return () => {
      window.clearInterval(resync);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
    };
  }, [carregar]);

  // Cronômetro de 1 s, próprio deste cartão (o tique de 30 s da home governa a fila).
  useEffect(() => {
    if (!estado || estado.estado === "fechado") return;
    const t = window.setInterval(() => setTique((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [estado]);

  const acao = useCallback(async (nome: string, args: Record<string, unknown> | undefined, rotulo: string) => {
    setOcupado(nome);
    const { data, error } = await rpc(nome, args);
    setOcupado(null);
    if (error) {
      toast.error(mensagemDe(error, `Não foi possível ${rotulo}.`));
      // O estado real pode ter mudado (outra aba, encerramento automático).
      void carregar();
      return null;
    }
    aplicar(data);
    return data as PontoEstado;
  }, [aplicar, carregar]);

  const abrir = async () => {
    const r = await acao("ponto_abrir", undefined, "abrir o expediente");
    if (!r) return;
    const n = r.leads_desde_ultimo_encerramento ?? 0;
    toast.success(
      n === 0
        ? `Expediente aberto. Nenhum lead novo ${desdeQuando(r)}.`
        : `Expediente aberto. Você recebeu ${n} ${n === 1 ? "lead" : "leads"} ${desdeQuando(r)}.`,
    );
    if (r.lote_erro) toast.warning("O lote de leads reservados não pôde ser aplicado agora; o sistema tenta de novo sozinho.");
  };
  const pausar = (motivo: Motivo) => acao("ponto_pausar", { p_motivo: motivo }, "pausar");
  const retomar = () => acao("ponto_retomar", undefined, "retomar");
  const encerrar = async () => {
    const r = await acao("ponto_encerrar", undefined, "encerrar o expediente");
    if (r) toast.success(`Expediente encerrado. Hoje: ${hhmm(r.segundos_trabalhados)} trabalhadas.`);
  };

  // ---- cronômetro (relógio do servidor + tempo decorrido local)
  void tique;
  const decorrido = snapshot.current ? Math.max(0, (Date.now() - snapshot.current.localMs) / 1000) : 0;
  const emCurso = estado?.estado === "aberto" || estado?.estado === "pausado";
  const trabalhadoS = (estado?.segundos_trabalhados ?? 0) + (estado?.estado === "aberto" ? decorrido : 0);
  const pausaS = (estado?.segundos_pausa ?? 0) + (estado?.estado === "pausado" ? decorrido : 0);
  const pausaAtualS = estado?.estado === "pausado" && estado.pausa_desde && snapshot.current
    ? Math.max(0, (snapshot.current.servidorMs - new Date(estado.pausa_desde).getTime()) / 1000 + decorrido)
    : 0;
  const pausaLonga = estado?.estado === "pausado" && pausaAtualS >= (estado.pausa_alerta_min ?? 75) * 60;

  // ---- estados de carga/erro (nunca decidir "fechado" a partir de um erro)
  if (erro && !estado) {
    return (
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-[18px] py-4">
        <Clock size={18} className="text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Expediente indisponível</p>
          <p className="text-[12.5px] text-muted-foreground">{erro}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void carregar()}>
          <RefreshCw size={14} className="mr-1" /> Tentar de novo
        </Button>
      </section>
    );
  }
  if (!estado) {
    return (
      <section className="flex items-center gap-2 rounded-2xl border border-border bg-card px-[18px] py-4 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> Carregando o expediente...
      </section>
    );
  }

  const selo =
    estado.estado === "aberto"
      ? { texto: "Em expediente", cls: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400", ponto: "bg-emerald-500" }
      : estado.estado === "pausado"
        ? { texto: `Em pausa · ${rotuloMotivo(estado.motivo_pausa)}`, cls: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400", ponto: "bg-amber-500" }
        : { texto: "Fora do expediente", cls: "bg-muted text-muted-foreground", ponto: "bg-muted-foreground/50" };

  const leadsDesde = estado.leads_desde_ultimo_encerramento ?? 0;
  const resumoLeads = leadsDesde === 0
    ? `Nenhum lead novo ${desdeQuando(estado)}`
    : `Você recebeu ${leadsDesde} ${leadsDesde === 1 ? "lead" : "leads"} ${desdeQuando(estado)}`;

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-4 px-[18px] py-4">
        <span className={`grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[13px] ${
          estado.estado === "fechado"
            ? "bg-muted text-muted-foreground"
            : "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
        }`}>
          <Clock size={21} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Expediente</span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${selo.cls}`}>
              <span className={`h-[7px] w-[7px] rounded-full ${selo.ponto}`} />
              {selo.texto}
            </span>
            {erro && (
              <span className="text-[11.5px] text-destructive" title={erro}>sem sincronizar</span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
            <span className="font-mono text-[27px] font-bold leading-tight tracking-tight tabular-nums text-foreground">
              {emCurso ? hhmmss(trabalhadoS) : hhmm(estado.segundos_trabalhados)}
            </span>
            {emCurso ? (
              <span className="text-[12.5px] text-muted-foreground">
                desde {horaLocal(estado.abriu_em)}
                {estado.pausas > 0 && ` · ${estado.pausas === 1 ? "1 pausa" : `${estado.pausas} pausas`} (${hhmm(pausaS)})`}
                {estado.estado === "pausado" && ` · nesta pausa há ${hhmm(pausaAtualS)}`}
              </span>
            ) : estado.encerrou_em ? (
              <span className="text-[12.5px] text-muted-foreground">
                último expediente {dataHoraLocal(estado.abriu_em)} – {horaLocal(estado.encerrou_em)}
                {estado.encerrado_auto && " (encerrado automaticamente)"}
              </span>
            ) : (
              <span className="text-[12.5px] text-muted-foreground">nenhum expediente registrado ainda</span>
            )}
          </div>

          <p className={`mt-0.5 text-[12.5px] ${pausaLonga ? "font-semibold text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
            {pausaLonga
              ? `Pausa acima de ${estado.pausa_alerta_min} min — ${estado.gestor_avisado_pausa ? "o gestor foi avisado." : "o gestor será avisado."}`
              : resumoLeads}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {estado.estado === "fechado" && (
            <Button size="sm" onClick={abrir} disabled={!!ocupado}>
              {ocupado === "ponto_abrir" ? <Loader2 size={14} className="mr-1 animate-spin" /> : <LogIn size={14} className="mr-1" />}
              Abrir expediente
            </Button>
          )}
          {estado.estado === "aberto" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={!!ocupado}>
                  {ocupado === "ponto_pausar" ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Pause size={14} className="mr-1" />}
                  Pausar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {MOTIVOS.map(({ valor, rotulo, Icone }) => (
                  <DropdownMenuItem key={valor} onClick={() => void pausar(valor)}>
                    <Icone size={14} className="mr-2" /> {rotulo}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {estado.estado === "pausado" && (
            <Button size="sm" onClick={() => void retomar()} disabled={!!ocupado}>
              {ocupado === "ponto_retomar" ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Play size={14} className="mr-1" />}
              Retomar
            </Button>
          )}
          {emCurso && (
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={encerrar} disabled={!!ocupado}>
              {ocupado === "ponto_encerrar" ? <Loader2 size={14} className="mr-1 animate-spin" /> : <LogOut size={14} className="mr-1" />}
              Encerrar
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
