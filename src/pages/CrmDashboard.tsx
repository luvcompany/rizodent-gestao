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
  Circle, CalendarIcon, ClipboardCheck, ListTodo, Bell, Users, RefreshCw, DollarSign
} from "lucide-react";
import { format, isToday, isPast, startOfDay, endOfDay, isSameDay, addDays, isAfter, isBefore } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

type Task = {
  id: string;
  lead_id: string;
  title: string;
  type: string;
  due_date: string;
  notes: string | null;
  status: string;
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

export default function CrmDashboard() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);
  const [upcomingDays, setUpcomingDays] = useState("7");
  const [leadsToday, setLeadsToday] = useState(0);
  const [faturamentoMes, setFaturamentoMes] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const now = new Date();
    const monthStart = format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd");
    const monthEnd = format(new Date(now.getFullYear(), now.getMonth() + 1, 0), "yyyy-MM-dd");

    const [tasksRes, leadsRes, appointmentsRes, leadsCountRes, pagamentosRes] = await Promise.all([
      supabase.from("crm_tasks").select("*").order("due_date"),
      supabase.from("crm_leads").select("id, name"),
      supabase.from("crm_appointments").select("*").order("scheduled_date"),
      supabase.from("crm_leads").select("id", { count: "exact", head: true }).gte("created_at", `${todayStr}T00:00:00`).lte("created_at", `${todayStr}T23:59:59`),
      supabase.from("pagamentos").select("valor").gte("data_pagamento", monthStart).lte("data_pagamento", monthEnd),
    ]);

    const leadsList = (leadsRes.data || []) as any[];
    const nameMap = new Map(leadsList.map((l) => [l.id, l.name]));

    const rawTasks = (tasksRes.data || []) as Task[];
    rawTasks.forEach((t) => (t.lead_name = nameMap.get(t.lead_id) || "Lead"));
    setTasks(rawTasks);

    const rawAppts = (appointmentsRes.data || []) as Appointment[];
    rawAppts.forEach((a) => (a.lead_name = nameMap.get(a.lead_id) || "Lead"));
    setAppointments(rawAppts);

    setLeadsToday(leadsCountRes.count || 0);

    // Faturamento do mês = soma direta de TODOS os pagamentos (mesma fonte do Dashboard principal)
    const totalFat = (pagamentosRes.data || [])
      .reduce((s: number, p: any) => s + Number(p.valor || 0), 0);
    setFaturamentoMes(totalFat);

    setLoading(false);
  }, []);

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

  const rescheduledCount = useMemo(() => {
    return appointments.filter(a => (a as any).is_rescheduled === true).length;
  }, [appointments]);

  const upcomingAppointments = useMemo(() => {
    const today = startOfDay(new Date());
    const endDate = addDays(today, parseInt(upcomingDays));
    return appointments
      .filter(a => {
        const d = new Date(a.scheduled_date);
        return (isSameDay(d, today) || isAfter(d, today)) && isBefore(d, endDate);
      })
      .sort((a, b) => {
        const cmp = a.scheduled_date.localeCompare(b.scheduled_date);
        return cmp !== 0 ? cmp : a.scheduled_time.localeCompare(b.scheduled_time);
      });
  }, [appointments, upcomingDays]);

  const groupedUpcoming = useMemo(() => {
    const groups = new Map<string, Appointment[]>();
    upcomingAppointments.forEach(a => {
      if (!groups.has(a.scheduled_date)) groups.set(a.scheduled_date, []);
      groups.get(a.scheduled_date)!.push(a);
    });
    return groups;
  }, [upcomingAppointments]);

  const handleMarkDone = async (task: Task) => {
    await supabase.from("crm_tasks").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", task.id);
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: "done" } : t));
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="flex flex-col h-full -m-6 p-4 overflow-y-auto" style={{ height: "calc(100vh - 4rem)" }}>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-foreground">Dashboard CRM</h1>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <CalendarIcon size={14} />
              {format(selectedDate, "dd/MM/yyyy")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar mode="single" selected={selectedDate} onSelect={(d) => d && setSelectedDate(d)} locale={ptBR} className="p-3 pointer-events-auto" />
          </PopoverContent>
        </Popover>
      </div>

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
              <p className="text-xs text-muted-foreground">Tarefas do dia</p>
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
              <p className="text-xs text-muted-foreground">Agendamentos do dia</p>
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
              <p className="text-xs text-muted-foreground">Reagendados</p>
            </div>
          </div>
        </Card>
      </div>

      {/* 4 Columns: Tarefas | Confirmações | Agendamentos do dia | Próximos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4 flex-1 min-h-0">
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
              Agendamentos do dia
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
