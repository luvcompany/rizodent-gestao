import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Power, RefreshCw, Shuffle } from "lucide-react";
import { mensagemDeErroRpc, rpcAusente } from "@/lib/relatorioSdr";

/**
 * Painel do motor do rodízio, dentro da aba Equipe (só o gestor chega aqui).
 *
 * Três modos, lidos e gravados no banco (crm_rodizio_config.modo):
 *   desligado — nada se move (estado de nascimento);
 *   sombra    — o motor só anota no livro quem TERIA recebido cada lead;
 *   ligado    — distribui de verdade.
 * O interruptor é a RPC rodizio_definir_modo; o retrato é rodizio_estado.
 *
 * Funis: o motor olhava UM funil só (o principal). Quando o dono criou funis
 * por procedimento, todo lead que caía neles ficava fora da distribuição — sem
 * aviso nenhum. Agora a lista de funis é escolhida aqui (rodizio_definir_funis)
 * e o estado devolve funis_ids/funis; lista vazia = padrão (só o principal).
 * A lista oferecida é recortada por tenant_id e só traz funil sem allowed_roles
 * (ver carregarFunis): sem isso o superadmin via funis de outros clientes e a
 * tela oferecia funil de closer/recepção que a RPC recusa.
 *
 * Realocação por silêncio: o tempo NÃO é mais contado no relógio da clínica, e
 * sim no expediente de cada SDR (migration do relógio justo, 10/09) — pausa,
 * almoço, depois de encerrar, fim de semana e feriado não correm contra ela.
 * A frase antiga desta tela ("realocação após N min sem resposta humana") ficou
 * meia verdade em dois pontos, e os dois estão escritos aqui agora:
 *   • lead que escreveu fora do horário CONTRATADO da dona (noite, fim de
 *     semana, dia de folga) ganha uma carência a mais — o "prazo maior pela
 *     manhã" que o dono pediu. É o campo novo desta tela, gravado por
 *     rodizio_definir_carencia_abertura. Pausa e almoço NÃO ganham carência: o
 *     relógio da própria SDR já para no almoço inteiro, e somar as duas coisas
 *     empurraria para a tarde o lead que escreveu 12h10;
 *   • se a dona não abriu o expediente no dia (falta, atestado, férias, conta
 *     esquecida), o relógio volta a ser o da clínica — senão o lead ficaria
 *     preso com quem não veio trabalhar.
 * O campo só aparece quando rodizio_estado devolve
 * realocar_carencia_abertura_min: banco sem a migration não pode mostrar um
 * número que não sabe gravar. src/integrations/supabase/types.ts ainda não
 * conhece a coluna nem a RPC, e nada aqui depende disso — as RPCs desta tela
 * passam todas pelo helper `rpc()` (cast local) e o estado é lido como jsonb.
 *
 * A distribuição inicial dos leads sem resposta passa SEMPRE por um dry-run
 * que mostra a lista antes de mover alguém, e leva um TETO por SDR nesta
 * rodada (p_max_por_sdr): sem teto, uma rodada só despeja a fila inteira na
 * SDR que estiver com menos entregas. O diálogo mostra o teto que o banco
 * realmente aplicou, e em modo sombra não oferece Confirmar — fora do modo
 * ligado o banco recusa a execução real.
 */

type Modo = "desligado" | "sombra" | "ligado";

interface MembroEstado {
  user_id: string; nome: string; estado: string; aberta: boolean; carga: number; reservas: number;
  /** Horário de hoje (da SDR ou, sem horário próprio, o comercial da clínica); null = não trabalha hoje. */
  entrada_hoje?: string | null; saida_hoje?: string | null;
}
interface Estado {
  modo: Modo; modo_alterado_em: string | null; em_expediente: boolean; dia_util: boolean;
  agora_local: string; fuso: string; reservas_pendentes: number; reservas_aviso: string | null;
  realocar_sem_resposta_min: number; hora_corte: string; corte_ate: string; equipe: MembroEstado[];
  /**
   * Minutos a MAIS no limite de silêncio quando a mensagem do lead chegou fora
   * do horário contratado da dona (noite, fim de semana, folga). Opcional
   * porque o banco pode estar sem a migration do relógio justo.
   */
  realocar_carencia_abertura_min?: number;
  /** Carência (min) entre o comparecimento e a entrega do lead ao administrador; 0 = na hora. */
  entrega_gestor_apos_min?: number; entregas_pendentes?: number;
  /** Corte: reserva de quem não abriu até entrada + N min vai para quem abriu. */
  corte_tolerancia_min?: number;
  /** Funil principal do rodízio (rodizio_funil): o padrão quando não há lista. */
  funil_id?: string | null;
  /** Funis escolhidos para o rodízio; opcionais porque o banco pode estar sem a migration. */
  funis_ids?: string[] | null;
  funis?: { id: string; nome: string }[] | null;
}
interface LinhaDistribuicao {
  lead_id: string; lead_nome: string | null; lead_telefone: string | null; etapa: string | null;
  ultima_mensagem_em: string | null; acao: string; para_user_id: string | null; para_nome: string | null;
}
/** Funil da tabela crm_pipelines (só os de venda entram no rodízio). */
interface Funil { id: string; name: string; is_instagram: boolean; is_posvenda: boolean; position: number | null }

const TEXTO_AUSENTE = "O motor do rodízio ainda não foi instalado no banco (migration da Fase 3 pendente).";
const TEXTO_FUNIS_AUSENTE = "A escolha dos funis do rodízio ainda não foi instalada no banco (migration pendente).";
const TEXTO_CARENCIA_AUSENTE =
  "O prazo extra de quem escreve fora do horário da SDR ainda não foi instalado no banco (migration do relógio justo pendente).";
/** Teto padrão por SDR na distribuição inicial: uma rodada calma, não um despejo. */
const TETO_PADRAO = "30";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args?: Record<string, unknown>) => (supabase as any).rpc(fn, args);

const ROTULO: Record<Modo, string> = { desligado: "Desligado", sombra: "Modo sombra", ligado: "Ligado" };
const COR: Record<Modo, string> = {
  desligado: "bg-muted text-muted-foreground",
  sombra: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  ligado: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
};
const ESTADO_PONTO: Record<string, string> = {
  aberta: "Em expediente", pausada: "Em pausa", encerrada: "Encerrou o expediente",
  fechada: "Sem expediente aberto", ausente: "Não abriu hoje",
};

const fmtHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export default function RodizioPainel({ aoMudar }: { aoMudar?: () => void }) {
  // Clínica do usuário logado. A lista de funis é filtrada por ela: ver o
  // comentário de carregarFunis — para o superadmin a RLS não filtra nada e a
  // tela chegava a oferecer funis de OUTROS clientes.
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? null;
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [alvo, setAlvo] = useState<Modo | null>(null);
  const [mudando, setMudando] = useState(false);
  const [previa, setPrevia] = useState<LinhaDistribuicao[] | null>(null);
  const [minutos, setMinutos] = useState<string>("");
  const [salvandoMin, setSalvandoMin] = useState(false);
  const [carenciaH, setCarenciaH] = useState<string>("");
  const [salvandoCarencia, setSalvandoCarencia] = useState(false);
  // Carência de abertura: o prazo extra de quem escreveu fora do horário da SDR.
  const [carenciaAbertura, setCarenciaAbertura] = useState<string>("");
  const [salvandoCarenciaAbertura, setSalvandoCarenciaAbertura] = useState(false);
  const [tolerancia, setTolerancia] = useState<string>("");
  const [salvandoTolerancia, setSalvandoTolerancia] = useState(false);
  const [distribuindo, setDistribuindo] = useState(false);
  // Teto por SDR da distribuição inicial. `tetoAplicado` é o teto que o dry-run
  // usou: a confirmação repete ESSE valor, senão o gestor confirmaria uma lista
  // diferente da que leu (basta ele mexer no campo com o diálogo aberto).
  const [maxPorSdr, setMaxPorSdr] = useState<string>(TETO_PADRAO);
  const [tetoAplicado, setTetoAplicado] = useState<number | null>(Number(TETO_PADRAO));
  // Funis do rodízio: a lista vem de crm_pipelines, a marcação vem do estado.
  const [funisDisponiveis, setFunisDisponiveis] = useState<Funil[]>([]);
  const [erroFunis, setErroFunis] = useState<string | null>(null);
  const [funisSel, setFunisSel] = useState<string[]>([]);
  const [funisNoBanco, setFunisNoBanco] = useState(false);
  const [salvandoFunis, setSalvandoFunis] = useState(false);

  /**
   * Funis de venda DESTA clínica. Três filtros, cada um consertando um defeito:
   *
   *   • tenant_id — a consulta não filtrava por clínica e confiava na RLS. Para
   *     o superadmin a RLS não recorta nada: a tela listava funis de OUTROS
   *     clientes e o gestor podia marcar um deles para o rodízio;
   *   • allowed_roles IS NULL — funil restrito a closer ou recepção não é porta
   *     de entrada do rodízio. A RPC rodizio_definir_funis passou a recusar
   *     esses funis; a tela não pode oferecer o que o banco vai rejeitar;
   *   • Instagram e pós-venda ficam de fora: não são entrada de lead novo, e
   *     entregá-los ao rodízio embaralharia o atendimento de comentário e o
   *     pós-operatório.
   */
  const carregarFunis = useCallback(async () => {
    if (!tenantId) {
      setFunisDisponiveis([]);
      setErroFunis("Não foi possível identificar a clínica do seu usuário para listar os funis.");
      return;
    }
    const { data, error } = await supabase
      .from("crm_pipelines")
      .select("id, name, is_instagram, is_posvenda, position")
      .eq("tenant_id", tenantId)
      .is("allowed_roles", null)
      .order("position", { ascending: true, nullsFirst: false })
      .order("created_at");
    if (error) {
      setErroFunis(mensagemDeErroRpc(error, "Não foi possível listar os funis.", TEXTO_FUNIS_AUSENTE));
      return;
    }
    setErroFunis(null);
    setFunisDisponiveis(((data ?? []) as Funil[]).filter((f) => !f.is_instagram && !f.is_posvenda));
  }, [tenantId]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await rpc("rodizio_estado");
    setCarregando(false);
    if (error) { setErro(mensagemDeErroRpc(error, "Não foi possível ler o estado do rodízio.", TEXTO_AUSENTE)); return; }
    setErro(null);
    const e = data as Estado;
    setEstado(e);
    setMinutos(String(e.realocar_sem_resposta_min ?? ""));
    setCarenciaH(typeof e.entrega_gestor_apos_min === "number" ? String(Math.round(e.entrega_gestor_apos_min / 60)) : "");
    setCarenciaAbertura(typeof e.realocar_carencia_abertura_min === "number" ? String(e.realocar_carencia_abertura_min) : "");
    setTolerancia(typeof e.corte_tolerancia_min === "number" ? String(e.corte_tolerancia_min) : "");
    // `in` (e não `?? []`) porque precisamos distinguir "o banco devolveu lista
    // vazia" (= padrão, só o funil principal) de "este banco ainda não conhece
    // funis do rodízio" — no segundo caso a tela avisa em vez de sugerir que a
    // marcação já vale.
    setFunisNoBanco(("funis_ids" in e) || ("funis" in e));
    setFunisSel(Array.isArray(e.funis_ids) ? e.funis_ids.map(String) : []);
    await carregarFunis();
  }, [carregarFunis]);

  useEffect(() => { carregar(); }, [carregar]);

  const definirModo = async () => {
    if (!alvo) return;
    setMudando(true);
    const { data, error } = await rpc("rodizio_definir_modo", { p_modo: alvo });
    setMudando(false);
    setAlvo(null);
    if (error) { toast.error(mensagemDeErroRpc(error, "Não foi possível mudar o modo.", TEXTO_AUSENTE)); return; }
    const r = data as { modo: Modo; elegiveis: number; abertas: number };
    if (r.modo === "ligado" && r.elegiveis === 0) {
      toast.warning("Rodízio ligado, mas nenhuma SDR está no rodízio: os leads continuam com o administrador até alguém entrar.");
    } else if (r.modo === "ligado" && r.abertas === 0) {
      toast.success("Rodízio ligado. Ninguém está em expediente agora: os leads novos ficam reservados e são entregues quando cada SDR abrir.");
    } else {
      toast.success(`Rodízio: ${ROTULO[r.modo].toLowerCase()}.`);
    }
    await carregar();
    aoMudar?.();
  };

  /** Campo do teto: vazio = sem teto (null); `false` = número inválido. */
  const tetoDoCampo = (): number | null | false => {
    const t = maxPorSdr.trim();
    if (t === "") return null;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 1 || n > 500) return false;
    return n;
  };

  /**
   * Distribuição inicial com teto por SDR. O parâmetro p_max_por_sdr é novo:
   * se o banco ainda estiver na versão anterior a função "não existe" com essa
   * assinatura (PGRST202) — aí repetimos SEM o teto e avisamos, em vez de
   * deixar o botão morto ou aplicar um teto que o banco ignorou calado.
   *
   * Devolve o teto EFETIVAMENTE usado (`tetoUsado`), null quando caiu no
   * fallback sem teto. Defeito que isso conserta: a tela guardava o teto PEDIDO
   * e o diálogo dizia "Teto de 30 por SDR nesta rodada" para uma lista calculada
   * sem teto nenhum — o gestor confirmava acreditando num limite que não existia.
   */
  const chamarDistribuir = async (
    dryRun: boolean,
    teto: number | null,
  ): Promise<{ data: unknown; error: unknown; tetoUsado: number | null }> => {
    const args: Record<string, unknown> = { p_dry_run: dryRun };
    if (teto !== null) args.p_max_por_sdr = teto;
    const r = await rpc("rodizio_distribuir_sem_resposta_agora", args);
    if (r.error && teto !== null && rpcAusente(r.error)) {
      toast.warning("Este banco ainda não aceita teto por SDR (migration pendente): a rodada vai sem limite por SDR.");
      const semTeto = await rpc("rodizio_distribuir_sem_resposta_agora", { p_dry_run: dryRun });
      return { data: semTeto.data, error: semTeto.error, tetoUsado: null };
    }
    return { data: r.data, error: r.error, tetoUsado: teto };
  };

  const simular = async () => {
    const teto = tetoDoCampo();
    if (teto === false) { toast.error("O teto por SDR precisa ser um número inteiro de 1 a 500 (deixe em branco para não limitar)."); return; }
    setDistribuindo(true);
    const { data, error, tetoUsado } = await chamarDistribuir(true, teto);
    setDistribuindo(false);
    if (error) { toast.error(mensagemDeErroRpc(error, "Não foi possível simular a distribuição.", TEXTO_AUSENTE)); return; }
    // O teto que o banco realmente aplicou nesta lista — não o que foi pedido.
    setTetoAplicado(tetoUsado);
    setPrevia((data ?? []) as LinhaDistribuicao[]);
  };

  const distribuir = async () => {
    setDistribuindo(true);
    // Mesmo teto do dry-run que o gestor acabou de ler (tetoAplicado), não o
    // que estiver no campo agora.
    const { data, error } = await chamarDistribuir(false, tetoAplicado);
    setDistribuindo(false);
    setPrevia(null);
    if (error) { toast.error(mensagemDeErroRpc(error, "Não foi possível distribuir.", TEXTO_AUSENTE)); return; }
    const linhas = (data ?? []) as LinhaDistribuicao[];
    const movidos = linhas.filter((l) => l.acao !== "fica").length;
    toast.success(`${movidos} lead${movidos === 1 ? "" : "s"} sem resposta distribuído${movidos === 1 ? "" : "s"}.`);
    await carregar();
    aoMudar?.();
  };

  const salvarMinutos = async () => {
    // Campo vazio NÃO é zero: Number("") é 0 e 0 aqui significa "desligar a
    // realocação". Quem apagou o campo sem querer desligava a regra inteira.
    if (minutos.trim() === "") { toast.error("Informe os minutos para a realocação (0 desliga)."); return; }
    const n = Number(minutos);
    if (!Number.isInteger(n) || n < 0 || n > 240) { toast.error("Informe um tempo entre 0 (desligado) e 240 minutos."); return; }
    setSalvandoMin(true);
    const { error } = await rpc("rodizio_definir_tempo_realocacao", { p_min: n });
    setSalvandoMin(false);
    if (error) { toast.error(mensagemDeErroRpc(error, "Não foi possível salvar o tempo.", TEXTO_AUSENTE)); return; }
    // O "de expediente da SDR" só é verdade em banco com a migration do relógio
    // justo — o mesmo sinal usado no resto da tela (a chave da carência).
    const porSdr = typeof estado?.realocar_carencia_abertura_min === "number";
    toast.success(n === 0
      ? "Realocação por silêncio desligada."
      : porSdr
        ? `Realocação após ${n} min de expediente da SDR sem resposta humana.`
        : `Realocação após ${n} min sem resposta humana (horário comercial da clínica).`);
    await carregar();
  };

  /**
   * Carência de abertura — o "prazo maior pela manhã". Vale só para a mensagem
   * que chegou fora do horário contratado da dona (noite, fim de semana,
   * folga); pausa e almoço já param o relógio dela e não somam carência.
   *
   * Campo vazio NÃO é zero: 0 aqui significa "quem escreveu de madrugada tem o
   * mesmo prazo de quem escreveu às 10h", uma decisão. O teto de 480 min é o
   * mesmo que a RPC rodizio_definir_carencia_abertura aceita — validar aqui
   * evita mandar ao banco um número que ele vai recusar.
   */
  const salvarCarenciaAbertura = async () => {
    if (carenciaAbertura.trim() === "") { toast.error("Informe os minutos a mais (0 desliga a carência)."); return; }
    const n = Number(carenciaAbertura);
    if (!Number.isInteger(n) || n < 0 || n > 480) { toast.error("Informe entre 0 (desligada) e 480 minutos (8 h)."); return; }
    setSalvandoCarenciaAbertura(true);
    const { error } = await rpc("rodizio_definir_carencia_abertura", { p_min: n });
    setSalvandoCarenciaAbertura(false);
    if (error) { toast.error(mensagemDeErroRpc(error, "Não foi possível salvar a carência.", TEXTO_CARENCIA_AUSENTE)); return; }
    toast.success(n === 0
      ? "Sem prazo extra: quem escreveu fora do horário da SDR tem o mesmo tempo."
      : `Quem escreveu fora do horário da SDR ganha ${n} min a mais antes da realocação.`);
    await carregar();
  };

  const salvarCarencia = async () => {
    // Campo vazio não vira 0: 0 aqui quer dizer "entrega o lead ao
    // administrador na hora do comparecimento", uma decisão, não um branco.
    if (carenciaH.trim() === "") { toast.error("Informe as horas de carência (0 = na hora)."); return; }
    const h = Number(carenciaH);
    if (!Number.isInteger(h) || h < 0 || h > 168) { toast.error("Informe entre 0 (na hora) e 168 horas (7 dias)."); return; }
    setSalvandoCarencia(true);
    const { error } = await rpc("rodizio_definir_carencia_entrega", { p_min: h * 60 });
    setSalvandoCarencia(false);
    if (error) { toast.error(mensagemDeErroRpc(error, "Não foi possível salvar a carência.", TEXTO_AUSENTE)); return; }
    toast.success(h === 0
      ? "Depois do comparecimento o lead passa para o administrador na hora."
      : `Depois do comparecimento o lead fica ${h} h com a SDR antes de passar para o administrador.`);
    await carregar();
  };

  const salvarTolerancia = async () => {
    // Com o campo VAZIO, Number("") é 0 e o botão gravava tolerância 0: o corte
    // passava a acontecer no instante da entrada de cada SDR — quem chegasse um
    // minuto atrasada perdia as reservas do dia. Campo em branco não é zero.
    if (tolerancia.trim() === "") { toast.error("Informe os minutos de tolerância."); return; }
    const n = Number(tolerancia);
    if (!Number.isInteger(n) || n < 0 || n > 480) { toast.error("Informe entre 0 e 480 minutos."); return; }
    setSalvandoTolerancia(true);
    const { error } = await rpc("rodizio_definir_tolerancia_corte", { p_min: n });
    setSalvandoTolerancia(false);
    if (error) { toast.error(mensagemDeErroRpc(error, "Não foi possível salvar a tolerância.", TEXTO_AUSENTE)); return; }
    toast.success(`Reservas de quem não abrir até ${n} min depois da entrada passam para quem abriu.`);
    await carregar();
  };

  const alternarFunil = (id: string, marcado: boolean) =>
    setFunisSel((prev) => (marcado ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));

  const salvarFunis = async () => {
    setSalvandoFunis(true);
    const { error } = await rpc("rodizio_definir_funis", { p_ids: funisSel });
    setSalvandoFunis(false);
    if (error) { toast.error(mensagemDeErroRpc(error, "Não foi possível salvar os funis do rodízio.", TEXTO_FUNIS_AUSENTE)); return; }
    const nomes = funisDisponiveis.filter((f) => funisSel.includes(f.id)).map((f) => f.name).join(", ");
    toast.success(funisSel.length === 0
      ? "Rodízio de volta ao padrão: só o funil principal entra na distribuição."
      : `Rodízio nos funis: ${nomes}.`);
    await carregar();
    aoMudar?.();
  };

  if (erro) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        {erro}
        <Button variant="link" size="sm" className="ml-2 h-auto p-0" onClick={carregar}>Tentar de novo</Button>
      </div>
    );
  }
  if (!estado) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" size={14} /> Lendo o estado do rodízio...
      </div>
    );
  }

  const modo = estado.modo;
  // Alcance do motor: os funis que o banco diz estar no rodízio. Sem lista
  // (ou com lista vazia) vale só o funil principal — e a frase precisa dizer
  // isso, porque foi justamente aí que os leads dos funis por procedimento
  // ficaram parados sem ninguém perceber.
  const nomesFunisEstado = Array.isArray(estado.funis) ? estado.funis.map((f) => f.nome).filter(Boolean) : [];
  const alcance = nomesFunisEstado.length > 0
    ? `dos funis ${nomesFunisEstado.join(", ")}`
    : funisNoBanco ? "do funil principal" : "do funil";
  // Realocação por silêncio em palavras verdadeiras. A frase antiga dizia
  // "realocação após N min sem resposta humana" e mentia em dois pontos: o
  // relógio é o expediente da SDR (não o da clínica) e quem escreveu fora do
  // horário dela tem N + carência. Cada pedaço abaixo conserta um.
  const carenciaAberturaMin =
    typeof estado.realocar_carencia_abertura_min === "number" ? estado.realocar_carencia_abertura_min : null;
  const fraseCarencia = carenciaAberturaMin === null
    ? "" // banco sem a migration: não prometer um prazo extra que ainda não existe
    : carenciaAberturaMin > 0
      ? ` Mensagem que chegou fora do horário dela (noite, fim de semana, folga) ganha ${carenciaAberturaMin} min a mais: ${estado.realocar_sem_resposta_min} + ${carenciaAberturaMin}.`
      : " Sem prazo extra: quem escreveu fora do horário dela tem o mesmo tempo.";
  // `carenciaAberturaMin === null` é o sinal de que ESTE banco ainda não tem a
  // migration do relógio justo (a chave nasce com a coluna). Aí o cronômetro
  // continua sendo o comercial da clínica, e prometer "expediente da SDR" seria
  // a mesma mentira do painel antigo, só invertida.
  const relogioDaSdr = carenciaAberturaMin !== null;
  const fraseRealocacao = estado.realocar_sem_resposta_min <= 0
    ? "Realocação por silêncio desligada: lead sem resposta continua com a mesma SDR."
    : relogioDaSdr
      ? `Realocação por silêncio: ${estado.realocar_sem_resposta_min} min sem resposta humana contados no expediente da SDR — pausa, almoço, depois de encerrar, fim de semana e feriado não contam.${fraseCarencia} Se a dona não abriu o expediente no dia, o tempo volta a ser contado no horário da clínica, para o lead não ficar preso com quem não veio trabalhar.`
      : `Realocação após ${estado.realocar_sem_resposta_min} min sem resposta humana, contados no horário comercial da clínica (o relógio por SDR ainda não foi publicado neste banco).`;
  const descricao: Record<Modo, string> = {
    desligado: "Nada é distribuído. Leads novos continuam com o administrador.",
    sombra: "O motor só anota, no livro de atribuições, quem teria recebido cada lead. Ninguém muda de dona.",
    ligado: `Leads novos ${alcance} vão para a SDR em expediente com menos entregas; fora do expediente ficam reservados. Reserva de quem não abriu até ${estado.corte_tolerancia_min ?? 60} min depois da entrada dela vai para quem abriu. ${fraseRealocacao}`,
  };
  // Salvar só habilita se a marcação mudou de verdade (ordem não conta).
  const mesmaLista = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const x = [...a].sort();
    const y = [...b].sort();
    return x.every((v, i) => v === y[i]);
  };
  const funisMudaram = !mesmaLista(funisSel, Array.isArray(estado.funis_ids) ? estado.funis_ids.map(String) : []);
  const movidosPrevia = (previa ?? []).filter((l) => l.acao !== "fica").length;
  // O diálogo da prévia prometia que "em modo sombra, a confirmação só anota no
  // livro". Promessa falsa: fora do modo ligado o banco RECUSA a execução real —
  // não existe anotação nem confirmação a oferecer. Em sombra a frase diz a
  // verdade e o botão Confirmar nem aparece (ver o rodapé do diálogo).
  const fraseDaConfirmacao = modo === "sombra"
    ? "Em modo sombra esta lista é só simulação — para aplicar, ligue o rodízio."
    : "Ao confirmar, cada um vai para a SDR indicada (ou fica reservado se ela não estiver em expediente).";

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Power size={18} className="text-primary" />
          <h2 className="font-semibold text-foreground">Distribuição automática</h2>
          <Badge variant="outline" className={COR[modo]}>{ROTULO[modo]}</Badge>
        </div>
        <span className="text-xs text-muted-foreground">
          {estado.em_expediente ? "Em horário comercial" : "Fora do horário comercial"}
          {" · "}{estado.dia_util ? "dia útil" : "não é dia útil"}
          {estado.modo_alterado_em && ` · modo desde ${fmtHora(estado.modo_alterado_em)}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={carregar} disabled={carregando} title="Atualizar">
            <RefreshCw size={14} className={carregando ? "animate-spin" : ""} />
          </Button>
          {(["desligado", "sombra", "ligado"] as Modo[]).filter((m) => m !== modo).map((m) => (
            <Button key={m} size="sm" variant={m === "ligado" ? "default" : "outline"} onClick={() => setAlvo(m)}>
              {m === "desligado" ? "Desligar" : m === "sombra" ? "Modo sombra" : "Ligar"}
            </Button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">{descricao[modo]}</p>
      {estado.reservas_aviso && (
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">{estado.reservas_aviso}</p>
      )}

      {estado.equipe.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SDR</TableHead>
                <TableHead>Expediente</TableHead>
                <TableHead>Horário hoje</TableHead>
                <TableHead className="text-right">Entregas no ciclo</TableHead>
                <TableHead className="text-right">Reservados</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {estado.equipe.map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell className="font-medium">{m.nome}</TableCell>
                  <TableCell>{ESTADO_PONTO[m.estado] ?? m.estado}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.entrada_hoje ? `${m.entrada_hoje}–${m.saida_hoje ?? ""}` : "não trabalha hoje"}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.carga}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.reservas}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
        <span className="text-muted-foreground">Realocar lead sem resposta humana após</span>
        <input
          type="number" min={0} max={240} value={minutos} onChange={(e) => setMinutos(e.target.value)}
          className="h-8 w-20 rounded-md border border-border bg-background px-2 text-sm tabular-nums"
          aria-label="Minutos de expediente da SDR sem resposta"
        />
        <span className="text-muted-foreground">{relogioDaSdr ? "min de expediente da SDR (0 desliga)" : "min (0 desliga)"}</span>
        <Button size="sm" variant="outline" onClick={salvarMinutos} disabled={salvandoMin || String(estado.realocar_sem_resposta_min) === minutos}>
          {salvandoMin ? <Loader2 className="animate-spin" size={14} /> : "Salvar"}
        </Button>
        {/* O relógio é o dela, não o da clínica: sem esta linha o gestor lê "30
            min" e cobra 30 minutos de parede — inclusive o almoço. Em banco sem
            a migration a linha diz o que vale lá: o relógio da clínica. */}
        <span className="w-full text-xs text-muted-foreground">
          {relogioDaSdr
            ? "O tempo corre só enquanto a dona está com o expediente aberto e sem pausa: almoço, pausa, depois de encerrar, fim de semana e feriado não contam. Se ela não abriu o expediente no dia, o tempo é contado no horário da clínica e o lead é realocado normalmente."
            : "Neste banco o tempo ainda é contado no horário comercial da clínica, inclusive durante a pausa e o almoço da SDR: o relógio por expediente entra depois de publicar as migrations."}
          {/* Em sombra não existe dona de verdade — a simulação continua no
              relógio da clínica, e dizer o contrário aqui seria mentir de novo. */}
          {relogioDaSdr && modo === "sombra" && " Em modo sombra o motor só simula e usa o relógio da clínica: o relógio por expediente vale quando o rodízio está ligado, com dona de verdade."}
        </span>
      </div>

      {/* O "prazo maior pela manhã" do dono. Só aparece quando rodizio_estado
          devolve a chave: banco sem a migration do relógio justo não tem coluna
          para gravar, e campo que não salva é pior do que campo nenhum. */}
      {typeof estado.realocar_carencia_abertura_min === "number" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">Quem escreveu fora do horário da SDR (noite, fim de semana, folga) ganha</span>
          <input
            type="number" min={0} max={480} value={carenciaAbertura} onChange={(e) => setCarenciaAbertura(e.target.value)}
            className="h-8 w-20 rounded-md border border-border bg-background px-2 text-sm tabular-nums"
            aria-label="Minutos a mais antes da realocação quando a mensagem chegou fora do horário da SDR"
          />
          <span className="text-muted-foreground">min a mais antes de realocar (0 desliga)</span>
          <Button
            size="sm" variant="outline" onClick={salvarCarenciaAbertura}
            disabled={salvandoCarenciaAbertura || String(estado.realocar_carencia_abertura_min) === carenciaAbertura}
          >
            {salvandoCarenciaAbertura ? <Loader2 className="animate-spin" size={14} /> : "Salvar"}
          </Button>
          <span className="w-full text-xs text-muted-foreground">
            Vale só para o horário contratado dela (aba Equipe → Editar) e para dia não útil. Pausa e
            almoço não entram aqui: o relógio da própria SDR já para nesses períodos, e somar as duas
            coisas empurraria para a tarde o lead que escreveu na hora do almoço.
            {estado.realocar_sem_resposta_min > 0 && ` Limite desses leads: ${estado.realocar_sem_resposta_min + estado.realocar_carencia_abertura_min} min de expediente dela.`}
          </span>
        </div>
      )}

      {typeof estado.entrega_gestor_apos_min === "number" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">Depois do comparecimento, o lead fica com a SDR por</span>
          <input
            type="number" min={0} max={168} value={carenciaH} onChange={(e) => setCarenciaH(e.target.value)}
            className="h-8 w-20 rounded-md border border-border bg-background px-2 text-sm tabular-nums"
            aria-label="Horas de carência antes de passar ao administrador"
          />
          <span className="text-muted-foreground">h antes de passar para o administrador (0 = na hora)</span>
          <Button
            size="sm" variant="outline" onClick={salvarCarencia}
            disabled={salvandoCarencia || String(Math.round(estado.entrega_gestor_apos_min / 60)) === carenciaH}
          >
            {salvandoCarencia ? <Loader2 className="animate-spin" size={14} /> : "Salvar"}
          </Button>
          {(estado.entregas_pendentes ?? 0) > 0 && (
            <span className="text-xs text-muted-foreground">
              {estado.entregas_pendentes} lead{estado.entregas_pendentes === 1 ? "" : "s"} na carência agora.
            </span>
          )}
        </div>
      )}

      {typeof estado.corte_tolerancia_min === "number" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">Reserva de quem não abriu o expediente passa para quem abriu</span>
          <input
            type="number" min={0} max={480} value={tolerancia} onChange={(e) => setTolerancia(e.target.value)}
            className="h-8 w-20 rounded-md border border-border bg-background px-2 text-sm tabular-nums"
            aria-label="Minutos depois da entrada"
          />
          <span className="text-muted-foreground">min depois da entrada dela (horário na aba Equipe → Editar)</span>
          <Button
            size="sm" variant="outline" onClick={salvarTolerancia}
            disabled={salvandoTolerancia || String(estado.corte_tolerancia_min) === tolerancia}
          >
            {salvandoTolerancia ? <Loader2 className="animate-spin" size={14} /> : "Salvar"}
          </Button>
          {/* Esta mesma tolerância é a régua que diz "não abriu o expediente
              hoje" na realocação por silêncio (relógio justo). O gestor mexe em
              um número e move duas regras: precisa saber disso antes. */}
          {relogioDaSdr && (
            <span className="w-full text-xs text-muted-foreground">
              Este mesmo prazo decide quando a SDR conta como ausente no dia: passado ele sem expediente
              aberto, os leads dela voltam a ser contados pelo relógio da clínica e podem ser realocados.
            </span>
          )}
        </div>
      )}

      {/* Funis que entram no rodízio. Antes o motor olhava um funil só: lead que
          caía num funil por procedimento nunca chegava a uma SDR. */}
      <div className="mt-3 border-t border-border pt-3 text-sm">
        <p className="font-medium text-foreground">Funis que entram no rodízio</p>
        {!funisNoBanco && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            Este banco ainda não devolve os funis do rodízio (migration pendente): a marcação só passa
            a valer depois de publicar as migrations.
          </p>
        )}
        {erroFunis ? (
          <p className="mt-1 text-xs text-destructive">{erroFunis}</p>
        ) : funisDisponiveis.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Nenhum funil de vendas cadastrado. Funis de Instagram e de pós-venda não entram no rodízio.
          </p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {funisDisponiveis.map((f) => (
                <label key={f.id} className="flex cursor-pointer items-center gap-2">
                  <Checkbox checked={funisSel.includes(f.id)} onCheckedChange={(c) => alternarFunil(f.id, !!c)} />
                  <span className="text-foreground">
                    {f.name}
                    {estado.funil_id === f.id && <span className="text-muted-foreground"> (principal)</span>}
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={salvarFunis} disabled={salvandoFunis || !funisMudaram}>
                {salvandoFunis ? <Loader2 className="animate-spin" size={14} /> : "Salvar funis"}
              </Button>
              {/* A legenda dizia só "lead NOVO nele entra na distribuição" —
                  prometia menos do que o clique faz. Marcar um funil também
                  coloca em movimento os leads que JÁ estão nele: a varredura
                  seguinte do motor os alcança. O gestor precisa saber disso antes
                  de salvar, não depois de ver leads antigos mudando de dona. */}
              <span className="text-xs text-muted-foreground">
                {funisSel.length === 0
                  ? "Nenhum marcado: volta ao padrão — só o funil principal entra no rodízio."
                  : funisSel.length === 1
                    ? "1 funil marcado. Entram na distribuição os leads novos dele e também os que já estão lá, na próxima varredura do motor."
                    : `${funisSel.length} funis marcados. Entram na distribuição os leads novos deles e também os que já estão lá, na próxima varredura do motor.`}
              </span>
            </div>
          </>
        )}
      </div>

      {modo !== "desligado" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button variant="outline" size="sm" onClick={simular} disabled={distribuindo}>
            <Shuffle size={14} className="mr-1" /> Distribuir os leads sem resposta agora
          </Button>
          <span className="text-xs text-muted-foreground">no máximo</span>
          <input
            type="number" min={1} max={500} value={maxPorSdr} onChange={(e) => setMaxPorSdr(e.target.value)}
            className="h-8 w-20 rounded-md border border-border bg-background px-2 text-sm tabular-nums"
            aria-label="Máximo de leads por SDR nesta rodada"
          />
          <span className="text-xs text-muted-foreground">
            por SDR nesta rodada (em branco = sem teto). Mostra a lista antes de mover.
            {/* Dizia "em modo sombra só anota, não move" — promessa falsa: o
                banco recusa a execução real fora do modo ligado, então em sombra
                não há nem anotação, só a simulação na tela. */}
            {modo === "sombra" && " Em modo sombra esta lista é só simulação — para aplicar, ligue o rodízio."}
          </span>
        </div>
      )}

      <AlertDialog open={!!alvo} onOpenChange={(o) => !o && setAlvo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {alvo === "ligado" ? "Ligar a distribuição automática?" : alvo === "sombra" ? "Passar para o modo sombra?" : "Desligar a distribuição?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {alvo === "ligado" && "A partir de agora os leads novos do funil vão para as SDRs no rodízio. Os leads que já existem continuam onde estão até você usar a distribuição inicial."}
              {alvo === "sombra" && "O motor passa a registrar quem teria recebido cada lead, sem mudar dona nenhuma. Use por alguns dias para conferir a distribuição antes de ligar."}
              {alvo === "desligado" && "Reservas pendentes são canceladas sem mover ninguém. Leads já entregues continuam com as SDRs."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mudando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); definirModo(); }} disabled={mudando}>
              {mudando ? <Loader2 className="animate-spin" size={14} /> : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={previa !== null} onOpenChange={(o) => !o && setPrevia(null)}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Distribuição inicial dos leads sem resposta</AlertDialogTitle>
            <AlertDialogDescription>
              {previa && previa.length === 0
                ? "Nenhum lead do administrador está aguardando resposta agora."
                : `${previa?.length ?? 0} lead${(previa?.length ?? 0) === 1 ? "" : "s"} aguardando resposta; ${movidosPrevia === 1 ? "1 muda de dona" : `${movidosPrevia} mudam de dona`}. ${
                    tetoAplicado === null
                      ? `Sem teto por SDR: ${movidosPrevia === 1 ? "esse lead vai" : `todos esses ${movidosPrevia} leads vão`} de uma vez.`
                      : `Teto de ${tetoAplicado} por SDR nesta rodada.`
                  } ${fraseDaConfirmacao}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {previa && previa.length > 0 && (
            <div className="max-h-72 overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead>Etapa</TableHead>
                    <TableHead>Última mensagem</TableHead>
                    <TableHead>Vai para</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previa.map((l) => (
                    <TableRow key={l.lead_id}>
                      <TableCell className="font-medium">{l.lead_nome || l.lead_telefone || "—"}</TableCell>
                      <TableCell>{l.etapa ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{fmtHora(l.ultima_mensagem_em)}</TableCell>
                      <TableCell>{l.para_nome ?? l.acao}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={distribuindo}>Fechar</AlertDialogCancel>
            {/* Em modo sombra não existe botão Confirmar: o banco recusa a
                execução real fora do modo ligado, e o botão só serviria para o
                gestor tomar um erro depois de decidir. */}
            {modo !== "sombra" && previa && previa.length > 0 && (
              <AlertDialogAction onClick={(e) => { e.preventDefault(); distribuir(); }} disabled={distribuindo}>
                {distribuindo ? <Loader2 className="animate-spin" size={14} /> : "Confirmar distribuição"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
