import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensagemDeErroRpc, rpcAusente } from "@/lib/relatorioSdr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BookOpen, Car, Check, Clock, Coffee, Loader2, LogIn, LogOut, MoreHorizontal, Pause, Phone,
  Play, RefreshCw, Stethoscope, User, Utensils, X,
} from "lucide-react";

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
 * MOTIVOS DE PAUSA (11/09/2026): a lista NÃO é mais escrita aqui. Ela vem de
 * ponto_motivos_ativos() — quem manda é o CRC, na aba Equipe ("o crc deve
 * gerenciar tudo isso do SDR"). Três cuidados, porque o expediente dela não
 * pode depender de uma consulta dar certo:
 *   1. o estado NASCE com a lista de hoje (Café / Almoço / Outro), então o
 *      botão "Pausar" nunca fica travado esperando o banco responder;
 *   2. se a consulta falhar ou vier vazia, essa lista continua valendo — e ela
 *      é exatamente a que o banco publicado aceita hoje, não uma lista nova que
 *      seria recusada no clique;
 *   3. motivo com exige_texto abre um campo para ela escrever (é o "Outro" do
 *      pedido do dono). O texto vai em p_detalhe e é gravado em
 *      crm_ponto_eventos.motivo_detalhe — o MOTIVO continua sendo a chave
 *      curta, que é o que mantém o relatório de ponto agrupável.
 * Banco ainda sem a migration dos motivos (site novo publicado antes): a
 * chamada de dois argumentos volta PGRST202 e a tela repete com um argumento
 * só — a assinatura antiga —, avisando que o texto escrito ainda não é
 * guardado. Assim a SDR pausa nas duas pontas da janela de publicação.
 *
 * "Leads desde o último encerramento": sem encerramento anterior o servidor
 * conta desde o início do dia da clínica (leads_desde_base = "hoje") e o texto
 * acompanha — o primeiro "Abrir" não fala de um encerramento que não existiu.
 *
 * O AVISO de "seu expediente vai encerrar" (15 s, encerrar agora × mais 5 min)
 * NÃO fica mais aqui: mora em AvisoFimExpediente, montado no CrmLayout. Este
 * cartão só existe na home /crm/sdr, e a SDR passa o dia em Conversas — o aviso
 * nunca a alcançava lá e o servidor encerrava calado. Aqui ficaram o cartão, os
 * botões (encerrar na mão continua existindo, por decisão do dono) e a linha
 * "Encerra sozinho às HH:MM", que vem da mesma ponto_fim_expediente.
 * Como a decisão passou a ser tomada FORA deste cartão, ele ouve o evento
 * "ponto:mudou" disparado pelo vigia e recarrega na hora — antes o cartão ficava
 * até um minuto inteiro (o resync) mostrando um expediente já encerrado.
 *
 * Erro NUNCA vira estado "fechado": um erro de rede mostraria o botão
 * "Abrir" para quem já está em expediente. Erro fica visível, com "Tentar de novo".
 * RPC ainda não publicada (PGRST202, janela entre o site e a migration da
 * Fase 2): o aviso diz isso em PT-BR (mensagemDeErroRpc, a mesma detecção do
 * relatório) em vez de vazar "could not find the function".
 */

type Estado = "fechado" | "aberto" | "pausado";

/** Uma opção do menu "Pausar" (linha de crm_ponto_motivos, via ponto_motivos_ativos). */
type MotivoPausa = {
  /** Chave curta e estável — é ela que vai para crm_ponto_eventos.motivo. */
  chave: string;
  rotulo: string;
  /** Nome do ícone lucide; o que a tela não conhecer vira "pause". */
  icone: string;
  /** Pede o motivo escrito (o "Outro" do pedido do dono). */
  exige_texto: boolean;
};

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
  /** Chave do motivo (não o rótulo): a tradução para a tela vem da lista. */
  motivo_pausa: string | null;
  /** Só no retorno de ponto_pausar(p_motivo, p_detalhe). */
  motivo_detalhe?: string | null;
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

/** ponto_fim_expediente: quando o expediente de hoje encerra sozinho (saída da SDR, ou adiamento). */
type FimExpediente = {
  servidor_agora: string;
  saida_hoje: string | null;
  adiado_ate: string | null;
  encerra_em: string | null;
};

/** ponto_minha_pausa: a pausa aberta desta SDR (motivo, rótulo e o texto escrito). */
type MinhaPausa = {
  pausado: boolean;
  motivo?: string | null;
  rotulo?: string | null;
  detalhe?: string | null;
  desde?: string | null;
};

type RespostaRpc = { data: unknown; error: unknown };
// RPCs da Fase 2 ainda não estão em types.ts (gerado pelo Lovable) — mesmo
// padrão do resto do projeto para RPC não tipada.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (nome: string, args?: Record<string, unknown>): Promise<RespostaRpc> => (supabase as any).rpc(nome, args);

const TEXTO_RPC_AUSENTE = "O ponto de expediente ainda não está instalado no banco (migration da Fase 2 pendente).";
const mensagemDe = (e: unknown, fallback: string): string => mensagemDeErroRpc(e, fallback, TEXTO_RPC_AUSENTE);

/**
 * Lista de segurança: é EXATAMENTE a que o banco publicado hoje aceita
 * ('cafe', 'almoco', 'outro'). Vale nos dois momentos em que a consulta não
 * serve — enquanto ela não volta e quando ela falha — e por isso não pode
 * conter motivo novo: oferecer "Ligação" a um banco que ainda não a conhece
 * seria um erro no clique dela. "Outro" já pede o texto aqui: se o banco for o
 * novo, a exigência bate; se for o antigo, a tela manda o texto e o servidor
 * simplesmente ignora (a assinatura de um argumento).
 */
const MOTIVOS_FALLBACK: MotivoPausa[] = [
  { chave: "cafe", rotulo: "Café", icone: "coffee", exige_texto: false },
  { chave: "almoco", rotulo: "Almoço", icone: "utensils", exige_texto: false },
  { chave: "outro", rotulo: "Outro", icone: "more-horizontal", exige_texto: true },
];

/** Ícones que o gestor pode escolher (a RPC ponto_motivo_criar valida a mesma lista). */
const ICONES: Record<string, typeof Coffee> = {
  coffee: Coffee,
  utensils: Utensils,
  phone: Phone,
  "more-horizontal": MoreHorizontal,
  pause: Pause,
  clock: Clock,
  car: Car,
  stethoscope: Stethoscope,
  user: User,
  "book-open": BookOpen,
};
const iconeDe = (nome: string | null | undefined): typeof Coffee => ICONES[String(nome ?? "")] ?? Pause;

/** Motivo que não está mais na lista (evento antigo): mostra a chave legível. */
const chaveLegivel = (chave: string) => {
  const s = chave.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * Mesma régua do banco ("pelo menos 3 letras"): pontuação e espaço não contam,
 * então "..." e "---" não passam aqui nem lá. Sem isso a tela liberaria o botão
 * e o servidor recusaria — a SDR levaria o erro depois de já ter digitado.
 */
const LIMITE_DETALHE = 120;
const detalheSuficiente = (t: string) => t.replace(/[\s.,;:!?¡¿'"“”()[\]{}\-_/\\|+*=<>@#$%&~^`´]/g, "").length >= 3;

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
  // Encerramento automático (decisão do dono, 09/09): na saída do horário dela o
  // servidor encerra sozinho. Aqui isso só aparece como a linha "Encerra sozinho
  // às HH:MM" — quem pergunta antes, em qualquer tela, é AvisoFimExpediente.
  const [fim, setFim] = useState<FimExpediente | null>(null);
  // Motivos: nascem com a lista de segurança e são TROCADOS quando o banco
  // responde. Nunca ficam vazios — botão de pausa sem opção é botão quebrado.
  const [motivos, setMotivos] = useState<MotivoPausa[]>(MOTIVOS_FALLBACK);
  const [motivosDoBanco, setMotivosDoBanco] = useState(false);
  // Motivo escolhido que pede texto: enquanto está aqui, o cartão mostra o campo.
  const [pedindo, setPedindo] = useState<MotivoPausa | null>(null);
  const [texto, setTexto] = useState("");
  // O que ela escreveu na pausa que está correndo (vem de ponto_minha_pausa).
  const [detalhePausa, setDetalhePausa] = useState<string | null>(null);
  const campoDetalhe = useRef<HTMLInputElement | null>(null);
  // Lido pelo onCloseAutoFocus do menu: o Radix devolve o foco ao botão
  // "Pausar" quando o menu fecha, e isso roubava o cursor do campo que acabou
  // de abrir — ela digitaria no nada. Ref, e não estado, porque o menu fecha
  // ANTES de o React aplicar o setPedindo.
  const querTexto = useRef(false);
  // Instante (relógio local) em que a última resposta do servidor chegou e o
  // "agora" do servidor naquele instante — o cronômetro é a diferença.
  const snapshot = useRef<{ localMs: number; servidorMs: number } | null>(null);

  const carregarFim = useCallback(async () => {
    const { data, error } = await rpc("ponto_fim_expediente");
    if (error || !data) return; // RPC ausente ou erro: sem aviso automático, o servidor encerra do mesmo jeito
    setFim(data as FimExpediente);
  }, []);

  /** Lista do CRC. Erro ou lista vazia mantém a de segurança, calada: a SDR
   *  precisa pausar, não precisa saber que uma consulta falhou. */
  const carregarMotivos = useCallback(async () => {
    const { data, error } = await rpc("ponto_motivos_ativos");
    if (error || !Array.isArray(data) || data.length === 0) return;
    setMotivos(
      (data as Record<string, unknown>[])
        .filter((m) => typeof m.chave === "string" && String(m.chave).trim() !== "")
        .map((m) => ({
          chave: String(m.chave),
          rotulo: String(m.rotulo ?? "").trim() || chaveLegivel(String(m.chave)),
          icone: String(m.icone ?? "pause"),
          exige_texto: m.exige_texto === true,
        })),
    );
    setMotivosDoBanco(true);
  }, []);

  /** Texto escrito na pausa em curso. Só é chamado quando o estado é "pausado". */
  const carregarDetalhe = useCallback(async () => {
    const { data, error } = await rpc("ponto_minha_pausa");
    if (error || !data) return; // banco sem a migration: o selo fica sem o detalhe, e só
    const p = data as MinhaPausa;
    setDetalhePausa(p.pausado ? (p.detalhe ?? null) : null);
  }, []);

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
    const e = data as PontoEstado;
    if (e.estado === "aberto" || e.estado === "pausado") void carregarFim();
    else setFim(null);
    if (e.estado === "pausado") void carregarDetalhe();
    else setDetalhePausa(null);
    if (e.estado !== "aberto") setPedindo(null); // não ficar pedindo texto fora do expediente aberto
  }, [aplicar, carregarFim, carregarDetalhe]);

  useEffect(() => {
    void carregar();
    void carregarMotivos();
    // Os MOTIVOS também entram no resync. O gestor pode mexer na lista a qualquer
    // hora — é o ponto do pedido do dono — e a SDR de aba aberta ficaria clicando
    // em opção que o banco recusa, por tempo indefinido, até apertar F5.
    const resync = window.setInterval(() => { void carregar(); void carregarMotivos(); }, 60_000);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") { void carregar(); void carregarMotivos(); }
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    return () => {
      window.clearInterval(resync);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
    };
  }, [carregar, carregarMotivos]);

  // O vigia AvisoFimExpediente (montado no layout) encerra ou adia o expediente
  // fora deste cartão. Sem este ouvinte, o cartão ficava até 60 s — o intervalo
  // de resync acima — mostrando o estado velho depois da decisão dela: relógio
  // correndo, botão "Encerrar" e a linha "Encerra sozinho às HH:MM" com o
  // horário anterior ao adiamento. O vigia dispara "ponto:mudou"; aqui só
  // recarregamos.
  useEffect(() => {
    const aoMudarPonto = () => void carregar();
    window.addEventListener("ponto:mudou", aoMudarPonto);
    return () => window.removeEventListener("ponto:mudou", aoMudarPonto);
  }, [carregar]);

  // Cronômetro de 1 s, próprio deste cartão (o tique de 30 s da home governa a fila).
  useEffect(() => {
    if (!estado || estado.estado === "fechado") return;
    const t = window.setInterval(() => setTique((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [estado]);

  // Cursor dentro do campo assim que ele aparece (depois de o menu terminar de
  // fechar): é uma pausa, ela não vai clicar no campo para começar a escrever.
  useEffect(() => {
    if (!pedindo) return;
    const t = window.setTimeout(() => campoDetalhe.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [pedindo]);

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

  /**
   * Pausar com motivo (e o texto, quando o motivo pede).
   *
   * Duas tentativas de propósito: a primeira é a assinatura nova
   * ponto_pausar(p_motivo, p_detalhe); se o banco ainda não tiver a migration
   * dos motivos, o PostgREST devolve PGRST202 e a segunda usa a assinatura
   * antiga, de um argumento, que continua existindo. Sem esse segundo caminho,
   * publicar o site antes de aplicar a migration deixaria a SDR sem pausar.
   */
  const pausar = useCallback(async (m: MotivoPausa, detalhe: string | null) => {
    const escrito = detalhe && detalhe.trim() ? detalhe.trim().slice(0, LIMITE_DETALHE) : null;
    setOcupado("ponto_pausar");
    let { data, error } = await rpc("ponto_pausar", { p_motivo: m.chave, p_detalhe: escrito });
    let semDetalheNoBanco = false;
    if (error && rpcAusente(error)) {
      const r = await rpc("ponto_pausar", { p_motivo: m.chave });
      data = r.data;
      error = r.error;
      semDetalheNoBanco = !error && !!escrito;
    }
    setOcupado(null);
    if (error) {
      toast.error(mensagemDe(error, "Não foi possível pausar."));
      void carregar();
      // A recusa mais provável aqui é justamente lista velha: o gestor desativou
      // o motivo, ou passou a exigir texto num que não exigia. Repor a lista no
      // mesmo instante faz o próximo clique já usar o menu certo — senão a
      // mensagem manda escrever o motivo e não existe campo onde escrever.
      void carregarMotivos();
      return;
    }
    aplicar(data);
    const devolvido = (data as PontoEstado | null)?.motivo_detalhe;
    setDetalhePausa(devolvido ?? escrito);
    setPedindo(null);
    setTexto("");
    if (semDetalheNoBanco) {
      toast.warning("Pausa registrada. O motivo escrito só vai ser guardado depois que o banco for atualizado.");
    }
  }, [aplicar, carregar]);

  /** Clique no menu: motivo que pede texto abre o campo; os outros pausam na hora. */
  const escolherMotivo = (m: MotivoPausa) => {
    if (m.exige_texto) {
      querTexto.current = true;
      setTexto("");
      setPedindo(m);
      return;
    }
    querTexto.current = false;
    void pausar(m, null);
  };

  const retomar = () => acao("ponto_retomar", undefined, "retomar");
  // Encerrar na mão continua sendo um botão do cartão: o dono foi explícito —
  // "mesmo podendo encerrar sozinho ainda tem que ter o botão de encerrar".
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

  // Rótulo do motivo da pausa em curso: a lista traduz a chave; motivo que saiu
  // da lista (evento antigo) vira a própria chave legível, nunca "Pausa" — o
  // gestor precisa reconhecer o que ela escolheu naquele dia.
  const motivoEmCurso = estado.motivo_pausa
    ? motivos.find((m) => m.chave === estado.motivo_pausa)?.rotulo ?? chaveLegivel(estado.motivo_pausa)
    : "Pausa";
  const detalheCurto = detalhePausa && detalhePausa.length > 48 ? `${detalhePausa.slice(0, 48)}…` : detalhePausa;

  const selo =
    estado.estado === "aberto"
      ? { texto: "Em expediente", cls: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400", ponto: "bg-emerald-500", titulo: "" }
      : estado.estado === "pausado"
        ? {
            texto: `Em pausa · ${motivoEmCurso}${detalheCurto ? `: ${detalheCurto}` : ""}`,
            cls: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
            ponto: "bg-amber-500",
            titulo: detalhePausa ?? "",
          }
        : { texto: "Fora do expediente", cls: "bg-muted text-muted-foreground", ponto: "bg-muted-foreground/50", titulo: "" };

  const leadsDesde = estado.leads_desde_ultimo_encerramento ?? 0;
  const resumoLeads = leadsDesde === 0
    ? `Nenhum lead novo ${desdeQuando(estado)}`
    : `Você recebeu ${leadsDesde} ${leadsDesde === 1 ? "lead" : "leads"} ${desdeQuando(estado)}`;
  const pausando = ocupado === "ponto_pausar";
  const podeConfirmar = detalheSuficiente(texto) && !pausando;

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
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${selo.cls}`} title={selo.titulo}>
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
                {/* Nunca desabilitado por causa da lista: ela já nasce preenchida. */}
                <Button size="sm" variant="outline" disabled={!!ocupado}>
                  {pausando ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Pause size={14} className="mr-1" />}
                  Pausar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end" className="w-48"
                onCloseAutoFocus={(e) => { if (querTexto.current) { e.preventDefault(); querTexto.current = false; } }}
              >
                {motivos.map((m) => {
                  const Icone = iconeDe(m.icone);
                  return (
                    <DropdownMenuItem key={m.chave} onClick={() => escolherMotivo(m)}>
                      <Icone size={14} className="mr-2" /> {m.rotulo}
                      {m.exige_texto && <span className="ml-auto pl-2 text-[10.5px] text-muted-foreground">escrever</span>}
                    </DropdownMenuItem>
                  );
                })}
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

      {/* Campo do motivo escrito. Fica NA LINHA, sem diálogo: ela está com
          pressa (é uma pausa, não um formulário) — abre com o cursor dentro,
          Enter confirma e Esc cancela. O botão só libera com texto de verdade,
          a mesma régua do banco. */}
      {pedindo && estado.estado === "aberto" && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-[18px] py-2.5">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
            {(() => { const Icone = iconeDe(pedindo.icone); return <Icone size={14} />; })()}
            {pedindo.rotulo}:
          </span>
          <Input
            autoFocus
            ref={campoDetalhe}
            value={texto}
            maxLength={LIMITE_DETALHE}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && podeConfirmar) { e.preventDefault(); void pausar(pedindo, texto); }
              if (e.key === "Escape") { e.preventDefault(); setPedindo(null); setTexto(""); }
            }}
            placeholder="Motivo da pausa (ex.: buscar documento no cartório)"
            aria-label={`Motivo da pausa: ${pedindo.rotulo}`}
            className="h-8 w-full max-w-[360px] flex-1 text-sm"
          />
          <Button size="sm" onClick={() => void pausar(pedindo, texto)} disabled={!podeConfirmar}>
            {pausando ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Check size={14} className="mr-1" />}
            Pausar
          </Button>
          <Button
            size="sm" variant="ghost" className="text-muted-foreground"
            onClick={() => { setPedindo(null); setTexto(""); }} disabled={pausando}
          >
            <X size={14} className="mr-1" /> Cancelar
          </Button>
          <span className="w-full text-[11px] text-muted-foreground">
            Pelo menos 3 letras. Enter confirma, Esc cancela.
            {!motivosDoBanco && " Esta lista de motivos é a padrão: a configurada pelo administrador não pôde ser lida agora."}
          </span>
        </div>
      )}

      {emCurso && fim?.encerra_em && (
        <p className="border-t border-border px-[18px] py-2 text-[11.5px] text-muted-foreground">
          Encerra sozinho às {horaLocal(fim.encerra_em)}{fim.adiado_ate && fim.encerra_em === fim.adiado_ate ? " (adiado)" : ""}.
        </p>
      )}
    </section>
  );
}
