import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FILTRO_LEAD_NOVO } from "@/lib/leadNovo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CalendarDays, CheckCircle2, AlertTriangle,
  Circle, CalendarIcon, ClipboardCheck, ListTodo, Bell, Users, RefreshCw, DollarSign,
  AlertCircle, XCircle, Handshake
} from "lucide-react";
import { format, isToday, isPast, startOfDay, isSameDay, addDays, isAfter, isBefore } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { applyAppointmentOutcome } from "@/lib/appointmentOutcome";
import { EmptyState, KpiCard, PageHeader, PillTabs, SectionCard, StatusPill, type SemanticTone } from "@/components/crm-ui";
import ThemedLoader from "@/components/ThemedLoader";
// toastDbError mostra a mensagem que o gatilho do banco devolveu (em vez de um
// "erro" genérico) quando o desfecho falha no meio do caminho.
import { toastDbError } from "@/lib/appointmentActions";
import { useAuth } from "@/contexts/AuthContext";
// Fundação canônica: datas em America/Bahia (fuso da clínica, não do navegador)
// e paginação com ORDER BY estável que lança erro em vez de truncar silenciosamente.
import { fetchAllPaged, rangeBahia, todayBahia, contaComoFaturamento } from "@/lib/reportKit";

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

const appointmentStatus = (status: string): { label: string; tone: SemanticTone } => {
  if (status === "confirmed") return { label: "Confirmado", tone: "success" };
  if (status === "cancelled") return { label: "Cancelado", tone: "destructive" };
  if (status === "no_show") return { label: "Faltou", tone: "destructive" };
  if (status === "contracted") return { label: "Contratou", tone: "success" };
  if (status === "not_contracted") return { label: "Não contratou", tone: "slate" };
  return { label: "Pendente", tone: "warning" };
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
// v3 (14/09/2026): "Faturamento do mês" passou a usar a régua de faturamento de
// marketing (mesma do Dashboard principal). Versão nova para o cache antigo não
// continuar mostrando o total bruto.
const DASH_LS_KEY = "crm:dashboard_cache_v3";
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
    // Lead criado pela conciliação do Dontus não é lead novo (leadNovo.ts).
    supabase.from("crm_leads").select("id", { count: "exact", head: true }).gte("created_at", leadsBounds.gteIso).lte("created_at", leadsBounds.lteIso).or(FILTRO_LEAD_NOVO),
    // As duas marcas vêm junto com o valor porque é o que separa faturamento de
    // MARKETING do caixa bruto (ver contaComoFaturamento). Sem elas o card
    // mostrava R$ 92.742 onde o Dashboard principal mostrava R$ 79.212 — o
    // mesmo mês, dois números, e nenhum dos dois dizia qual era qual.
    fetchAllPaged<{ valor: number | string | null; recorrencia_orto: boolean | null; nao_marketing: boolean | null }>(
      () => supabase.from("pagamentos").select("valor, recorrencia_orto, nao_marketing").gte("data_pagamento", monthStart).lte("data_pagamento", monthEnd),
      "id",
    ),
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

  // Faturamento do mês = a MESMA régua do Dashboard principal e dos relatórios
  // (contaComoFaturamento): fora manutenção de ortodontia e pagamento marcado
  // como não-marketing. Antes somava tudo, e o card divergia do Dashboard em
  // R$ 13.530,00 no mês (decisão do dono em 14/09/2026: um número só).
  const faturamentoMes = pagamentosAll
    .filter(contaComoFaturamento)
    .reduce((s, p) => s + Number(p.valor || 0), 0);

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
      const ok = await applyAppointmentOutcome({ leadId: appt.lead_id, appointmentId: appt.id, outcome });
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
      toast.success(
        outcome === "no_show" ? "Marcado como não compareceu"
        : outcome === "contracted" ? "Marcado como contratado"
        : "Movido para Não Contratados",
      );
      setAppointments(prev => prev.map(a => a.id === appt.id ? { ...a, status: outcome } : a));
      setOutcomeStep(prev => { const { [appt.id]: _, ...r } = prev; return r; });
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
    return <ThemedLoader fullScreen={false} />;
  }

  if (loadError && !dataLoaded) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Não foi possível carregar os dados do dashboard."
        action={<Button variant="outline" onClick={() => { setLoading(true); fetchData(); }}><RefreshCw size={14} /> Tentar novamente</Button>}
      />
    );
  }

  const moneyLabel = faturamentoMes.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const countPill = (count: number, tone: SemanticTone = "slate") => <StatusPill tone={tone}>{count}</StatusPill>;

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Dashboard CRM"
        subtitle={`Tarefas e agendamentos dos últimos ${DASH_WINDOW_DAYS} e próximos ${DASH_WINDOW_DAYS} dias`}
        actions={
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2">
                <CalendarIcon size={16} />
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
                className="pointer-events-auto p-3"
              />
              <p className="px-3 pb-3 text-center text-xs text-muted-foreground">
                Somente datas dentro da janela de ±{DASH_WINDOW_DAYS} dias
              </p>
            </PopoverContent>
          </Popover>
        }
      />

      {loadError && dataLoaded && (
        <div className="flex flex-wrap items-center gap-2 rounded-control border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm text-destructive-soft-foreground">
          <AlertTriangle size={16} className="shrink-0" />
          <span>Falha ao atualizar os dados — exibindo a última versão carregada.</span>
          <Button variant="ghost" className="ml-auto" onClick={() => fetchData()}>Tentar novamente</Button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(18rem,1.25fr)_minmax(0,2.75fr)]">
        <Card className="flex min-h-40 flex-col justify-between overflow-hidden border-sidebar-border bg-sidebar p-5 text-sidebar-foreground shadow-float sm:p-6">
          <span className="grid h-11 w-11 place-items-center rounded-control bg-sidebar-primary text-sidebar-primary-foreground">
            <DollarSign className="h-5 w-5" />
          </span>
          <div className="mt-6 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground/70">Faturamento do mês</p>
            <p className="mt-1 break-words text-3xl font-bold tabular-nums text-sidebar-foreground sm:text-4xl" title={moneyLabel}>{moneyLabel}</p>
          </div>
        </Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard label={`Tarefas ${diaSelecionadoLabel}`} value={todayTasks.length} icon={ListTodo} tone="primary" />
          <KpiCard label="Tarefas atrasadas" value={overdueTasks.length} icon={AlertTriangle} tone="destructive" />
          <KpiCard label={`Agendamentos ${diaSelecionadoLabel}`} value={dayAppointments.length} icon={CalendarDays} tone="success" />
          <KpiCard label="Confirmações pendentes" value={pendingConfirmations.length} icon={Bell} tone="warning" />
          <KpiCard label="Leads hoje" value={leadsToday} icon={Users} tone="info" />
          <KpiCard label="Reagendados no mês" value={rescheduledCount} icon={RefreshCw} tone="purple" />
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <SectionCard title="Aguardando resultado" icon={AlertCircle} actions={countPill(awaitingOutcome.length, "warning")}>
          <div className="space-y-3">
            {awaitingOutcome.length === 0 && <EmptyState icon={ClipboardCheck} title="Nenhum agendamento aguardando desfecho" />}
            {awaitingOutcome.map((appt) => {
              const apptDate = new Date(appt.scheduled_date + "T12:00:00");
              const step = outcomeStep[appt.id] || "init";
              const saving = outcomeSaving === appt.id;
              return (
                <div key={appt.id} className="space-y-3 rounded-control border border-warning/30 bg-warning-soft p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Button variant="link" onClick={() => navigate(`/crm/conversa/${appt.lead_id}`)} className="h-auto min-w-0 whitespace-normal p-0 text-left font-semibold leading-snug">
                      {appt.lead_name}
                    </Button>
                    <StatusPill tone="warning" className="shrink-0">Aguardando</StatusPill>
                  </div>
                  <p className="text-xs text-muted-foreground">{format(apptDate, "dd/MM/yyyy")} às {appt.scheduled_time?.slice(0, 5)}</p>
                  {step === "init" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Button disabled={saving} onClick={() => setOutcomeStep((p) => ({ ...p, [appt.id]: "compareceu" }))}><CheckCircle2 size={14} /> Compareceu</Button>
                      <Button variant="outline" disabled={saving} className="border-destructive/40 text-destructive hover:bg-destructive-soft" onClick={() => handleOutcome(appt, "no_show")}><XCircle size={14} /> Não veio</Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">Resultado da avaliação:</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Button disabled={saving} onClick={() => handleOutcome(appt, "contracted")}><Handshake size={14} /> Contratou</Button>
                        <Button variant="outline" disabled={saving} onClick={() => handleOutcome(appt, "not_contracted")}>Não contratou</Button>
                      </div>
                      <Button variant="ghost" className="w-full" onClick={() => setOutcomeStep((p) => ({ ...p, [appt.id]: "init" }))}>← Voltar</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title={`Tarefas — ${format(selectedDate, "dd 'de' MMMM", { locale: ptBR })}`} icon={ListTodo} actions={countPill(todayTasks.length, "primary")}>
          <div className="space-y-3">
            {todayTasks.length === 0 && <EmptyState icon={ListTodo} title="Nenhuma tarefa para este dia" />}
            {todayTasks.map((t) => (
              <div key={t.id} className="flex items-start gap-3 rounded-control border border-border/60 bg-surface-sunken p-4">
                <Button variant="ghost" size="icon" className="shrink-0" onClick={() => handleMarkDone(t)} aria-label="Concluir tarefa"><Circle size={18} /></Button>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold leading-snug">{t.title}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <StatusPill tone="slate">{typeLabels[t.type] || t.type}</StatusPill>
                    <span>{format(new Date(t.due_date), "HH:mm")}</span>
                    <Button variant="link" onClick={() => navigate(`/crm/conversa/${t.lead_id}`)} className="h-auto whitespace-normal p-0 text-left text-xs">{t.lead_name}</Button>
                  </div>
                </div>
                <Button variant="ghost" className="shrink-0" onClick={() => handleMarkDone(t)}><CheckCircle2 size={14} /> Concluir</Button>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Tarefas atrasadas" icon={AlertTriangle} actions={countPill(overdueTasks.length, "destructive")}>
          <div className="space-y-3">
            {overdueTasks.length === 0 && <EmptyState icon={CheckCircle2} title="Nenhuma tarefa atrasada" />}
            {overdueTasks.slice(0, 5).map((t) => (
              <div key={t.id} className="flex items-start gap-3 rounded-control border border-destructive/25 bg-destructive-soft p-4">
                <AlertTriangle size={18} className="mt-1 shrink-0 text-destructive-soft-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold leading-snug">{t.title}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <StatusPill tone="destructive">{format(new Date(t.due_date), "dd/MM HH:mm")}</StatusPill>
                    <Button variant="link" onClick={() => navigate(`/crm/conversa/${t.lead_id}`)} className="h-auto whitespace-normal p-0 text-left text-xs">{t.lead_name}</Button>
                  </div>
                </div>
                <Button variant="ghost" className="shrink-0" onClick={() => handleMarkDone(t)}>Concluir</Button>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Confirmações de Agendamento" icon={Bell} actions={countPill(pendingConfirmations.length, "warning")}>
          <div className="space-y-3">
            {pendingConfirmations.length === 0 && <EmptyState icon={Bell} title="Nenhuma confirmação pendente" />}
            {[...pendingConfirmations].sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime()).map((t) => {
              const overdue = isPast(new Date(t.due_date)) && !isToday(new Date(t.due_date));
              return (
                <div key={t.id} className={cn("flex items-start gap-3 rounded-control border p-4", overdue ? "border-destructive/25 bg-destructive-soft" : "border-warning/25 bg-warning-soft")}>
                  <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-control", overdue ? "bg-destructive text-destructive-foreground" : "bg-warning text-warning-foreground")}><Bell size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold leading-snug">{t.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <StatusPill tone={overdue ? "destructive" : "warning"}>{overdue ? "Atrasada" : "Pendente"}</StatusPill>
                      <span>{format(new Date(t.due_date), "dd/MM HH:mm")}</span>
                      <Button variant="link" onClick={() => navigate(`/crm/conversa/${t.lead_id}`)} className="h-auto whitespace-normal p-0 text-left text-xs">{t.lead_name}</Button>
                    </div>
                  </div>
                  <Button variant="ghost" className="shrink-0" onClick={() => navigate(`/crm/conversa/${t.lead_id}`)}>Ver</Button>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title={`Agendamentos — ${format(selectedDate, "dd 'de' MMMM", { locale: ptBR })}`} icon={CalendarDays} actions={countPill(dayAppointments.length, "success")}>
          <div className="space-y-3">
            {dayAppointments.length === 0 && <EmptyState icon={CalendarDays} title="Nenhum agendamento para este dia" />}
            {[...dayAppointments].sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time)).map((appt) => {
              const isReschedule = appt.is_rescheduled === true;
              const status = appointmentStatus(appt.status);
              return (
                <div key={appt.id} className={cn("flex items-start gap-3 rounded-control border p-4", isReschedule ? "border-purple/25 bg-purple-soft" : "border-success/25 bg-success-soft")}>
                  <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-control", isReschedule ? "bg-purple text-purple-foreground" : "bg-success text-success-foreground")}><CalendarDays size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold leading-snug">{appt.lead_name}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium">{appt.scheduled_time?.slice(0, 5)}</span>
                      {isReschedule && <StatusPill tone="purple">Reagendado</StatusPill>}
                      {appt.notes && <span className="break-words">{appt.notes}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                    <Button variant="ghost" onClick={() => navigate(`/crm/conversa/${appt.lead_id}`)}>Ver</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard
          title="Próximos Agendamentos"
          icon={CalendarDays}
          className="lg:col-span-2 xl:col-span-3"
          actions={countPill(upcomingAppointments.length, "info")}
        >
          <PillTabs
            value={upcomingDays}
            onValueChange={setUpcomingDays}
            items={[{ value: "7", label: "7 dias" }, { value: "14", label: "14 dias" }, { value: "30", label: "30 dias" }]}
          />
          <div className="mt-5 grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {upcomingAppointments.length === 0 && <div className="lg:col-span-2 xl:col-span-3"><EmptyState icon={CalendarDays} title={`Nenhum agendamento nos próximos ${upcomingDays} dias`} /></div>}
            {Array.from(groupedUpcoming.entries()).map(([dateStr, appts]) => {
              const date = new Date(dateStr + "T12:00:00");
              const isDateToday = isToday(date);
              return (
                <section key={dateStr} className="overflow-hidden rounded-card border border-border/60 bg-surface-sunken">
                  <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
                    <h3 className={cn("text-sm font-semibold capitalize", isDateToday ? "text-primary" : "text-foreground")}>{isDateToday ? "Hoje" : format(date, "EEEE, dd 'de' MMMM", { locale: ptBR })}</h3>
                    <StatusPill tone={isDateToday ? "primary" : "slate"}>{appts.length}</StatusPill>
                  </div>
                  <div className="divide-y divide-border/60">
                    {appts.map((appt) => {
                      const isReschedule = appt.is_rescheduled === true;
                      const status = appointmentStatus(appt.status);
                      return (
                        <div key={appt.id} className="flex items-start gap-3 bg-card p-4">
                          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-control", isReschedule ? "bg-purple-soft text-purple-soft-foreground" : "bg-info-soft text-info-soft-foreground")}><CalendarDays size={16} /></span>
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-sm font-semibold leading-snug">{appt.lead_name}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-medium">{appt.scheduled_time?.slice(0, 5)}</span>
                              {isReschedule && <StatusPill tone="purple">Reagendado</StatusPill>}
                              {appt.notes && <span className="break-words">{appt.notes}</span>}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <StatusPill tone={status.tone}>{status.label}</StatusPill>
                            <Button variant="ghost" onClick={() => navigate(`/crm/conversa/${appt.lead_id}`)}>Ver</Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
