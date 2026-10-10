import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { contaComoLeadNovo } from "@/lib/leadNovo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CalendarDays, Phone, MessageSquare, Clock, CheckCircle2, AlertTriangle,
  Circle, CalendarIcon, ClipboardCheck, ListTodo, Bell, Users, RefreshCw, DollarSign,
  AlertCircle, XCircle, Handshake
} from "lucide-react";
import { format, isToday, isPast, startOfDay, isSameDay, addDays, isAfter, isBefore } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { registrarDesfechoDaConsulta } from "@/lib/appointmentOutcome";
// toastDbError mostra a mensagem que o gatilho do banco devolveu (em vez de um
// "erro" genérico) quando o desfecho falha no meio do caminho.
import { toastDbError } from "@/lib/appointmentActions";
import { useAuth } from "@/contexts/AuthContext";
import { versaoDosPaineis, aoInvalidarPaineis } from "@/lib/paineis";
import { rotuloTipoDeTarefa } from "@/lib/tarefaTipo";
// Fundação canônica: datas no fuso do tenant (tenants.timezone), não do navegador
// e paginação com ORDER BY estável que lança erro em vez de truncar silenciosamente.
import { fetchAllPaged, rangeNoFuso, hojeNoFuso, contaComoFaturamento } from "@/lib/reportKit";

type Task = {
  id: string;
  lead_id: string;
  title: string;
  type: string;
  due_date: string;
  notes: string | null;
  status: string;
  assigned_to?: string | null;
  owner_role?: string | null;
  lead_name?: string;
};

type Appointment = {
  id: string;
  lead_id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  notes: string | null;
  lead_name?: string;
  is_rescheduled?: boolean;
};


// ── Cache stale-while-revalidate ─────────────────────────────────────────────
type DashboardCacheData = {
  tasks: Task[];
  appointments: Appointment[];
  leadsToday: number;
  faturamentoMes: number;
};
// v2: chave inclui user.id para isolar caches entre usuários
const _dashCache: { userId: string | null; data: DashboardCacheData | null; ts: number; versao: number } = {
  userId: null, data: null, ts: 0, versao: -1,
};
const DASH_CACHE_TTL = 5 * 60_000; // 5 min — navegação volta instantânea
// v3 (14/09/2026): "Faturamento do mês" passou a usar a régua de faturamento de
// marketing (mesma do Dashboard principal). Versão nova para o cache antigo não
// continuar mostrando o total bruto.
const DASH_LS_KEY = "crm:dashboard_cache_v5";
const DASH_LS_TTL = 15 * 60_000;
// Janela de dados de tarefas/agendamentos: ±60 dias a partir de hoje (explicitada na UI)
const DASH_WINDOW_DAYS = 60;

/** Invalida o cache em memória E no localStorage (sem userId, limpa o de todos os usuários). */
export const invalidateDashboardCache = (userId?: string | null) => {
  _dashCache.userId = null; _dashCache.data = null; _dashCache.ts = 0;
  try {
    if (userId) {
      localStorage.removeItem(`${DASH_LS_KEY}:${userId}`);
    } else {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(`${DASH_LS_KEY}:`)) localStorage.removeItem(k);
      }
    }
  } catch { /* localStorage indisponível */ }
};

function readDashCache(userId: string | null | undefined): DashboardCacheData | null {
  if (!userId) return null;
  if (_dashCache.userId === userId && _dashCache.data && _dashCache.versao === versaoDosPaineis() && Date.now() - _dashCache.ts < DASH_CACHE_TTL) {
    return _dashCache.data;
  }
  try {
    const raw = localStorage.getItem(`${DASH_LS_KEY}:${userId}`);
    if (!raw) return null;
    const { data, ts, versao } = JSON.parse(raw);
    if (Date.now() - ts > DASH_LS_TTL) return null;
    if (versao !== versaoDosPaineis()) return null;
    return data as DashboardCacheData;
  } catch { return null; }
}

function writeDashCache(userId: string | null | undefined, data: DashboardCacheData): void {
  if (!userId) return;
  _dashCache.userId = userId;
  _dashCache.data = data;
  _dashCache.ts = Date.now();
  _dashCache.versao = versaoDosPaineis();
  try { localStorage.setItem(`${DASH_LS_KEY}:${userId}`, JSON.stringify({ data, ts: Date.now(), versao: _dashCache.versao })); } catch {}
}

/** Carrega tarefas, agendamentos, leads de hoje e faturamento do mês.
 *  Fonte ÚNICA usada pelo prefetch e pela tela (evita divergência entre os dois caminhos).
 *  Lança erro em qualquer falha de query: erro NUNCA vira zero silencioso nem entra no cache. */
async function loadDashboardData(
  userId: string | null | undefined,
  userRole: string | null | undefined,
): Promise<DashboardCacheData> {
  // "Hoje" e mês corrente no fuso da clínica (tenants.timezone), não no do navegador
  const hoje = hojeNoFuso(); // YYYY-MM-DD
  const [hYear, hMonth] = hoje.split("-").map(Number);
  const monthStart = `${hoje.slice(0, 7)}-01`;
  const monthEnd = format(new Date(hYear, hMonth, 0), "yyyy-MM-dd");
  // Janelas estreitas: tarefas ativas + agendamentos recentes/próximos (±DASH_WINDOW_DAYS dias)
  const taskWindowStart = format(addDays(new Date(), -DASH_WINDOW_DAYS), "yyyy-MM-dd");
  const apptWindowStart = taskWindowStart;
  const apptWindowEnd = format(addDays(new Date(), DASH_WINDOW_DAYS), "yyyy-MM-dd");
  // Leads de hoje: dia inteiro no fuso do tenant, inclusivo até 23:59:59.999
  const leadsBounds = rangeNoFuso(hoje, hoje);

  const [tasksAll, appointmentsAll, leadsHoje, pagamentosAll] = await Promise.all([
    fetchAllPaged<Task>(() => supabase.from("crm_tasks").select("*").neq("status", "done").gte("due_date", taskWindowStart), "id"),
    fetchAllPaged<Appointment>(() => supabase.from("crm_appointments").select("*").gte("scheduled_date", apptWindowStart).lte("scheduled_date", apptWindowEnd), "id"),
    // Lead novo pela regra única do banco: a coluna calculada eh_lead_novo vem no
    // select e a contagem é feita aqui (ver leadNovo.ts).
    fetchAllPaged<{ id: string; eh_lead_novo?: boolean | null }>(
      () => supabase.from("crm_leads").select("id, eh_lead_novo" as "*").gte("created_at", leadsBounds.gteIso).lte("created_at", leadsBounds.lteIso) as never,
      "id",
    ),
    // As duas marcas vêm junto com o valor porque é o que separa faturamento de
    // MARKETING do caixa bruto (ver contaComoFaturamento). Sem elas o card
    // mostrava R$ 92.742 onde o Dashboard principal mostrava R$ 79.212 — o
    // mesmo mês, dois números, e nenhum dos dois dizia qual era qual.
    fetchAllPaged<{ valor: number | string | null; recorrencia_orto: boolean | null; nao_marketing: boolean | null }>(
      // Até HOJE: parcela lançada para data futura ainda não foi recebida (mesma
      // régua do Dashboard principal, que mostra "pagamentos recebidos").
      () => supabase.from("pagamentos").select("valor, recorrencia_orto, nao_marketing").gte("data_pagamento", monthStart).lte("data_pagamento", hoje < monthEnd ? hoje : monthEnd),
      "id",
    ),
  ]);
  // fetchAllPaged lança erro em qualquer falha (nunca vira zero silencioso).
  const leadsTodayCount = leadsHoje.filter(contaComoLeadNovo).length;

  // Buscar só os nomes dos leads referenciados (em vez de TODOS os leads)
  const refIds = Array.from(new Set([
    ...tasksAll.map((t) => t.lead_id),
    ...appointmentsAll.map((a) => a.lead_id),
  ].filter(Boolean)));
  const nameMap = new Map<string, string>();
  const CHUNK = 200;
  for (let i = 0; i < refIds.length; i += CHUNK) {
    const chunk = refIds.slice(i, i + CHUNK);
    const { data: leadsChunk } = await supabase.from("crm_leads").select("id, name").in("id", chunk);
    (leadsChunk || []).forEach((l: any) => nameMap.set(l.id, l.name));
  }

  const isPrivileged = userRole === "crc" || userRole === "gerente" || userRole === "superadmin";
  const tasks = tasksAll
    .filter((t) => {
      if (isPrivileged || !userRole) return true;
      return t.owner_role === userRole || t.assigned_to === userId;
    })
    // Paginação é por id (estável); a ordem de exibição por vencimento é aplicada aqui
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
  tasks.forEach((t) => (t.lead_name = nameMap.get(t.lead_id) || "Lead"));

  const appointments = [...appointmentsAll].sort((a, b) => {
    const cmp = a.scheduled_date.localeCompare(b.scheduled_date);
    return cmp !== 0 ? cmp : (a.scheduled_time || "").localeCompare(b.scheduled_time || "");
  });
  appointments.forEach((a) => (a.lead_name = nameMap.get(a.lead_id) || "Lead"));

  // Faturamento do mês = a MESMA régua do Dashboard principal e dos relatórios
  // (contaComoFaturamento): fora manutenção de ortodontia e pagamento marcado
  // como não-marketing. Antes somava tudo, e o card divergia do Dashboard em
  // R$ 13.530,00 no mês (decisão do dono em 14/09/2026: um número só).
  const faturamentoMes = pagamentosAll
    .filter(contaComoFaturamento)
    .reduce((s, p) => s + Number(p.valor || 0), 0);

  return { tasks, appointments, leadsToday: leadsTodayCount, faturamentoMes };
}

/** Pré-carrega os dados do dashboard.
 *  Popula o cache em memória + localStorage para tornar a primeira renderização instantânea. */
export const prefetchCrmDashboardData = async (
  userId: string | null | undefined,
  userRole: string | null | undefined,
): Promise<void> => {
  if (!userId) return;
  // Cache fresco: nada a fazer.
  if (_dashCache.userId === userId && _dashCache.data && _dashCache.versao === versaoDosPaineis() && Date.now() - _dashCache.ts < DASH_CACHE_TTL) return;
  try {
    const data = await loadDashboardData(userId, userRole);
    writeDashCache(userId, data);
  } catch (e) {
    // Erro NÃO entra no cache: a tela refaz o fetch e mostra o estado de erro.
    console.warn("[prefetchCrmDashboardData] falhou:", e);
  }
};

export default function CrmDashboard() {
  const navigate = useNavigate();
  const { user, userRole } = useAuth();
  // Inicialização lazy: lê cache uma vez, evitando spinner quando há dados
  const [tasks, setTasks] = useState<Task[]>(() => readDashCache(user?.id)?.tasks || []);
  const [appointments, setAppointments] = useState<Appointment[]>(() => readDashCache(user?.id)?.appointments || []);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(() => !readDashCache(user?.id));
  const [upcomingDays, setUpcomingDays] = useState("7");
  const [leadsToday, setLeadsToday] = useState(() => readDashCache(user?.id)?.leadsToday || 0);
  const [faturamentoMes, setFaturamentoMes] = useState(() => readDashCache(user?.id)?.faturamentoMes || 0);
  // Estado de erro explícito: falha de query NUNCA vira R$0/0 silencioso
  const [loadError, setLoadError] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(() => !!readDashCache(user?.id));

  const fetchData = useCallback(async () => {
    // Cache do mesmo usuário: aplica na hora (sem spinner) e busca SEMPRE em segundo plano.
    const cached = readDashCache(user?.id);
    if (cached) {
      setTasks(cached.tasks);
      setAppointments(cached.appointments);
      setLeadsToday(cached.leadsToday);
      setFaturamentoMes(cached.faturamentoMes);
      setDataLoaded(true);
      setLoading(false);
    }
    try {
      const data = await loadDashboardData(user?.id, userRole);
      writeDashCache(user?.id, data);
      setTasks(data.tasks);
      setAppointments(data.appointments);
      setLeadsToday(data.leadsToday);
      setFaturamentoMes(data.faturamentoMes);
      setDataLoaded(true);
      setLoadError(false);
    } catch (e) {
      // Erro NÃO entra no cache nem vira zero: mostra estado de erro na tela
      console.error("[CrmDashboard] fetchData falhou:", e);
      setLoadError(true);
      toast.error("Erro ao carregar os dados do dashboard");
    } finally {
      setLoading(false);
    }
  }, [user?.id, userRole]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => aoInvalidarPaineis(() => { invalidateDashboardCache(user?.id); fetchData(); }), [fetchData, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const agenda = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { invalidateDashboardCache(user?.id); fetchData(); }, 800);
    };
    const channel = supabase
      .channel(`crm-dashboard-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_appointments" }, agenda)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_tasks" }, agenda)
      .on("postgres_changes", { event: "*", schema: "public", table: "pagamentos" }, agenda)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "crm_leads" }, agenda)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [fetchData, user?.id]);

  const todayTasks = useMemo(() =>
    tasks.filter(t => t.status !== "done" && isSameDay(new Date(t.due_date), selectedDate)),
  [tasks, selectedDate]);

  const overdueTasks = useMemo(() =>
    tasks.filter(t => t.status !== "done" && isPast(new Date(t.due_date)) && !isToday(new Date(t.due_date))),
  [tasks]);

  const pendingConfirmations = useMemo(() =>
    tasks.filter(t => t.status !== "done" && t.type === "agendamento"),
  [tasks]);

  const dayAppointments = useMemo(() =>
    appointments.filter(a => a.scheduled_date === format(selectedDate, "yyyy-MM-dd")),
  [appointments, selectedDate]);

  // Reagendados do MÊS CORRENTE (filtrado por scheduled_date; mês no fuso do tenant)
  // Padronizado com Dashboard.tsx: fonte = crm_appointments + is_rescheduled + scheduled_date no período
  const rescheduledCount = useMemo(() => {
    const hoje = hojeNoFuso();
    const [hYear, hMonth] = hoje.split("-").map(Number);
    const mStart = `${hoje.slice(0, 7)}-01`;
    const mEnd = format(new Date(hYear, hMonth, 0), "yyyy-MM-dd");
    return appointments.filter(a =>
      (a as any).is_rescheduled === true &&
      a.scheduled_date >= mStart &&
      a.scheduled_date <= mEnd
    ).length;
  }, [appointments]);

  const upcomingAppointments = useMemo(() => {
    const today = startOfDay(new Date());
    const endDate = addDays(today, parseInt(upcomingDays));
    return appointments
      .filter(a => {
        const d = new Date(a.scheduled_date + "T12:00:00");
        return (isSameDay(d, today) || isAfter(d, today)) && isBefore(d, endDate);
      })
      .sort((a, b) => {
        const cmp = a.scheduled_date.localeCompare(b.scheduled_date);
        return cmp !== 0 ? cmp : a.scheduled_time.localeCompare(b.scheduled_time);
      });
  }, [appointments, upcomingDays]);

  // Agendamentos vencidos sem desfecho ("hoje" no fuso do tenant)
  const awaitingOutcome = useMemo(() => {
    const todayStr = hojeNoFuso();
    return appointments
      .filter(a => a.scheduled_date < todayStr && a.status === "confirmed")
      .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
  }, [appointments]);

  const [outcomeStep, setOutcomeStep] = useState<Record<string, "init" | "compareceu">>({});
  const [outcomeSaving, setOutcomeSaving] = useState<string | null>(null);
  const handleOutcome = async (appt: Appointment, outcome: "no_show" | "contracted" | "not_contracted") => {
    setOutcomeSaving(appt.id);
    try {
      const r = await registrarDesfechoDaConsulta({ leadId: appt.lead_id, appointmentId: appt.id, outcome });
      const ok = r.ok;
      // Invalida o cache: sem isso o agendamento "ressuscita" sem desfecho ao voltar à tela
      invalidateDashboardCache(user?.id);
      // false = a consulta JÁ tinha desfecho e NADA foi gravado (o update exige
      // status 'confirmed'). O retorno era ignorado: a tela dava sucesso e ainda
      // pintava na lista um desfecho que não existe no banco, escondendo o que
      // outra pessoa (ou o cron) já havia registrado. Mesmo caminho do chat
      // (AppointmentConfirmBar.doOutcome): avisa e relê os dados.
      if (!ok) {
        toast.error("Este agendamento já recebeu desfecho — recarregando");
        await fetchData();
        return;
      }
      const acao = outcome === "no_show" ? "Não compareceu" : outcome === "contracted" ? "Contratou" : "Não contratou";
      if (r.falhaDeEtapa) {
        // O desfecho ficou gravado; só o movimento de etapa foi recusado.
        toast.warning(`Marcado como ${acao}, mas o lead não foi movido de etapa: ${r.falhaDeEtapa}`);
      } else {
        toast.success(
          outcome === "no_show" ? "Marcado como não compareceu"
          : outcome === "contracted" ? "Marcado como contratado"
          : "Movido para Não Contratados",
        );
      }
      setAppointments(prev => prev.map(a => a.id === appt.id ? { ...a, status: outcome } : a));
      setOutcomeStep(prev => { const { [appt.id]: _, ...resto } = prev; return resto; });
    } catch (e) {
      // Defeito que existia: o catch engolia o erro num texto genérico e deixava
      // a tela como estava. Mas applyAppointmentOutcome pode LANÇAR DEPOIS de já
      // ter gravado o desfecho (a movimentação de etapa pode ser barrada por
      // permissão), então o banco fica com um estado e a tela com outro — sem
      // explicação e sem recarga. Agora a mensagem real do banco aparece e os
      // dados são relidos, para a tela mostrar o que de fato ficou gravado.
      // O invalidate vem ANTES do fetchData de propósito: se a exceção estourou
      // antes da linha que invalida o cache, o cache segue quente e fetchData
      // volta na hora sem consultar o banco — a "recarga" não recarregaria nada.
      invalidateDashboardCache(user?.id);
      toastDbError(e, "Erro ao registrar desfecho");
      await fetchData();
    } finally {
      setOutcomeSaving(null);
    }
  };

  const groupedUpcoming = useMemo(() => {
    const groups = new Map<string, Appointment[]>();
    upcomingAppointments.forEach(a => {
      if (!groups.has(a.scheduled_date)) groups.set(a.scheduled_date, []);
      groups.get(a.scheduled_date)!.push(a);
    });
    return groups;
  }, [upcomingAppointments]);

  const handleMarkDone = async (task: Task) => {
    const { error } = await supabase.from("crm_tasks").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", task.id);
    if (error) {
      toast.error("Erro ao concluir tarefa");
      return;
    }
    // Invalida o cache: sem isso a tarefa concluída "ressuscita" ao voltar à tela
    invalidateDashboardCache(user?.id);
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: "done" } : t));
  };

  // Rótulo honesto para os cards que seguem o dia selecionado no calendário
  const diaSelecionadoLabel = isToday(selectedDate) ? "do dia" : `de ${format(selectedDate, "dd/MM")}`;
  // Janela de dados carregada (a mesma dos fetches), explicitada e imposta no calendário
  const dataWindowStart = addDays(startOfDay(new Date()), -DASH_WINDOW_DAYS);
  const dataWindowEnd = addDays(startOfDay(new Date()), DASH_WINDOW_DAYS);

  if (loading) {
    return <div className="flex items-center justify-center h-full text-sm font-medium text-muted-foreground">Carregando...</div>;
  }

  // Falha de carregamento sem nenhum dado para exibir: estado de erro explícito (nunca zeros falsos)
  if (loadError && !dataLoaded) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive-soft text-destructive">
          <AlertTriangle size={28} className="text-destructive" />
        </span>
        <p className="text-[15px] font-semibold text-foreground">Não foi possível carregar os dados do dashboard.</p>
        <Button variant="outline" size="sm" className="h-10 gap-2 rounded-xl bg-card px-4 font-semibold shadow-card" onClick={() => { setLoading(true); fetchData(); }}>
          <RefreshCw size={14} /> Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full -m-2 sm:-m-4 lg:-m-6 px-4 py-5 sm:p-6 lg:p-8 overflow-y-auto" style={{ height: "calc(100vh - 4rem)" }}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6 lg:mb-8">
        <div className="min-w-0">
          <h1 className="text-[28px] sm:text-[32px] font-bold leading-tight tracking-tight text-foreground">Dashboard CRM</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Tarefas e agendamentos dos últimos {DASH_WINDOW_DAYS} e próximos {DASH_WINDOW_DAYS} dias
          </p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-11 w-full sm:w-auto justify-start gap-2.5 rounded-xl border-border/60 bg-card pl-1.5 pr-4 text-sm font-semibold tabular-nums text-foreground shadow-card hover:bg-surface-sunken">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-fg">
                <CalendarIcon size={16} />
              </span>
              {format(selectedDate, "dd/MM/yyyy")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(d) => d && setSelectedDate(d)}
              disabled={{ before: dataWindowStart, after: dataWindowEnd }}
              locale={ptBR}
              className="p-3 pointer-events-auto"
            />
            <p className="px-3 pb-3 text-center text-xs text-tertiary">
              Somente datas dentro da janela de ±{DASH_WINDOW_DAYS} dias
            </p>
          </PopoverContent>
        </Popover>
      </div>

      {loadError && dataLoaded && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/20 bg-destructive-soft px-4 py-3 text-sm text-destructive-soft-foreground">
          <AlertTriangle size={18} className="shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">Falha ao atualizar os dados — exibindo a última versão carregada.</span>
          <Button variant="outline" size="sm" className="ml-auto h-8 rounded-lg border-destructive/30 bg-card px-3 text-[13px] font-semibold text-destructive-soft-foreground hover:bg-destructive-soft" onClick={() => fetchData()}>
            Tentar novamente
          </Button>
        </div>
      )}

      {/* KPI Cards: faturamento em destaque (2 colunas) + 6 cards com chip pastel e número grande */}
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 lg:gap-5 mb-6 lg:mb-8">
        <Card className="relative col-span-2 xl:row-span-2 flex min-h-[168px] flex-col overflow-hidden rounded-card border-0 bg-sidebar p-5 sm:p-6 xl:p-7 text-sidebar-active-foreground shadow-card">
          <span className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/35 blur-3xl" />
          <span className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
          <DollarSign size={180} strokeWidth={1.25} className="pointer-events-none absolute -bottom-10 -right-8 text-sidebar-active-foreground/[0.06]" />
          <div className="relative grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_1fr] items-center gap-x-3.5 gap-y-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-brand"><DollarSign size={22} className="text-primary-foreground" /></div>
            <div className="contents">
              <p className="col-span-2 row-start-2 self-end truncate text-[38px] sm:text-[48px] xl:text-[56px] font-bold leading-none tracking-tight tabular-nums text-sidebar-active-foreground" title={faturamentoMes.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}>{faturamentoMes.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}</p>
              <p className="col-start-2 row-start-1 text-[15px] font-semibold leading-snug text-sidebar-foreground line-clamp-2">Faturamento do mês</p>
            </div>
          </div>
        </Card>
        <Card className="flex min-h-[124px] flex-col rounded-card border-border/60 bg-card p-4 sm:p-5 shadow-card transition-shadow hover:shadow-md">
          <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1fr] items-start gap-x-3 gap-y-3">
            <div className="col-start-2 row-start-1 flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft"><ListTodo size={20} className="text-primary-soft-fg" /></div>
            <div className="contents">
              <p className="col-start-1 row-start-2 self-end truncate text-[30px] sm:text-[36px] font-bold leading-none tracking-tight tabular-nums text-foreground">{todayTasks.length}</p>
               <p className="col-start-1 row-start-1 pt-0.5 text-xs sm:text-[13px] font-semibold leading-snug text-muted-foreground line-clamp-2 max-[1359px]:col-span-2 max-[1359px]:pr-12">Tarefas {diaSelecionadoLabel}</p>
            </div>
          </div>
        </Card>
        <Card className="flex min-h-[124px] flex-col rounded-card border-border/60 bg-card p-4 sm:p-5 shadow-card transition-shadow hover:shadow-md">
          <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1fr] items-start gap-x-3 gap-y-3">
            <div className="col-start-2 row-start-1 flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl bg-destructive-soft"><AlertTriangle size={20} className="text-destructive" /></div>
            <div className="contents">
              <p className="col-start-1 row-start-2 self-end truncate text-[30px] sm:text-[36px] font-bold leading-none tracking-tight tabular-nums text-foreground">{overdueTasks.length}</p>
               <p className="col-start-1 row-start-1 pt-0.5 text-xs sm:text-[13px] font-semibold leading-snug text-muted-foreground line-clamp-2 max-[1359px]:col-span-2 max-[1359px]:pr-12">Tarefas atrasadas</p>
            </div>
          </div>
        </Card>
        <Card className="flex min-h-[124px] flex-col rounded-card border-border/60 bg-card p-4 sm:p-5 shadow-card transition-shadow hover:shadow-md">
          <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1fr] items-start gap-x-3 gap-y-3">
            <div className="col-start-2 row-start-1 flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl bg-success-soft"><CalendarDays size={20} className="text-success" /></div>
            <div className="contents">
              <p className="col-start-1 row-start-2 self-end truncate text-[30px] sm:text-[36px] font-bold leading-none tracking-tight tabular-nums text-foreground">{dayAppointments.length}</p>
               <p className="col-start-1 row-start-1 pt-0.5 text-xs sm:text-[13px] font-semibold leading-snug text-muted-foreground line-clamp-2 max-[1359px]:col-span-2 max-[1359px]:pr-12">Agendamentos {diaSelecionadoLabel}</p>
            </div>
          </div>
        </Card>
        <Card className="flex min-h-[124px] flex-col rounded-card border-border/60 bg-card p-4 sm:p-5 shadow-card transition-shadow hover:shadow-md">
          <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1fr] items-start gap-x-3 gap-y-3">
            <div className="col-start-2 row-start-1 flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl bg-warning-soft"><Bell size={20} className="text-warning" /></div>
            <div className="contents">
              <p className="col-start-1 row-start-2 self-end truncate text-[30px] sm:text-[36px] font-bold leading-none tracking-tight tabular-nums text-foreground">{pendingConfirmations.length}</p>
               <p className="col-start-1 row-start-1 pt-0.5 text-xs sm:text-[13px] font-semibold leading-snug text-muted-foreground line-clamp-2 max-[1359px]:col-span-2 max-[1359px]:pr-12">Confirmações pendentes</p>
            </div>
          </div>
        </Card>
        <Card className="flex min-h-[124px] flex-col rounded-card border-border/60 bg-card p-4 sm:p-5 shadow-card transition-shadow hover:shadow-md">
          <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1fr] items-start gap-x-3 gap-y-3">
            <div className="col-start-2 row-start-1 flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl bg-info-soft"><Users size={20} className="text-info" /></div>
            <div className="contents">
              <p className="col-start-1 row-start-2 self-end truncate text-[30px] sm:text-[36px] font-bold leading-none tracking-tight tabular-nums text-foreground">{leadsToday}</p>
               <p className="col-start-1 row-start-1 pt-0.5 text-xs sm:text-[13px] font-semibold leading-snug text-muted-foreground line-clamp-2 max-[1359px]:col-span-2 max-[1359px]:pr-12">Leads hoje</p>
            </div>
          </div>
        </Card>
        <Card className="flex min-h-[124px] flex-col rounded-card border-border/60 bg-card p-4 sm:p-5 shadow-card transition-shadow hover:shadow-md">
          <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1fr] items-start gap-x-3 gap-y-3">
            <div className="col-start-2 row-start-1 flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl bg-rescheduled-soft"><RefreshCw size={20} className="text-rescheduled" /></div>
            <div className="contents">
              <p className="col-start-1 row-start-2 self-end truncate text-[30px] sm:text-[36px] font-bold leading-none tracking-tight tabular-nums text-foreground">{rescheduledCount}</p>
               <p className="col-start-1 row-start-1 pt-0.5 text-xs sm:text-[13px] font-semibold leading-snug text-muted-foreground line-clamp-2 max-[1359px]:col-span-2 max-[1359px]:pr-12">Reagendados no mês</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Cards de lista: Aguardando | Tarefas | Confirmações (1ª fileira) · Agendamentos do dia | Próximos (2ª fileira) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4 lg:gap-5 pb-2">
        {/* Column 0: Awaiting outcome */}
        <Card className="flex flex-col overflow-hidden rounded-card border-border/60 bg-card shadow-card xl:col-span-4 xl:col-start-9 xl:row-start-1">
          <div className="px-5 pt-5 pb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-3 min-w-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning-soft">
                <AlertCircle size={18} className="text-warning" />
              </span>
              Aguardando resultado
            </h2>
            <Badge variant="outline" className="h-7 min-w-7 justify-center rounded-full border-0 bg-warning-soft px-2.5 text-xs font-semibold tabular-nums text-warning-soft-foreground">{awaitingOutcome.length}</Badge>
          </div>
          <div className="flex-1 px-5 pb-5 space-y-3">
            {awaitingOutcome.length === 0 && (
              <div className="flex h-full min-h-[150px] flex-col items-center justify-center gap-3 rounded-2xl bg-surface-sunken/70 dark:bg-muted/40 px-4 py-8 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-card text-success shadow-xs dark:bg-background">
                  <CheckCircle2 size={22} />
                </span>
                <p className="max-w-[220px] text-[13px] font-medium text-muted-foreground">Nenhum agendamento aguardando desfecho</p>
              </div>
            )}
            {awaitingOutcome.map(appt => {
              const apptDate = new Date(appt.scheduled_date + "T12:00:00");
              const step = outcomeStep[appt.id] || "init";
              const saving = outcomeSaving === appt.id;
              return (
                <div key={appt.id} className="rounded-2xl border border-warning/30 bg-warning-soft/50 p-4 space-y-3">
                  <button
                    onClick={() => navigate(`/crm/conversa/${appt.lead_id}`)}
                    className="text-[15px] font-semibold truncate text-foreground hover:text-primary-soft-fg text-left block w-full"
                  >
                    {appt.lead_name}
                  </button>
                  <p className="-mt-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground tabular-nums">
                    <Clock size={13} className="shrink-0 text-warning" />
                    {format(apptDate, "dd/MM/yyyy")} às {appt.scheduled_time?.slice(0, 5)}
                  </p>
                  {step === "init" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" disabled={saving} className="h-10 rounded-xl text-[13px] font-semibold gap-1.5 bg-success hover:bg-success/90 text-success-foreground shadow-xs"
                        onClick={() => setOutcomeStep(p => ({ ...p, [appt.id]: "compareceu" }))}>
                        <CheckCircle2 size={14} /> Compareceu
                      </Button>
                      <Button size="sm" variant="outline" disabled={saving}
                        className="h-10 rounded-xl bg-card text-[13px] font-semibold gap-1.5 border-destructive/30 text-destructive hover:bg-destructive-soft hover:text-destructive"
                        onClick={() => handleOutcome(appt, "no_show")}>
                        <XCircle size={14} /> Não veio
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Resultado da avaliação:</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" disabled={saving} className="h-10 rounded-xl text-[13px] font-semibold gap-1.5 bg-primary hover:bg-primary-hover text-primary-foreground shadow-brand"
                          onClick={() => handleOutcome(appt, "contracted")}>
                          <Handshake size={14} /> Contratou
                        </Button>
                        <Button size="sm" variant="outline" disabled={saving} className="h-10 rounded-xl bg-card text-[13px] font-semibold"
                          onClick={() => handleOutcome(appt, "not_contracted")}>
                          Não contratou
                        </Button>
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 w-full rounded-lg text-xs text-muted-foreground"
                        onClick={() => setOutcomeStep(p => ({ ...p, [appt.id]: "init" }))}>
                        ← Voltar
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Column 1: Tasks */}
        <Card className="flex flex-col overflow-hidden rounded-card border-border/60 bg-card shadow-card xl:col-span-4 xl:col-start-1 xl:row-start-1 xl:row-span-2">
          <div className="px-5 pt-5 pb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-3 min-w-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-brand">
                <ListTodo size={18} />
              </span>Tarefas — {format(selectedDate, "dd 'de' MMMM", { locale: ptBR })}
            </h2>
            <Badge variant="outline" className="h-7 min-w-7 justify-center rounded-full border-0 bg-primary-soft px-2.5 text-xs font-semibold tabular-nums text-primary-soft-fg">{todayTasks.length}</Badge>
          </div>
          <div className="flex-1 px-5 pb-5 space-y-2.5">
            {todayTasks.length === 0 && <p className="rounded-2xl bg-surface-sunken/70 dark:bg-muted/40 px-4 py-10 text-center text-[13px] font-medium text-muted-foreground">Nenhuma tarefa para este dia</p>}
            {todayTasks.map(t => (
              <div key={t.id} className="relative flex items-start gap-3 rounded-xl border border-border/60 bg-card px-3.5 py-3 transition-colors hover:border-border hover:bg-surface-sunken/60 group">
                <button onClick={() => handleMarkDone(t)} className="mt-px shrink-0 rounded-full">
                  <Circle size={20} className="text-tertiary hover:text-success transition-colors" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-snug text-foreground line-clamp-2 break-words">{t.title}</p>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-tertiary mt-1.5">
                    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-slate-soft px-2 text-[11px] font-medium text-slate-soft-foreground">{rotuloTipoDeTarefa(t.type)}</span>
                    <span>·</span>
                    <span className="font-medium tabular-nums text-muted-foreground">{format(new Date(t.due_date), "HH:mm")}</span>
                    <span>·</span>
                    <button onClick={() => navigate(`/crm/conversa/${t.lead_id}`)} className="min-w-0 max-w-full truncate text-left font-medium text-primary-soft-fg hover:underline">{t.lead_name}</button>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 h-8 rounded-lg bg-card px-2.5 text-xs font-semibold text-success-soft-foreground shadow-card hover:bg-success-soft hover:text-success-soft-foreground" onClick={() => handleMarkDone(t)}>
                  <CheckCircle2 size={14} className="mr-1" /> Concluir
                </Button>
              </div>
            ))}

            {overdueTasks.length > 0 && (
              <>
                <div className="flex items-center gap-2 pt-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-destructive after:h-px after:flex-1 after:bg-destructive/20 after:content-['']">Atrasadas ({overdueTasks.length})</div>
                {overdueTasks.slice(0, 5).map(t => (
                  <div key={t.id} className="relative flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive-soft/60 px-3.5 py-3 group">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-card">
                      <AlertTriangle size={15} className="text-destructive shrink-0" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold leading-snug text-foreground line-clamp-2 break-words">{t.title}</p>
                      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-tertiary mt-1.5">
                        <span className="text-destructive font-semibold tabular-nums">{format(new Date(t.due_date), "dd/MM HH:mm")}</span>
                        <span>·</span>
                        <button onClick={() => navigate(`/crm/conversa/${t.lead_id}`)} className="min-w-0 max-w-full truncate text-left font-medium text-primary-soft-fg hover:underline">{t.lead_name}</button>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 h-8 rounded-lg bg-card px-2.5 text-xs font-semibold text-success-soft-foreground shadow-card hover:bg-success-soft hover:text-success-soft-foreground" onClick={() => handleMarkDone(t)}>
                      Concluir
                    </Button>
                  </div>
                ))}
              </>
            )}

          </div>
        </Card>

        {/* Column 2: Pending Appointment Confirmations */}
        <Card className="flex flex-col overflow-hidden rounded-card border-border/60 bg-card shadow-card md:col-span-2 xl:col-span-4 xl:col-start-9 xl:row-start-2">
          <div className="px-5 pt-5 pb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-3 min-w-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning-soft">
                <Bell size={18} className="text-warning" />
              </span>
              Confirmações de Agendamento
            </h2>
            <Badge variant="outline" className="h-7 min-w-7 justify-center rounded-full border-0 bg-warning-soft px-2.5 text-xs font-semibold tabular-nums text-warning-soft-foreground">{pendingConfirmations.length}</Badge>
          </div>
          <div className="flex-1 px-5 pb-5 space-y-2.5">
            {pendingConfirmations.length === 0 && (
              <div className="flex h-full min-h-[150px] flex-col items-center justify-center gap-3 rounded-2xl bg-surface-sunken/70 dark:bg-muted/40 px-4 py-8 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-card text-warning shadow-xs dark:bg-background">
                  <Bell size={22} />
                </span>
                <p className="max-w-[220px] text-[13px] font-medium text-muted-foreground">Nenhuma confirmação pendente</p>
              </div>
            )}
            {pendingConfirmations
              .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
              .map(t => {
                const overdue = isPast(new Date(t.due_date)) && !isToday(new Date(t.due_date));
                return (
                  <div key={t.id} className={cn(
                    "flex items-start gap-3 rounded-xl border px-3.5 py-3 group",
                    overdue ? "bg-destructive-soft/60 border-destructive/20" : "bg-warning-soft/50 border-warning/25"
                  )}>
                    <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl shrink-0 bg-card shadow-xs")}>
                      <Bell size={17} className={overdue ? "text-destructive" : "text-warning"} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold leading-snug text-foreground line-clamp-2 break-words">{t.title}</p>
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-tertiary mt-1.5 min-w-0">
                        <span className={cn("font-semibold tabular-nums text-muted-foreground shrink-0", overdue && "text-destructive")}>
                          {format(new Date(t.due_date), "dd/MM HH:mm")}
                        </span>
                        <span>·</span>
                        <button onClick={() => navigate(`/crm/conversa/${t.lead_id}`)} className="min-w-0 max-w-full truncate text-left font-medium text-primary-soft-fg hover:underline">{t.lead_name}</button>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="h-8 shrink-0 self-center rounded-lg border-border/60 bg-card px-3 text-xs font-semibold" onClick={() => navigate(`/crm/conversa/${t.lead_id}`)}>
                      Ver
                    </Button>
                  </div>
                );
              })}
          </div>
        </Card>

        {/* Column 3: Today's Appointments */}
        <Card className="flex flex-col overflow-hidden rounded-card border-border/60 bg-card shadow-card md:col-span-2 xl:col-span-4 xl:col-start-5 xl:row-start-1 xl:row-span-2">
          <div className="px-5 pt-5 pb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-3 min-w-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-soft">
                <CalendarDays size={18} className="text-success" />
              </span>
              Agendamentos — {format(selectedDate, "dd 'de' MMMM", { locale: ptBR })}
            </h2>
            <Badge variant="outline" className="h-7 min-w-7 justify-center rounded-full border-0 bg-success-soft px-2.5 text-xs font-semibold tabular-nums text-success-soft-foreground">{dayAppointments.length}</Badge>
          </div>
          <div className="flex-1 px-5 pb-5 space-y-2.5">
            {dayAppointments.length === 0 && <p className="rounded-2xl bg-surface-sunken/70 dark:bg-muted/40 px-4 py-10 text-center text-[13px] font-medium text-muted-foreground">Nenhum agendamento para este dia</p>}
            {dayAppointments.sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time)).map(appt => {
              const isReschedule = (appt as any).is_rescheduled === true;
              return (
              <div key={appt.id} className={cn(
                "relative flex flex-wrap items-center gap-x-3 gap-y-3 overflow-hidden rounded-xl border bg-card py-3.5 pl-4 pr-3.5 before:absolute before:inset-y-0 before:left-0 before:w-1",
                isReschedule ? "border-rescheduled/25 before:bg-rescheduled"
                  : appt.status === "confirmed" || appt.status === "contracted" ? "border-border/60 before:bg-success"
                  : appt.status === "cancelled" || appt.status === "no_show" ? "border-border/60 before:bg-destructive"
                  : appt.status === "not_contracted" ? "border-border/60 before:bg-slate"
                  : "border-border/60 before:bg-warning"
              )}>
                <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                  isReschedule ? "bg-rescheduled-soft text-rescheduled"
                    : appt.status === "confirmed" || appt.status === "contracted" ? "bg-success-soft text-success"
                    : appt.status === "cancelled" || appt.status === "no_show" ? "bg-destructive-soft text-destructive"
                    : appt.status === "not_contracted" ? "bg-slate-soft text-slate-soft-foreground"
                    : "bg-warning-soft text-warning")}>
                  <CalendarDays size={17} />
                </div>
                <div className="flex-1 min-w-0 basis-[calc(100%-3.25rem)]">
                  <p className="text-sm font-semibold text-foreground truncate">{appt.lead_name}</p>
                  <div className="flex items-center gap-1.5 text-xs text-tertiary mt-1 min-w-0">
                    <span className="font-semibold tabular-nums text-foreground">{appt.scheduled_time?.slice(0, 5)}</span>
                    {isReschedule && <Badge variant="secondary" className="h-5 shrink-0 rounded-full border-0 bg-rescheduled-soft px-2 py-0 text-[10px] font-medium text-rescheduled-soft-foreground">Reagendado</Badge>}
                    {appt.notes && <><span>·</span><span className="truncate">{appt.notes}</span></>}
                  </div>
                </div>
                <Badge variant="outline" className={cn(
                  "mr-auto h-6 shrink-0 rounded-full border-0 px-2.5 text-[11px] font-semibold",
                  appt.status === "confirmed" || appt.status === "contracted" ? "bg-success-soft text-success-soft-foreground"
                    : appt.status === "cancelled" || appt.status === "no_show" ? "bg-destructive-soft text-destructive-soft-foreground"
                    : appt.status === "not_contracted" ? "bg-slate-soft text-slate-soft-foreground"
                    : "bg-warning-soft text-warning-soft-foreground"
                )}>
                  {appt.status === "confirmed" ? "Confirmado" : appt.status === "cancelled" ? "Cancelado" : appt.status === "no_show" ? "Faltou" : appt.status === "contracted" ? "Contratou" : appt.status === "not_contracted" ? "Não contratou" : "Pendente"}
                </Badge>
                <Button variant="outline" size="sm" className="h-8 shrink-0 rounded-lg border-border/60 bg-card px-3 text-xs font-semibold" onClick={() => navigate(`/crm/conversa/${appt.lead_id}`)}>
                  Ver
                </Button>
              </div>
              );
            })}
          </div>
        </Card>

        {/* Column 3: Upcoming Appointments */}
        <Card className="flex flex-col overflow-hidden rounded-card border-border/60 bg-card shadow-card md:col-span-2 xl:col-span-12 xl:row-start-3">
          <div className="px-5 pt-5 pb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-3 min-w-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-info-soft text-info">
                <CalendarDays size={18} />
              </span>
              Próximos Agendamentos
            </h2>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="h-7 min-w-7 justify-center rounded-full border-0 bg-info-soft px-2.5 text-xs font-semibold tabular-nums text-info-soft-foreground">{upcomingAppointments.length}</Badge>
              <Tabs value={upcomingDays} onValueChange={setUpcomingDays}>
                <TabsList variant="pill" className="gap-1 rounded-full bg-surface-sunken p-1 dark:bg-muted/60">
                  <TabsTrigger value="7" className="h-8 px-3.5 font-semibold">7 dias</TabsTrigger>
                  <TabsTrigger value="14" className="h-8 px-3.5 font-semibold">14 dias</TabsTrigger>
                  <TabsTrigger value="30" className="h-8 px-3.5 font-semibold">30 dias</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
          <div className="flex-1 grid grid-cols-1 content-start gap-x-4 gap-y-4 px-5 pb-5 md:grid-cols-2 xl:grid-cols-3">
            {upcomingAppointments.length === 0 && (
              <p className="col-span-full rounded-2xl bg-surface-sunken/70 dark:bg-muted/40 px-4 py-10 text-center text-[13px] font-medium text-muted-foreground">Nenhum agendamento nos próximos {upcomingDays} dias</p>
            )}
            {Array.from(groupedUpcoming.entries()).map(([dateStr, appts]) => {
              const date = new Date(dateStr + "T12:00:00");
              const isDateToday = isToday(date);
              return (
                <div key={dateStr} className="rounded-2xl bg-surface-sunken/70 dark:bg-muted/40 p-3">
                  <div className={cn(
                    "mb-3 px-1 pt-0.5 text-[13px] font-semibold first-letter:uppercase",
                    isDateToday ? "text-primary-soft-fg" : "text-foreground"
                  )}>
                    {isDateToday ? "Hoje" : format(date, "EEEE, dd 'de' MMMM", { locale: ptBR })}
                  </div>
                  <div className="grid grid-cols-1 gap-2.5">
                    {appts.map(appt => {
                      const isReschedule = (appt as any).is_rescheduled === true;
                      return (
                      <div key={appt.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-3 rounded-xl border bg-card p-3.5 shadow-xs transition-shadow hover:shadow-card", isReschedule ? "border-rescheduled/30" : "border-border/60")}>
                        <div className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                          isReschedule ? "bg-rescheduled-soft" :
                          appt.status === "confirmed" || appt.status === "contracted" ? "bg-success-soft"
                            : appt.status === "cancelled" || appt.status === "no_show" ? "bg-destructive-soft"
                            : appt.status === "not_contracted" ? "bg-slate-soft"
                            : "bg-warning-soft"
                        )}>
                          <CalendarDays size={17} className={cn(
                            isReschedule ? "text-rescheduled" :
                            appt.status === "confirmed" || appt.status === "contracted" ? "text-success"
                              : appt.status === "cancelled" || appt.status === "no_show" ? "text-destructive"
                              : appt.status === "not_contracted" ? "text-slate-soft-foreground"
                              : "text-warning"
                          )} />
                        </div>
                        <div className="flex-1 min-w-0 basis-[calc(100%-3.25rem)]">
                          <p className="text-sm font-semibold text-foreground truncate">{appt.lead_name}</p>
                          <div className="flex items-center gap-1.5 text-xs text-tertiary mt-1 min-w-0">
                            <span className="font-semibold tabular-nums text-foreground">{appt.scheduled_time?.slice(0, 5)}</span>
                            {isReschedule && <Badge variant="secondary" className="h-5 shrink-0 rounded-full border-0 bg-rescheduled-soft px-2 py-0 text-[10px] font-medium text-rescheduled-soft-foreground">Reagendado</Badge>}
                            {appt.notes && <><span>·</span><span className="truncate">{appt.notes}</span></>}
                          </div>
                        </div>
                        <Badge variant="outline" className={cn(
                          "mr-auto h-6 rounded-full border-0 px-2.5 text-[11px] font-semibold",
                          appt.status === "confirmed" || appt.status === "contracted" ? "bg-success-soft text-success-soft-foreground"
                            : appt.status === "cancelled" || appt.status === "no_show" ? "bg-destructive-soft text-destructive-soft-foreground"
                            : appt.status === "not_contracted" ? "bg-slate-soft text-slate-soft-foreground"
                            : "bg-warning-soft text-warning-soft-foreground"
                        )}>
                          {appt.status === "confirmed" ? "Confirmado" : appt.status === "cancelled" ? "Cancelado" : appt.status === "no_show" ? "Faltou" : appt.status === "contracted" ? "Contratou" : appt.status === "not_contracted" ? "Não contratou" : "Pendente"}
                        </Badge>
                        <Button variant="outline" size="sm" className="h-8 rounded-lg border-border/60 bg-card px-3 text-xs font-semibold" onClick={() => navigate(`/crm/conversa/${appt.lead_id}`)}>
                          Ver
                        </Button>
                      </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
