import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { applyAppointmentOutcome, applySdrComparecimento } from "@/lib/appointmentOutcome";
import { cancelAppointment, rescheduleAppointment, toastDbError } from "@/lib/appointmentActions";
import { corDesfecho, desfechoEhComparecimento, ehPapelSdr, rotuloDesfecho } from "@/lib/desfechoLabel";

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
};

type Stage = { id: string; name: string; color: string; pipeline_id: string };
type Pipeline = { id: string; name: string };

const typeLabels: Record<string, string> = {
  agendamento: "Agendamento",
  ligacao: "Ligação",
  followup: "Acompanhar",
  personalizado: "Personalizado",
};

const typeIcons: Record<string, any> = {
  agendamento: CalendarDays,
  ligacao: Phone,
  followup: MessageSquare,
  personalizado: Clock,
};

function getTaskStatus(task: Task) {
  if (task.status === "done") return "done";
  if (isPast(new Date(task.due_date))) return "late";
  return "pending";
}

function statusColor(st: string) {
  if (st === "done") return "bg-green-500/20 text-green-600 border-green-500/30";
  if (st === "late") return "bg-destructive/15 text-destructive border-destructive/30";
  return "bg-card text-foreground border-border";
}

function statusBg(st: string) {
  if (st === "done") return "bg-green-500 text-white";
  if (st === "late") return "bg-destructive text-white";
  return "bg-primary/10 text-primary";
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
    const [tasksRes, profilesRes, apptsRes, stagesRes, pipelinesRes] = await Promise.all([
      supabase.from("crm_tasks").select("id, lead_id, title, type, due_date, notes, assigned_to, status, owner_role").order("due_date"),
      supabase.from("profiles").select("id, nome").not("id","in",HIDDEN_USER_IDS_PG),
      supabase.from("crm_appointments").select("id, lead_id, scheduled_date, scheduled_time, status, notes, is_rescheduled, lead_name, lead_cidade").gte("scheduled_date", weekStart).lte("scheduled_date", weekEnd).order("scheduled_date").order("scheduled_time"),
      supabase.from("crm_stages").select("id, name, color, pipeline_id").order("position"),
      supabase.from("crm_pipelines").select("id, name"),
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
  const [currentDate, setCurrentDate] = useState(new Date());
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
  const [deleteApptConfirm, setDeleteApptConfirm] = useState<string | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [apptMoveStageId, setApptMoveStageId] = useState("");
  const [crmStages, setCrmStages] = useState<Stage[]>(() => (_sameUserModuleCache && calendarCache.stages) || _lsInit?.stages || []);
  const [crmPipelines, setCrmPipelines] = useState<Pipeline[]>(() => (_sameUserModuleCache && calendarCache.pipelines) || _lsInit?.pipelines || []);
  const [apptMovePipelineId, setApptMovePipelineId] = useState("");
  const [tenantCities, setTenantCities] = useState<string[]>([]);
  // Desfecho / remarcação / cancelamento do agendamento
  const [apptStep, setApptStep] = useState<"init" | "compareceu" | "reschedule">("init");
  const [apptBusy, setApptBusy] = useState(false);
  const [apptNewDate, setApptNewDate] = useState("");
  const [apptNewTime, setApptNewTime] = useState("09:00");
  const [cancelApptFor, setCancelApptFor] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const isManager = userRole === "gerente" || userRole === "superadmin";

  useEffect(() => {
    (async () => {
      // O closer não lê `clinicas` (policy closer_sem_acesso_clinicas), então a
      // consulta direta volta vazia para ele. A RPC devolve só id/nome/cidade
      // das clínicas ativas do próprio cliente, sem abrir a tabela.
      const { data } = await supabase.from("clinicas").select("cidade").eq("ativa", true);
      let linhas = (data || []) as { cidade: string | null }[];
      if (linhas.length === 0) {
        const { data: viaRpc } = await (supabase as any).rpc("closer_clinicas_do_tenant");
        linhas = (viaRpc || []) as { cidade: string | null }[];
      }
      const unique = Array.from(new Set(linhas.map((c) => c.cidade).filter(Boolean) as string[]));
      setTenantCities(unique);
    })();
  }, []);

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
      supabase.from("crm_tasks").select("id, lead_id, title, type, due_date, notes, assigned_to, status, owner_role").order("due_date"),
      supabase.from("profiles").select("id, nome").not("id","in",HIDDEN_USER_IDS_PG),
      // crm_appointments has denormalized lead_name/lead_cidade columns (populated by triggers)
      // — no join needed, immune to RLS restrictions on crm_leads
      supabase.from("crm_appointments").select("id, lead_id, scheduled_date, scheduled_time, status, notes, is_rescheduled, lead_name, lead_cidade").gte("scheduled_date", weekRange.start).lte("scheduled_date", weekRange.end).order("scheduled_date").order("scheduled_time"),
      supabase.from("crm_stages").select("id, name, color, pipeline_id").order("position"),
      supabase.from("crm_pipelines").select("id, name"),
    ]);

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
    if (error) { toast.error("Erro ao concluir tarefa: " + error.message); return; }
    if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para concluir esta tarefa."); return; }
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: "done" } : t));
    setSelectedTask(null);
  };

  const handleDeleteTask = async (taskId: string) => {
    const { data, error } = await supabase.from("crm_tasks").delete().eq("id", taskId).select("id");
    if (error) { toast.error("Erro ao excluir tarefa: " + error.message); return; }
    if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para excluir esta tarefa."); return; }
    toast.success("Tarefa excluída");
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setSelectedTask(null);
    setDeleteConfirm(null);
  };

  const handleDeleteAppointment = async (apptId: string) => {
    const { data, error } = await supabase.from("crm_appointments").delete().eq("id", apptId).select("id");
    if (error) { toast.error("Erro ao excluir agendamento: " + error.message); return; }
    if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para excluir este agendamento."); return; }
    toast.success("Agendamento excluído");
    setAppointments((prev) => prev.filter((a) => a.id !== apptId));
    setDeleteApptConfirm(null);
  };

  const refreshAppt = (apptId: string, status: string) => {
    setAppointments((prev) => prev.map((a) => a.id === apptId ? { ...a, status } : a));
  };

  const handleApptOutcome = async (appt: Appointment, outcome: "contracted" | "not_contracted" | "no_show") => {
    setApptBusy(true);
    try {
      const ok = await applyAppointmentOutcome({ leadId: appt.lead_id, appointmentId: appt.id, outcome });
      if (!ok) { toast.error("Este agendamento já recebeu desfecho — recarregando"); await fetchTasks(); return; }
      refreshAppt(appt.id, outcome);
      toast.success("Desfecho registrado");
      setSelectedAppointment(null);
    } catch (e) {
      toastDbError(e, "Erro ao registrar desfecho");
    } finally {
      setApptBusy(false);
      setApptStep("init");
    }
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
      const r = await applySdrComparecimento(appt.id);
      if (!r.ok) { toast.error("Este agendamento já recebeu desfecho — recarregando"); await fetchTasks(); return; }
      // Estado local com o status que o banco gravou; o rótulo/cor da tela saem
      // de rotuloDesfecho/corDesfecho, então para ela o card lê "Compareceu".
      refreshAppt(appt.id, "not_contracted");
      toast.success("Comparecimento registrado no seu crédito — o lead continua com você e passa para o administrador ao fim da carência; a etapa não muda agora");
      setSelectedAppointment(null);
    } catch (e) {
      toastDbError(e, "Erro ao registrar comparecimento");
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
      toastDbError(e, "Erro ao remarcar agendamento");
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
      toastDbError(e, "Erro ao cancelar agendamento");
    } finally {
      setApptBusy(false);
    }
  };

  const handleApptReopen = async (appt: Appointment) => {
    setApptBusy(true);
    const { data, error } = await supabase.from("crm_appointments").update({ status: "confirmed" }).eq("id", appt.id).select("id");
    setApptBusy(false);
    if (error) { toastDbError(error, "Erro ao reabrir agendamento"); return; }
    if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para reabrir este agendamento."); return; }
    refreshAppt(appt.id, "confirmed");
    toast.success("Agendamento reaberto");
    setSelectedAppointment(null);
  };

  const handleApptMoveStage = async (appt: Appointment) => {
    if (!apptMoveStageId) return;
    await supabase.from("crm_lead_stage_history")
      .update({ exited_at: new Date().toISOString() })
      .eq("lead_id", appt.lead_id)
      .is("exited_at", null);
    // Mostra o motivo real se o histórico falhar, mas não bloqueia: o passo
    // decisivo é o update do lead logo abaixo, que é conferido.
    const { error: histError } = await supabase.from("crm_lead_stage_history").insert({ lead_id: appt.lead_id, stage_id: apptMoveStageId });
    if (histError) toastDbError(histError, "Erro ao registrar o histórico de etapa");
    const { data, error } = await supabase.from("crm_leads")
      .update({ stage_id: apptMoveStageId, pipeline_id: apptMovePipelineId })
      .eq("id", appt.lead_id)
      .select("id");
    if (error) { toastDbError(error, "Erro ao mover o lead"); return; }
    if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para mover este lead."); return; }
    toast.success("Lead movido de etapa");
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
      if (filterType && t.type !== filterType) return false;
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

  const hours = Array.from({ length: 14 }, (_, i) => i + 7);

  const renderTaskCard = (task: Task, compact = false) => {
    const st = getTaskStatus(task);
    const typeLabel = typeLabels[task.type] || task.type;
    return (
      <div
        key={task.id}
        onClick={() => setSelectedTask(task)}
        className={cn("border rounded-md p-2.5 cursor-pointer hover:shadow-md transition-all", statusColor(st))}
      >
        <div className="font-medium text-sm truncate">{task.lead_name}</div>
        {!compact && (
          <>
            <div className="text-xs text-muted-foreground mt-0.5">{format(new Date(task.due_date), "dd/MM/yyyy HH:mm")}</div>
            <div className="flex items-center gap-1 mt-1 text-xs">
              {st === "late" ? <AlertTriangle size={11} className="text-destructive" /> : st === "done" ? <CheckCircle2 size={11} className="text-green-500" /> : <Circle size={11} className="text-primary" />}
              <span>{typeLabel}</span>
            </div>
            {task.notes && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.title}: {task.notes}</p>}
          </>
        )}
        {compact && (
          <div className="text-[10px] text-muted-foreground truncate mt-0.5">{format(new Date(task.due_date), "HH:mm")} {typeLabel}</div>
        )}
      </div>
    );
  };

  const renderEventsColumn = (title: string, tasks: Task[]) => (
    <div className="flex-1 min-w-[220px] flex flex-col">
      <div className="text-center py-3 border-b border-border">
        <h3 className="text-xs font-bold uppercase tracking-wide text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground">{tasks.length} eventos</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {tasks.length === 0 && <div className="text-center text-xs text-muted-foreground py-8">Nenhum evento</div>}
        {tasks.map((t) => renderTaskCard(t))}
      </div>
    </div>
  );

  const dayTasks = selectedDay ? tasksByDay.get(format(selectedDay, "yyyy-MM-dd")) || [] : [];

  // Appointment week days (Mon-Sat, no Sunday)
  const apptWeekDays = useMemo(() => {
    const all = eachDayOfInterval({
      start: startOfWeek(currentDate, { weekStartsOn: 1 }),
      end: endOfWeek(currentDate, { weekStartsOn: 1 }),
    });
    return all.filter(d => d.getDay() !== 0); // Exclude Sunday
  }, [currentDate]);

  // City rows: start with known cities from clinicas, then add any cities
  // found in this week's appointments (including "Sem cidade" for leads
  // with no cidade set). This prevents appointments from disappearing when
  // a lead's cidade is null or doesn't match a clinica city.
  const apptCities = useMemo(() => {
    const known = new Set(tenantCities);
    const fromAppts = appointments.map(a => a.lead_cidade || "Sem cidade");
    const extra = fromAppts.filter(c => !known.has(c));
    const uniqueExtra = [...new Set(extra)];
    return [...tenantCities, ...uniqueExtra];
  }, [tenantCities, appointments]);

  // Legenda do calendário de agendamentos.
  // Para a SDR, os dois desfechos de comparecimento ('contracted' e
  // 'not_contracted') viram UMA entrada só, "Compareceu" (decisão D3): quem
  // decide contrato é o pagamento, não ela. Duas entradas ensinariam a ler o
  // contrato pela cor — exatamente o que o rótulo esconde. Para os demais
  // papéis os itens continuam sendo os mesmos de antes, na mesma ordem.
  const legendaAgendamentos = useMemo(() => {
    const confirmado = { cor: "bg-blue-500/40 border border-blue-500/60", texto: "Confirmado" };
    const compareceuCor = "bg-emerald-500/40 border border-emerald-500/60";
    const naoCompareceu = { cor: "bg-amber-500/40 border border-amber-500/60", texto: "Não compareceu" };
    const reagendado = { cor: "bg-purple-500/40 border border-purple-500/60", texto: "Reagendado" };
    const cancelado = { cor: "bg-muted border border-border", texto: "Cancelado" };
    if (ehPapelSdr(userRole)) {
      return [
        confirmado,
        { cor: compareceuCor, texto: rotuloDesfecho("contracted", userRole) },
        naoCompareceu,
        reagendado,
        cancelado,
      ];
    }
    return [
      confirmado,
      { cor: compareceuCor, texto: "Contratado" },
      naoCompareceu,
      { cor: "bg-red-500/40 border border-red-500/60", texto: "Não contratou" },
      reagendado,
      cancelado,
    ];
  }, [userRole]);

  return (
    <div className="flex flex-col h-full -m-6 p-4" style={{ height: "calc(100vh - 4rem)" }}>
      {/* MAIN VIEW TOGGLE */}
      <div className="flex items-center gap-3 mb-4 flex-shrink-0">
        <div className="flex bg-secondary rounded-lg p-1 gap-1">
          <Button
            variant={mainView === "agendamentos" ? "default" : "ghost"}
            size="sm"
            className={cn("h-9 px-6 text-sm font-medium", mainView === "agendamentos" && "gradient-orange text-primary-foreground shadow-sm")}
            onClick={() => setMainView("agendamentos")}
          >
            <CalendarDays size={16} className="mr-2" />
            Agendamentos
          </Button>
          <Button
            variant={mainView === "tarefas" ? "default" : "ghost"}
            size="sm"
            className={cn("h-9 px-6 text-sm font-medium", mainView === "tarefas" && "gradient-orange text-primary-foreground shadow-sm")}
            onClick={() => setMainView("tarefas")}
          >
            <Clock size={16} className="mr-2" />
            Tarefas
          </Button>
        </div>
      </div>

      {/* ==================== TAREFAS VIEW ==================== */}
      {mainView === "tarefas" && (
        <>
          {/* Sub-nav */}
          <div className="flex items-center justify-between mb-3 flex-shrink-0 gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              {(["events", "list", "week", "month"] as TaskViewMode[]).map((v) => (
                <Button
                  key={v}
                  variant={taskView === v ? "default" : "ghost"}
                  size="sm"
                  className={cn("h-8 text-xs", taskView === v && "bg-primary text-primary-foreground")}
                  onClick={() => setTaskView(v)}
                >
                  {v === "events" ? "Eventos" : v === "list" ? "Lista" : v === "week" ? "Semana" : "Mês"}
                </Button>
              ))}

              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-8 text-xs w-[120px] ml-2"><SelectValue placeholder="Tipo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="agendamento">Agendamento</SelectItem>
                  <SelectItem value="ligacao">Ligação</SelectItem>
                  <SelectItem value="followup">Follow-up</SelectItem>
                  <SelectItem value="personalizado">Personalizado</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterUser} onValueChange={setFilterUser}>
                <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue placeholder="Responsável" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              {(filterType || filterUser) && (
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFilterType(""); setFilterUser(""); }}>Limpar</Button>
              )}
            </div>
            <span className="text-sm text-muted-foreground">{filtered.length} tarefas</span>
          </div>

          {/* Nav for month/week */}
          {(taskView === "month" || taskView === "week") && (
            <div className="flex items-center gap-2 mb-3 flex-shrink-0">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => nav(-1)}><ChevronLeft size={16} /></Button>
              <h2 className="text-sm font-bold text-foreground min-w-[180px] text-center capitalize">
                {taskView === "month"
                  ? format(currentDate, "MMMM yyyy", { locale: ptBR })
                  : `Sem. ${format(startOfWeek(currentDate, { weekStartsOn: 1 }), "dd MMM", { locale: ptBR })} — ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), "dd MMM yyyy", { locale: ptBR })}`}
              </h2>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => nav(1)}><ChevronRight size={16} /></Button>
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setCurrentDate(new Date())}>Hoje</Button>
            </div>
          )}

          {/* EVENTS */}
          {taskView === "events" && (
            <div className="flex-1 flex gap-px bg-border rounded-lg overflow-hidden min-h-0">
              {renderEventsColumn("Concluídas", eventsView.done)}
              {renderEventsColumn("Atrasadas", eventsView.late)}
              {renderEventsColumn("Hoje", eventsView.today)}
              {renderEventsColumn("Amanhã", eventsView.tomorrow)}
              {renderEventsColumn("Próxima Semana", eventsView.nextWeek)}
            </div>
          )}

          {/* LIST */}
          {taskView === "list" && (
            <div className="flex-1 overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50 sticky top-0 z-10">
                  <tr className="text-left">
                    <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Vencimento</th>
                    <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Responsável</th>
                    <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Lead</th>
                    <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Tipo</th>
                    <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Comentário</th>
                    <th className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.sort((a, b) => new Date(b.due_date).getTime() - new Date(a.due_date).getTime()).map((t) => {
                    const st = getTaskStatus(t);
                    const assignedProfile = profiles.find((p) => p.id === t.assigned_to);
                    return (
                      <tr key={t.id} onClick={() => setSelectedTask(t)} className={cn("cursor-pointer hover:bg-secondary/50 transition-colors", st === "late" && "bg-destructive/5", st === "done" && "bg-green-500/5")}>
                        <td className="px-3 py-2.5 text-xs whitespace-nowrap">{format(new Date(t.due_date), "dd/MM/yyyy HH:mm")}</td>
                        <td className="px-3 py-2.5 text-xs">{assignedProfile?.nome || "—"}</td>
                        <td className="px-3 py-2.5">
                          <button onClick={(e) => { e.stopPropagation(); navigate(`/crm/conversa/${t.lead_id}`); }} className="text-xs text-primary hover:underline font-medium">{t.lead_name}</button>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5 text-xs">
                            {st === "late" ? <AlertTriangle size={12} className="text-destructive" /> : st === "done" ? <CheckCircle2 size={12} className="text-green-500" /> : <Circle size={12} className="text-primary" />}
                            {typeLabels[t.type] || t.type}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[200px] truncate">{t.notes || t.title}</td>
                        <td className="px-3 py-2.5">
                          <Badge variant="outline" className={cn("text-[10px]", st === "done" && "border-green-500 text-green-600", st === "late" && "border-destructive text-destructive")}>
                            {st === "done" ? "Concluída" : st === "late" ? "Atrasada" : "Pendente"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Nenhuma tarefa encontrada</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* MONTH */}
          {taskView === "month" && (
            <>
              <div className="grid grid-cols-7 mb-1 flex-shrink-0">
                {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => (
                  <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 flex-1 gap-px bg-border rounded-lg overflow-hidden">
                {days.map((day) => {
                  const key = format(day, "yyyy-MM-dd");
                  const dayTs = tasksByDay.get(key) || [];
                  const hasLate = dayTs.some((t) => getTaskStatus(t) === "late");
                  const inMonth = isSameMonth(day, currentDate);
                  return (
                    <div key={key} onClick={() => setSelectedDay(day)} className={cn("bg-card p-1 min-h-[90px] cursor-pointer hover:bg-secondary/30 transition-colors relative", !inMonth && "opacity-30", isToday(day) && "ring-1 ring-primary/50", selectedDay && isSameDay(day, selectedDay) && "bg-primary/5")}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={cn("text-xs font-medium", isToday(day) ? "bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center" : "text-foreground")}>{format(day, "d")}</span>
                        {hasLate && <span className="w-2 h-2 rounded-full bg-destructive" />}
                      </div>
                      <div className="space-y-0.5">
                        {dayTs.slice(0, 3).map((t) => {
                          const st = getTaskStatus(t);
                          return (
                            <div key={t.id} onClick={(e) => { e.stopPropagation(); setSelectedTask(t); }} className={cn("text-[10px] px-1 py-0.5 rounded truncate cursor-pointer font-medium", st === "done" && "bg-green-500 text-white", st === "late" && "bg-destructive text-white", st === "pending" && "bg-primary/15 text-foreground")}>
                              {t.lead_name} {format(new Date(t.due_date), "HH:mm")} {typeLabels[t.type]}
                            </div>
                          );
                        })}
                        {dayTs.length > 3 && <div className="text-[9px] text-muted-foreground pl-1">+{dayTs.length - 3}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* WEEK */}
          {taskView === "week" && (
            <>
              <div className="grid flex-shrink-0" style={{ gridTemplateColumns: "50px repeat(7, 1fr)" }}>
                <div />
                {days.map((day) => (
                  <div key={day.toISOString()} className={cn("text-center py-2 text-xs font-medium border-b border-border", isToday(day) && "text-primary")}>
                    <div>{format(day, "EEE", { locale: ptBR })}</div>
                    <div className={cn("text-sm font-bold", isToday(day) && "bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center mx-auto")}>{format(day, "d")}</div>
                  </div>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="grid" style={{ gridTemplateColumns: "50px repeat(7, 1fr)" }}>
                  {hours.map((hour) => (
                    <div key={hour} className="contents">
                      <div className="text-[10px] text-muted-foreground text-right pr-2 pt-1 border-r border-border h-[60px]">{String(hour).padStart(2, "0")}:00</div>
                      {days.map((day) => {
                        const key = format(day, "yyyy-MM-dd");
                        const hourTasks = (tasksByDay.get(key) || []).filter((t) => new Date(t.due_date).getHours() === hour);
                        return (
                          <div key={`${key}-${hour}`} className="border-r border-b border-border h-[60px] p-0.5 relative">
                            {hourTasks.map((t) => {
                              const st = getTaskStatus(t);
                              return (
                                <div key={t.id} onClick={() => setSelectedTask(t)} className={cn("text-[9px] px-1 py-0.5 rounded cursor-pointer truncate mb-0.5 font-medium", st === "done" && "bg-green-500 text-white", st === "late" && "bg-destructive text-white", st === "pending" && "bg-primary/15 text-foreground")}>
                                  {t.lead_name}, {typeLabels[t.type]}
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
            </>
          )}

          {/* Day summary (month) */}
          {taskView === "month" && selectedDay && dayTasks.length > 0 && (
            <div className="mt-3 p-3 bg-card border border-border rounded-lg flex-shrink-0 max-h-[200px] overflow-y-auto">
              <h3 className="text-sm font-medium text-foreground mb-2">Tarefas de {format(selectedDay, "dd 'de' MMMM", { locale: ptBR })}</h3>
              <div className="space-y-1.5">
                {dayTasks.map((t) => {
                  const st = getTaskStatus(t);
                  const Icon = typeIcons[t.type] || Clock;
                  return (
                    <div key={t.id} onClick={() => setSelectedTask(t)} className="flex items-center gap-2 p-2 rounded-md bg-secondary/50 text-xs cursor-pointer hover:bg-secondary transition-colors">
                      {st === "done" ? <CheckCircle2 size={14} className="text-green-500" /> : st === "late" ? <AlertTriangle size={14} className="text-destructive" /> : <Circle size={14} className="text-primary" />}
                      <Icon size={12} className="text-muted-foreground" />
                      <span className="flex-1 truncate font-medium">{t.lead_name} — {t.title}</span>
                      <span className={cn("text-muted-foreground", st === "late" && "text-destructive")}>{format(new Date(t.due_date), "HH:mm")}</span>
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
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-3 flex-shrink-0">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentDate(prev => addDays(prev, -7))}><ChevronLeft size={16} /></Button>
            <h2 className="text-sm font-bold text-foreground min-w-[200px] text-center capitalize">
              {format(startOfWeek(currentDate, { weekStartsOn: 1 }), "dd MMM", { locale: ptBR })} — {format(endOfWeek(currentDate, { weekStartsOn: 1 }), "dd MMM yyyy", { locale: ptBR })}
            </h2>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentDate(prev => addDays(prev, 7))}><ChevronRight size={16} /></Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setCurrentDate(new Date())}>Hoje</Button>
            <span className="text-sm text-muted-foreground ml-auto">
              {appointments.filter(a => {
                const ws = format(startOfWeek(currentDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
                const we = format(endOfWeek(currentDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
                return a.scheduled_date >= ws && a.scheduled_date <= we;
              }).length} agendamentos
            </span>
          </div>
          {/* Legenda de cores */}
          <div className="flex items-center gap-3 mb-2 flex-shrink-0 flex-wrap text-[11px]">
            <span className="text-muted-foreground font-medium">Legenda:</span>
            {legendaAgendamentos.map((item) => (
              <span key={item.texto} className="flex items-center gap-1">
                <span className={cn("w-3 h-3 rounded", item.cor)} /> {item.texto}
              </span>
            ))}
          </div>
          {/* Matrix: Cities (rows) x Weekdays Mon-Sat (columns) */}
          <div className="flex-1 overflow-auto rounded-lg border border-border">
            <div className="grid min-w-[700px]" style={{ gridTemplateColumns: `140px repeat(${apptWeekDays.length}, 1fr)` }}>
              {/* Header row: empty corner + day headers */}
              <div className="bg-secondary/70 border-b border-r border-border p-2 text-xs font-semibold text-muted-foreground uppercase sticky top-0 z-10">
                Cidade
              </div>
              {apptWeekDays.map(day => (
                <div key={day.toISOString()} className={cn("bg-secondary/70 border-b border-border p-2 text-center sticky top-0 z-10", isToday(day) && "bg-primary/10")}>
                  <div className="text-xs font-medium text-muted-foreground">{format(day, "EEE", { locale: ptBR })}</div>
                  <div className={cn("text-sm font-bold", isToday(day) ? "bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center mx-auto" : "text-foreground")}>{format(day, "d")}</div>
                </div>
              ))}

              {/* Data rows: one per city */}
              {apptCities.map(city => (
                <div key={city} className="contents">
                  {/* City label */}
                  <div className="bg-card border-b border-r border-border p-2 flex items-start">
                    <span className="text-xs font-semibold text-foreground">{city}</span>
                  </div>
                  {/* Cells for each day */}
                  {apptWeekDays.map(day => {
                    const dayKey = format(day, "yyyy-MM-dd");
                    const cellAppts = appointments.filter(a =>
                      a.scheduled_date === dayKey &&
                      (a.lead_cidade || "Sem cidade") === city
                    ).sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));

                    return (
                      <div key={`${city}-${dayKey}`} className={cn("bg-card border-b border-border p-1.5 min-h-[80px]", isToday(day) && "bg-primary/5")}>
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
                            // classes que este calendário já usava. Os demais
                            // ramos ficam como estavam — inclusive a precedência
                            // de is_rescheduled sobre 'confirmed'.
                            const statusStyle =
                              ehComparecimento
                                ? corDesfecho(statusNorm, userRole)
                                : statusNorm === "no_show"
                                ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/50"
                                : statusNorm === "cancelled"
                                ? "bg-muted text-muted-foreground border border-border line-through"
                                : remarcada
                                ? "bg-purple-500/15 text-purple-700 dark:text-purple-400 border border-purple-500/30"
                                : statusNorm === "confirmed"
                                ? "bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30"
                                : "bg-primary/10 text-foreground border border-border";
                            // O ícone segue a mesma regra de sigilo do rótulo: se a
                            // SDR visse 🤝 x ❌, o emoji contaria o contrato. Para
                            // ela os dois desfechos usam o mesmo símbolo neutro.
                            const statusIcon =
                              ehComparecimento
                                ? (ehPapelSdr(userRole) ? "✅" : statusNorm === "contracted" ? "🤝" : "❌")
                                : statusNorm === "no_show"
                                ? "🚫"
                                : statusNorm === "cancelled"
                                ? "🗑️"
                                : null;
                            // Balão na MESMA ordem de precedência da cor: quando a
                            // consulta veio de uma remarcação o chip pinta roxo, que
                            // na legenda desta tela é "Reagendado". O balão anterior
                            // ignorava is_rescheduled e escrevia "Confirmado" em cima
                            // de um chip roxo — contradizendo a legenda ao lado.
                            const statusTitulo =
                              ehComparecimento || statusNorm === "no_show" || statusNorm === "cancelled"
                                ? rotuloDesfecho(statusNorm, userRole)
                                : remarcada
                                ? "Reagendado"
                                : rotuloDesfecho(statusNorm, userRole);
                            return (
                              <div
                                key={appt.id}
                                className={cn("text-[10px] px-1.5 py-1 rounded transition-colors cursor-pointer hover:shadow-sm", statusStyle)}
                                title={statusTitulo}
                                onClick={() => {
                                  setSelectedAppointment(appt);
                                  setApptStep("init");
                                  setApptMoveStageId("");
                                  setApptMovePipelineId("");
                                }}
                              >
                                <div className="font-medium break-words leading-tight">
                                   {statusIcon && <span className="mr-0.5">{statusIcon}</span>}
                                   {!statusIcon && remarcada && <span className="text-purple-500 mr-0.5">↻</span>}
                                   {appt.lead_name}
                                 </div>
                                <div className="opacity-70">{appt.scheduled_time?.slice(0, 5)}</div>
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
              <div className="bg-secondary/70 border-t-2 border-r border-border p-2 text-xs font-semibold text-foreground sticky bottom-0 z-10">
                Total / dia
              </div>
              {apptWeekDays.map(day => {
                const dayKey = format(day, "yyyy-MM-dd");
                const dayAppts = appointments.filter(a => a.scheduled_date === dayKey);
                const total = dayAppts.length;
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
                      "bg-secondary/70 border-t-2 border-border p-2 text-center sticky bottom-0 z-10 space-y-0.5",
                      isToday(day) && "bg-primary/10",
                    )}
                  >
                    <div className="text-[10px] font-bold text-foreground">{total} agend.</div>
                    {ehPapelSdr(userRole) ? (
                      <div className="text-[10px] text-emerald-700 dark:text-emerald-300" title={rotuloDesfecho("contracted", userRole)}>✅ {compareceram}</div>
                    ) : (
                      <>
                        <div className="text-[10px] text-emerald-700 dark:text-emerald-300">🤝 {contratados}</div>
                        <div className="text-[10px] text-red-700 dark:text-red-300">❌ {naoContratados}</div>
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
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{selectedTask?.title}</DialogTitle></DialogHeader>
          {selectedTask && (() => {
            const st = getTaskStatus(selectedTask);
            const assignedProfile = profiles.find((p) => p.id === selectedTask.assigned_to);
            return (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge className={cn(statusBg(st))}>{st === "done" ? "Concluída" : st === "late" ? "Atrasada" : "Pendente"}</Badge>
                  <Badge variant="outline">{typeLabels[selectedTask.type]}</Badge>
                </div>
                <div className="text-muted-foreground">
                  <CalendarDays size={14} className="inline mr-1" />
                  {format(new Date(selectedTask.due_date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                </div>
                {selectedTask.lead_name && <div><span className="text-muted-foreground">Lead: </span><span className="font-medium">{selectedTask.lead_name}</span></div>}
                {assignedProfile && <div><span className="text-muted-foreground">Responsável: </span><span className="font-medium">{assignedProfile.nome}</span></div>}
                {selectedTask.notes && <p className="text-muted-foreground bg-secondary/50 p-2 rounded">{selectedTask.notes}</p>}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => { setSelectedTask(null); navigate(`/crm/conversa/${selectedTask.lead_id}`); }}>Ir para conversa</Button>
                  {st !== "done" && (
                    <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={() => handleMarkDone(selectedTask)}>
                      <CheckCircle2 size={14} className="mr-1" /> Concluir
                    </Button>
                  )}
                </div>
                <Button size="sm" variant="destructive" className="w-full gap-1" onClick={() => setDeleteConfirm(selectedTask.id)}>
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

      {/* Delete appointment confirm */}
      <Dialog open={!!deleteApptConfirm} onOpenChange={(o) => { if (!o) setDeleteApptConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Excluir agendamento?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Esta ação não pode ser desfeita.</p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="outline" onClick={() => setDeleteApptConfirm(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteApptConfirm && handleDeleteAppointment(deleteApptConfirm)}>Excluir</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Appointment result dialog */}
      <Dialog open={!!selectedAppointment && !cancelApptFor} onOpenChange={(o) => { if (!o) { setSelectedAppointment(null); setApptStep("init"); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Resultado do Agendamento</DialogTitle></DialogHeader>
          {selectedAppointment && (() => {
            const appt = selectedAppointment;
            const isOpen = appt.status === "confirmed";
            return (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium">{appt.lead_name}</p>
                  <p className="text-xs text-muted-foreground">{appt.scheduled_date} às {appt.scheduled_time?.slice(0, 5)}</p>
                </div>

                {isOpen && apptStep === "init" && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      {/* SDR: "Compareceu" fecha o ciclo dela na RPC própria e
                          NÃO abre o segundo passo — ela não decide contrato nem
                          pode ler as duas palavras (mesma regra do chat, em
                          AppointmentConfirmBar.tsx). */}
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" disabled={apptBusy} onClick={() => ehPapelSdr(userRole) ? handleApptComparecimentoSdr(appt) : setApptStep("compareceu")}>
                        <CheckCircle2 size={14} className="mr-1" /> Compareceu
                      </Button>
                      <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" disabled={apptBusy} onClick={() => handleApptOutcome(appt, "no_show")}>
                        Não compareceu
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="outline" disabled={apptBusy} onClick={() => { setApptStep("reschedule"); setApptNewDate(""); setApptNewTime("09:00"); }}>
                        Reagendar
                      </Button>
                      <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={apptBusy} onClick={() => { setCancelApptFor(appt); setCancelReason(""); }}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}

                {/* Resultado da avaliação (Contratou / Não contratou) é da
                    gestão: para a SDR este bloco não é renderizado. */}
                {isOpen && apptStep === "compareceu" && !ehPapelSdr(userRole) && (
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Resultado da avaliação</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" disabled={apptBusy} onClick={() => handleApptOutcome(appt, "contracted")}>Contratou</Button>
                      <Button size="sm" variant="outline" disabled={apptBusy} onClick={() => handleApptOutcome(appt, "not_contracted")}>Não contratou</Button>
                    </div>
                    <Button size="sm" variant="ghost" className="w-full text-xs" onClick={() => setApptStep("init")}>← Voltar</Button>
                  </div>
                )}

                {isOpen && apptStep === "reschedule" && (
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Novo horário</Label>
                    <Input type="date" value={apptNewDate} onChange={(e) => setApptNewDate(e.target.value)} className="h-8 text-xs" />
                    <Input type="time" value={apptNewTime} onChange={(e) => setApptNewTime(e.target.value)} className="h-8 text-xs" />
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setApptStep("init")}>Voltar</Button>
                      <Button size="sm" className="flex-1" disabled={apptBusy} onClick={() => handleApptReschedule(appt)}>Remarcar</Button>
                    </div>
                  </div>
                )}

                {!isOpen && (
                  <p className="text-xs text-muted-foreground">
                    Desfecho já registrado: {rotuloDesfecho(appt.status, userRole)}.
                  </p>
                )}

                <div>
                  <Label className="text-xs font-semibold">Mover lead para (opcional)</Label>
                  <Select value={apptMovePipelineId} onValueChange={(v) => { setApptMovePipelineId(v); setApptMoveStageId(""); }}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Funil..." /></SelectTrigger>
                    <SelectContent>
                      {crmPipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {apptMovePipelineId && (
                    <Select value={apptMoveStageId} onValueChange={setApptMoveStageId}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Etapa..." /></SelectTrigger>
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
                    <Button size="sm" variant="outline" className="w-full mt-2" onClick={() => handleApptMoveStage(appt)}>Mover lead</Button>
                  )}
                </div>

                <Button variant="outline" size="sm" className="w-full" onClick={() => navigate(`/crm/conversa/${appt.lead_id}`)}>Ir para conversa</Button>

                {!isOpen && isManager && (
                  <Button variant="outline" size="sm" className="w-full" disabled={apptBusy} onClick={() => handleApptReopen(appt)}>Reabrir</Button>
                )}

                {/* Excluir é direito de todo papel para agendamento ABERTO
                    (decisão de 31/08); com desfecho registrado, só gerência —
                    o banco protege a régua com um gatilho, e aqui o botão
                    acompanha para não oferecer o que será recusado. */}
                {isOpen && (
                  <Button variant="destructive" size="sm" className="w-full" onClick={() => { setCancelApptFor(appt); setCancelReason(""); }}>
                    Cancelar agendamento
                  </Button>
                )}
                {(isManager || isOpen) && (
                  <Button variant="destructive" size="sm" className="w-full" onClick={() => { setDeleteApptConfirm(appt.id); setSelectedAppointment(null); }}>
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
          <p className="text-xs text-muted-foreground">
            {cancelApptFor && `${cancelApptFor.scheduled_date} às ${cancelApptFor.scheduled_time?.slice(0, 5)}`}
          </p>
          <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Motivo do cancelamento (obrigatório)" className="text-sm" />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => { setCancelApptFor(null); setCancelReason(""); }}>Voltar</Button>
            <Button variant="destructive" size="sm" disabled={apptBusy || cancelReason.trim().length < 3} onClick={handleApptCancel}>
              {apptBusy ? "Cancelando..." : "Cancelar agendamento"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
