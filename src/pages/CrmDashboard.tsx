import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { applyAppointmentOutcome } from "@/lib/appointmentOutcome";
import { useAuth } from "@/contexts/AuthContext";
// Fundação canônica: datas em America/Bahia (fuso da clínica, não do navegador)
// e paginação com ORDER BY estável que lança erro em vez de truncar silenciosamente.
import { fetchAllPaged, rangeBahia, todayBahia } from "@/lib/reportKit";

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

const typeLabels: Record<string, string> = {
  agendamento: "Agendamento",
  ligacao: "Ligação",
  followup: "Follow-up",
  personalizado: "Personalizado",
};

// ── Cache stale-while-revalidate ─────────────────────────────────────────────
type DashboardCacheData = {
  tasks: Task[];
  appointments: Appointment[];
  leadsToday: number;
  faturamentoMes: number;
};
// v2: chave inclui user.id para isolar caches entre usuários
const _dashCache: { userId: string | null; data: DashboardCacheData | null; ts: number } = {
  userId: null, data: null, ts: 0,
};
const DASH_CACHE_TTL = 5 * 60_000; // 5 min — navegação volta instantânea
const DASH_LS_KEY = "crm:dashboard_cache_v2";
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
  if (_dashCache.userId === userId && _dashCache.data && Date.now() - _dashCache.ts < DASH_CACHE_TTL) {
    return _dashCache.data;
  }
  try {
    const raw = localStorage.getItem(`${DASH_LS_KEY}:${userId}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > DASH_LS_TTL) return null;
    return data as DashboardCacheData;
  } catch { return null; }
}

function writeDashCache(userId: string | null | undefined, data: DashboardCacheData): void {
  if (!userId) return;
  _dashCache.userId = userId;
  _dashCache.data = data;
  _dashCache.ts = Date.now();
  try { localStorage.setItem(`${DASH_LS_KEY}:${userId}`, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

/** Carrega tarefas, agendamentos, leads de hoje e faturamento do mês.
 *  Fonte ÚNICA usada pelo prefetch e pela tela (evita divergência entre os dois caminhos).
 *  Lança erro em qualquer falha de query: erro NUNCA vira zero silencioso nem entra no cache. */
async function loadDashboardData(
  userId: string | null | undefined,
  userRole: string | null | undefined,
): Promise<DashboardCacheData> {
  // "Hoje" e mês corrente no fuso da clínica (America/Bahia), não no do navegador
  const hoje = todayBahia(); // YYYY-MM-DD
  const [hYear, hMonth] = hoje.split("-").map(Number);
  const monthStart = `${hoje.slice(0, 7)}-01`;
  const monthEnd = format(new Date(hYear, hMonth, 0), "yyyy-MM-dd");
  // Janelas estreitas: tarefas ativas + agendamentos recentes/próximos (±DASH_WINDOW_DAYS dias)
  const taskWindowStart = format(addDays(new Date(), -DASH_WINDOW_DAYS), "yyyy-MM-dd");
  const apptWindowStart = taskWindowStart;
  const apptWindowEnd = format(addDays(new Date(), DASH_WINDOW_DAYS), "yyyy-MM-dd");
  // Leads de hoje: dia inteiro em America/Bahia, inclusivo até 23:59:59.999
  const leadsBounds = rangeBahia(hoje, hoje);

  const [tasksAll, appointmentsAll, leadsCountRes, pagamentosAll] = await Promise.all([
    fetchAllPaged<Task>(() => supabase.from("crm_tasks").select("*").neq("status", "done").gte("due_date", taskWindowStart), "id"),
    fetchAllPaged<Appointment>(() => supabase.from("crm_appointments").select("*").gte("scheduled_date", apptWindowStart).lte("scheduled_date", apptWindowEnd), "id"),
    supabase.from("crm_leads").select("id", { count: "exact", head: true }).gte("created_at", leadsBounds.gteIso).lte("created_at", leadsBounds.lteIso),
    fetchAllPaged<{ valor: number | string | null }>(() => supabase.from("pagamentos").select("valor").gte("data_pagamento", monthStart).lte("data_pagamento", monthEnd), "id"),
  ]);
  if (leadsCountRes.error || leadsCountRes.count === null) {
    throw new Error(`contagem de leads de hoje falhou: ${leadsCountRes.error?.message ?? "count nulo"}`);
  }

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

  // Faturamento do mês = soma direta de TODOS os pagamentos (mesma fonte do Dashboard principal)
  const faturamentoMes = pagamentosAll.reduce((s, p) => s + Number(p.valor || 0), 0);

  return { tasks, appointments, leadsToday: leadsCountRes.count, faturamentoMes };
}

/** Pré-carrega os dados do dashboard.
 *  Popula o cache em memória + localStorage para tornar a primeira renderização instantânea. */
export const prefetchCrmDashboardData = async (
  userId: string | null | undefined,
  userRole: string | null | undefined,
): Promise<void> => {
  if (!userId) return;
  // Cache fresco: nada a fazer.
  if (_dashCache.userId === userId && _dashCache.data && Date.now() - _dashCache.ts < DASH_CACHE_TTL) return;
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
    // Cache de módulo quente (navegação SPA) → pula fetch (só se for do mesmo usuário)
    if (_dashCache.userId === user?.id && _dashCache.data && Date.now() - _dashCache.ts < DASH_CACHE_TTL) {
      setLoading(false);
      return;
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

  // Reagendados do MÊS CORRENTE (filtrado por scheduled_date; mês em America/Bahia)
  // Padronizado com Dashboard.tsx: fonte = crm_appointments + is_rescheduled + scheduled_date no período
  const rescheduledCount = useMemo(() => {
    const hoje = todayBahia();
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

  // Agendamentos vencidos sem desfecho ("hoje" em America/Bahia)
  const awaitingOutcome = useMemo(() => {
    const todayStr = todayBahia();
    return appointments
      .filter(a => a.scheduled_date < todayStr && a.status === "confirmed")
      .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
  }, [appointments]);

  const [outcomeStep, setOutcomeStep] = useState<Record<string, "init" | "compareceu">>({});
  const [outcomeSaving, setOutcomeSaving] = useState<string | null>(null);
  const handleOutcome = async (appt: Appointment, outcome: "no_show" | "contracted" | "not_contracted") => {
    setOutcomeSaving(appt.id);
    try {
      await applyAppointmentOutcome({ leadId: appt.lead_id, appointmentId: appt.id, outcome });
      // Invalida o cache: sem isso o agendamento "ressuscita" sem desfecho ao voltar à tela
      invalidateDashboardCache(user?.id);
      toast.success(
        outcome === "no_show" ? "Marcado como não compareceu"
        : outcome === "contracted" ? "Marcado como contratado"
        : "Movido para Não Contratados",
      );
      setAppointments(prev => prev.map(a => a.id === appt.id ? { ...a, status: outcome } : a));
      setOutcomeStep(prev => { const { [appt.id]: _, ...r } = prev; return r; });
    } catch (e) {
      toast.error("Erro ao registrar desfecho");
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
    return <div className="flex items-center justify-center h-full text-muted-foreground">Carregando...</div>;
  }

  // Falha de carregamento sem nenhum dado para exibir: estado de erro explícito (nunca zeros falsos)
  if (loadError && !dataLoaded) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <AlertTriangle size={32} className="text-destructive" />
        <p className="text-sm">Não foi possível carregar os dados do dashboard.</p>
        <Button variant="outline" size="sm" className="gap-1" onClick={() => { setLoading(true); fetchData(); }}>
          <RefreshCw size={14} /> Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full -m-6 p-4 overflow-y-auto" style={{ height: "calc(100vh - 4rem)" }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Dashboard CRM</h1>
          <p className="text-[11px] text-muted-foreground">
            Tarefas e agendamentos dos últimos {DASH_WINDOW_DAYS} e próximos {DASH_WINDOW_DAYS} dias
          </p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <CalendarIcon size={14} />
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
            <p className="px-3 pb-2 text-center text-[11px] text-muted-foreground">
              Somente datas dentro da janela de ±{DASH_WINDOW_DAYS} dias
            </p>
          </PopoverContent>
        </Popover>
      </div>

      {loadError && dataLoaded && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertTriangle size={14} className="shrink-0" />
          <span>Falha ao atualizar os dados — exibindo a última versão carregada.</span>
          <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={() => fetchData()}>
            Tentar novamente
          </Button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 mb-6">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10"><DollarSign size={20} className="text-primary" /></div>
            <div>
              <p className="text-xl font-bold">{faturamentoMes.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}</p>
              <p className="text-xs text-muted-foreground">Faturamento do mês</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10"><ListTodo size={20} className="text-primary" /></div>
            <div>
              <p className="text-2xl font-bold">{todayTasks.length}</p>
              <p className="text-xs text-muted-foreground">Tarefas {diaSelecionadoLabel}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10"><AlertTriangle size={20} className="text-destructive" /></div>
            <div>
              <p className="text-2xl font-bold">{overdueTasks.length}</p>
              <p className="text-xs text-muted-foreground">Tarefas atrasadas</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10"><CalendarDays size={20} className="text-green-600" /></div>
            <div>
              <p className="text-2xl font-bold">{dayAppointments.length}</p>
              <p className="text-xs text-muted-foreground">Agendamentos {diaSelecionadoLabel}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-500/10"><Bell size={20} className="text-orange-600" /></div>
            <div>
              <p className="text-2xl font-bold">{pendingConfirmations.length}</p>
              <p className="text-xs text-muted-foreground">Confirmações pendentes</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10"><Users size={20} className="text-blue-600" /></div>
            <div>
              <p className="text-2xl font-bold">{leadsToday}</p>
              <p className="text-xs text-muted-foreground">Leads hoje</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10"><RefreshCw size={20} className="text-purple-600" /></div>
            <div>
              <p className="text-2xl font-bold">{rescheduledCount}</p>
              <p className="text-xs text-muted-foreground">Reagendados no mês</p>
            </div>
          </div>
        </Card>
      </div>

      {/* 5 Columns: Aguardando | Tarefas | Confirmações | Agendamentos do dia | Próximos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-5 gap-4 flex-1 min-h-0">
        {/* Column 0: Awaiting outcome */}
        <Card className="flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground flex items-center gap-1.5">
              <AlertCircle size={14} className="text-orange-600" />
              Aguardando resultado
            </h2>
            <Badge variant="outline" className="border-orange-500 text-orange-600">{awaitingOutcome.length}</Badge>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {awaitingOutcome.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum agendamento aguardando desfecho</p>
            )}
            {awaitingOutcome.map(appt => {
              const apptDate = new Date(appt.scheduled_date + "T12:00:00");
              const step = outcomeStep[appt.id] || "init";
              const saving = outcomeSaving === appt.id;
              return (
                <div key={appt.id} className="rounded-lg border-2 border-orange-500/40 bg-orange-500/5 p-3 space-y-2">
                  <button
                    onClick={() => navigate(`/crm/conversa/${appt.lead_id}`)}
                    className="text-sm font-medium truncate text-foreground hover:text-primary text-left block w-full"
                  >
                    {appt.lead_name}
                  </button>
                  <p className="text-[11px] text-muted-foreground -mt-1">
                    {format(apptDate, "dd/MM/yyyy")} às {appt.scheduled_time?.slice(0, 5)}
                  </p>
                  {step === "init" ? (
                    <div className="grid grid-cols-2 gap-1.5">
                      <Button size="sm" disabled={saving} className="h-7 text-[11px] gap-1 bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => setOutcomeStep(p => ({ ...p, [appt.id]: "compareceu" }))}>
                        <CheckCircle2 size={11} /> Compareceu
                      </Button>
                      <Button size="sm" variant="outline" disabled={saving}
                        className="h-7 text-[11px] gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                        onClick={() => handleOutcome(appt, "no_show")}>
                        <XCircle size={11} /> Não veio
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-muted-foreground">Resultado da avaliação:</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        <Button size="sm" disabled={saving} className="h-7 text-[11px] gap-1 bg-primary hover:bg-primary/90 text-primary-foreground"
                          onClick={() => handleOutcome(appt, "contracted")}>
                          <Handshake size={11} /> Contratou
                        </Button>
                        <Button size="sm" variant="outline" disabled={saving} className="h-7 text-[11px]"
                          onClick={() => handleOutcome(appt, "not_contracted")}>
                          Não contratou
                        </Button>
                      </div>
                      <Button variant="ghost" size="sm" className="h-5 w-full text-[10px]"
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
        <Card className="flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground">Tarefas — {format(selectedDate, "dd 'de' MMMM", { locale: ptBR })}</h2>
            <Badge variant="outline">{todayTasks.length}</Badge>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {todayTasks.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nenhuma tarefa para este dia</p>}
            {todayTasks.map(t => (
              <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50 border border-border group">
                <button onClick={() => handleMarkDone(t)} className="shrink-0">
                  <Circle size={18} className="text-muted-foreground hover:text-green-500 transition-colors" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{t.title}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span>{typeLabels[t.type] || t.type}</span>
                    <span>·</span>
                    <span>{format(new Date(t.due_date), "HH:mm")}</span>
                    <span>·</span>
                    <button onClick={() => navigate(`/crm/conversa/${t.lead_id}`)} className="text-primary hover:underline">{t.lead_name}</button>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 h-7 text-xs" onClick={() => handleMarkDone(t)}>
                  <CheckCircle2 size={14} className="mr-1" /> Concluir
                </Button>
              </div>
            ))}

            {overdueTasks.length > 0 && (
              <>
                <div className="text-xs font-semibold text-destructive uppercase mt-4 mb-1">Atrasadas ({overdueTasks.length})</div>
                {overdueTasks.slice(0, 5).map(t => (
                  <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg bg-destructive/5 border border-destructive/20 group">
                    <AlertTriangle size={16} className="text-destructive shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.title}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span className="text-destructive font-medium">{format(new Date(t.due_date), "dd/MM HH:mm")}</span>
                        <span>·</span>
                        <button onClick={() => navigate(`/crm/conversa/${t.lead_id}`)} className="text-primary hover:underline">{t.lead_name}</button>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 h-7 text-xs" onClick={() => handleMarkDone(t)}>
                      Concluir
                    </Button>
                  </div>
                ))}
              </>
            )}

          </div>
        </Card>

        {/* Column 2: Pending Appointment Confirmations */}
        <Card className="flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground flex items-center gap-1.5">
              <Bell size={14} className="text-orange-600" />
              Confirmações de Agendamento
            </h2>
            <Badge variant="outline" className="border-orange-500 text-orange-600">{pendingConfirmations.length}</Badge>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {pendingConfirmations.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhuma confirmação pendente</p>
            )}
            {pendingConfirmations
              .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
              .map(t => {
                const overdue = isPast(new Date(t.due_date)) && !isToday(new Date(t.due_date));
                return (
                  <div key={t.id} className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border group",
                    overdue ? "bg-destructive/5 border-destructive/20" : "bg-orange-500/5 border-orange-500/20"
                  )}>
                    <div className={cn("p-2 rounded-lg shrink-0", overdue ? "bg-destructive/10" : "bg-orange-500/10")}>
                      <Bell size={16} className={overdue ? "text-destructive" : "text-orange-600"} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.title}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span className={cn("font-medium", overdue && "text-destructive")}>
                          {format(new Date(t.due_date), "dd/MM HH:mm")}
                        </span>
                        <span>·</span>
                        <button onClick={() => navigate(`/crm/conversa/${t.lead_id}`)} className="text-primary hover:underline truncate">{t.lead_name}</button>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" onClick={() => navigate(`/crm/conversa/${t.lead_id}`)}>
                      Ver
                    </Button>
                  </div>
                );
              })}
          </div>
        </Card>

        {/* Column 3: Today's Appointments */}
        <Card className="flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground flex items-center gap-1.5">
              <CalendarDays size={14} className="text-green-600" />
              Agendamentos — {format(selectedDate, "dd 'de' MMMM", { locale: ptBR })}
            </h2>
            <Badge variant="outline" className="border-green-500 text-green-600">{dayAppointments.length}</Badge>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {dayAppointments.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nenhum agendamento para este dia</p>}
            {dayAppointments.sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time)).map(appt => {
              const isReschedule = (appt as any).is_rescheduled === true;
              return (
              <div key={appt.id} className={cn(
                "flex items-center gap-3 p-3 rounded-lg border",
                isReschedule ? "bg-purple-500/5 border-purple-500/20" : "bg-green-500/5 border-green-500/20"
              )}>
                <div className={cn("p-2 rounded-lg", isReschedule ? "bg-purple-500/10" : "bg-green-500/10")}>
                  <CalendarDays size={16} className={isReschedule ? "text-purple-600" : "text-green-600"} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{appt.lead_name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span className="font-medium">{appt.scheduled_time?.slice(0, 5)}</span>
                    {isReschedule && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 bg-purple-500/10 text-purple-600">Reagendado</Badge>}
                    {appt.notes && <><span>·</span><span className="truncate">{appt.notes}</span></>}
                  </div>
                </div>
                <Badge variant="outline" className={cn("text-[10px]", isReschedule ? "border-purple-500 text-purple-600" : "border-green-500 text-green-600")}>
                  {appt.status === "confirmed" ? "Confirmado" : appt.status === "cancelled" ? "Cancelado" : appt.status === "no_show" ? "Faltou" : appt.status === "contracted" ? "Contratou" : appt.status === "not_contracted" ? "Não contratou" : "Pendente"}
                </Badge>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => navigate(`/crm/conversa/${appt.lead_id}`)}>
                  Ver
                </Button>
              </div>
              );
            })}
          </div>
        </Card>

        {/* Column 3: Upcoming Appointments */}
        <Card className="flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground">Próximos Agendamentos</h2>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{upcomingAppointments.length}</Badge>
              <Select value={upcomingDays} onValueChange={setUpcomingDays}>
                <SelectTrigger className="h-7 text-xs w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 dias</SelectItem>
                  <SelectItem value="14">14 dias</SelectItem>
                  <SelectItem value="30">30 dias</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {upcomingAppointments.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum agendamento nos próximos {upcomingDays} dias</p>
            )}
            {Array.from(groupedUpcoming.entries()).map(([dateStr, appts]) => {
              const date = new Date(dateStr + "T12:00:00");
              const isDateToday = isToday(date);
              return (
                <div key={dateStr}>
                  <div className={cn(
                    "text-xs font-semibold uppercase mb-1.5 px-1",
                    isDateToday ? "text-primary" : "text-muted-foreground"
                  )}>
                    {isDateToday ? "Hoje" : format(date, "EEEE, dd 'de' MMMM", { locale: ptBR })}
                  </div>
                  <div className="space-y-1.5">
                    {appts.map(appt => {
                      const isReschedule = (appt as any).is_rescheduled === true;
                      return (
                      <div key={appt.id} className={cn("flex items-center gap-3 p-3 rounded-lg border", isReschedule ? "bg-purple-500/5 border-purple-500/20" : "bg-secondary/50 border-border")}>
                        <div className={cn(
                          "p-2 rounded-lg",
                          isReschedule ? "bg-purple-500/10" :
                          appt.status === "confirmed" ? "bg-green-500/10" : appt.status === "cancelled" ? "bg-destructive/10" : "bg-primary/10"
                        )}>
                          <CalendarDays size={16} className={cn(
                            isReschedule ? "text-purple-600" :
                            appt.status === "confirmed" ? "text-green-600" : appt.status === "cancelled" ? "text-destructive" : "text-primary"
                          )} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{appt.lead_name}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                            <span className="font-medium">{appt.scheduled_time?.slice(0, 5)}</span>
                            {isReschedule && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 bg-purple-500/10 text-purple-600">Reagendado</Badge>}
                            {appt.notes && <><span>·</span><span className="truncate">{appt.notes}</span></>}
                          </div>
                        </div>
                        <Badge variant="outline" className={cn(
                          "text-[10px]",
                          appt.status === "confirmed" && "border-green-500 text-green-600",
                          appt.status === "cancelled" && "border-destructive text-destructive"
                        )}>
                          {appt.status === "confirmed" ? "Confirmado" : appt.status === "cancelled" ? "Cancelado" : appt.status === "no_show" ? "Faltou" : appt.status === "contracted" ? "Contratou" : appt.status === "not_contracted" ? "Não contratou" : "Pendente"}
                        </Badge>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => navigate(`/crm/conversa/${appt.lead_id}`)}>
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
