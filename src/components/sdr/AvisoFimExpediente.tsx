import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { mensagemDeErroRpc } from "@/lib/relatorioSdr";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlarmClock, Loader2, LogOut, Play, RefreshCw } from "lucide-react";

/**
 * Aviso de fim de expediente da SDR — vigia SEM tela própria, montado uma única
 * vez no CrmLayout (por isso vale em qualquer rota do CRM).
 *
 * Por que ele existe separado do cartão SdrExpediente: o aviso morava dentro do
 * cartão, que só é montado na home /crm/sdr. A SDR passa o dia em
 * /crm/conversas — lá não aparecia aviso nenhum e o cron encerrava o expediente
 * 1 minuto depois da saída dela, calado. O pedido do dono era o contrário:
 * perguntar antes, onde ela estiver.
 *
 * Regras que este componente sustenta:
 *   • só o perfil "sdr" faz alguma coisa. Papel ainda não resolvido ou qualquer
 *     outro papel: retorna null e NÃO chama RPC (o ponto é do perfil SDR — as
 *     RPCs recusariam de qualquer forma, e chamar por chamar polui o log);
 *   • o disparo usa o RELÓGIO DO SERVIDOR (servidor_agora de ponto_meu_estado,
 *     no mesmo padrão de snapshot do cartão): um PC com hora adiantada não pode
 *     encerrar o expediente antes da hora, nem um atrasado deixar passar;
 *   • a contagem de 15 s PARA enquanto alguma RPC está em curso. Antes ela
 *     continuava correndo durante a chamada: clicar em "Continuar por mais
 *     5 min" faltando 1-2 s (ou com internet lenta) encerrava o expediente
 *     mesmo assim, exatamente o oposto do que ela pediu;
 *   • o diálogo NÃO fecha por Esc nem por clique fora. Fechar sem escolher fazia
 *     a SDR achar que havia cancelado o encerramento, enquanto o cron fechava em
 *     silêncio minutos depois. Aqui não existe saída sem desfecho: encerrar,
 *     adiar, ou o próprio prazo vencendo;
 *   • encerrar que falha por rede mantém o aviso aberto com "Tentar de novo" (e
 *     a contagem não recomeça sozinha, para não entrar em laço de tentativas);
 *   • se o cron (ou outra aba) encerrou primeiro, isso não é erro dela: o aviso
 *     fecha com um recado neutro — e, antes de abrir, o aviso confere no
 *     servidor se o expediente ainda está aberto, para não perguntar sobre um
 *     expediente que ela já encerrou na mão;
 *   • DUAS ABAS não podem se atropelar. Como o vigia agora mora no layout, cada
 *     aba aberta tem o seu cronômetro: às 18:00 as duas mostravam o aviso, ela
 *     clicava "Continuar por mais 5 min" na aba da frente e a aba de trás
 *     chegava a zero e chamava ponto_encerrar — que NÃO recusa (o adiamento só
 *     segura o cron), encerrando o expediente contra a escolha explícita dela.
 *     Agora, antes de encerrar POR PRAZO e antes de ABRIR o aviso, o vigia relê
 *     ponto_fim_expediente: se encerra_em ficou MAIOR que o agora do servidor,
 *     outra aba adiou — o aviso fecha (ou nem abre) e nada é encerrado;
 *   • encerrar e adiar disparam o evento "ponto:mudou". Sem ele, o cartão do
 *     expediente na home ficava até 60 s (o resync dele) mostrando o estado
 *     velho depois de a decisão já ter sido tomada aqui;
 *   • quando o diálogo abre, o foco vai no botão SEGURO ("Continuar por mais
 *     5 min"). Antes o foco não entrava no diálogo e a decisão de 15 s era
 *     inalcançável pelo teclado — e o foco jamais pode nascer no botão de
 *     encerrar, senão um Enter distraído encerra o expediente.
 *
 * Os botões Abrir/Pausar/Retomar/Encerrar continuam no cartão da home — o dono
 * foi explícito: "mesmo podendo encerrar sozinho ainda tem que ter o botão de
 * encerrar".
 */

type Estado = "fechado" | "aberto" | "pausado";

/** Só o que o vigia precisa de ponto_meu_estado (o cartão usa o resto). */
type PontoEstado = {
  servidor_agora: string;
  estado: Estado;
  segundos_trabalhados: number;
};

/** ponto_fim_expediente: quando o expediente de hoje encerra sozinho (saída da SDR, ou adiamento). */
type FimExpediente = {
  servidor_agora: string;
  saida_hoje: string | null;
  adiado_ate: string | null;
  encerra_em: string | null;
};

type RespostaRpc = { data: unknown; error: unknown };
// RPCs do ponto não estão em types.ts (gerado pelo Lovable) — mesmo padrão do
// cartão SdrExpediente para RPC não tipada.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (nome: string, args?: Record<string, unknown>): Promise<RespostaRpc> => (supabase as any).rpc(nome, args);

const TEXTO_RPC_AUSENTE = "O ponto de expediente ainda não está instalado no banco (migration pendente).";
const mensagemDe = (e: unknown, fallback: string): string => mensagemDeErroRpc(e, fallback, TEXTO_RPC_AUSENTE);

/**
 * "Não tem mais o que encerrar": ponto_encerrar diz "O expediente já está
 * encerrado." e ponto_adiar_encerramento diz "O expediente não está aberto." —
 * as duas acontecem quando o cron ou outra aba chegou primeiro. Isso é
 * informação, não falha, e não pode aparecer como erro vermelho para a SDR.
 */
const jaEncerrado = (e: unknown): boolean => {
  const m = String((e as { message?: string } | null)?.message ?? "");
  return /j[áa] est[áa] encerrado|n[ãa]o est[áa] aberto/i.test(m);
};

/** Só para o toast do encerramento ("Hoje: 6h30 trabalhadas"). */
const hhmm = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 3600)}h${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}`;
};

const SEGUNDOS_AVISO = 15;
const MINUTOS_ADIAMENTO = 5;

/**
 * Avisa o resto da tela que o ponto mudou aqui. O cartão SdrExpediente ouve este
 * evento e recarrega na hora.
 *
 * Defeito que isso conserta: o vigia encerrava (ou adiava) o expediente e o
 * cartão da home continuava até 60 s — o intervalo de resync dele — mostrando o
 * estado velho, com cronômetro correndo e botão "Encerrar" de um expediente que
 * já havia sido encerrado.
 */
const avisarPontoMudou = () => window.dispatchEvent(new Event("ponto:mudou"));

export default function AvisoFimExpediente() {
  const { userRole, roleResolved } = useAuth();
  const ehSdr = roleResolved && userRole === "sdr";

  const [emExpediente, setEmExpediente] = useState(false);
  const [fim, setFim] = useState<FimExpediente | null>(null);
  const [aberto, setAberto] = useState(false);
  const [contador, setContador] = useState(SEGUNDOS_AVISO);
  const [ocupado, setOcupado] = useState<"encerrar" | "adiar" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tique, setTique] = useState(0);
  /** encerra_em já avisado: uma pergunta por horário. Adiar muda o encerra_em, e
   *  é justamente essa mudança que libera o próximo aviso, 5 minutos depois. */
  const [fimAvisado, setFimAvisado] = useState<string | null>(null);
  /** Instante local em que a resposta chegou + o "agora" do servidor nele. */
  const snapshot = useRef<{ localMs: number; servidorMs: number } | null>(null);
  // Refs para a sincronização de 60 s não depender do estado capturado no
  // closure (e não recriar o intervalo a cada tique).
  const ocupadoRef = useRef<"encerrar" | "adiar" | null>(null);
  const abertoRef = useRef(false);
  /** Conferência de "ainda está aberto?" em curso — impede que a batida de 1 s
   *  dispare a mesma verificação várias vezes. */
  const conferindo = useRef(false);
  /** Botão SEGURO ("Continuar por mais 5 min"): recebe o foco quando o diálogo
   *  abre, para a decisão de 15 s existir também para o teclado. */
  const botaoSeguro = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { ocupadoRef.current = ocupado; abertoRef.current = aberto; }, [ocupado, aberto]);

  /** Reancora o relógio: guarda o "agora" do servidor e o instante local em que
   *  ele chegou. Toda RPC do ponto devolve servidor_agora — usar a mais recente
   *  encurta a deriva entre as sincronizações de 60 s. */
  const marcarSnapshot = useCallback((servidorAgora: string | undefined) => {
    const ms = servidorAgora ? new Date(servidorAgora).getTime() : NaN;
    if (Number.isFinite(ms)) snapshot.current = { localMs: Date.now(), servidorMs: ms };
  }, []);

  /** Fecha o aviso porque o expediente já estava encerrado (cron/outra aba). */
  const fecharPorJaEncerrado = useCallback(() => {
    setAberto(false);
    setErro(null);
    setEmExpediente(false);
    setFim(null);
    toast.info("Seu expediente já havia sido encerrado.");
    avisarPontoMudou();
  }, []);

  /**
   * Relê ponto_fim_expediente e responde: "outra aba (ou o cartão da home) adiou
   * o encerramento?". A resposta é sim quando encerra_em passou a ser MAIOR que
   * o servidor_agora da MESMA resposta — os dois instantes vêm do servidor, sem
   * misturar o relógio do PC.
   *
   * Existe por causa do defeito das duas abas: o adiamento só segura o cron, e
   * ponto_encerrar aceita encerrar mesmo recém-adiado. Sem esta releitura, a aba
   * de trás chegava a zero e encerrava o expediente que ela acabou de prolongar
   * na aba da frente.
   *
   * Falha de rede aqui devolve `adiou: false` de propósito: na dúvida, o vigia
   * segue o comportamento antigo (perguntar/encerrar) em vez de deixar o
   * expediente aberto para sempre — quem fecha no fim do dia é o cron.
   */
  const conferirAdiamento = useCallback(async (): Promise<{ adiou: boolean; fim: FimExpediente | null }> => {
    const { data, error } = await rpc("ponto_fim_expediente");
    if (error || !data) return { adiou: false, fim: null };
    const f = data as FimExpediente;
    marcarSnapshot(f.servidor_agora);
    setFim(f);
    const agoraMs = new Date(f.servidor_agora).getTime();
    const alvoMs = f.encerra_em ? new Date(f.encerra_em).getTime() : NaN;
    const adiou = Number.isFinite(agoraMs) && Number.isFinite(alvoMs) && alvoMs > agoraMs;
    return { adiou, fim: f };
  }, [marcarSnapshot]);

  const sincronizar = useCallback(async () => {
    if (!ehSdr) return;
    // Chamada em curso: não sobrescrever o snapshot nem o estado no meio dela.
    if (ocupadoRef.current) return;
    const { data, error } = await rpc("ponto_meu_estado");
    // Erro de rede/RPC ausente é silencioso aqui: quem mostra a falha do ponto é
    // o cartão da home. Este vigia não pode encher a tela dela de toast.
    if (error || !data) return;
    const e = data as PontoEstado;
    marcarSnapshot(e.servidor_agora);
    const emCurso = e.estado === "aberto" || e.estado === "pausado";
    setEmExpediente(emCurso);
    if (!emCurso) {
      setFim(null);
      // Aviso na tela e expediente já fechado no servidor: dá o desfecho em vez
      // de fazer o diálogo desaparecer sem explicação.
      if (abertoRef.current) fecharPorJaEncerrado();
      return;
    }
    const r = await rpc("ponto_fim_expediente");
    if (r.error || !r.data) return; // sem horário de saída conhecido: nada a avisar
    const f = r.data as FimExpediente;
    marcarSnapshot(f.servidor_agora);
    setFim(f);
  }, [ehSdr, fecharPorJaEncerrado, marcarSnapshot]);

  // Sincroniza ao montar, a cada 60 s e quando a aba volta ao foco (uma aba em
  // segundo plano tem timer estrangulado pelo navegador).
  useEffect(() => {
    if (!ehSdr) return;
    void sincronizar();
    const resync = window.setInterval(() => void sincronizar(), 60_000);
    const aoVoltar = () => { if (document.visibilityState === "visible") void sincronizar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    return () => {
      window.clearInterval(resync);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
    };
  }, [ehSdr, sincronizar]);

  // Batida de 1 s só enquanto há expediente em curso: é ela que compara o "agora
  // do servidor" com o encerra_em.
  useEffect(() => {
    if (!ehSdr || !emExpediente) return;
    const t = window.setInterval(() => setTique((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [ehSdr, emExpediente]);

  // Em toda saída destas duas funções o `ocupado` é liberado DEPOIS do desfecho
  // (erro na tela, diálogo fechado). Liberar antes abriria uma renderização com
  // contagem em zero e nada barrando o encerramento automático — a mesma
  // armadilha que este componente veio consertar.
  /**
   * `porPrazo` = a contagem de 15 s venceu (ninguém clicou). Só nesse caso o
   * vigia relê ponto_fim_expediente antes de encerrar: se outra aba adiou, a
   * escolha explícita dela vale mais que o cronômetro desta aba.
   *
   * A releitura fica DENTRO daqui, com `ocupado` já marcado, de propósito: se
   * fosse uma função separada que solta e remarca o `ocupado`, o efeito da
   * contagem (que ainda está com contador em 0) disparava o encerramento uma
   * segunda vez.
   */
  const encerrar = useCallback(async (porPrazo = false) => {
    setOcupado("encerrar");
    setErro(null);
    if (porPrazo) {
      const { adiou } = await conferirAdiamento();
      if (adiou) {
        setAberto(false);
        setOcupado(null);
        toast.info("Encerramento adiado em outra aba. Seu expediente continua aberto.");
        return;
      }
    }
    const { data, error } = await rpc("ponto_encerrar");
    if (error) {
      if (jaEncerrado(error)) { fecharPorJaEncerrado(); setOcupado(null); return; }
      // Falhou por rede: o aviso FICA aberto com "Tentar de novo". Sumir agora
      // deixaria a SDR sem saber se encerrou ou não.
      setErro(mensagemDe(error, "Não foi possível encerrar o expediente agora. Verifique a internet e tente de novo."));
      setOcupado(null);
      return;
    }
    const e = data as PontoEstado | null;
    setAberto(false);
    setEmExpediente(false);
    setFim(null);
    setOcupado(null);
    toast.success(
      e ? `Expediente encerrado. Hoje: ${hhmm(e.segundos_trabalhados)} trabalhadas.` : "Expediente encerrado.",
    );
    // O cartão da home precisa saber agora, não no resync de 60 s dele.
    avisarPontoMudou();
  }, [conferirAdiamento, fecharPorJaEncerrado]);

  const continuarMais5 = useCallback(async () => {
    setOcupado("adiar");
    setErro(null);
    const { data, error } = await rpc("ponto_adiar_encerramento", { p_min: MINUTOS_ADIAMENTO });
    if (error) {
      if (jaEncerrado(error)) { fecharPorJaEncerrado(); setOcupado(null); return; }
      setErro(mensagemDe(error, "Não foi possível adiar o encerramento agora. Verifique a internet e tente de novo."));
      setOcupado(null);
      return;
    }
    // O novo encerra_em é diferente do que acabou de ser avisado — e é por isso
    // que o aviso volta sozinho quando os 5 minutos vencerem.
    const f = data as FimExpediente;
    marcarSnapshot(f.servidor_agora);
    setFim(f);
    setAberto(false);
    setOcupado(null);
    toast.success(`Mais ${MINUTOS_ADIAMENTO} minutos. Aviso de novo quando acabar.`);
    // A linha "Encerra sozinho às HH:MM" do cartão da home muda com o adiamento:
    // sem este aviso ela ficava com o horário antigo até o resync de 60 s.
    avisarPontoMudou();
  }, [fecharPorJaEncerrado, marcarSnapshot]);

  // Chegou a hora (pelo relógio do servidor): abre o aviso, uma vez por horário.
  useEffect(() => {
    if (!ehSdr || !emExpediente || aberto || conferindo.current) return;
    if (!fim?.encerra_em || !snapshot.current) return;
    if (fimAvisado === fim.encerra_em) return;
    const agoraServidorMs = snapshot.current.servidorMs + (Date.now() - snapshot.current.localMs);
    if (agoraServidorMs < new Date(fim.encerra_em).getTime()) return;
    const alvo = fim.encerra_em;
    conferindo.current = true;
    void (async () => {
      // Confere no servidor ANTES de abrir: o estado em memória pode ter até
      // 60 s, e ela pode ter encerrado na mão pelo cartão da home (ou em outra
      // aba) segundos antes. Perguntar "vai encerrar?" sobre um expediente já
      // fechado só confundiria.
      const { data, error } = await rpc("ponto_meu_estado");
      if (error || !data) {
        // Sem resposta: espera 5 s antes de tentar de novo, para uma internet
        // caída não virar uma chamada por segundo.
        window.setTimeout(() => { conferindo.current = false; }, 5_000);
        return;
      }
      const e = data as PontoEstado;
      marcarSnapshot(e.servidor_agora);
      const segueAberto = e.estado === "aberto" || e.estado === "pausado";
      setEmExpediente(segueAberto);
      if (!segueAberto) { setFim(null); conferindo.current = false; return; }
      // Segunda pergunta ao servidor, pelo mesmo motivo das duas abas: se ela
      // clicou "Continuar por mais 5 min" na outra aba nos últimos segundos, o
      // encerra_em já é futuro e esta aba não deve nem abrir o aviso.
      const { adiou, fim: f } = await conferirAdiamento();
      conferindo.current = false;
      if (adiou) return;
      // Marca o horário efetivamente lido agora (e não o `alvo` de um estado que
      // pode ter até 60 s): é ele que compõe a regra "uma pergunta por horário".
      setFimAvisado(f?.encerra_em ?? alvo);
      setContador(SEGUNDOS_AVISO);
      setErro(null);
      setAberto(true);
    })();
  }, [tique, ehSdr, emExpediente, aberto, fim, fimAvisado, conferirAdiamento, marcarSnapshot]);

  // Contagem do aviso: sem resposta em 15 s, encerra.
  // A contagem PARA quando `ocupado` (a chamada dela está em curso) e quando há
  // `erro` na tela — assim a decisão dela nunca é atropelada pelo cronômetro, e
  // uma falha de rede não vira laço de tentativas automáticas.
  useEffect(() => {
    if (!aberto || ocupado || erro) return;
    // `true` = encerramento POR PRAZO: só nesse caminho o vigia relê o
    // ponto_fim_expediente para não atropelar um adiamento feito em outra aba.
    if (contador <= 0) { void encerrar(true); return; }
    const t = window.setTimeout(() => setContador((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [aberto, ocupado, erro, contador, encerrar]);

  if (!ehSdr) return null;

  const emCurso = !!ocupado;

  // Diálogo controlado só por este componente (de propósito não tem
  // onOpenChange): Esc e clique fora são barrados porque o aviso existe para
  // forçar uma escolha — encerrar ou continuar. Fechar "no vazio" era o defeito
  // que fazia a SDR achar que havia cancelado o encerramento enquanto o cron
  // fechava o expediente em silêncio.
  return (
    <AlertDialog open={aberto}>
      <AlertDialogContent
        className="max-w-sm"
        onEscapeKeyDown={(e) => e.preventDefault()}
        // Clique fora não fecha, e não é preciso prop nenhuma para isso: o
        // AlertDialog do Radix já barra pointerDownOutside/interactOutside por
        // conta própria — é por isso que essas duas props nem existem no tipo
        // dele (o `onPointerDownOutside` que ficava aqui era erro de tipo puro,
        // sem efeito algum no comportamento).
        // Foco explícito no botão SEGURO. Sem isto o foco não entrava no
        // diálogo: quem usa teclado (ou leitor de tela) não alcançava a decisão
        // dentro dos 15 s e o expediente encerrava sozinho. O foco nunca nasce
        // em "Encerrar agora" — um Enter reflexo encerraria o expediente.
        onOpenAutoFocus={(e) => { e.preventDefault(); botaoSeguro.current?.focus(); }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlarmClock size={18} className="text-amber-500" /> Seu expediente vai encerrar
          </AlertDialogTitle>
          <AlertDialogDescription>
            {erro ? (
              <span className="text-destructive">{erro}</span>
            ) : ocupado ? (
              "Só um instante, estamos registrando sua escolha..."
            ) : (
              <>
                Chegou o fim do seu horário. Sem resposta, o expediente encerra em{" "}
                <span className="font-mono text-base font-semibold tabular-nums text-foreground">{contador}s</span>.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <Button ref={botaoSeguro} variant="outline" onClick={() => void continuarMais5()} disabled={emCurso}>
            {ocupado === "adiar" ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Play size={14} className="mr-1" />}
            Continuar por mais {MINUTOS_ADIAMENTO} min
          </Button>
          <Button onClick={() => void encerrar()} disabled={emCurso}>
            {ocupado === "encerrar"
              ? <Loader2 size={14} className="mr-1 animate-spin" />
              : erro
                ? <RefreshCw size={14} className="mr-1" />
                : <LogOut size={14} className="mr-1" />}
            {erro ? "Tentar de novo" : "Encerrar agora"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
