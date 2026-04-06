import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CalendarDays, Phone, MessageSquare, Clock, CheckCircle2, AlertTriangle,
  Circle, CalendarIcon, ClipboardCheck, ListTodo, Bell
} from "lucide-react";
import { format, isToday, isPast, startOfDay, endOfDay, isSameDay } from "date-fns";
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

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [tasksRes, leadsRes, appointmentsRes] = await Promise.all([
      supabase.from("crm_tasks").select("*").order("due_date"),
      supabase.from("crm_leads").select("id, name"),
      supabase.from("crm_appointments").select("*").order("scheduled_date"),
    ]);

    const nameMap = new Map(((leadsRes.data || []) as any[]).map((l) => [l.id, l.name]));

    const rawTasks = (tasksRes.data || []) as Task[];
    rawTasks.forEach((t) => (t.lead_name = nameMap.get(t.lead_id) || "Lead"));
    setTasks(rawTasks);

    const rawAppts = (appointmentsRes.data || []) as Appointment[];
    rawAppts.forEach((a) => (a.lead_name = nameMap.get(a.lead_id) || "Lead"));
    setAppointments(rawAppts);

    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Metrics
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

  const confirmedToday = useMemo(() =>
    appointments.filter(a => a.scheduled_date === format(selectedDate, "yyyy-MM-dd") && a.status === "confirmed"),
  [appointments, selectedDate]);

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
            <Calendar mode="single" selected={selectedDate} onSelect={(d) => d && setSelectedDate(d)} className="p-3 pointer-events-auto" />
          </PopoverContent>
        </Popover>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
        {/* Tasks of the day */}
        <Card className="flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground">Tarefas — {format(selectedDate, "dd 'de' MMMM", { locale: ptBR })}</h2>
            <Badge variant="outline">{todayTasks.length}</Badge>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {todayTasks.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nenhuma tarefa para este dia</p>}
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

        {/* Appointments of the day */}
        <Card className="flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground">Agendamentos — {format(selectedDate, "dd 'de' MMMM", { locale: ptBR })}</h2>
            <Badge variant="outline">{dayAppointments.length}</Badge>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {dayAppointments.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nenhum agendamento para este dia</p>}
            {dayAppointments.sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time)).map(appt => (
              <div key={appt.id} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50 border border-border">
                <div className={cn(
                  "p-2 rounded-lg",
                  appt.status === "confirmed" ? "bg-green-500/10" : appt.status === "cancelled" ? "bg-destructive/10" : "bg-primary/10"
                )}>
                  <CalendarDays size={16} className={cn(
                    appt.status === "confirmed" ? "text-green-600" : appt.status === "cancelled" ? "text-destructive" : "text-primary"
                  )} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{appt.lead_name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span className="font-medium">{appt.scheduled_time.slice(0, 5)}</span>
                    {appt.notes && <><span>·</span><span className="truncate">{appt.notes}</span></>}
                  </div>
                </div>
                <Badge variant="outline" className={cn(
                  "text-[10px]",
                  appt.status === "confirmed" && "border-green-500 text-green-600",
                  appt.status === "cancelled" && "border-destructive text-destructive"
                )}>
                  {appt.status === "confirmed" ? "Confirmado" : appt.status === "cancelled" ? "Cancelado" : appt.status === "no_show" ? "Faltou" : "Confirmado"}
                </Badge>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => navigate(`/crm/conversa/${appt.lead_id}`)}>
                  Ver
                </Button>
              </div>
            ))}

            {/* Pending confirmations */}
            {pendingConfirmations.length > 0 && (
              <>
                <div className="text-xs font-semibold text-orange-600 uppercase mt-4 mb-1">Confirmações pendentes ({pendingConfirmations.length})</div>
                {pendingConfirmations.slice(0, 5).map(t => (
                  <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg bg-orange-500/5 border border-orange-500/20">
                    <Bell size={16} className="text-orange-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.title}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span>{format(new Date(t.due_date), "dd/MM HH:mm")}</span>
                        <span>·</span>
                        <button onClick={() => navigate(`/crm/conversa/${t.lead_id}`)} className="text-primary hover:underline">{t.lead_name}</button>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
