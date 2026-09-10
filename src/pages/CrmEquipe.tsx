import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useGestorEquipe } from "@/hooks/useGestorEquipe";
import RodizioPainel from "@/components/sdr/RodizioPainel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Info, KeyRound, Loader2, Pencil, Plus, RefreshCw, Trash2, UserCheck, UserX, Users } from "lucide-react";
import { mensagemDeErroRpc } from "@/lib/relatorioSdr";

/**
 * Equipe — gestão das SDRs do rodízio pelo gestor do cliente.
 *
 * Quem entra: só quem `is_gestor_equipe()` devolve true (superadmin ou o gestor
 * NOMEADO em crm_rodizio_config.gestor_user_id). Papel nenhum abre esta tela
 * sozinho — nem crc (o usuário do Meta App Review também é crc), nem gerente
 * (a mesma função é a porta de criar conta e redefinir senha em
 * admin-manage-user). O guard de verdade está no servidor: toda RPC abaixo
 * repete a checagem e responde "sem permissão"; aqui só evitamos mostrar uma
 * tela que não funcionaria.
 *
 * Contrato (Fase 1 do rodízio) — RPCs SECURITY DEFINER, só usuários do tenant
 * atual com papel sdr:
 *   equipe_listar()                        → linhas da tabela
 *   equipe_bloquear(p_user_id, p_bloquear)
 *   equipe_rodizio(p_user_id, p_ativo)
 *
 * Criar usuária e redefinir senha mexem em auth.users (Auth Admin API) e, por
 * decisão documentada no topo da migration da Fase 1, NÃO são RPCs: a tela
 * chama a edge function `admin-manage-user` (create / reset_password), que
 * aceita o gestor do tenant (is_gestor_equipe() no banco) criando SÓ papel
 * sdr no próprio tenant. Nada de "tentar RPC primeiro": a senha temporária só
 * sai daqui para essa função (antes ia parar num endpoint inexistente).
 *
 * Senha: digitada pelo gestor no formulário, vai direto para a função e é
 * apagada do estado no mesmo instante. Nunca aparece em toast, log ou lista.
 * A usuária troca a senha no primeiro login (must_change_password).
 *
 * Editar / excluir (decisão do dono, 09/09): "trocar de SDR é só trocar nome
 * e e-mail" — o diálogo Editar salva horário (RPC equipe_definir_horario),
 * nome (RPC equipe_editar_nome), e-mail (admin-manage-user set_email, que
 * derruba as sessões da conta) e, opcionalmente, uma senha temporária nova.
 * Essa ORDEM é regra: o horário é a única gravação que o banco recusa por
 * validação, e ela precisa acontecer antes de mexer no e-mail e na senha. A
 * validação do horário, por sua vez, só roda se o horário MUDOU — validar sempre
 * impedia corrigir o nome de uma SDR cujo horário antigo não passa nas regras
 * novas de front.
 * Excluir apaga a conta pela mesma
 * function (delete), que ANTES redistribui os leads dela pela RPC
 * equipe_redistribuir_leads (rodízio ligado → revezam entre as outras SDRs;
 * senão → administrador); a prévia vem de equipe_excluir_previa.
 *
 * Rodízio: a distribuição automática ainda está DESLIGADA (crm_rodizio_config
 * .modo = 'desligado'); o interruptor só define quem vai participar quando
 * ela for ligada (Fase 2). A página avisa isso.
 */

type Membro = {
  user_id: string;
  nome: string;
  email: string;
  bloqueado: boolean;
  no_rodizio: boolean;
  criado_em: string | null;
  ultimo_login: string | null;
  leads_hoje: number;
};

const MIN_SENHA = 8;

/** Site publicado antes de a migration ser aplicada (PGRST202): sem estes
 *  textos a tela mostrava o "Could not find the function ..." do PostgREST. */
const TEXTO_RPC_AUSENTE_EQUIPE =
  "Esta parte da gestão de equipe ainda não foi instalada no banco: publique as migrations e tente de novo.";
const TEXTO_RPC_AUSENTE_HORARIO =
  "O horário de trabalho da SDR ainda não foi instalado no banco (migration pendente). Até publicar, o expediente dela segue o horário comercial da clínica.";

/** Horário de trabalho da SDR (RPCs equipe_horarios / equipe_definir_horario). */
type Horario = {
  hora_entrada: string | null; hora_saida: string | null; almoco_inicio: string | null; almoco_fim: string | null;
  sabado_entrada: string | null; sabado_saida: string | null;
};
const hhmm = (t: string | null | undefined): string => (t ? String(t).slice(0, 5) : "");
/** Sem horário próprio o servidor NÃO deixa a SDR sem regra: usa o horário
 *  comercial da clínica (rodizio_horario_dia) e encerra o expediente nele. O
 *  "—" que ficava aqui lia-se como "não encerra sozinho", que é falso. */
const resumoHorario = (h: Horario | undefined): string => {
  if (!h || !h.hora_entrada) return "horário da clínica";
  let s = `${hhmm(h.hora_entrada)}–${hhmm(h.hora_saida)}`;
  if (h.almoco_inicio) s += ` · almoço ${hhmm(h.almoco_inicio)}–${hhmm(h.almoco_fim)}`;
  s += h.sabado_entrada ? ` · sáb ${hhmm(h.sabado_entrada)}–${hhmm(h.sabado_saida)}` : " · sem sábado";
  return s;
};
const EDICAO_VAZIA = { nome: "", email: "", senha: "", entrada: "", saida: "", almocoIni: "", almocoFim: "", sabEntrada: "", sabSaida: "" };
type Edicao = typeof EDICAO_VAZIA;

/**
 * Valida o horário no FRONT, antes de qualquer gravação. Repete as 6 regras da
 * RPC equipe_definir_horario (entrada/saída juntas, saída depois da entrada,
 * almoço com início e fim juntos e dentro da jornada, sábado com as duas pontas
 * e saída depois da entrada) porque, antes, a recusa do banco só chegava DEPOIS
 * de o e-mail e a senha já terem sido trocados.
 *
 * A última regra não é do banco e sim do motor: rodizio_horario_dia só usa o
 * horário próprio da SDR quando hora_entrada (seg–sex) está preenchida. Então
 * sábado sozinho é aceito pelo banco e depois IGNORADO — a auditoria mediu
 * isso. Aqui a tela recusa em vez de deixar o gestor achar que gravou.
 * Comparação de "HH:MM" como texto: nesse formato a ordem alfabética é a ordem
 * do relógio.
 */
const erroDoHorario = (e: Edicao): string | null => {
  const { entrada, saida, almocoIni, almocoFim, sabEntrada, sabSaida } = e;
  if (!!entrada !== !!saida) return "Informe a entrada e a saída de segunda a sexta (ou deixe as duas em branco).";
  if (entrada && saida <= entrada) return "A saída precisa ser depois da entrada.";
  if (!!almocoIni !== !!almocoFim) return "Informe o início e o fim do almoço (ou deixe os dois em branco).";
  if (almocoIni) {
    if (!entrada) return "Para definir o almoço, preencha primeiro a entrada e a saída de segunda a sexta.";
    if (almocoFim <= almocoIni) return "O fim do almoço precisa ser depois do início.";
    if (almocoIni < entrada || almocoFim > saida) return "O almoço precisa caber entre a entrada e a saída.";
  }
  if (!!sabEntrada !== !!sabSaida) return "Informe a entrada e a saída do sábado (ou deixe as duas em branco).";
  if (sabEntrada && sabSaida <= sabEntrada) return "No sábado, a saída precisa ser depois da entrada.";
  if (sabEntrada && !entrada)
    return "Defina também o horário de segunda a sexta para o sábado valer: sem a entrada de segunda a sexta, o sistema usa o horário comercial da clínica e ignora o sábado preenchido aqui.";
  return null;
};

type RespostaRpc = { data: unknown; error: unknown };
/** Resultado de equipe_redistribuir_leads (devolvido por admin-manage-user no delete). */
type Redistribuicao = { leads: number; para_rodizio: number; para_gestor: number; reservas_refeitas: number; destinos: Record<string, number> };
/**
 * Corpo devolvido por admin-manage-user (create/reset_password/set_email/delete).
 *
 * `aviso` é sucesso PARCIAL, não erro: a function passou a devolvê-lo quando a
 * gravação principal deu certo mas algo ficou pela metade — por exemplo o e-mail
 * trocado no login (auth.users) sem o cadastro (profiles) acompanhar. Sem este
 * campo aqui a tela descartava o recado e mostrava só "atualizado", deixando o
 * gestor achar que estava tudo certo.
 */
type RespostaFuncao = {
  error?: string; aviso?: string; user_id?: string; role?: string; sessoes_encerradas?: number | null;
  redistribuicao?: Redistribuicao | null;
} | null | undefined;
/** equipe_excluir_previa: o que acontece com os leads dela se for excluída. */
type Previa = {
  email: string; leads: number; leads_ciclo_fechado: number; reservas: number; agendamentos_credito: number;
  modo: string; elegiveis: string[]; n_elegiveis: number; destino_auto: "rodizio" | "gestor"; gestor_nome: string | null;
};
type Destino = "auto" | "rodizio" | "gestor";
type ErroLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  context?: { json?: unknown; clone?: () => { json: () => Promise<{ error?: unknown }> } };
};

// RPCs da Fase 1 ainda não estão em types.ts (arquivo gerado pelo Lovable);
// mesmo padrão do resto do projeto para RPC não tipada.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (nome: string, args?: Record<string, unknown>): Promise<RespostaRpc> => (supabase as any).rpc(nome, args);

const comoErro = (e: unknown): ErroLike => (e && typeof e === "object" ? (e as ErroLike) : {});

/** Mensagem legível de um erro do PostgREST/Supabase (RAISE EXCEPTION chega em
 *  `message`). Delegada a mensagemDeErroRpc (o mesmo caminho do SdrExpediente):
 *  a versão local daqui não conhecia PGRST202 e despejava o texto cru do
 *  PostgREST quando a RPC ainda não estava publicada. */
const mensagemDe = (e: unknown, fallback: string): string => mensagemDeErroRpc(e, fallback, TEXTO_RPC_AUSENTE_EQUIPE);

/** Idem para as RPCs de horário (equipe_horarios / equipe_definir_horario), que
 *  costumam ser as mais novas do banco. */
const mensagemDeHorario = (e: unknown, fallback: string): string => mensagemDeErroRpc(e, fallback, TEXTO_RPC_AUSENTE_HORARIO);

/** Extrai o erro de uma edge function (corpo JSON `{ error }` ou contexto da resposta). */
const erroDaFuncao = async (data: RespostaFuncao, error: unknown, fallback: string): Promise<string> => {
  if (data?.error) return String(data.error);
  const err = comoErro(error);
  const context = err.context;
  if (context?.json && typeof context.clone === "function") {
    try {
      const body = await context.clone().json();
      if (body?.error) return String(body.error);
    } catch { /* usa a mensagem abaixo */ }
  }
  return err.message || fallback;
};

const fmtData = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Nunca");

export default function CrmEquipe() {
  const { profile } = useAuth();
  const { isGestor, resolved, erro: erroGestor, tentarDeNovo } = useGestorEquipe();

  const [membros, setMembros] = useState<Membro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null); // user_id da linha em ação

  // Diálogos
  const [novaAberta, setNovaAberta] = useState(false);
  const [nova, setNova] = useState({ nome: "", email: "", senha: "" });
  const [criando, setCriando] = useState(false);
  const [senhaDe, setSenhaDe] = useState<Membro | null>(null);
  const [senhaNova, setSenhaNova] = useState("");
  const [redefinindo, setRedefinindo] = useState(false);
  const [bloqueioDe, setBloqueioDe] = useState<Membro | null>(null);
  const [edicaoDe, setEdicaoDe] = useState<Membro | null>(null);
  const [edicao, setEdicao] = useState(EDICAO_VAZIA);
  const [horarios, setHorarios] = useState<Record<string, Horario>>({});
  const [erroHorarios, setErroHorarios] = useState<string | null>(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [exclusaoDe, setExclusaoDe] = useState<Membro | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [previaErro, setPreviaErro] = useState<string | null>(null);
  const [destino, setDestino] = useState<Destino>("auto");
  const [excluindo, setExcluindo] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await rpc("equipe_listar");
    setCarregando(false);
    if (error) {
      setErroLista(mensagemDe(error, "Não foi possível carregar a equipe."));
      return;
    }
    setErroLista(null);
    setMembros(((data ?? []) as Membro[]).map((m) => ({ ...m, leads_hoje: Number(m.leads_hoje ?? 0) })));
    // Horários. Se a leitura falhar, a coluna NÃO pode continuar dizendo
    // "horário da clínica" para todo mundo: sem o dado, isso seria uma
    // afirmação falsa sobre quem tem horário próprio. Então a coluna volta a
    // "—" e a tela diz por quê.
    const { data: hs, error: hErr } = await rpc("equipe_horarios");
    if (hErr) {
      setHorarios({});
      setErroHorarios(mensagemDeHorario(hErr, "Não foi possível ler os horários da equipe."));
    } else if (Array.isArray(hs)) {
      const mapa: Record<string, Horario> = {};
      for (const h of hs as (Horario & { user_id: string })[]) mapa[h.user_id] = h;
      setHorarios(mapa);
      setErroHorarios(null);
    }
  }, []);

  useEffect(() => {
    if (resolved && isGestor) carregar();
  }, [resolved, isGestor, carregar]);

  // ---------------------------------------------------------------- criar
  const criarSdr = async () => {
    const nome = nova.nome.trim();
    const email = nova.email.trim().toLowerCase();
    const senha = nova.senha;
    if (!nome) return toast.error("Informe o nome da SDR.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error("Informe um e-mail válido.");
    if (senha.length < MIN_SENHA) return toast.error(`A senha temporária precisa ter ao menos ${MIN_SENHA} caracteres.`);

    setCriando(true);
    // A senha sai do estado ANTES da chamada: se a tela re-renderizar ou o
    // diálogo fechar por erro, não sobra senha em campo nenhum.
    setNova((n) => ({ ...n, senha: "" }));
    try {
      // admin-manage-user: para o gestor, a função ignora tenant_id (usa o do
      // gestor) e só aceita role 'sdr'; para o superadmin, tenant_id é o alvo.
      const tenantId = profile?.tenant_id ?? undefined;
      const { data, error: fnErr } = await supabase.functions.invoke<RespostaFuncao>("admin-manage-user", {
        body: { action: "create", tenant_id: tenantId, nome, email, password: senha, role: "sdr" },
      });
      if (fnErr || data?.error) {
        // O campo de senha já foi esvaziado acima. Sem dizer isso, o gestor
        // corrige o e-mail, clica de novo e leva "a senha precisa ter ao menos
        // N caracteres" — um erro que não tem nada a ver com o que aconteceu.
        const motivo = await erroDaFuncao(data, fnErr, "Não foi possível criar a SDR.");
        toast.error(`${motivo} Digite a senha temporária de novo.`);
        requestAnimationFrame(() => {
          document.getElementById("sdr-senha")?.focus();
        });
        return;
      }
      const papelEfetivo = data?.role;
      if (papelEfetivo && papelEfetivo !== "sdr") {
        // Nunca deixar passar calado: papel diferente do pedido = permissão diferente.
        toast.error(`Atenção: a conta foi criada com o papel "${papelEfetivo}", não como SDR. Avise o administrador.`);
      } else {
        toast.success(`SDR ${nome} criada. Ela troca a senha no primeiro acesso.`);
      }
      setNovaAberta(false);
      setNova({ nome: "", email: "", senha: "" });
      await carregar();
    } finally {
      setCriando(false);
    }
  };

  // ------------------------------------------------------- redefinir senha
  const redefinirSenha = async () => {
    if (!senhaDe) return;
    const senha = senhaNova;
    if (senha.length < MIN_SENHA) return toast.error(`A nova senha precisa ter ao menos ${MIN_SENHA} caracteres.`);
    setRedefinindo(true);
    setSenhaNova("");
    try {
      // admin-manage-user: para o gestor, o alvo precisa ser do tenant dele e
      // ter SÓ o papel sdr (a função confere).
      const { data, error: fnErr } = await supabase.functions.invoke<RespostaFuncao>("admin-manage-user", {
        body: { action: "reset_password", user_id: senhaDe.user_id, password: senha },
      });
      if (fnErr || data?.error) {
        // Mesmo cuidado do criarSdr: o campo já foi esvaziado antes da chamada.
        const motivo = await erroDaFuncao(data, fnErr, "Não foi possível redefinir a senha.");
        toast.error(`${motivo} Digite a nova senha de novo.`);
        requestAnimationFrame(() => {
          document.getElementById("sdr-senha-nova")?.focus();
        });
        return;
      }
      toast.success(`Senha de ${senhaDe.nome} redefinida. Ela troca no próximo acesso.`);
      setSenhaDe(null);
    } finally {
      setRedefinindo(false);
    }
  };

  // ------------------------------------------------------------ bloquear
  const alternarBloqueio = async (m: Membro) => {
    const bloquear = !m.bloqueado;
    setOcupado(m.user_id);
    const { error } = await rpc("equipe_bloquear", { p_user_id: m.user_id, p_bloquear: bloquear });
    setOcupado(null);
    if (error) {
      toast.error(mensagemDe(error, bloquear ? "Não foi possível bloquear." : "Não foi possível desbloquear."));
      return;
    }
    toast.success(bloquear ? `${m.nome} bloqueada. Ela não entra mais no sistema.` : `${m.nome} desbloqueada.`);
    setMembros((prev) => prev.map((x) => (x.user_id === m.user_id ? { ...x, bloqueado: bloquear, no_rodizio: bloquear ? false : x.no_rodizio } : x)));
    carregar(); // o banco decide se bloquear também tira do rodízio
  };

  // ------------------------------------------------------------- rodízio
  const alternarRodizio = async (m: Membro, ativo: boolean) => {
    if (ativo && m.bloqueado) {
      toast.error("Desbloqueie a SDR antes de colocá-la no rodízio.");
      return;
    }
    setOcupado(m.user_id);
    // Otimista: o interruptor responde na hora; se o banco recusar, volta.
    setMembros((prev) => prev.map((x) => (x.user_id === m.user_id ? { ...x, no_rodizio: ativo } : x)));
    const { error } = await rpc("equipe_rodizio", { p_user_id: m.user_id, p_ativo: ativo });
    setOcupado(null);
    if (error) {
      setMembros((prev) => prev.map((x) => (x.user_id === m.user_id ? { ...x, no_rodizio: !ativo } : x)));
      toast.error(mensagemDe(error, "Não foi possível alterar o rodízio."));
      return;
    }
    toast.success(
      ativo
        ? `${m.nome} vai participar do rodízio quando a distribuição automática for ligada.`
        : `${m.nome} não vai participar do rodízio.`,
    );
  };

  // -------------------------------------------------------------- editar
  const abrirEdicao = (m: Membro) => {
    const h = horarios[m.user_id];
    setEdicao({
      nome: m.nome ?? "", email: m.email ?? "", senha: "",
      entrada: hhmm(h?.hora_entrada), saida: hhmm(h?.hora_saida),
      almocoIni: hhmm(h?.almoco_inicio), almocoFim: hhmm(h?.almoco_fim),
      sabEntrada: hhmm(h?.sabado_entrada), sabSaida: hhmm(h?.sabado_saida),
    });
    setEdicaoDe(m);
  };

  const salvarEdicao = async () => {
    if (!edicaoDe) return;
    const nome = edicao.nome.trim();
    const email = edicao.email.trim().toLowerCase();
    const senha = edicao.senha;
    // Toda validação de front acontece ANTES de qualquer chamada: nada de
    // recusar o 4º campo quando o 2º já mudou o e-mail (o que desconecta a SDR).
    if (!nome) return toast.error("Informe o nome.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error("Informe um e-mail válido.");
    if (senha && senha.length < MIN_SENHA) return toast.error(`A nova senha precisa ter ao menos ${MIN_SENHA} caracteres.`);
    // O que mudou é calculado ANTES da validação do horário, de propósito.
    // Defeito: a validação rodava primeiro e valia para todo mundo. Uma das
    // regras ("sábado só vale com segunda a sexta preenchida") é nova e só
    // existe no front — então uma SDR cadastrada antes dela, com sábado sozinho
    // no banco, travava a tela: o gestor não conseguia nem corrigir o NOME dela,
    // porque o horário que ele não tocou reprovava. Agora o horário só é
    // validado quando o gestor realmente mexeu nele.
    const mudouNome = nome !== (edicaoDe.nome ?? "").trim();
    const mudouEmail = email !== (edicaoDe.email ?? "").trim().toLowerCase();
    const hAtual = horarios[edicaoDe.user_id];
    const mudouHorario =
      edicao.entrada !== hhmm(hAtual?.hora_entrada) || edicao.saida !== hhmm(hAtual?.hora_saida) ||
      edicao.almocoIni !== hhmm(hAtual?.almoco_inicio) || edicao.almocoFim !== hhmm(hAtual?.almoco_fim) ||
      edicao.sabEntrada !== hhmm(hAtual?.sabado_entrada) || edicao.sabSaida !== hhmm(hAtual?.sabado_saida);
    if (!mudouNome && !mudouEmail && !senha && !mudouHorario) { setEdicaoDe(null); return; }
    if (mudouHorario) {
      const erroHorario = erroDoHorario(edicao);
      if (erroHorario) return toast.error(erroHorario);
    }

    setSalvandoEdicao(true);
    // Mesmo cuidado do criarSdr: a senha sai do estado antes da chamada.
    setEdicao((e) => ({ ...e, senha: "" }));
    const feitos: string[] = [];
    /** "Horário salvo, mas o nome não: " — o gestor precisa saber o que já ficou gravado. */
    const prefixo = (oQue: string) =>
      feitos.length ? `${feitos.join(" e ")} ${feitos.length > 1 ? "salvos" : "salvo"}, mas ${oQue} não: ` : "";
    // A senha é a ÚLTIMA gravação; qualquer falha antes dela significa que a
    // senha nova não foi aplicada, e o campo já foi esvaziado acima.
    const avisoSenha = senha ? " A senha nova não foi aplicada; digite de novo." : "";
    /** Quantas sessões a troca de e-mail derrubou, quando a function informa. */
    let sessoesEncerradas: number | null = null;
    try {
      // Ordem deliberada: HORÁRIO primeiro. É a única gravação que o banco pode
      // recusar por regra de negócio (equipe_definir_horario tem 6 validações);
      // quando ela era a última, a recusa chegava com o e-mail já trocado (o
      // que derruba a sessão da SDR) e a senha já redefinida.
      if (mudouHorario) {
        const { error } = await rpc("equipe_definir_horario", {
          p_user_id: edicaoDe.user_id,
          p_entrada: edicao.entrada || null, p_saida: edicao.saida || null,
          p_almoco_inicio: edicao.almocoIni || null, p_almoco_fim: edicao.almocoFim || null,
          p_sabado_entrada: edicao.sabEntrada || null, p_sabado_saida: edicao.sabSaida || null,
        });
        if (error) {
          toast.error(`${mensagemDeHorario(error, "Não foi possível salvar o horário.")}${avisoSenha}${mudouNome || mudouEmail ? " Nome e e-mail continuam como estavam." : ""}`);
          return;
        }
        feitos.push("horário");
      }
      if (mudouNome) {
        const { error } = await rpc("equipe_editar_nome", { p_user_id: edicaoDe.user_id, p_nome: nome });
        if (error) {
          toast.error(`${prefixo("o nome")}${mensagemDe(error, "Não foi possível mudar o nome.")}${avisoSenha}`);
          await carregar();
          return;
        }
        feitos.push("nome");
      }
      if (mudouEmail) {
        const { data, error: fnErr } = await supabase.functions.invoke<RespostaFuncao>("admin-manage-user", {
          body: { action: "set_email", user_id: edicaoDe.user_id, email },
        });
        if (fnErr || data?.error) {
          const motivo = await erroDaFuncao(data, fnErr, "Não foi possível mudar o e-mail.");
          toast.error(`${prefixo("o e-mail")}${motivo}${avisoSenha}`);
          await carregar();
          return;
        }
        // Sucesso parcial: a function trocou o e-mail do login mas avisou que
        // algo ficou pela metade (o cadastro em profiles, por exemplo). Toast de
        // aviso, com duração longa — é recado que o gestor precisa LER e
        // provavelmente agir, não uma confirmação de passagem.
        if (data?.aviso) toast.warning(data.aviso, { duration: 15_000 });
        // Guardado para o toast final: só afirmamos que a sessão dela caiu se a
        // function informou quantas sessões encerrou.
        if (typeof data?.sessoes_encerradas === "number") sessoesEncerradas = data.sessoes_encerradas;
        feitos.push("e-mail");
      }
      if (senha) {
        const { data, error: fnErr } = await supabase.functions.invoke<RespostaFuncao>("admin-manage-user", {
          body: { action: "reset_password", user_id: edicaoDe.user_id, password: senha },
        });
        if (fnErr || data?.error) {
          const motivo = await erroDaFuncao(data, fnErr, "Não foi possível redefinir a senha.");
          toast.error(`${prefixo("a senha")}${motivo} Digite a senha de novo.`);
          await carregar();
          return;
        }
        feitos.push("senha");
      }
      // "Foi desconectada" só quando a function CONFIRMA quantas sessões
      // encerrou. Antes a frase era incondicional: bastava o e-mail ter mudado
      // para a tela afirmar a desconexão, mesmo em um banco cuja function não
      // encerra sessão nenhuma — o gestor ficava esperando a SDR cair e ela
      // seguia logada com o e-mail antigo.
      toast.success(
        `${nome}: ${feitos.join(", ")} ${feitos.length > 1 ? "atualizados" : "atualizado"}.` +
        (typeof sessoesEncerradas === "number" ? " Quem estava logada nessa conta foi desconectada." : "") +
        (senha ? " Ela troca a senha no próximo acesso." : ""),
      );
      setEdicaoDe(null);
      await carregar();
    } finally {
      setSalvandoEdicao(false);
    }
  };

  // ------------------------------------------------------------- excluir
  const abrirExclusao = async (m: Membro) => {
    setPrevia(null);
    setPreviaErro(null);
    setDestino("auto");
    setExclusaoDe(m);
    const { data, error } = await rpc("equipe_excluir_previa", { p_user_id: m.user_id });
    if (error) {
      setPreviaErro(mensagemDe(error, "Não foi possível calcular o que acontece com os leads dela."));
      return;
    }
    setPrevia(data as Previa);
  };

  const excluir = async () => {
    if (!exclusaoDe) return;
    setExcluindo(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke<RespostaFuncao>("admin-manage-user", {
        body: { action: "delete", user_id: exclusaoDe.user_id, destino },
      });
      if (fnErr || data?.error) {
        toast.error(await erroDaFuncao(data, fnErr, "Não foi possível excluir a SDR."));
        return;
      }
      const r = data?.redistribuicao;
      const partes: string[] = [];
      if (r) {
        if (r.para_rodizio > 0) partes.push(`${r.para_rodizio} para outras SDRs`);
        if (r.para_gestor > 0) partes.push(`${r.para_gestor} para o administrador`);
      }
      toast.success(`${exclusaoDe.nome} excluída.${partes.length ? ` Leads: ${partes.join(" e ")}.` : " Ela não tinha leads."}`);
      setExclusaoDe(null);
      await carregar();
    } finally {
      setExcluindo(false);
    }
  };

  // --------------------------------------------------------------- gate
  // Só `false` vindo do banco fecha a rota. Erro de rede/5xx na RPC NÃO é
  // "não é gestor": fica em carregando com "Tentar de novo" (nunca expulsar
  // por uma decisão tomada por negação sobre um estado de erro).
  if (!resolved) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        {erroGestor ? (
          <>
            <p className="text-sm">Não foi possível confirmar sua permissão para gerir a equipe.</p>
            <Button variant="outline" size="sm" onClick={tentarDeNovo}>
              <RefreshCw size={14} className="mr-1" /> Tentar de novo
            </Button>
          </>
        ) : (
          <span className="flex items-center"><Loader2 className="mr-2 animate-spin" size={16} /> Carregando...</span>
        )}
      </div>
    );
  }
  if (!isGestor) return <Navigate to="/crm" replace />;

  const ativasNoRodizio = membros.filter((m) => m.no_rodizio && !m.bloqueado).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-5 pb-10">
        <header className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
              <Users size={22} className="text-primary" /> Equipe
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              SDRs do rodízio de leads. {membros.length > 0 && `${ativasNoRodizio} de ${membros.length} no rodízio.`}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={carregar} disabled={carregando} title="Atualizar">
              <RefreshCw size={14} className={carregando ? "animate-spin" : ""} />
            </Button>
            <Button size="sm" onClick={() => setNovaAberta(true)}>
              <Plus size={14} className="mr-1" /> Nova SDR
            </Button>
          </div>
        </header>

        <RodizioPainel aoMudar={carregar} />

        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          {erroLista ? (
            <div className="px-6 py-14 text-center">
              <p className="font-semibold text-foreground">Não foi possível carregar a equipe</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{erroLista}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={carregar}>Tentar de novo</Button>
            </div>
          ) : carregando && membros.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="animate-spin" size={16} /> Carregando a equipe...
            </div>
          ) : membros.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10">
                <Users className="text-primary" size={22} />
              </div>
              <p className="mt-3 font-semibold text-foreground">Nenhuma SDR cadastrada</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Crie a primeira SDR. Ela entra fora do rodízio e você liga o interruptor quando quiser.
              </p>
              <Button size="sm" className="mt-4" onClick={() => setNovaAberta(true)}>
                <Plus size={14} className="mr-1" /> Nova SDR
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Rodízio</TableHead>
                    <TableHead>Horário</TableHead>
                    <TableHead className="text-right" title="Leads atribuídos a ela hoje">Leads hoje</TableHead>
                    <TableHead>Último login</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {membros.map((m) => {
                    const emAcao = ocupado === m.user_id;
                    return (
                      <TableRow key={m.user_id} className={m.bloqueado ? "opacity-70" : ""}>
                        <TableCell className="font-medium text-foreground">{m.nome}</TableCell>
                        <TableCell className="text-muted-foreground">{m.email}</TableCell>
                        <TableCell>
                          {m.bloqueado
                            ? <Badge variant="destructive">Bloqueada</Badge>
                            : <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400">Ativa</Badge>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={m.no_rodizio && !m.bloqueado}
                              disabled={emAcao || m.bloqueado}
                              onCheckedChange={(v) => alternarRodizio(m, v)}
                              aria-label={m.no_rodizio ? "Tirar do rodízio" : "Pôr no rodízio"}
                            />
                            <span className="text-xs text-muted-foreground">{m.no_rodizio && !m.bloqueado ? "Sim" : "Não"}</span>
                          </div>
                        </TableCell>
                        <TableCell
                          className="whitespace-nowrap text-xs text-muted-foreground"
                          title={erroHorarios
                            ? erroHorarios
                            : horarios[m.user_id]?.hora_entrada
                              ? "Horário próprio dela. Para mudar, use Editar."
                              : "Sem horário próprio: vale o horário comercial da clínica e o expediente dela encerra nele. Para dar um horário próprio, use Editar."}
                        >
                          {erroHorarios ? "—" : resumoHorario(horarios[m.user_id])}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{m.leads_hoje}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtData(m.ultimo_login)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="ghost" title="Editar nome, e-mail ou senha" disabled={emAcao} onClick={() => abrirEdicao(m)}>
                              <Pencil size={14} />
                            </Button>
                            <Button
                              size="sm" variant="ghost" title="Redefinir senha" disabled={emAcao}
                              onClick={() => { setSenhaNova(""); setSenhaDe(m); }}
                            >
                              <KeyRound size={14} />
                            </Button>
                            {m.bloqueado ? (
                              <Button size="sm" variant="ghost" title="Desbloquear" disabled={emAcao} onClick={() => alternarBloqueio(m)}>
                                {emAcao ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" title="Bloquear" disabled={emAcao} onClick={() => setBloqueioDe(m)}>
                                {emAcao ? <Loader2 size={14} className="animate-spin" /> : <UserX size={14} />}
                              </Button>
                            )}
                            <Button
                              size="sm" variant="ghost" title="Excluir a conta" disabled={emAcao}
                              className="text-destructive hover:text-destructive" onClick={() => abrirExclusao(m)}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        {erroHorarios && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Coluna Horário indisponível: {erroHorarios}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Bloquear tira a SDR do sistema na hora (e do rodízio). Tirar do rodízio só interrompe a
          entrega de leads novos quando a distribuição automática estiver ligada — os que já são
          dela continuam com ela. Para colocar outra pessoa no lugar de uma SDR, use Editar e troque
          nome, e-mail e senha: os leads e o histórico continuam na mesma conta. Excluir apaga a
          conta e redistribui os leads dela. Quem aparece como "horário da clínica" não está sem
          regra: sem horário próprio vale o horário comercial da clínica, e o expediente dela
          encerra nele.
        </p>
      </div>

      {/* ---------------------------------------------------------- Nova SDR */}
      <Dialog open={novaAberta} onOpenChange={(v) => { if (!criando) { setNovaAberta(v); if (!v) setNova({ nome: "", email: "", senha: "" }); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova SDR</DialogTitle>
            <DialogDescription>
              A conta nasce fora do rodízio e com acesso só ao número principal. A SDR vai ser
              obrigada a trocar a senha no primeiro acesso.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            autoComplete="off"
            onSubmit={(e) => { e.preventDefault(); criarSdr(); }}
          >
            <div className="space-y-1">
              <Label htmlFor="sdr-nome">Nome</Label>
              <Input id="sdr-nome" value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} placeholder="Nome completo" autoFocus />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sdr-email">E-mail</Label>
              <Input id="sdr-email" type="email" value={nova.email} onChange={(e) => setNova({ ...nova, email: e.target.value })} placeholder="nome@clinica.com.br" autoComplete="off" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sdr-senha">Senha temporária</Label>
              <Input
                id="sdr-senha" type="password" value={nova.senha}
                onChange={(e) => setNova({ ...nova, senha: e.target.value })}
                placeholder={`Mínimo ${MIN_SENHA} caracteres`} minLength={MIN_SENHA} autoComplete="new-password"
              />
              <p className="text-[11px] text-muted-foreground">
                Passe esta senha para a SDR por um canal seguro. Ela não fica salva aqui e não aparece de novo.
              </p>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setNovaAberta(false)} disabled={criando}>Cancelar</Button>
              <Button type="submit" disabled={criando}>
                {criando ? <><Loader2 size={14} className="mr-1 animate-spin" /> Criando...</> : "Criar SDR"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- Redefinir senha */}
      <Dialog open={!!senhaDe} onOpenChange={(v) => { if (!redefinindo && !v) { setSenhaDe(null); setSenhaNova(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
            <DialogDescription>
              {senhaDe ? `${senhaDe.nome} (${senhaDe.email})` : ""}. Ela vai precisar trocar esta senha no próximo acesso.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" autoComplete="off" onSubmit={(e) => { e.preventDefault(); redefinirSenha(); }}>
            <div className="space-y-1">
              <Label htmlFor="sdr-senha-nova">Nova senha temporária</Label>
              <Input
                id="sdr-senha-nova" type="password" value={senhaNova}
                onChange={(e) => setSenhaNova(e.target.value)}
                placeholder={`Mínimo ${MIN_SENHA} caracteres`} minLength={MIN_SENHA} autoComplete="new-password" autoFocus
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => { setSenhaDe(null); setSenhaNova(""); }} disabled={redefinindo}>Cancelar</Button>
              <Button type="submit" disabled={redefinindo}>
                {redefinindo ? <><Loader2 size={14} className="mr-1 animate-spin" /> Redefinindo...</> : "Redefinir"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------- Editar */}
      <Dialog open={!!edicaoDe} onOpenChange={(v) => { if (!salvandoEdicao && !v) { setEdicaoDe(null); setEdicao(EDICAO_VAZIA); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar SDR</DialogTitle>
            <DialogDescription>
              Para colocar outra pessoa no lugar, troque o nome e o e-mail (e dê uma senha nova):
              os leads e o histórico continuam nesta conta. Ao trocar o e-mail, quem estiver logada
              nessa conta é desconectada.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" autoComplete="off" onSubmit={(e) => { e.preventDefault(); salvarEdicao(); }}>
            <div className="space-y-1">
              <Label htmlFor="sdr-edit-nome">Nome</Label>
              <Input id="sdr-edit-nome" value={edicao.nome} onChange={(e) => setEdicao({ ...edicao, nome: e.target.value })} autoComplete="off" autoFocus />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sdr-edit-email">E-mail</Label>
              <Input id="sdr-edit-email" type="email" value={edicao.email} onChange={(e) => setEdicao({ ...edicao, email: e.target.value })} autoComplete="off" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sdr-edit-senha">Nova senha temporária (opcional)</Label>
              <Input
                id="sdr-edit-senha" type="password" value={edicao.senha}
                onChange={(e) => setEdicao({ ...edicao, senha: e.target.value })}
                placeholder={`Deixe em branco para manter · mínimo ${MIN_SENHA} caracteres`} autoComplete="new-password"
              />
              <p className="text-[11px] text-muted-foreground">
                Passe a senha por um canal seguro. Ela não fica salva aqui e a pessoa troca no próximo acesso.
              </p>
            </div>
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Horário de trabalho</p>
              <p className="text-[11px] text-muted-foreground">
                Segunda a sexta. As reservas dela passam para quem abriu o expediente se ela não abrir até a
                entrada + tolerância do painel do rodízio. Sábado em branco = não trabalha no sábado — e o
                sábado só vale se a entrada e a saída de segunda a sexta estiverem preenchidas. Tudo em
                branco = vale o horário comercial da clínica.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="sdr-h-entrada" className="text-xs">Entrada</Label>
                  <Input id="sdr-h-entrada" type="time" value={edicao.entrada} onChange={(e) => setEdicao({ ...edicao, entrada: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sdr-h-saida" className="text-xs">Saída</Label>
                  <Input id="sdr-h-saida" type="time" value={edicao.saida} onChange={(e) => setEdicao({ ...edicao, saida: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sdr-h-alm1" className="text-xs">Almoço (início)</Label>
                  <Input id="sdr-h-alm1" type="time" value={edicao.almocoIni} onChange={(e) => setEdicao({ ...edicao, almocoIni: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sdr-h-alm2" className="text-xs">Almoço (fim)</Label>
                  <Input id="sdr-h-alm2" type="time" value={edicao.almocoFim} onChange={(e) => setEdicao({ ...edicao, almocoFim: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sdr-h-sab1" className="text-xs">Sábado (entrada)</Label>
                  <Input id="sdr-h-sab1" type="time" value={edicao.sabEntrada} onChange={(e) => setEdicao({ ...edicao, sabEntrada: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sdr-h-sab2" className="text-xs">Sábado (saída)</Label>
                  <Input id="sdr-h-sab2" type="time" value={edicao.sabSaida} onChange={(e) => setEdicao({ ...edicao, sabSaida: e.target.value })} />
                </div>
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setEdicaoDe(null)} disabled={salvandoEdicao}>Cancelar</Button>
              <Button type="submit" disabled={salvandoEdicao}>
                {salvandoEdicao ? <><Loader2 size={14} className="mr-1 animate-spin" /> Salvando...</> : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------ Excluir */}
      <AlertDialog open={!!exclusaoDe} onOpenChange={(v) => { if (!excluindo && !v) setExclusaoDe(null); }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {exclusaoDe?.nome}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Isso apaga a conta {exclusaoDe?.email ? `(${exclusaoDe.email}) ` : ""}de vez. O histórico dela
                  (relatórios, crédito de {previa ? previa.agendamentos_credito : "…"} consulta{previa?.agendamentos_credito === 1 ? "" : "s"},
                  livro de atribuições) fica, mas sem o nome. <strong>Para trocar de pessoa, prefira Editar</strong> (nome,
                  e-mail e senha).
                </p>
                {previaErro ? (
                  <p className="text-destructive">{previaErro}</p>
                ) : !previa ? (
                  <p className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Conferindo os leads dela...</p>
                ) : previa.leads === 0 && previa.reservas === 0 ? (
                  <p>Ela não tem leads nem reservas: nada precisa ser redistribuído.</p>
                ) : (
                  <>
                    <p>
                      Ela tem <strong>{previa.leads}</strong> lead{previa.leads === 1 ? "" : "s"}
                      {previa.leads_ciclo_fechado > 0 && ` (${previa.leads_ciclo_fechado} com o ciclo já encerrado, que vão direto para o administrador)`}
                      {previa.reservas > 0 && ` e ${previa.reservas} reserva${previa.reservas === 1 ? "" : "s"} pendente${previa.reservas === 1 ? "" : "s"}`}.
                      Para onde vão os demais?
                    </p>
                    <RadioGroup value={destino} onValueChange={(v) => setDestino(v as Destino)} className="gap-2">
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2">
                        <RadioGroupItem value="auto" className="mt-0.5" />
                        <span>
                          <span className="font-medium text-foreground">Automático</span>{" "}
                          <span className="text-xs">
                            {previa.destino_auto === "rodizio"
                              ? `— rodízio ligado: revezam entre ${previa.elegiveis.join(", ")}.`
                              : `— rodízio ${previa.modo === "ligado" ? "sem outra SDR elegível" : previa.modo}: voltam para o administrador${previa.gestor_nome ? ` (${previa.gestor_nome})` : ""} e entram no rodízio quando escreverem.`}
                          </span>
                        </span>
                      </label>
                      <label className={`flex items-start gap-2 rounded-lg border border-border p-2 ${previa.n_elegiveis === 0 ? "opacity-50" : "cursor-pointer"}`}>
                        <RadioGroupItem value="rodizio" className="mt-0.5" disabled={previa.n_elegiveis === 0} />
                        <span>
                          <span className="font-medium text-foreground">Entre as outras SDRs do rodízio</span>{" "}
                          <span className="text-xs">
                            {previa.n_elegiveis === 0 ? "— nenhuma SDR ativa no rodízio agora." : `— ${previa.elegiveis.join(", ")}, revezando, mesmo com o motor ${previa.modo}.`}
                          </span>
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2">
                        <RadioGroupItem value="gestor" className="mt-0.5" />
                        <span>
                          <span className="font-medium text-foreground">Para o administrador</span>{" "}
                          <span className="text-xs">— todos voltam para {previa.gestor_nome ?? "o administrador"} e entram no rodízio quando escreverem.</span>
                        </span>
                      </label>
                    </RadioGroup>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={excluindo || (!previa && !previaErro)}
              onClick={(e) => { e.preventDefault(); excluir(); }}
            >
              {excluindo ? <><Loader2 size={14} className="mr-1 animate-spin" /> Excluindo...</> : "Excluir e redistribuir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ----------------------------------------------------------- Bloquear */}
      <AlertDialog open={!!bloqueioDe} onOpenChange={(v) => !v && setBloqueioDe(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bloquear {bloqueioDe?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              Ela perde o acesso ao sistema imediatamente e sai do rodízio. Os leads que já são dela
              continuam atribuídos a ela até alguém transferir. Dá para desbloquear depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { const m = bloqueioDe; setBloqueioDe(null); if (m) alternarBloqueio(m); }}
            >
              Bloquear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
