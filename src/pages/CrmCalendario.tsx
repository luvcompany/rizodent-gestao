import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { anotarNoHistorico } from "@/lib/notaDeSistema";
import { Button } from "@/components/ui/button";
import { HIDDEN_USER_IDS_PG } from "@/lib/hiddenUsers";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  ChevronLeft, ChevronRight, CalendarDays, Phone, MessageSquare, Clock,
  CheckCircle2, AlertTriangle, Circle, List, LayoutGrid, Trash2
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek,
  isSameMonth, isToday, isSameDay, isPast, addMonths, subMonths, addWeeks, subWeeks,
  isAfter, isBefore, addDays, startOfDay
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { registrarDesfechoDaConsulta } from "@/lib/appointmentOutcome";
import {
  cancelAppointment, rescheduleAppointment, marcarComparecimentoSdr, compareceuEAgendou,
  excluirAgendamento, formatBahiaLabel, isBeforeScheduled,
} from "@/lib/appointmentActions";
import { corDesfecho, desfechoEhComparecimento, escondeDesfechoDeVenda, rotuloDesfecho } from "@/lib/desfechoLabel";
import { mensagemDeErro } from "@/lib/mensagemDeErro";
import { contagem, plural } from "@/lib/plural";
import { TIPOS_DE_TAREFA, ROTULO_TIPO_DE_TAREFA, iconeTipoDeTarefa, rotuloTipoDeTarefa, tarefaDoTipo } from "@/lib/tarefaTipo";
import {
  agendaSeparaPorCidade, colunaDePresencaAusente, consultaAberta, diaDaSemanaAberto, diasDaGradeDaSemana, horasDaGradeSemanal,
  consultaEmDiaFuturo, podeAnteciparDesfecho, podeExcluirAgendamento, podeReabrirAgendamento,
} from "@/lib/regrasDaAgenda";
import { fusoDoTenant } from "@/lib/fuso";
import { useTenantConfig } from "@/hooks/useTenantConfig";
import { useNumerosLiberados } from "@/hooks/useNumerosLiberados";

// Busca todas as tarefas pendentes (paginando) + as concluídas mais recentes.
// Antes vinham só as 1000 mais antigas (limite do banco), todas concluídas,
// e as atrasadas sumiam da tela.
async function buscarTarefasCalendario(): Promise<{ data: any[]; error: any }> {
  const cols = "id, lead_id, title, type, due_date, notes, assigned_to, status, owner_role";
  const pend: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("crm_tasks").select(cols).neq("status", "done").order("due_date").range(from, from + 999);
    if (error) return { data: pend, error };
    pend.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const { data: done, error } = await supabase.from("crm_tasks").select(cols).eq("status", "done").order("due_date", { ascending: false }).limit(1000);
  const all = [...pend, ...(done || [])].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  return { data: all, error };
}


type Task = {
  id: string;
  lead_id: string;
  title: string;
  type: string;
  due_date: string;
  notes: string | null;
  assigned_to: string | null;
  status: string;
  owner_role?: string | null;
  lead_name?: string;
};

type Profile = { id: string; nome: string };

type MainView = "tarefas" | "agendamentos";
type TaskViewMode = "events" | "list" | "month" | "week";

type Appointment = {
  id: string;
  lead_id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  notes: string | null;
  lead_name?: string;
  lead_cidade?: string | null;
  is_rescheduled?: boolean;
  /** Origem do desfecho (automático x manual): decide Reabrir/Excluir. */
  outcome_source?: string | null;
  /** AGENDA-11 (migration 20260929002100): presença separada do status. */
  presenca_confirmada_em?: string | null;
  presenca_confirmada_por?: string | null;
};

type Stage = { id: string; name: string; color: string; pipeline_id: string };
type Pipeline = { id: string; name: string };
type Unidade = { nome: string | null; cidade: string | null };
/** Unidades ativas: a lista que a pessoa consegue ler + a contagem do servidor (AGENDA-8). */
type UnidadesDaAgenda = { lista: Unidade[]; quantas: number | null };

/**
 * AGENDA-8. A lista (nome/cidade) vem de `clinicas` ou, para closer/recepção
 * (policies *_sem_acesso_clinicas), da RPC closer_clinicas_do_tenant. A SDR não
 * lê nenhuma das duas; a contagem (agenda_quantas_unidades, migration
 * 20260929002320) diz a ela — e a todos — se a agenda separa por cidade.
 * `quantas` = null quando a RPC ainda não existe no banco.
 */
async function buscarUnidadesDaAgenda(): Promise<UnidadesDaAgenda> {
  const [direto, viaCloser, contagemDoServidor] = await Promise.all([
    supabase.from("clinicas").select("nome, cidade").eq("ativa", true),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("closer_clinicas_do_tenant"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("agenda_quantas_unidades"),
  ]);
  let lista = (direto.data || []) as Unidade[];
  if (lista.length === 0) lista = (viaCloser.data || []) as Unidade[];
  const quantas = !contagemDoServidor.error && typeof contagemDoServidor.data === "number"
    ? contagemDoServidor.data
    : null;
  return { lista, quantas };
}

// Rótulo e ícone do tipo de tarefa: src/lib/tarefaTipo.ts (fonte única; traduz
// também 'call' e 'follow_up', que as automações gravam).

// Consultas da semana. A presença (presenca_confirmada_*) ainda não está nos
// tipos gerados (G2) e só existe depois da migration 20260929002100: se o banco
// ainda não a tem, a agenda continua, só sem o selo de presença.
const COLUNAS_DA_CONSULTA =
  "id, lead_id, scheduled_date, scheduled_time, status, notes, is_rescheduled, lead_name, lead_cidade, outcome_source";
const COLUNAS_DE_PRESENCA = "presenca_confirmada_em, presenca_confirmada_por";

type LinhaDaConsulta = Record<string, unknown>;
type ErroDaLeitura = { code?: string; message?: string } | null;

async function buscarConsultasDaSemana(
  inicio: string,
  fim: string,
): Promise<{ data: LinhaDaConsulta[] | null; error: ErroDaLeitura; presenca: boolean }> {
  const buscar = (colunas: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("crm_appointments")
      .select(colunas)
      .gte("scheduled_date", inicio)
      .lte("scheduled_date", fim)
      .order("scheduled_date")
      .order("scheduled_time");
  const comPresenca = await buscar(`${COLUNAS_DA_CONSULTA}, ${COLUNAS_DE_PRESENCA}`);
  if (comPresenca.error && colunaDePresencaAusente(comPresenca.error)) {
    const semPresenca = await buscar(COLUNAS_DA_CONSULTA);
    return { data: semPresenca.data, error: semPresenca.error, presenca: false };
  }
  return { data: comPresenca.data, error: comPresenca.error, presenca: true };
}

/** "pelo paciente em 29/09 às 14:02" / "pela equipe …" (fuso da clínica). */
function presencaTexto(a: Appointment): string {
  if (!a.presenca_confirmada_em) return "";
  const d = new Date(a.presenca_confirmada_em);
  if (Number.isNaN(d.getTime())) return "";
  const timeZone = fusoDoTenant();
  const dia = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone });
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone });
  return `${a.presenca_confirmada_por ? "pela equipe" : "pelo paciente"} em ${dia} às ${hora}`;
}

const normStatus = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
/** Fora do número principal do "Total / dia" (AGENDA-16): o horário antigo da remarcação e a cancelada. */
const foraDoTotal = (s: string | null | undefined) => ["cancelled", "rescheduled"].includes(normStatus(s));

function getTaskStatus(task: Task) {
  if (task.status === "done") return "done";
  if (isPast(new Date(task.due_date))) return "late";
  return "pending";
}

function statusColor(st: string) {
  if (st === "done") return "bg-card text-foreground border-border/60 border-l-[3px] border-l-success";
  if (st === "late") return "bg-destructive-soft/50 text-foreground border-destructive/30 border-l-[3px] border-l-destructive";
  return "bg-card text-foreground border-border/60 border-l-[3px] border-l-info";
}

function statusBg(st: string) {
  if (st === "done") return "border-transparent bg-success-soft text-success-soft-foreground hover:bg-success-soft";
  if (st === "late") return "border-transparent bg-destructive-soft text-destructive-soft-foreground hover:bg-destructive-soft";
  return "border-transparent bg-info-soft text-info-soft-foreground hover:bg-info-soft";
}

// Page-level cache to avoid refetching on every render.
// v2: chave inclui user.id (via campo userId) para não vazar entre usuários
const calendarCache = {
  userId: null as string | null,
  tasks: null as Task[] | null,
  profiles: null as Profile[] | null,
  appointments: null as Appointment[] | null,
  stages: null as Stage[] | null,
  pipelines: null as Pipeline[] | null,
  // Com o dono junto: o prefetch e a própria tela gravam em momentos diferentes.
  unidades: null as { userId: string; dados: UnidadesDaAgenda } | null,
  timestamp: 0,
};
const CALENDAR_CACHE_TTL = 2 * 60_000;

export const invalidateCalendarCache = () => {
  calendarCache.userId = null;
  calendarCache.tasks = null;
  calendarCache.profiles = null;
  calendarCache.appointments = null;
  calendarCache.stages = null;
  calendarCache.pipelines = null;
  calendarCache.unidades = null;
  calendarCache.timestamp = 0;
};

// localStorage persistence (tasks + profiles + stages + pipelines are week-independent)
const CAL_LS_KEY = "crm:calendar_cache_v2";
const CAL_LS_TTL = 15 * 60_000;

type CalendarLS = {
  tasks: Task[];
  profiles: Profile[];
  stages: Stage[];
  pipelines: Pipeline[];
};

function readCalendarLS(userId: string | null | undefined): CalendarLS | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(`${CAL_LS_KEY}:${userId}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw) as { data: CalendarLS; ts: number };
    if (Date.now() - ts > CAL_LS_TTL) return null;
    return data;
  } catch { return null; }
}

function writeCalendarLS(userId: string | null | undefined, data: CalendarLS) {
  if (!userId) return;
  try { localStorage.setItem(`${CAL_LS_KEY}:${userId}`, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

/** Pré-carrega tarefas/agendamentos da semana atual + perfis/etapas/pipelines.
 *  Popula o cache em memória + localStorage para tornar a primeira renderização instantânea. */
export const prefetchCrmCalendarioData = async (userId: string | null | undefined): Promise<void> => {
  if (!userId) return;
  if (calendarCache.userId === userId && calendarCache.tasks && calendarCache.appointments
    && calendarCache.timestamp && Date.now() - calendarCache.timestamp < CALENDAR_CACHE_TTL) return;
  try {
    const today = new Date();
    const weekStart = format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const weekEnd = format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const [tasksRes, profilesRes, apptsRes, stagesRes, pipelinesRes, unidadesDaAgenda] = await Promise.all([
      buscarTarefasCalendario(),
      supabase.from("profiles").select("id, nome").not("id","in",HIDDEN_USER_IDS_PG),
      buscarConsultasDaSemana(weekStart, weekEnd),
      supabase.from("crm_stages").select("id, name, color, pipeline_id").order("position"),
      supabase.from("crm_pipelines").select("id, name"),
      buscarUnidadesDaAgenda(),
    ]);
    const apptLeadIds = (apptsRes.data || []).filter((a: any) => !a.lead_name || !a.lead_cidade).map((a: any) => a.lead_id).filter(Boolean);
    const taskLeadIds = (tasksRes.data || []).map((t: any) => t.lead_id).filter(Boolean);
    const allLeadIds = [...new Set([...apptLeadIds, ...taskLeadIds])];
    let leadsData: any[] = [];
    if (allLeadIds.length) {
      const { data: rpcData, error: rpcError } = await supabase.rpc("get_leads_for_calendar", { _lead_ids: allLeadIds });
      if (!rpcError && rpcData && rpcData.length > 0) leadsData = rpcData;
      else {
        const { data } = await supabase.from("crm_leads").select("id, name, cidade").in("id", allLeadIds);
        leadsData = data || [];
      }
    }
    const leadsMap = new Map(leadsData.map((l: any) => [l.id, l]));
    const rawTasks = (tasksRes.data || []).map((t: any) => ({ ...t, lead_name: leadsMap.get(t.lead_id)?.name || "Lead" })) as Task[];
    const profs = (profilesRes.data as Profile[]) || [];
    const rawAppts = (apptsRes.data || []).map((a: any) => ({
      ...a,
      lead_name: a.lead_name || leadsMap.get(a.lead_id)?.name || "Lead",
      lead_cidade: a.lead_cidade || leadsMap.get(a.lead_id)?.cidade || null,
      is_rescheduled: a.is_rescheduled || false,
    })) as Appointment[];
    const stgs = (stagesRes.data as Stage[]) || [];
    const pipes = (pipelinesRes.data as Pipeline[]) || [];
    calendarCache.userId = userId;
    calendarCache.tasks = rawTasks;
    calendarCache.profiles = profs;
    calendarCache.appointments = rawAppts;
    calendarCache.stages = stgs;
    calendarCache.pipelines = pipes;
    calendarCache.unidades = { userId, dados: unidadesDaAgenda };
    calendarCache.timestamp = Date.now();
    writeCalendarLS(userId, { tasks: rawTasks, profiles: profs, stages: stgs, pipelines: pipes });
  } catch (e) {
    console.warn("[prefetchCrmCalendarioData] falhou:", e);
  }
};

export default function CrmCalendario() {
  const navigate = useNavigate();
  const { user, userRole } = useAuth();
  // Verifica se cache de módulo é do MESMO user; senão, ignora
  const _sameUserModuleCache = calendarCache.userId === user?.id;
  const [_lsInit] = useState<CalendarLS | null>(() =>
    _sameUserModuleCache && calendarCache.tasks ? null : readCalendarLS(user?.id)
  );
  const [tasks, setTasks] = useState<Task[]>(() => (_sameUserModuleCache && calendarCache.tasks) || _lsInit?.tasks || []);
  const [profiles, setProfiles] = useState<Profile[]>(() => (_sameUserModuleCache && calendarCache.profiles) || _lsInit?.profiles || []);
  const [appointments, setAppointments] = useState<Appointment[]>(() => (_sameUserModuleCache && calendarCache.appointments) || []);
  // `?data=AAAA-MM-DD` abre a agenda naquele dia (vindo da visão "Todos os clientes").
  const [currentDate, setCurrentDate] = useState(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(new URLSearchParams(window.location.search).get("data") ?? "");
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
  });
  // `?view=tarefas` abre direto na aba de tarefas — é o item "Tarefas" do menu
  // da SDR (mesma tela, sem duplicar página). Sem o parâmetro, agendamentos.
  const [searchParams] = useSearchParams();
  const viewParam = searchParams.get("view");
  const [mainView, setMainView] = useState<MainView>(viewParam === "tarefas" ? "tarefas" : "agendamentos");
  useEffect(() => {
    setMainView(viewParam === "tarefas" ? "tarefas" : "agendamentos");
  }, [viewParam]);
  const [taskView, setTaskView] = useState<TaskViewMode>("events");
  const [filterUser, setFilterUser] = useState("");
  const [filterType, setFilterType] = useState("");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [apptMoveStageId, setApptMoveStageId] = useState("");
  const [crmStages, setCrmStages] = useState<Stage[]>(() => (_sameUserModuleCache && calendarCache.stages) || _lsInit?.stages || []);
  const [crmPipelines, setCrmPipelines] = useState<Pipeline[]>(() => (_sameUserModuleCache && calendarCache.pipelines) || _lsInit?.pipelines || []);
  const [apptMovePipelineId, setApptMovePipelineId] = useState("");
  // Clínicas ativas do cliente (null = ainda carregando). Com 0 ou 1 a agenda
  // é UMA linha; com 2 ou mais, uma linha por cidade (AGENDA-8). Vem do cache
  // do módulo quando há, para a grade não trocar de forma ao abrir.
  const [unidadesDaAgenda, setUnidadesDaAgenda] = useState<UnidadesDaAgenda | null>(
    () => (user?.id && calendarCache.unidades?.userId === user.id ? calendarCache.unidades.dados : null),
  );
  // Desfecho / remarcação / cancelamento do agendamento
  const [apptStep, setApptStep] = useState<"init" | "compareceu" | "reschedule" | "agendou">("init");
  const [apptBusy, setApptBusy] = useState(false);
  const [apptNewDate, setApptNewDate] = useState("");
  const [apptNewTime, setApptNewTime] = useState("09:00");
  const [cancelApptFor, setCancelApptFor] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  // Excluir = RPC sdr_excluir_agendamento (status 'cancelled' + motivo + nota no chat).
  const [excluirApptFor, setExcluirApptFor] = useState<Appointment | null>(null);
  const [excluirMotivo, setExcluirMotivo] = useState("");
  // Desfecho antes do horário (AGENDA-14): a ação espera a confirmação.
  const [antecipar, setAntecipar] = useState<{ acao: "compareceu" | "no_show" } | null>(null);
  // false só na janela em que o banco ainda não tem as colunas de presença.
  const [presencaDisponivel, setPresencaDisponivel] = useState(true);
  // POS-01: o perfil não alcança nenhum funil.
  const [semFunil, setSemFunil] = useState(false);

  // Gestão da clínica (AGENDA-1, modelo "dono = gerente"): quem reabre
  // desfecho e registra resultado antes do horário é ehGestaoDaClinica
  // (src/lib/roles.ts) — a régua do banco (stamp_appointment_update,
  // trg_a_desfecho_nao_antecipado). As perguntas passam por
  // podeReabrirAgendamento / podeAnteciparDesfecho (src/lib/regrasDaAgenda.ts).

  const { config: tenantConfig } = useTenantConfig();
  const horario = tenantConfig?.businessHours ?? null;
  const rotuloUnidade = tenantConfig?.vocabulary.unidade || "Unidade";
  // REC-07: recepção/closer sem número liberado — a agenda avisa o motivo.
  const { semNumeroLiberado, aviso: avisoSemNumero } = useNumerosLiberados();

  useEffect(() => {
    let ativo = true;
    buscarUnidadesDaAgenda()
      .then((u) => {
        if (!ativo) return;
        setUnidadesDaAgenda(u);
        if (user?.id) calendarCache.unidades = { userId: user.id, dados: u };
      })
      // Falha de rede: sem lista nem contagem, a grade decide pelas cidades das consultas.
      .catch(() => { if (ativo) setUnidadesDaAgenda({ lista: [], quantas: null }); });
    return () => { ativo = false; };
  }, [user?.id]);

  const unidades = unidadesDaAgenda?.lista ?? null;
  const tenantCities = useMemo(
    () => Array.from(new Set((unidades ?? []).map((c) => c.cidade).filter(Boolean) as string[])),
    [unidades],
  );
  // AGENDA-8: a matriz por cidade é organização de clínica com várias
  // unidades. Com uma só (ou nenhuma cadastrada), tudo numa linha só — antes a
  // linha da unidade ficava vazia e as consultas caíam em "Sem cidade". Quem
  // decide é a contagem do servidor (a SDR não lê `clinicas`, e a agenda dela
  // virava uma linha só num cliente com várias unidades); sem ela, lista vazia é "não
  // sei" e valem as cidades das consultas, como antes. Enquanto carrega, a
  // grade fica sem linhas (ver apptCities) em vez de desenhar uma forma e
  // trocar pela outra.
  const cidadesDasConsultas = useMemo(
    () => new Set(appointments.map((a) => a.lead_cidade).filter(Boolean)).size,
    [appointments],
  );
  const agendaPorCidade = agendaSeparaPorCidade(unidadesDaAgenda?.quantas, unidades?.length ?? 0, cidadesDasConsultas);
  const rotuloLinhaUnica = unidades?.length === 1
    ? (unidades[0].nome || unidades[0].cidade || "Agenda").trim() || "Agenda"
    : "Agenda";

  const weekRange = useMemo(() => ({
    start: format(startOfWeek(currentDate, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    end: format(endOfWeek(currentDate, { weekStartsOn: 1 }), "yyyy-MM-dd"),
  }), [currentDate]);

  const fetchTasks = useCallback(async () => {
    const isCacheValid = calendarCache.userId === user?.id
      && calendarCache.timestamp && Date.now() - calendarCache.timestamp < CALENDAR_CACHE_TTL;
    if (isCacheValid && calendarCache.tasks && calendarCache.appointments) {
      setTasks(calendarCache.tasks);
      setProfiles(calendarCache.profiles || []);
      setAppointments(calendarCache.appointments);
      setCrmStages(calendarCache.stages || []);
      setCrmPipelines(calendarCache.pipelines || []);
    }

    const [tasksRes, profilesRes, apptsRes, stagesRes, pipelinesRes] = await Promise.all([
      buscarTarefasCalendario(),
      supabase.from("profiles").select("id, nome").not("id","in",HIDDEN_USER_IDS_PG),
      // crm_appointments has denormalized lead_name/lead_cidade columns (populated by triggers)
      // — no join needed, immune to RLS restrictions on crm_leads
      buscarConsultasDaSemana(weekRange.start, weekRange.end),
      supabase.from("crm_stages").select("id, name, color, pipeline_id").order("position"),
      supabase.from("crm_pipelines").select("id, name"),
    ]);
    setPresencaDisponivel(apptsRes.presenca);
    // POS-01: perfil sem nenhum funil acessível (a RLS devolve lista vazia) —
    // a tela explica em vez de mostrar uma agenda vazia sem motivo.
    if (!pipelinesRes.error) setSemFunil((pipelinesRes.data || []).length === 0);

    // Build a fallback leads map for any appointment/task missing denormalized data
    // (e.g. legacy rows before the migration ran, or tasks which don't have snapshot columns yet).
    // Tries RPC first (bypasses RLS), then falls back to direct query.
    const apptLeadIds = (apptsRes.data || [])
      .filter((a: any) => !a.lead_name || !a.lead_cidade)
      .map((a: any) => a.lead_id)
      .filter(Boolean);
    const taskLeadIds = (tasksRes.data || []).map((t: any) => t.lead_id).filter(Boolean);
    const allLeadIds = [...new Set([...apptLeadIds, ...taskLeadIds])];
    let leadsData: any[] = [];
    if (allLeadIds.length) {
      const { data: rpcData, error: rpcError } = await supabase.rpc("get_leads_for_calendar", { _lead_ids: allLeadIds });
      // `[]` é verdadeiro em JS: a função devolve lista vazia para quem não
      // alcança os leads (closer/recepção) e o nome virava "Lead" na tela.
      if (!rpcError && rpcData && rpcData.length > 0) {
        leadsData = rpcData;
      } else {
        const { data } = await supabase.from("crm_leads").select("id, name, cidade").in("id", allLeadIds);
        leadsData = data || [];
      }
    }
    const leadsMap = new Map(leadsData.map((l: any) => [l.id, l]));

    const rawTasks = (tasksRes.data || []).map((t: any) => ({
      ...t,
      lead_name: leadsMap.get(t.lead_id)?.name || "Lead",
    })) as Task[];
    const profs = (profilesRes.data as Profile[]) || [];
    const rawAppts = (apptsRes.data || []).map((a: any) => ({
      ...a,
      // Prefer denormalized snapshot, fallback to leadsMap, then "Lead" / null
      lead_name: a.lead_name || leadsMap.get(a.lead_id)?.name || "Lead",
      lead_cidade: a.lead_cidade || leadsMap.get(a.lead_id)?.cidade || null,
      is_rescheduled: a.is_rescheduled || false,
    })) as Appointment[];
    const stgs = (stagesRes.data as Stage[]) || [];
    const pipes = (pipelinesRes.data as Pipeline[]) || [];

    // Update module cache (scoped to current user)
    calendarCache.userId = user?.id ?? null;
    calendarCache.tasks = rawTasks;
    calendarCache.profiles = profs;
    calendarCache.appointments = rawAppts;
    calendarCache.stages = stgs;
    calendarCache.pipelines = pipes;
    calendarCache.timestamp = Date.now();

    // Persist week-independent data to localStorage (com user.id na chave)
    writeCalendarLS(user?.id, { tasks: rawTasks, profiles: profs, stages: stgs, pipelines: pipes });

    setTasks(rawTasks);
    setProfiles(profs);
    setAppointments(rawAppts);
    setCrmStages(stgs);
    setCrmPipelines(pipes);
  }, [weekRange.end, weekRange.start, user?.id]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const handleMarkDone = async (task: Task) => {
    // O `.select()` torna a resposta verificável: RLS que recusa devolve
    // sucesso com ZERO linhas, não erro.
    const { data, error } = await supabase.from("crm_tasks").update({ status: "done" }).eq("id", task.id).select("id");
    if (error) { toast.error("Erro ao concluir tarefa: " + mensagemDeErro(error)); return; }
    if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para concluir esta tarefa."); return; }
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: "done" } : t));
    setSelectedTask(null);
  };

  const handleDeleteTask = async (taskId: string) => {
    const { data, error } = await supabase.from("crm_tasks").delete().eq("id", taskId).select("id");
    if (error) { toast.error("Erro ao excluir tarefa: " + mensagemDeErro(error)); return; }
    if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para excluir esta tarefa."); return; }
    toast.success("Tarefa excluída");
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setSelectedTask(null);
    setDeleteConfirm(null);
  };

  /**
   * "Excluir agendamento" (AGENDA-19): a mesma RPC do chat
   * (sdr_excluir_agendamento, via excluirAgendamento). Não apaga a linha:
   * grava 'cancelled' com o motivo, escreve no chat do lead, tira dos
   * relatórios e devolve o lead a "Conversando" quando não sobra consulta
   * viva. Antes o calendário fazia DELETE físico — a consulta sumia sem motivo
   * nem rastro e o crédito da SDR desaparecia do relatório.
   */
  const handleExcluirAgendamento = async () => {
    if (!excluirApptFor) return;
    setApptBusy(true);
    try {
      const ok = await excluirAgendamento({ appointmentId: excluirApptFor.id, motivo: excluirMotivo });
      if (ok) {
        refreshAppt(excluirApptFor.id, "cancelled");
        setExcluirApptFor(null);
        setExcluirMotivo("");
        setSelectedAppointment(null);
        // A RPC pode ter mudado a etapa do lead: a agenda relê.
        await fetchTasks();
      }
    } catch (e) {
      toast.error(mensagemDeErro(e, "Não foi possível excluir o agendamento."));
    } finally {
      setApptBusy(false);
    }
  };

  const refreshAppt = (apptId: string, status: string) => {
    setAppointments((prev) => prev.map((a) => a.id === apptId ? { ...a, status } : a));
  };

  const handleApptOutcome = async (appt: Appointment, outcome: "contracted" | "not_contracted" | "no_show") => {
    setApptBusy(true);
    try {
      const r = await registrarDesfechoDaConsulta({ leadId: appt.lead_id, appointmentId: appt.id, outcome });
      if (!r.ok) { toast.error("Este agendamento já recebeu desfecho — recarregando"); await fetchTasks(); return; }
      refreshAppt(appt.id, outcome);
      const acao = outcome === "no_show" ? "Não compareceu" : outcome === "contracted" ? "Contratou" : "Não contratou";
      if (r.falhaDeEtapa) {
        toast.warning(`Marcado como ${acao}, mas o lead não foi movido de etapa: ${r.falhaDeEtapa}`);
      } else {
        toast.success("Desfecho registrado");
      }
      setSelectedAppointment(null);
    } catch (e) {
      // A recusa do banco vem em português (ex.: "A consulta é só em …",
      // gatilho do SDR-01): é ela que o usuário precisa ler. E a tela relê os
      // dados, para mostrar o que de fato ficou gravado.
      toast.error(mensagemDeErro(e, "Erro ao registrar desfecho"));
      await fetchTasks();
      setSelectedAppointment(null);
    } finally {
      setApptBusy(false);
      setApptStep("init");
    }
  };

  /**
   * Desfecho antes do horário marcado (AGENDA-14 / SDR-01): a gestão confirma
   * ("A consulta é só em … — registrar o resultado agora?"); os outros papéis
   * são recusados pelo banco, então a tela explica em vez de oferecer o clique.
   */
  const guardarAntecipado = (appt: Appointment, acao: "compareceu" | "no_show", executar: () => void) => {
    if (isBeforeScheduled(appt.scheduled_date, appt.scheduled_time)) {
      setAntecipar({ acao });
      return;
    }
    executar();
  };

  const executarCompareceu = (appt: Appointment) => {
    // SDR: "Compareceu" fecha o ciclo dela na RPC própria e NÃO abre o segundo
    // passo — ela não decide contrato (mesma regra do chat).
    if (escondeDesfechoDeVenda(userRole)) handleApptComparecimentoSdr(appt);
    else setApptStep("compareceu");
  };

  /** Agendamento criado por bot/API, aguardando a equipe — a mesma ação do chat. */
  const handleConfirmarPendente = async (appt: Appointment) => {
    setApptBusy(true);
    try {
      const { data, error } = await supabase
        .from("crm_appointments")
        .update({ status: "confirmed" })
        .eq("id", appt.id)
        .eq("status", "pending")
        .select("id");
      if (error) { toast.error(mensagemDeErro(error, "Erro ao confirmar agendamento")); return; }
      if (!data || data.length === 0) {
        toast.error("Este agendamento já foi confirmado ou alterado — recarregando");
        await fetchTasks();
        return;
      }
      await anotarNoHistorico(appt.lead_id, `✅ Agendamento confirmado: ${appt.scheduled_date.split("-").reverse().join("/")} às ${appt.scheduled_time?.slice(0, 5)}`);
      toast.success("Agendamento confirmado!");
      refreshAppt(appt.id, "confirmed");
      // O diálogo segue aberto, agora com as ações de consulta agendada.
      setSelectedAppointment((prev) => (prev && prev.id === appt.id ? { ...prev, status: "confirmed" } : prev));
    } finally {
      setApptBusy(false);
    }
  };

  /** "Compareceu e agendou" (AGENDA-14): desfecho no atual + consulta nova + etapa pela função. */
  const handleApptAgendou = async (appt: Appointment) => {
    if (!apptNewDate) { toast.error("Selecione a data da nova consulta"); return; }
    setApptBusy(true);
    try {
      const ok = await compareceuEAgendou({
        leadId: appt.lead_id,
        old: { id: appt.id, scheduled_date: appt.scheduled_date, scheduled_time: appt.scheduled_time },
        newDate: apptNewDate,
        newTime: apptNewTime,
      });
      // Mesmo sem o movimento de etapa (ok false) o desfecho e a consulta nova
      // já estão gravados: a tela relê para mostrar o que ficou.
      if (ok) setSelectedAppointment(null);
      await fetchTasks();
    } catch (e) {
      toast.error(mensagemDeErro(e, "Erro ao registrar o comparecimento"));
    } finally {
      setApptBusy(false);
      setApptStep("init");
    }
  };

  /** Aviso ao marcar data em dia que a clínica não abre (CRC-10). */
  const avisoDiaFechado = (dia: string): string | null => {
    if (!dia) return null;
    const d = new Date(`${dia}T12:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return diaDaSemanaAberto(horario, d.getDay()) === false
      ? "A clínica não abre neste dia da semana (Horário comercial). Confira a data antes de salvar."
      : null;
  };

  /**
   * "Compareceu" da SDR aqui no calendário — espelho do que
   * AppointmentConfirmBar.tsx já faz no chat (doSdrComparecimento).
   *
   * Por que não pode ser o caminho comum (handleApptOutcome):
   *   • ele obriga a escolher entre "Contratou" e "Não contratou" — as duas
   *     palavras que a SDR não pode ler (decisão do dono);
   *   • ele grava o status por UPDATE, sem outcome_source = 'sdr'. A consulta
   *     ficava marcada como desfecho "do sistema" e a RPC de correção depois
   *     recusava com "esta marcada como CONTRATADA pelo sistema de pagamentos":
   *     ela travava num erro que ela mesma tinha cometido;
   *   • ela não enxerga a etapa de destino (RLS), então o movimento de etapa
   *     não sairia daqui de qualquer jeito.
   * A RPC sdr_marcar_comparecimento grava 'not_contracted' (= compareceu, com
   * contrato em aberto) carimbando a autoria da SDR, e a entrega ao
   * administrador continua com os gatilhos da carência de 24 h.
   */
  const handleApptComparecimentoSdr = async (appt: Appointment) => {
    setApptBusy(true);
    try {
      // marcarComparecimentoSdr (e não applySdrComparecimento, que foi apagada):
      // ela monta o aviso com o que o SERVIDOR respondeu. O texto fixo que estava
      // aqui prometia "a etapa não muda agora", e desde 10/09 a RPC move o lead
      // para "Compareceu" — que agora é etapa visível para a SDR. O card saltava
      // de coluna na frente dela enquanto a tela garantia que nada tinha mudado.
      const ok = await marcarComparecimentoSdr(appt.id);
      if (!ok) { await fetchTasks(); return; }
      // Estado local com o status que o banco gravou; o rótulo/cor da tela saem
      // de rotuloDesfecho/corDesfecho, então para ela o card lê "Compareceu".
      refreshAppt(appt.id, "not_contracted");
      // A etapa mudou no banco: recarrega para a agenda bater com o funil.
      await fetchTasks();
      setSelectedAppointment(null);
    } catch (e) {
      toast.error(mensagemDeErro(e, "Erro ao registrar comparecimento"));
    } finally {
      setApptBusy(false);
      setApptStep("init");
    }
  };

  const handleApptReschedule = async (appt: Appointment) => {
    if (!apptNewDate) { toast.error("Selecione a nova data"); return; }
    setApptBusy(true);
    try {
      const ok = await rescheduleAppointment({
        leadId: appt.lead_id,
        old: { id: appt.id, scheduled_date: appt.scheduled_date, scheduled_time: appt.scheduled_time },
        newDate: apptNewDate,
        newTime: apptNewTime,
      });
      if (ok) { setSelectedAppointment(null); await fetchTasks(); }
    } catch (e) {
      toast.error(mensagemDeErro(e, "Erro ao remarcar agendamento"));
    } finally {
      setApptBusy(false);
      setApptStep("init");
    }
  };

  const handleApptCancel = async () => {
    if (!cancelApptFor) return;
    setApptBusy(true);
    try {
      const ok = await cancelAppointment({ leadId: cancelApptFor.lead_id, appointmentId: cancelApptFor.id, reason: cancelReason });
      if (ok) {
        refreshAppt(cancelApptFor.id, "cancelled");
        setCancelApptFor(null);
        setCancelReason("");
        setSelectedAppointment(null);
      }
    } catch (e) {
      toast.error(mensagemDeErro(e, "Erro ao cancelar agendamento"));
    } finally {
      setApptBusy(false);
    }
  };

  const handleApptReopen = async (appt: Appointment) => {
    setApptBusy(true);
    const { data, error } = await supabase.from("crm_appointments").update({ status: "confirmed" }).eq("id", appt.id).select("id");
    setApptBusy(false);
    if (error) { toast.error(mensagemDeErro(error, "Erro ao reabrir agendamento")); return; }
    if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para reabrir este agendamento."); return; }
    refreshAppt(appt.id, "confirmed");
    toast.success("Agendamento reaberto");
    setSelectedAppointment(null);
  };

  /**
   * "Mover lead para" (BACK-10): só o UPDATE de crm_leads, conferido. O
   * histórico de etapa é escrito pelo gatilho sync_lead_stage_history (o
   * único escritor; a policy de INSERT saiu na migration 20260929002320). O
   * código antigo fechava as passagens e inseria uma à mão ANTES do UPDATE —
   * sobrava uma passagem de duração zero e, com o índice único do P06, o
   * INSERT passaria a falhar. pipeline_id só vai no UPDATE quando o funil muda
   * (o mesmo payload de moverLeadParaFuncao, src/lib/etapaFuncao.ts).
   */
  const handleApptMoveStage = async (appt: Appointment) => {
    if (!apptMoveStageId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const etapa = crmStages.find((s) => s.id === apptMoveStageId);
    const { data: lead, error: leadErr } = await db
      .from("crm_leads")
      .select("id, stage_id, pipeline_id")
      .eq("id", appt.lead_id)
      .maybeSingle();
    if (leadErr) { toast.error(mensagemDeErro(leadErr, "Erro ao mover o lead")); return; }
    if (!lead) { toast.error("Seu perfil não tem acesso a este lead."); return; }
    if (lead.stage_id === apptMoveStageId) { toast.info("O lead já está nessa etapa."); return; }
    const payload: Record<string, unknown> = { stage_id: apptMoveStageId, updated_at: new Date().toISOString() };
    const funilDestino = etapa?.pipeline_id || apptMovePipelineId;
    if (funilDestino && funilDestino !== lead.pipeline_id) payload.pipeline_id = funilDestino;
    const { data, error } = await db.from("crm_leads").update(payload).eq("id", appt.lead_id).select("id");
    if (error) { toast.error(mensagemDeErro(error, "Erro ao mover o lead")); return; }
    if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para mover este lead."); return; }
    toast.success(`Lead movido para ${etapa?.name?.trim() || "a etapa escolhida"}`);
    setSelectedAppointment(null);
  };

  const filtered = useMemo(() => {
    const isPrivileged = userRole === "crc" || userRole === "gerente" || userRole === "superadmin";
    return tasks.filter((t) => {
      if (!isPrivileged && userRole) {
        // Show only tasks owned by the user's role or assigned to them.
        // A SDR mora no mundo do crc: a tarefa que ela cria nasce com
        // owner_role = 'crc' (gatilho set_owner_role_from_user, que mapeia
        // sdr → crc) e com assigned_to = null (o TaskPanel não escolhe
        // responsável). Sem esta linha, a tarefa que ela acabou de criar — e a
        // que o CRC criou sobre um lead dela — sumia da aba "Tarefas".
        // É seguro: a RESTRICTIVE sdr_escopo_crm_tasks já limita o que o banco
        // devolve às tarefas de leads dela.
        const matchesRole = t.owner_role === userRole || (userRole === "sdr" && t.owner_role === "crc");
        const matchesAssignee = t.assigned_to === user?.id;
        if (!matchesRole && !matchesAssignee) return false;
      }
      if (filterUser && t.assigned_to !== filterUser) return false;
      // 'call'/'follow_up' (gravados pelas automações) casam com Ligação/Follow-up.
      if (filterType && !tarefaDoTipo(t.type, filterType)) return false;
      return true;
    });
  }, [tasks, filterUser, filterType, userRole, user?.id]);

  const nav = (dir: number) => {
    setCurrentDate((prev) => {
      if (taskView === "month") return dir > 0 ? addMonths(prev, 1) : subMonths(prev, 1);
      return dir > 0 ? addWeeks(prev, 1) : subWeeks(prev, 1);
    });
  };

  // === EVENTS VIEW ===
  const eventsView = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const tomorrowStart = addDays(todayStart, 1);
    const nextWeekEnd = addDays(todayStart, 8);

    const done = filtered.filter((t) => t.status === "done").sort((a, b) => new Date(b.due_date).getTime() - new Date(a.due_date).getTime());
    const late = filtered.filter((t) => t.status !== "done" && isBefore(new Date(t.due_date), todayStart));
    const today = filtered.filter((t) => t.status !== "done" && isSameDay(new Date(t.due_date), todayStart));
    const tomorrow = filtered.filter((t) => t.status !== "done" && isSameDay(new Date(t.due_date), tomorrowStart));
    const nextWeek = filtered.filter((t) => {
      const d = new Date(t.due_date);
      return t.status !== "done" && isAfter(d, tomorrowStart) && !isSameDay(d, tomorrowStart) && isBefore(d, nextWeekEnd);
    });

    return { done, late, today, tomorrow, nextWeek };
  }, [filtered]);

  // === GRID ===
  const days = useMemo(() => {
    if (taskView === "month") {
      const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
      const end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 });
      return eachDayOfInterval({ start, end });
    }
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    const end = endOfWeek(currentDate, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentDate, taskView]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    filtered.forEach((t) => {
      const key = format(new Date(t.due_date), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    });
    return map;
  }, [filtered]);

  // Horas da visão Semana (AGENDA-9): 7h–20h ampliadas para o expediente e
  // para as tarefas desta semana — tarefa às 21h ou às 6h não some da grade.
  const hours = useMemo(() => {
    const horasDasTarefas: number[] = [];
    if (taskView === "week") {
      for (const day of days) {
        for (const t of tasksByDay.get(format(day, "yyyy-MM-dd")) || []) {
          horasDasTarefas.push(new Date(t.due_date).getHours());
        }
      }
    }
    return horasDaGradeSemanal(horario, horasDasTarefas);
  }, [days, tasksByDay, taskView, horario]);

  const renderTaskCard = (task: Task, compact = false) => {
    const st = getTaskStatus(task);
    const typeLabel = rotuloTipoDeTarefa(task.type);
    return (
      <div
        key={task.id}
        onClick={() => setSelectedTask(task)}
        className={cn("rounded-xl border p-3 cursor-pointer shadow-xs transition-shadow hover:shadow-card", statusColor(st))}
      >
        <div className="text-sm font-semibold leading-snug break-words">{task.lead_name}</div>
        {!compact && (
          <>
            <div className="mt-1 text-xs tabular-nums text-tertiary">{format(new Date(task.due_date), "dd/MM/yyyy HH:mm")}</div>
            <div className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {st === "late" ? <AlertTriangle size={12} className="shrink-0 text-destructive" /> : st === "done" ? <CheckCircle2 size={12} className="shrink-0 text-success" /> : <Circle size={12} className="shrink-0 text-info" />}
              <span className="break-all">{typeLabel}</span>
            </div>
            {task.notes && <p className="mt-2 text-xs leading-relaxed text-muted-foreground break-words">{task.title}: {task.notes}</p>}
          </>
        )}
        {compact && (
          <div className="mt-0.5 text-[11px] text-muted-foreground break-words">{format(new Date(task.due_date), "HH:mm")} {typeLabel}</div>
        )}
      </div>
    );
  };

  const renderEventsColumn = (title: string, tasks: Task[]) => (
    <div className="flex min-w-[180px] flex-1 basis-0 flex-col overflow-hidden rounded-card border border-border/60 border-t-[3px] border-t-[hsl(var(--col))] bg-[hsl(var(--col)/0.045)] xl:min-w-0">
       <div className="flex min-h-[56px] flex-wrap items-center justify-between gap-1.5 bg-[hsl(var(--col)/0.10)] px-3 py-3 xl:flex-nowrap xl:px-3.5">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground before:h-2 before:w-2 before:shrink-0 before:rounded-full before:bg-[hsl(var(--col))] before:content-['']">{title}</h3>
        <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full bg-card px-2.5 text-[11px] font-medium tabular-nums text-muted-foreground shadow-xs">{contagem(tasks.length, "evento", "eventos")}</span>
      </div>
      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {tasks.length === 0 && <div className="rounded-xl border border-dashed border-border py-8 text-center text-[13px] text-tertiary">Nenhum evento</div>}
        {tasks.map((t) => renderTaskCard(t))}
      </div>
    </div>
  );

  const dayTasks = selectedDay ? tasksByDay.get(format(selectedDay, "yyyy-MM-dd")) || [] : [];

  // Colunas da grade de agendamentos (AGENDA-9 / CRC-10): segunda a sábado e o
  // domingo quando a clínica abre no domingo (Horário comercial) OU quando há
  // consulta no domingo desta semana. Antes o domingo era cortado sempre e a
  // consulta dele sumia, embora o contador a contasse.
  const apptWeekDays = useMemo(
    () => diasDaGradeDaSemana(
      startOfWeek(currentDate, { weekStartsOn: 1 }),
      horario,
      appointments.map((a) => a.scheduled_date),
      (d) => format(d, "yyyy-MM-dd"),
    ),
    [currentDate, horario, appointments],
  );
  const apptWeekDayKeys = useMemo(() => new Set(apptWeekDays.map((d) => format(d, "yyyy-MM-dd"))), [apptWeekDays]);
  // Contador do cabeçalho = soma dos "Total / dia" da grade: os mesmos dias e
  // sem o horário antigo das remarcações nem as canceladas (CRC-10, AGENDA-16).
  const totalAgendamentosDaSemana = useMemo(
    () => appointments.filter((a) => apptWeekDayKeys.has(a.scheduled_date) && !foraDoTotal(a.status)).length,
    [appointments, apptWeekDayKeys],
  );

  // Linhas da grade. Uma clínica só (ou nenhuma cadastrada): UMA linha com
  // todas as consultas (AGENDA-8). Várias: as cidades das clínicas e, depois,
  // as cidades achadas nas consultas desta semana (inclusive "Sem cidade" para
  // lead sem cidade) — consulta nunca some por falta de cidade.
  const SEM_CIDADE = "Sem cidade";
  const apptCities = useMemo(() => {
    // Ainda sem saber quantas unidades há: nenhuma linha por um instante (o
    // cache do módulo e o prefetch já trazem a resposta na maioria das vezes).
    if (unidadesDaAgenda === null) return [];
    if (!agendaPorCidade) return [rotuloLinhaUnica];
    const known = new Set(tenantCities);
    const fromAppts = appointments.map(a => a.lead_cidade || SEM_CIDADE);
    const extra = fromAppts.filter(c => !known.has(c));
    const uniqueExtra = [...new Set(extra)];
    return [...tenantCities, ...uniqueExtra];
  }, [unidadesDaAgenda, agendaPorCidade, rotuloLinhaUnica, tenantCities, appointments]);

  // Legenda do calendário de agendamentos.
  // Para a SDR, os dois desfechos de comparecimento ('contracted' e
  // 'not_contracted') viram UMA entrada só, "Compareceu" (decisão D3): quem
  // decide contrato é o pagamento, não ela. Duas entradas ensinariam a ler o
  // contrato pela cor — exatamente o que o rótulo esconde. Para os demais
  // papéis os itens continuam sendo os mesmos de antes, na mesma ordem.
  //
  // AGENDA-11: 'confirmed' quer dizer "agendada" (todo agendamento nasce
  // assim), não "o paciente confirmou" — a legenda diz "Agendado". A presença
  // tem coluna própria e selo próprio (legendaPresenca). AGENDA-16: "Pendente"
  // (criado por bot/API, aguardando a equipe) e "Remarcada" (o horário antigo
  // de uma remarcação, tracejado) ganharam cor.
  const legendaAgendamentos = useMemo(() => {
    const agendado = { cor: "bg-info-soft text-info-soft-foreground", texto: "Agendado" };
    const pendente = { cor: "bg-orange-soft text-orange-soft-foreground", texto: "Pendente" };
    const compareceuCor = "bg-success-soft text-success-soft-foreground";
    const naoCompareceu = { cor: "bg-warning-soft text-warning-soft-foreground", texto: "Não compareceu" };
    const reagendado = { cor: "bg-rescheduled-soft text-rescheduled-soft-foreground", texto: "Reagendado" };
    const remarcada = { cor: "bg-card text-muted-foreground border border-dashed border-rescheduled/60", texto: "Remarcada" };
    const cancelado = { cor: "bg-muted text-muted-foreground ring-1 ring-inset ring-border", texto: "Cancelado" };
    if (escondeDesfechoDeVenda(userRole)) {
      return [
        agendado,
        pendente,
        { cor: compareceuCor, texto: rotuloDesfecho("contracted", userRole) },
        naoCompareceu,
        reagendado,
        remarcada,
        cancelado,
      ];
    }
    return [
      agendado,
      pendente,
      { cor: compareceuCor, texto: "Contratado" },
      naoCompareceu,
      { cor: "bg-destructive-soft text-destructive-soft-foreground", texto: "Não contratou" },
      reagendado,
      remarcada,
      cancelado,
    ];
  }, [userRole]);

  return (
    <div className="relative flex flex-col h-full -m-2 sm:-m-4 lg:-m-6 overflow-y-auto bg-background px-4 py-5 sm:px-6 lg:px-8 lg:py-6" style={{ height: "calc(100vh - 4rem)" }}>
      {/* MAIN VIEW TOGGLE */}
      <div className="mb-4 flex flex-shrink-0 items-center gap-3 xl:absolute xl:right-8 xl:top-6 xl:mb-0">
        <div className="flex w-full gap-1 rounded-full border border-border/60 bg-card p-1 shadow-card sm:w-auto">
          <Button
            variant={mainView === "agendamentos" ? "default" : "ghost"}
            size="sm"
            className={cn("h-10 flex-1 rounded-full px-5 text-sm font-semibold sm:flex-none", mainView === "agendamentos" ? "border border-primary/20 bg-primary-soft text-primary-soft-fg shadow-none hover:bg-primary-soft-2" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
            onClick={() => setMainView("agendamentos")}
          >
            <CalendarDays size={16} className="mr-2" />
            Agendamentos
          </Button>
          <Button
            variant={mainView === "tarefas" ? "default" : "ghost"}
            size="sm"
            className={cn("h-10 flex-1 rounded-full px-5 text-sm font-semibold sm:flex-none", mainView === "tarefas" ? "border border-primary/20 bg-primary-soft text-primary-soft-fg shadow-none hover:bg-primary-soft-2" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
            onClick={() => setMainView("tarefas")}
          >
            <Clock size={16} className="mr-2" />
            Tarefas
          </Button>
        </div>
      </div>

      {/* Avisos de acesso: sem funil (POS-01) e sem número liberado (REC-07).
          A agenda vazia sem motivo era exatamente o defeito relatado. */}
      {(semFunil || semNumeroLiberado) && (
        <div className="mb-4 flex flex-shrink-0 flex-col gap-2 xl:pr-[330px]">
          {semFunil && (
            <p role="status" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-[13px] leading-relaxed text-warning-soft-foreground">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              Seu perfil ainda não tem funil — peça ao(à) gestor(a).
            </p>
          )}
          {semNumeroLiberado && (
            <p role="status" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-[13px] leading-relaxed text-warning-soft-foreground">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              {avisoSemNumero}
            </p>
          )}
        </div>
      )}

      {/* ==================== TAREFAS VIEW ==================== */}
      {mainView === "tarefas" && (
        <>
          {/* Sub-nav */}
          <div className="mb-4 flex min-h-[50px] flex-shrink-0 flex-wrap items-center justify-between gap-3 xl:pr-[330px]">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-1 rounded-full border border-border/60 bg-card p-1 shadow-xs">
              {(["events", "list", "week", "month"] as TaskViewMode[]).map((v) => (
                <Button
                  key={v}
                  variant={taskView === v ? "default" : "ghost"}
                  size="sm"
                  className={cn("h-8 rounded-full px-3.5 text-[13px] font-medium", taskView === v ? "border border-primary/20 bg-primary-soft text-primary-soft-fg shadow-none hover:bg-primary-soft-2" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
                  onClick={() => setTaskView(v)}
                >
                  {v === "events" ? "Eventos" : v === "list" ? "Lista" : v === "week" ? "Semana" : "Mês"}
                </Button>
              ))}
              </div>

              {/* "Todos" é o valor sentinela 'all' do Select, não um filtro:
                  vira "" no estado (AGENDA-7 — antes esvaziava a lista). */}
              <Select value={filterType || "all"} onValueChange={(v) => setFilterType(v === "all" ? "" : v)}>
                <SelectTrigger className="h-10 w-[150px] rounded-full bg-card text-[13px] shadow-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {TIPOS_DE_TAREFA.map((t) => <SelectItem key={t} value={t}>{ROTULO_TIPO_DE_TAREFA[t]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterUser || "all"} onValueChange={(v) => setFilterUser(v === "all" ? "" : v)}>
                <SelectTrigger className="h-10 w-[170px] rounded-full bg-card text-[13px] shadow-xs"><SelectValue placeholder="Responsável" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              {(filterType || filterUser) && (
                <Button variant="ghost" size="sm" className="h-10 rounded-full px-4 text-[13px] font-medium text-muted-foreground hover:text-foreground" onClick={() => { setFilterType(""); setFilterUser(""); }}>Limpar</Button>
              )}
            </div>
            <span className="inline-flex h-8 items-center whitespace-nowrap rounded-full bg-slate-soft px-3 text-[13px] font-medium tabular-nums text-slate-soft-foreground">{contagem(filtered.length, "tarefa", "tarefas")}</span>
          </div>

          {/* Nav for month/week */}
          {(taskView === "month" || taskView === "week") && (
            <div className="mb-4 flex flex-shrink-0 flex-wrap items-center gap-2">
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl bg-card shadow-xs" onClick={() => nav(-1)}><ChevronLeft size={16} /></Button>
              <h2 className="min-w-[200px] text-center text-xl font-bold capitalize tracking-tight text-foreground sm:text-2xl">
                {taskView === "month"
                  ? format(currentDate, "MMMM yyyy", { locale: ptBR })
                  : `Sem. ${format(startOfWeek(currentDate, { weekStartsOn: 1 }), "dd MMM", { locale: ptBR })} — ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), "dd MMM yyyy", { locale: ptBR })}`}
              </h2>
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl bg-card shadow-xs" onClick={() => nav(1)}><ChevronRight size={16} /></Button>
              <Button variant="outline" size="sm" className="ml-1 h-9 rounded-xl bg-card px-4 text-[13px] font-medium shadow-xs" onClick={() => setCurrentDate(new Date())}>Hoje</Button>
            </div>
          )}

          {/* EVENTS */}
          {taskView === "events" && (
            <div className="flex min-h-[420px] flex-1 gap-3 overflow-x-auto pb-1 [&>div:nth-child(1)]:[--col:var(--success)] [&>div:nth-child(2)]:[--col:var(--destructive)] [&>div:nth-child(3)]:[--col:var(--info)] [&>div:nth-child(4)]:[--col:var(--purple)] [&>div:nth-child(5)]:[--col:var(--slate)]">
              {renderEventsColumn("Concluídas", eventsView.done)}
              {renderEventsColumn("Atrasadas", eventsView.late)}
              {renderEventsColumn("Hoje", eventsView.today)}
              {renderEventsColumn("Amanhã", eventsView.tomorrow)}
              {renderEventsColumn("Próxima Semana", eventsView.nextWeek)}
            </div>
          )}

          {/* LIST */}
          {taskView === "list" && (
            <div className="min-h-0 flex-1 overflow-auto rounded-card border border-border/60 bg-card shadow-card">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]">
                  <tr className="text-left">
                    <th className="px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wide text-tertiary">Vencimento</th>
                    <th className="px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wide text-tertiary">Responsável</th>
                    <th className="px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wide text-tertiary">Lead</th>
                    <th className="px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wide text-tertiary">Tipo</th>
                    <th className="px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wide text-tertiary">Comentário</th>
                    <th className="px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wide text-tertiary">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filtered.sort((a, b) => new Date(b.due_date).getTime() - new Date(a.due_date).getTime()).map((t) => {
                    const st = getTaskStatus(t);
                    const assignedProfile = profiles.find((p) => p.id === t.assigned_to);
                    return (
                      <tr key={t.id} onClick={() => setSelectedTask(t)} className={cn("h-14 cursor-pointer transition-colors hover:bg-surface-sunken/70", st === "late" && "bg-destructive-soft/30", st === "done" && "bg-success-soft/30")}>
                        <td className="whitespace-nowrap px-5 py-3 text-[13px] font-medium tabular-nums text-foreground">{format(new Date(t.due_date), "dd/MM/yyyy HH:mm")}</td>
                        <td className="px-4 py-3 text-[13px] text-muted-foreground">{assignedProfile?.nome || "—"}</td>
                        <td className="px-4 py-3">
                          <button onClick={(e) => { e.stopPropagation(); navigate(`/crm/conversa/${t.lead_id}`); }} className="text-left text-[13px] font-semibold text-primary-soft-fg hover:underline">{t.lead_name}</button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-muted-foreground">
                            {st === "late" ? <AlertTriangle size={12} className="text-destructive" /> : st === "done" ? <CheckCircle2 size={12} className="text-success" /> : <Circle size={12} className="text-info" />}
                            {rotuloTipoDeTarefa(t.type)}
                          </div>
                        </td>
                        <td className="min-w-[220px] max-w-[360px] px-4 py-3 text-[13px] leading-relaxed text-muted-foreground break-words">{t.notes || t.title}</td>
                        <td className="px-5 py-3">
                          <Badge variant="outline" className={cn("h-6 rounded-full border-transparent px-2.5 text-[11px] font-medium bg-warning-soft text-warning-soft-foreground", st === "done" && "bg-success-soft text-success-soft-foreground", st === "late" && "bg-destructive-soft text-destructive-soft-foreground")}>
                            {st === "done" ? "Concluída" : st === "late" ? "Atrasada" : "Pendente"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="py-14 text-center text-sm text-tertiary">Nenhuma tarefa encontrada</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* MONTH */}
          {taskView === "month" && (
            <>
            <div className="flex flex-none flex-col overflow-x-auto rounded-card border border-border/60 bg-card shadow-card sm:min-h-0 sm:flex-1">
            <div className="flex min-w-[680px] flex-1 flex-col sm:min-w-[720px]">
              <div className="grid flex-shrink-0 grid-cols-7 border-b border-border/60">
                {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => (
                  <div key={d} className="py-3 text-center text-[12px] font-semibold uppercase tracking-wide text-tertiary">{d}</div>
                ))}
              </div>
              <div className="grid flex-1 auto-rows-[minmax(96px,auto)] grid-cols-7 gap-px bg-border/50">
                {days.map((day) => {
                  const key = format(day, "yyyy-MM-dd");
                  const dayTs = tasksByDay.get(key) || [];
                  const hasLate = dayTs.some((t) => getTaskStatus(t) === "late");
                  const inMonth = isSameMonth(day, currentDate);
                  return (
                    <div key={key} onClick={() => setSelectedDay(day)} className={cn("relative min-h-[96px] cursor-pointer bg-card p-1.5 transition-colors sm:p-2 hover:bg-surface-sunken/70", !inMonth && "bg-surface-sunken/60 [&>*]:opacity-50", selectedDay && isSameDay(day, selectedDay) && "bg-primary-soft/40 ring-2 ring-inset ring-primary/40")}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums", isToday(day) ? "bg-primary text-primary-foreground shadow-brand" : "text-foreground")}>{format(day, "d")}</span>
                        {hasLate && <span className="h-2 w-2 rounded-full bg-destructive" />}
                      </div>
                      <div className="space-y-1">
                        {dayTs.slice(0, 3).map((t) => {
                          const st = getTaskStatus(t);
                          return (
                            <div key={t.id} onClick={(e) => { e.stopPropagation(); setSelectedTask(t); }} className={cn("cursor-pointer rounded-md border-l-[3px] px-1.5 py-1 text-[11px] font-medium leading-tight break-words", st === "done" && "border-l-success bg-success-soft text-success-soft-foreground", st === "late" && "border-l-destructive bg-destructive-soft text-destructive-soft-foreground", st === "pending" && "border-l-info bg-info-soft text-info-soft-foreground")}>
                              {t.lead_name} {format(new Date(t.due_date), "HH:mm")} {rotuloTipoDeTarefa(t.type)}
                            </div>
                          );
                        })}
                        {dayTs.length > 3 && <div className="pl-1 text-[11px] font-semibold text-tertiary">+{dayTs.length - 3}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            </div>
            </>
          )}

          {/* WEEK */}
          {taskView === "week" && (
            <>
            <div className="min-h-0 flex-1 overflow-auto rounded-card border border-border/60 bg-card shadow-card">
            <div className="min-w-[780px]">
              <div className="sticky top-0 z-10 grid flex-shrink-0 border-b border-border/60 bg-card" style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}>
                <div />
                {days.map((day) => (
                  <div key={day.toISOString()} className={cn("flex flex-col items-center gap-1 py-3 text-center text-[12px] font-medium uppercase tracking-wide text-tertiary", isToday(day) && "text-primary-soft-fg")}>
                    <div>{format(day, "EEE", { locale: ptBR })}</div>
                    <div className={cn("flex h-8 w-8 items-center justify-center rounded-full text-[20px] font-bold normal-case tabular-nums text-foreground", isToday(day) && "bg-primary text-[15px] text-primary-foreground shadow-brand")}>{format(day, "d")}</div>
                  </div>
                ))}
              </div>
              <div>
                <div className="grid" style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))" }}>
                  {hours.map((hour) => (
                    <div key={hour} className="contents">
                      <div className="min-h-[64px] border-r border-border/50 pr-2 pt-1.5 text-right text-[11px] tabular-nums text-tertiary">{String(hour).padStart(2, "0")}:00</div>
                      {days.map((day) => {
                        const key = format(day, "yyyy-MM-dd");
                        const hourTasks = (tasksByDay.get(key) || []).filter((t) => new Date(t.due_date).getHours() === hour);
                        return (
                          <div key={`${key}-${hour}`} className={cn("relative min-h-[64px] space-y-1 border-b border-r border-border/50 p-1", isToday(day) && "bg-primary-soft/25")}>
                            {hourTasks.map((t) => {
                              const st = getTaskStatus(t);
                              return (
                                <div key={t.id} onClick={() => setSelectedTask(t)} className={cn("cursor-pointer rounded-lg border-l-[3px] px-2 py-1.5 text-[12px] font-semibold leading-tight break-words transition-shadow hover:shadow-card", st === "done" && "border-l-event-green-bar bg-event-green-bg text-event-green-fg", st === "late" && "border-l-destructive bg-destructive-soft text-destructive-soft-foreground", st === "pending" && "border-l-event-blue-bar bg-event-blue-bg text-event-blue-fg")}>
                                  {t.lead_name}, {rotuloTipoDeTarefa(t.type)}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            </div>
            </>
          )}

          {/* Day summary (month) */}
          {taskView === "month" && selectedDay && dayTasks.length > 0 && (
            <div className="mt-4 max-h-[260px] flex-shrink-0 overflow-y-auto rounded-card border border-border/60 bg-card p-5 shadow-card">
              <h3 className="mb-3 text-base font-semibold text-foreground">Tarefas de {format(selectedDay, "dd 'de' MMMM", { locale: ptBR })}</h3>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {dayTasks.map((t) => {
                  const st = getTaskStatus(t);
                  const Icon = iconeTipoDeTarefa(t.type);
                  return (
                    <div key={t.id} onClick={() => setSelectedTask(t)} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3 py-2.5 text-[13px] shadow-xs transition-shadow hover:shadow-card">
                      {st === "done" ? <CheckCircle2 size={16} className="shrink-0 text-success" /> : st === "late" ? <AlertTriangle size={16} className="shrink-0 text-destructive" /> : <Circle size={16} className="shrink-0 text-info" />}
                      <Icon size={14} className="shrink-0 text-tertiary" />
                      <span className="min-w-0 flex-1 font-medium leading-snug text-foreground break-words">{t.lead_name} — {t.title}</span>
                      <span className={cn("shrink-0 text-xs font-semibold tabular-nums text-tertiary", st === "late" && "text-destructive")}>{format(new Date(t.due_date), "HH:mm")}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ==================== AGENDAMENTOS VIEW ==================== */}
      {mainView === "agendamentos" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex min-h-10 flex-shrink-0 items-center gap-2 xl:pr-[330px]">
            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0 rounded-xl bg-card shadow-xs" onClick={() => setCurrentDate(prev => addDays(prev, -7))}><ChevronLeft size={16} /></Button>
            <h2 className="min-w-0 px-1 text-center text-[22px] font-bold capitalize leading-tight tracking-tight text-foreground sm:text-[28px]">
              {format(startOfWeek(currentDate, { weekStartsOn: 1 }), "dd MMM", { locale: ptBR })} — {format(endOfWeek(currentDate, { weekStartsOn: 1 }), "dd MMM yyyy", { locale: ptBR })}
            </h2>
            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0 rounded-xl bg-card shadow-xs" onClick={() => setCurrentDate(prev => addDays(prev, 7))}><ChevronRight size={16} /></Button>
            <Button variant="outline" size="sm" className="ml-1 h-9 shrink-0 rounded-xl bg-card px-4 text-[13px] font-medium shadow-xs" onClick={() => setCurrentDate(new Date())}>Hoje</Button>
            <span className="ml-auto inline-flex h-8 items-center whitespace-nowrap rounded-full bg-slate-soft px-3 text-[13px] font-medium tabular-nums text-slate-soft-foreground">
              {contagem(totalAgendamentosDaSemana, "agendamento", "agendamentos")}
            </span>
          </div>
          {/* Legenda em uma faixa própria para não disputar espaço com o
              período, a contagem e o seletor de visualização. */}
          <div className="mb-2 flex flex-shrink-0 flex-wrap items-center gap-1.5 text-[11px]">
            <span className="mr-1 font-medium text-tertiary">Legenda:</span>
            {legendaAgendamentos.map((item) => (
              <span key={item.texto} className={cn("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 font-medium", item.cor)}>
                <span className="h-2 w-2 shrink-0 rounded-full bg-current" /> {item.texto}
              </span>
            ))}
            {/* Presença (AGENDA-11): coluna própria, independente da cor do
                status — só nas consultas em aberto. */}
            {presencaDisponivel && (
              <>
                <span className="ml-2 mr-1 font-medium text-tertiary">Presença:</span>
                <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full bg-success-soft px-2.5 font-medium text-success-soft-foreground">
                  <CheckCircle2 size={12} className="shrink-0" /> Presença confirmada
                </span>
                <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-sunken px-2.5 font-medium text-muted-foreground">
                  <Circle size={12} className="shrink-0" /> Sem confirmação
                </span>
              </>
            )}
          </div>
          {/* Matrix: Cities (rows) x Weekdays Mon-Sat (columns) */}
          <div className="min-h-0 flex-1 overflow-auto rounded-card border border-border/60 bg-card shadow-card">
            <div className="grid min-w-[820px] [--city-col:124px] sm:min-w-[880px] sm:[--city-col:168px]" style={{ gridTemplateColumns: `var(--city-col) repeat(${apptWeekDays.length}, minmax(116px, 1fr))`, gridTemplateRows: `auto repeat(${apptCities.length}, minmax(64px, auto)) auto` }}>
              {/* Header row: empty corner + day headers */}
              <div className="sticky left-0 top-0 z-20 flex items-end border-b border-r border-border/60 bg-card px-3 py-2 sm:px-4 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
                {unidadesDaAgenda === null ? "" : agendaPorCidade ? "Cidade" : rotuloUnidade}
              </div>
              {apptWeekDays.map(day => (
                <div key={day.toISOString()} className={cn("sticky top-0 z-10 flex flex-col items-center gap-0.5 border-b border-border/60 bg-card px-2 py-2 text-center", isToday(day) && "bg-primary-soft")}>
                  <div className={cn("text-[12px] font-medium uppercase tracking-wide text-tertiary", isToday(day) && "text-primary-soft-fg")}>{format(day, "EEE", { locale: ptBR })}</div>
                  <div className={cn("flex h-8 w-8 items-center justify-center rounded-full font-bold tabular-nums", isToday(day) ? "bg-primary text-[15px] text-primary-foreground shadow-brand" : "text-[20px] text-foreground")}>{format(day, "d")}</div>
                </div>
              ))}

              {/* Data rows: one per city */}
              {apptCities.map(city => (
                <div key={city} className="contents">
                  {/* City label */}
                  <div className="sticky left-0 z-[5] flex flex-col items-start gap-0.5 border-b border-r border-border/60 bg-card px-3 py-2 sm:px-4">
                    <span className="text-[13px] font-semibold leading-snug text-foreground break-words">{city}</span>
                    {/* AGENDA-8: com várias unidades, consulta sem cidade cai
                        aqui — diz onde se resolve. */}
                    {agendaPorCidade && city === SEM_CIDADE && (
                      <span className="text-[11px] leading-snug text-tertiary break-words">
                        Defina a cidade do paciente na conversa
                      </span>
                    )}
                  </div>
                  {/* Cells for each day */}
                  {apptWeekDays.map(day => {
                    const dayKey = format(day, "yyyy-MM-dd");
                    const cellAppts = appointments.filter(a =>
                      a.scheduled_date === dayKey &&
                      (!agendaPorCidade || (a.lead_cidade || SEM_CIDADE) === city)
                    ).sort((a, b) => (a.scheduled_time || "").localeCompare(b.scheduled_time || ""));

                    return (
                      <div key={`${city}-${dayKey}`} className={cn("min-h-16 border-b border-r border-border/40 p-1.5", isToday(day) && "bg-primary-soft/35")}>
                        <div className="space-y-1">
                          {cellAppts.map(appt => {
                            // Status normalizado UMA vez. `desfechoEhComparecimento`
                            // e `rotuloDesfecho` já normalizam por dentro, mas os
                            // ramos daqui comparavam o valor cru: um status com
                            // espaço/caixa diferente entrava no ramo do
                            // comparecimento e, lá dentro, `=== "contracted"`
                            // falhava — a gestão lia ❌ ("não contratou") num lead
                            // contratado. Um valor, uma régua, para cor, ícone e
                            // balão não poderem divergir.
                            const statusNorm = (appt.status ?? "").trim().toLowerCase();
                            const remarcada = !!(appt as any).is_rescheduled;
                            const ehComparecimento = desfechoEhComparecimento(statusNorm);
                            // Os dois desfechos de comparecimento saem do helper:
                            // para a SDR ele devolve a MESMA cor nos dois casos
                            // (decisão D3) e, para os outros papéis, exatamente as
                            // classes que este calendário já usava. AGENDA-16:
                            // status 'rescheduled' (o horário ANTIGO de uma
                            // remarcação) vem antes de is_rescheduled (a consulta
                            // NOVA, roxa) e é tracejado; 'pending' tem cor própria.
                            const statusStyle =
                              ehComparecimento
                                ? corDesfecho(statusNorm, userRole)
                                : statusNorm === "no_show"
                                ? "bg-warning-soft text-warning-soft-foreground border border-warning/30 border-l-warning"
                                : statusNorm === "cancelled"
                                ? "bg-muted text-muted-foreground border border-border line-through border-l-tertiary"
                                : statusNorm === "rescheduled"
                                ? "bg-card text-muted-foreground border border-dashed border-rescheduled/60 border-l-rescheduled shadow-none"
                                : remarcada
                                ? "bg-rescheduled-soft text-rescheduled-soft-foreground border border-rescheduled/30 border-l-rescheduled"
                                : statusNorm === "pending"
                                ? "bg-orange-soft text-orange-soft-foreground border border-orange/30 border-l-orange"
                                : statusNorm === "confirmed"
                                ? "bg-info-soft text-info-soft-foreground border border-info/25 border-l-info"
                                : "bg-slate-soft text-slate-soft-foreground border border-slate/25 border-l-slate";
                            // O ícone segue a mesma regra de sigilo do rótulo: se a
                            // SDR visse 🤝 x ❌, o emoji contaria o contrato. Para
                            // ela os dois desfechos usam o mesmo símbolo neutro.
                            const statusIcon =
                              ehComparecimento
                                ? (escondeDesfechoDeVenda(userRole) ? "✅" : statusNorm === "contracted" ? "🤝" : "❌")
                                : statusNorm === "no_show"
                                ? "🚫"
                                : statusNorm === "cancelled"
                                ? "🗑️"
                                : statusNorm === "rescheduled"
                                ? "↪"
                                : null;
                            // Balão na MESMA ordem de precedência da cor: quando a
                            // consulta veio de uma remarcação o chip pinta roxo, que
                            // na legenda desta tela é "Reagendado". O balão anterior
                            // ignorava is_rescheduled e escrevia "Confirmado" em cima
                            // de um chip roxo — contradizendo a legenda ao lado.
                            // 'confirmed' = agendada (AGENDA-11): o balão diz
                            // "Agendado" e a presença vem da coluna própria.
                            const aberta = consultaAberta(statusNorm);
                            const presencaTitulo = aberta && presencaDisponivel
                              ? (appt.presenca_confirmada_em ? " · Presença confirmada" : " · Sem confirmação de presença")
                              : "";
                            const statusTitulo =
                              (ehComparecimento || statusNorm === "no_show" || statusNorm === "cancelled"
                                ? rotuloDesfecho(statusNorm, userRole)
                                : statusNorm === "rescheduled"
                                ? "Remarcada — horário antigo, não conta no total"
                                : remarcada
                                ? "Reagendado"
                                : statusNorm === "pending"
                                ? "Pendente — aguardando a equipe confirmar o agendamento"
                                : statusNorm === "confirmed"
                                ? "Agendado"
                                : rotuloDesfecho(statusNorm, userRole)) + presencaTitulo;
                            return (
                              <div
                                key={appt.id}
                                className={cn("cursor-pointer rounded-lg px-2 py-1 text-[12px] leading-snug shadow-xs transition-shadow hover:shadow-card", statusStyle, "border-l-[3px]")}
                                title={statusTitulo}
                                onClick={() => {
                                  setSelectedAppointment(appt);
                                  setApptStep("init");
                                  setAntecipar(null);
                                  setApptMoveStageId("");
                                  setApptMovePipelineId("");
                                }}
                              >
                                <div className="font-semibold leading-snug break-words">
                                   {statusIcon && <span className="mr-1">{statusIcon}</span>}
                                   {!statusIcon && remarcada && <span className="mr-1 font-bold text-rescheduled">↻</span>}
                                   {appt.lead_name}
                                 </div>
                                <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] font-medium tabular-nums">
                                  <span className="opacity-75">{appt.scheduled_time?.slice(0, 5)}</span>
                                  {aberta && presencaDisponivel && (
                                    appt.presenca_confirmada_em
                                      ? <span className="inline-flex items-center gap-0.5 text-success-soft-foreground"><CheckCircle2 size={11} className="shrink-0" /> confirmada</span>
                                      : <span className="opacity-75">sem confirmação</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* Totals row: per-day counts */}
              <div className="sticky bottom-0 left-0 z-20 flex items-center border-r border-t border-border/60 bg-card px-3 py-2 sm:px-4 text-[13px] font-semibold text-foreground">
                Total / dia
              </div>
              {apptWeekDays.map(day => {
                const dayKey = format(day, "yyyy-MM-dd");
                const doDia = appointments.filter(a => a.scheduled_date === dayKey);
                // AGENDA-16: o horário antigo de uma remarcação e a cancelada
                // ficam fora do número principal (antes somavam como consultas).
                const dayAppts = doDia.filter(a => !foraDoTotal(a.status));
                const total = dayAppts.length;
                const fora = doDia.length - total;
                const contratados = dayAppts.filter(a => a.status === "contracted").length;
                const naoContratados = dayAppts.filter(a => a.status === "not_contracted").length;
                // Para a SDR os dois desfechos somam um número só: dois contadores
                // separados diriam quantos contrataram, que é justamente o que ela
                // não deve ler (decisão D3).
                const compareceram = dayAppts.filter(a => desfechoEhComparecimento(a.status)).length;
                return (
                  <div
                    key={`totals-${dayKey}`}
                    className={cn(
                      "sticky bottom-0 z-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-border/60 bg-card px-2 py-3 text-center",
                      isToday(day) && "bg-primary-soft",
                    )}
                  >
                    <div className="basis-full text-[12px] font-bold tabular-nums text-foreground">{total} agend.</div>
                    {fora > 0 && (
                      <div className="basis-full text-[11px] tabular-nums text-tertiary">
                        + {fora} {plural(fora, "remarcada ou cancelada", "remarcadas ou canceladas")}
                      </div>
                    )}
                    {escondeDesfechoDeVenda(userRole) ? (
                      <div className="text-[12px] font-semibold tabular-nums text-success-soft-foreground" title={rotuloDesfecho("contracted", userRole)}>✅ {compareceram}</div>
                    ) : (
                      <>
                        <div className="text-[12px] font-semibold tabular-nums text-success-soft-foreground">🤝 {contratados}</div>
                        <div className="text-[12px] font-semibold tabular-nums text-destructive-soft-foreground">❌ {naoContratados}</div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Task detail dialog */}
      <Dialog open={!!selectedTask && !deleteConfirm} onOpenChange={(o) => { if (!o) setSelectedTask(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="pr-6 text-lg font-bold leading-snug tracking-tight break-words">{selectedTask?.title}</DialogTitle></DialogHeader>
          {selectedTask && (() => {
            const st = getTaskStatus(selectedTask);
            const assignedProfile = profiles.find((p) => p.id === selectedTask.assigned_to);
            return (
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={cn("h-6 rounded-full px-2.5 text-[11px] font-medium", statusBg(st))}>{st === "done" ? "Concluída" : st === "late" ? "Atrasada" : "Pendente"}</Badge>
                  <Badge variant="outline" className="h-6 rounded-full border-transparent bg-surface-sunken px-2.5 text-[11px] font-medium text-muted-foreground empty:hidden">{rotuloTipoDeTarefa(selectedTask.type)}</Badge>
                </div>
                <div className="space-y-2.5 rounded-xl bg-surface-sunken p-4">
                <div className="flex items-center font-medium tabular-nums text-foreground">
                  <CalendarDays size={16} className="mr-2 inline shrink-0 text-tertiary" />
                  {format(new Date(selectedTask.due_date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                </div>
                {selectedTask.lead_name && <div className="break-words"><span className="text-muted-foreground">Lead: </span><span className="font-semibold text-foreground">{selectedTask.lead_name}</span></div>}
                {assignedProfile && <div className="break-words"><span className="text-muted-foreground">Responsável: </span><span className="font-semibold text-foreground">{assignedProfile.nome}</span></div>}
                {selectedTask.notes && <p className="!mt-3.5 rounded-lg bg-card p-3 leading-relaxed text-muted-foreground break-words">{selectedTask.notes}</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-10 flex-1 rounded-xl" onClick={() => { setSelectedTask(null); navigate(`/crm/conversa/${selectedTask.lead_id}`); }}>Ir para conversa</Button>
                  {st !== "done" && (
                    <Button size="sm" className="h-10 flex-1 rounded-xl bg-success text-success-foreground hover:bg-success/90" onClick={() => handleMarkDone(selectedTask)}>
                      <CheckCircle2 size={14} className="mr-1" /> Concluir
                    </Button>
                  )}
                </div>
                <Button size="sm" variant="destructive" className="h-10 w-full gap-1 rounded-xl" onClick={() => setDeleteConfirm(selectedTask.id)}>
                  <Trash2 size={14} /> Excluir tarefa
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Delete task confirm */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => { if (!o) setDeleteConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Excluir tarefa?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Esta ação não pode ser desfeita.</p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDeleteTask(deleteConfirm)}>Excluir</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Appointment result dialog */}
      <Dialog open={!!selectedAppointment && !cancelApptFor && !excluirApptFor} onOpenChange={(o) => { if (!o) { setSelectedAppointment(null); setApptStep("init"); setAntecipar(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Resultado do Agendamento</DialogTitle></DialogHeader>
          {selectedAppointment && (() => {
            const appt = selectedAppointment;
            const statusNorm = normStatus(appt.status);
            // 'pending' (criado por bot/API) é consulta ABERTA (AGENDA-16 /
            // CRC-08): nunca "Desfecho já registrado".
            const isOpen = consultaAberta(statusNorm);
            const isPending = statusNorm === "pending";
            const isConfirmed = statusNorm === "confirmed";
            const quando = formatBahiaLabel(appt.scheduled_date, appt.scheduled_time);
            const avisoNovaData = avisoDiaFechado(apptNewDate);
            return (
              <div className="space-y-4">
                <div className="rounded-xl bg-surface-sunken p-4">
                  <p className="text-[15px] font-semibold leading-snug text-foreground break-words">{appt.lead_name}</p>
                  <p className="mt-1 text-[13px] tabular-nums text-muted-foreground first-letter:uppercase">{quando}</p>
                  {/* Presença (AGENDA-11): coluna própria, não o status. */}
                  {isOpen && presencaDisponivel && (
                    appt.presenca_confirmada_em ? (
                      <p className="mt-2 inline-flex flex-wrap items-center gap-1 rounded-full bg-success-soft px-2.5 py-0.5 text-[11px] font-medium text-success-soft-foreground">
                        <CheckCircle2 size={11} className="shrink-0" /> Presença confirmada
                        <span className="font-normal opacity-80">· {presencaTexto(appt)}</span>
                      </p>
                    ) : (
                      <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        <Circle size={11} className="shrink-0" /> Sem confirmação de presença
                      </p>
                    )
                  )}
                </div>

                {/* Desfecho antes do horário (AGENDA-14 / SDR-01). */}
                {isConfirmed && antecipar && (
                  <div className="space-y-2 rounded-xl border border-warning/40 bg-warning-soft px-3.5 py-3">
                    {podeAnteciparDesfecho(userRole, consultaEmDiaFuturo(appt.scheduled_date)) ? (
                      <>
                        <p className="text-[13px] leading-relaxed text-warning-soft-foreground">
                          A consulta é só em {quando} — registrar o resultado agora?
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <Button size="sm" variant="outline" className="h-10 rounded-xl bg-card" disabled={apptBusy} onClick={() => setAntecipar(null)}>Voltar</Button>
                          <Button
                            size="sm"
                            className="h-10 rounded-xl"
                            disabled={apptBusy}
                            onClick={() => {
                              const acao = antecipar.acao;
                              setAntecipar(null);
                              if (acao === "compareceu") executarCompareceu(appt);
                              else handleApptOutcome(appt, "no_show");
                            }}
                          >
                            Registrar agora
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-[13px] leading-relaxed text-warning-soft-foreground">
                          A consulta é só em {quando}. O resultado pode ser registrado a partir do dia da consulta — antes disso, só o gerente.
                        </p>
                        <Button size="sm" variant="outline" className="h-10 w-full rounded-xl bg-card" onClick={() => setAntecipar(null)}>Entendi</Button>
                      </>
                    )}
                  </div>
                )}

                {/* Pendente: a mesma ação do chat — a equipe confirma o
                    agendamento criado pelo bot/API; depois vêm as ações de
                    consulta agendada (CRC-08). */}
                {isPending && (
                  <div className="space-y-2">
                    <p className="rounded-xl bg-orange-soft px-3.5 py-2.5 text-[13px] text-orange-soft-foreground">
                      Aguardando a equipe confirmar o agendamento.
                    </p>
                    <Button size="sm" className="h-10 w-full rounded-xl bg-success text-success-foreground hover:bg-success/90" disabled={apptBusy} onClick={() => handleConfirmarPendente(appt)}>
                      <CheckCircle2 size={14} className="mr-1" /> Confirmar agendamento
                    </Button>
                  </div>
                )}

                {isConfirmed && !antecipar && apptStep === "init" && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      {/* SDR: "Compareceu" fecha o ciclo dela na RPC própria e
                          NÃO abre o segundo passo — ela não decide contrato nem
                          pode ler as duas palavras (mesma regra do chat, em
                          AppointmentConfirmBar.tsx). */}
                      <Button size="sm" className="h-10 rounded-xl bg-success text-success-foreground hover:bg-success/90" disabled={apptBusy} onClick={() => guardarAntecipado(appt, "compareceu", () => executarCompareceu(appt))}>
                        <CheckCircle2 size={14} className="mr-1" /> Compareceu
                      </Button>
                      <Button size="sm" variant="outline" className="h-10 rounded-xl border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive" disabled={apptBusy} onClick={() => guardarAntecipado(appt, "no_show", () => handleApptOutcome(appt, "no_show"))}>
                        Não compareceu
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="outline" className="h-10 rounded-xl" disabled={apptBusy} onClick={() => { setApptStep("reschedule"); setApptNewDate(""); setApptNewTime(appt.scheduled_time?.slice(0, 5) || "09:00"); }}>
                        Reagendar
                      </Button>
                      {/* Um só "Cancelar", com motivo (AGENDA-19 / SDR-11). */}
                      <Button size="sm" variant="ghost" className="h-10 rounded-xl text-muted-foreground" disabled={apptBusy} onClick={() => { setCancelApptFor(appt); setCancelReason(""); }}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}

                {/* Resultado da avaliação (Contratou / Não contratou / Agendou)
                    é da gestão: para a SDR este bloco não é renderizado. */}
                {isConfirmed && apptStep === "compareceu" && !escondeDesfechoDeVenda(userRole) && (
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Resultado da avaliação</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" className="h-10 rounded-xl" disabled={apptBusy} onClick={() => handleApptOutcome(appt, "contracted")}>Contratou</Button>
                      <Button size="sm" variant="outline" className="h-10 rounded-xl" disabled={apptBusy} onClick={() => handleApptOutcome(appt, "not_contracted")}>Não contratou</Button>
                    </div>
                    {/* "Compareceu e agendou" — igual ao chat (AGENDA-14). */}
                    <Button size="sm" variant="outline" className="h-10 w-full rounded-xl border-info/40 text-info-soft-foreground hover:bg-info-soft" disabled={apptBusy} onClick={() => { setApptStep("agendou"); setApptNewDate(""); setApptNewTime("09:00"); }}>
                      <CalendarDays size={14} className="mr-1" /> Agendou
                    </Button>
                    <Button size="sm" variant="ghost" className="w-full text-xs" onClick={() => setApptStep("init")}>← Voltar</Button>
                  </div>
                )}

                {isConfirmed && (apptStep === "reschedule" || apptStep === "agendou") && (
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">
                      {apptStep === "agendou" ? "Nova consulta agendada na clínica" : "Novo horário"}
                    </Label>
                    <Input type="date" aria-label="Data" value={apptNewDate} onChange={(e) => setApptNewDate(e.target.value)} className="h-10 rounded-xl text-sm" />
                    <Input type="time" aria-label="Hora" value={apptNewTime} onChange={(e) => setApptNewTime(e.target.value)} className="h-10 rounded-xl text-sm" />
                    {avisoNovaData && (
                      <p className="text-[11px] leading-snug text-warning-soft-foreground">{avisoNovaData}</p>
                    )}
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setApptStep(apptStep === "agendou" ? "compareceu" : "init")}>Voltar</Button>
                      <Button size="sm" className="flex-1" disabled={apptBusy} onClick={() => (apptStep === "agendou" ? handleApptAgendou(appt) : handleApptReschedule(appt))}>
                        {apptStep === "agendou" ? "Salvar" : "Remarcar"}
                      </Button>
                    </div>
                  </div>
                )}

                {!isOpen && (
                  <p className="rounded-xl bg-muted px-3.5 py-2.5 text-[13px] text-muted-foreground">
                    Desfecho já registrado: {rotuloDesfecho(appt.status, userRole)}.
                  </p>
                )}

                <div>
                  <Label className="text-xs font-semibold">Mover lead para (opcional)</Label>
                  <Select value={apptMovePipelineId} onValueChange={(v) => { setApptMovePipelineId(v); setApptMoveStageId(""); }}>
                    <SelectTrigger className="mt-1.5 h-10 rounded-xl"><SelectValue placeholder="Funil..." /></SelectTrigger>
                    <SelectContent>
                      {crmPipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {apptMovePipelineId && (
                    <Select value={apptMoveStageId} onValueChange={setApptMoveStageId}>
                      <SelectTrigger className="mt-2 h-10 rounded-xl"><SelectValue placeholder="Etapa..." /></SelectTrigger>
                      <SelectContent>
                        {crmStages.filter(s => s.pipeline_id === apptMovePipelineId).map(s => (
                          <SelectItem key={s.id} value={s.id}>
                            <span className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                              {s.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {apptMoveStageId && (
                    <Button size="sm" variant="outline" className="mt-2 h-10 w-full rounded-xl" onClick={() => handleApptMoveStage(appt)}>Mover lead</Button>
                  )}
                </div>

                <Button variant="outline" size="sm" className="h-10 w-full rounded-xl" onClick={() => navigate(`/crm/conversa/${appt.lead_id}`)}>Ir para conversa</Button>

                {/* Reabrir: só a gestão da clínica (AGENDA-1, a régua do
                    gatilho stamp_appointment_update); remarcada e contrato do
                    pagamento/integração não reabrem. */}
                {podeReabrirAgendamento(userRole, appt) && (
                  <Button variant="outline" size="sm" className="h-10 w-full rounded-xl" disabled={apptBusy} onClick={() => handleApptReopen(appt)}>Reabrir</Button>
                )}

                {/* Excluir (AGENDA-19): pede motivo e passa pela RPC
                    sdr_excluir_agendamento — fica no histórico do paciente e sai
                    dos relatórios. Só aparece para quem a RPC aceita (SDR dona
                    do lead, crc e gestão) e nos status que ela aceita. */}
                {podeExcluirAgendamento(userRole, appt) && (
                  <Button variant="destructive" size="sm" className="h-10 w-full rounded-xl" disabled={apptBusy} onClick={() => { setExcluirApptFor(appt); setExcluirMotivo(""); }}>
                    <Trash2 size={14} className="mr-1" /> Excluir agendamento
                  </Button>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Cancelar agendamento com motivo */}
      <Dialog open={!!cancelApptFor} onOpenChange={(o) => { if (!o) { setCancelApptFor(null); setCancelReason(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Cancelar agendamento</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground first-letter:uppercase">
            {cancelApptFor && formatBahiaLabel(cancelApptFor.scheduled_date, cancelApptFor.scheduled_time)}
          </p>
          <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Motivo do cancelamento (obrigatório)" className="min-h-[96px] rounded-xl text-sm" />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => { setCancelApptFor(null); setCancelReason(""); }}>Voltar</Button>
            <Button variant="destructive" size="sm" disabled={apptBusy || cancelReason.trim().length < 3} onClick={handleApptCancel}>
              {apptBusy ? "Cancelando..." : "Cancelar agendamento"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Excluir agendamento com motivo (RPC sdr_excluir_agendamento) */}
      <Dialog open={!!excluirApptFor} onOpenChange={(o) => { if (!o) { setExcluirApptFor(null); setExcluirMotivo(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Excluir agendamento</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground first-letter:uppercase">
            {excluirApptFor && formatBahiaLabel(excluirApptFor.scheduled_date, excluirApptFor.scheduled_time)}
          </p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            O agendamento sai dos relatórios e fica no histórico do paciente, com o motivo.
          </p>
          <Textarea value={excluirMotivo} onChange={(e) => setExcluirMotivo(e.target.value)} placeholder="Motivo da exclusão (obrigatório)" className="min-h-[96px] rounded-xl text-sm" />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => { setExcluirApptFor(null); setExcluirMotivo(""); }}>Voltar</Button>
            <Button variant="destructive" size="sm" disabled={apptBusy || excluirMotivo.trim().length < 3} onClick={handleExcluirAgendamento}>
              {apptBusy ? "Excluindo..." : "Excluir agendamento"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
