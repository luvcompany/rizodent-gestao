import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

type Task = {
  id: string;
  lead_id: string;
  title: string;
  type: string;
  due_date: string;
  notes: string | null;
  assigned_to: string | null;
  status: string;
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

export default function CrmCalendario() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [mainView, setMainView] = useState<MainView>("agendamentos");
  const [taskView, setTaskView] = useState<TaskViewMode>("events");
  const [filterUser, setFilterUser] = useState("");
  const [filterType, setFilterType] = useState("");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteApptConfirm, setDeleteApptConfirm] = useState<string | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [apptResultStatus, setApptResultStatus] = useState("");
  const [apptMoveStageId, setApptMoveStageId] = useState("");
  const [crmStages, setCrmStages] = useState<Stage[]>([]);
  const [crmPipelines, setCrmPipelines] = useState<Pipeline[]>([]);
  const [apptMovePipelineId, setApptMovePipelineId] = useState("");

  const fetchTasks = useCallback(async () => {
    const [tasksRes, profilesRes, leadsRes, apptsRes, stagesRes, pipelinesRes] = await Promise.all([
      supabase.from("crm_tasks").select("*").order("due_date"),
      supabase.from("profiles").select("id, nome"),
      supabase.from("crm_leads").select("id, name"),
      supabase.from("crm_appointments").select("*").order("scheduled_date"),
      supabase.from("crm_stages").select("id, name, color, pipeline_id").order("position"),
      supabase.from("crm_pipelines").select("id, name"),
    ]);
    const rawTasks = (tasksRes.data || []) as Task[];
    const nameMap = new Map(((leadsRes.data || []) as any[]).map((l) => [l.id, l.name]));
    rawTasks.forEach((t) => (t.lead_name = nameMap.get(t.lead_id) || "Lead"));
    setTasks(rawTasks);
    setProfiles((profilesRes.data as Profile[]) || []);
    const rawAppts = (apptsRes.data || []) as Appointment[];
    rawAppts.forEach((a) => (a.lead_name = nameMap.get(a.lead_id) || "Lead"));
    setAppointments(rawAppts);
    setCrmStages((stagesRes.data as Stage[]) || []);
    setCrmPipelines((pipelinesRes.data as Pipeline[]) || []);
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const handleMarkDone = async (task: Task) => {
    await supabase.from("crm_tasks").update({ status: "done" }).eq("id", task.id);
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: "done" } : t));
    setSelectedTask(null);
  };

  const handleDeleteTask = async (taskId: string) => {
    const { error } = await supabase.from("crm_tasks").delete().eq("id", taskId);
    if (error) { toast.error("Erro ao excluir tarefa"); return; }
    toast.success("Tarefa excluída");
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setSelectedTask(null);
    setDeleteConfirm(null);
  };

  const handleDeleteAppointment = async (apptId: string) => {
    const { error } = await supabase.from("crm_appointments").delete().eq("id", apptId);
    if (error) { toast.error("Erro ao excluir agendamento"); return; }
    toast.success("Agendamento excluído");
    setAppointments((prev) => prev.filter((a) => a.id !== apptId));
    setDeleteApptConfirm(null);
  };

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (filterUser && t.assigned_to !== filterUser) return false;
      if (filterType && t.type !== filterType) return false;
      return true;
    });
  }, [tasks, filterUser, filterType]);

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

  // Appointment week days
  const apptWeekDays = useMemo(() => {
    return eachDayOfInterval({
      start: startOfWeek(currentDate, { weekStartsOn: 1 }),
      end: endOfWeek(currentDate, { weekStartsOn: 1 }),
    });
  }, [currentDate]);

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
          <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden flex-1">
            {apptWeekDays.map(day => {
              const dayKey = format(day, "yyyy-MM-dd");
              const dayAppts = appointments.filter(a => a.scheduled_date === dayKey);
              return (
                <div key={dayKey} className={cn("bg-card p-2 min-h-[200px] flex flex-col", isToday(day) && "ring-1 ring-primary/50")}>
                  <div className={cn("text-xs font-medium mb-2 text-center", isToday(day) ? "text-primary" : "text-foreground")}>
                    <div>{format(day, "EEE", { locale: ptBR })}</div>
                    <div className={cn("text-sm font-bold", isToday(day) && "bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center mx-auto")}>{format(day, "d")}</div>
                  </div>
                  <div className="space-y-1 flex-1 overflow-y-auto">
                    {dayAppts.sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time)).map(appt => (
                      <div
                        key={appt.id}
                        className={cn(
                          "text-[10px] px-1.5 py-1.5 rounded transition-colors group relative",
                          appt.status === "confirmed" ? "bg-green-500/15 text-green-700" :
                          appt.status === "cancelled" ? "bg-destructive/10 text-destructive" :
                          "bg-primary/10 text-foreground"
                        )}
                      >
                        <div className="font-medium truncate cursor-pointer hover:underline" onClick={() => {
                          setSelectedAppointment(appt);
                          setApptResultStatus(appt.status);
                          setApptMoveStageId("");
                          setApptMovePipelineId("");
                        }}>{appt.lead_name}</div>
                      </div>
                    ))}
                    {dayAppts.length === 0 && <div className="text-[10px] text-muted-foreground text-center py-4">—</div>}
                  </div>
                </div>
              );
            })}
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
      <Dialog open={!!selectedAppointment} onOpenChange={(o) => { if (!o) setSelectedAppointment(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Resultado do Agendamento</DialogTitle></DialogHeader>
          {selectedAppointment && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">{selectedAppointment.lead_name}</p>
                <p className="text-xs text-muted-foreground">{selectedAppointment.scheduled_date} às {selectedAppointment.scheduled_time?.slice(0, 5)}</p>
              </div>
              <div>
                <Label className="text-xs font-semibold">Status do agendamento</Label>
                <Select value={apptResultStatus} onValueChange={setApptResultStatus}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="confirmed">✅ Confirmado</SelectItem>
                    <SelectItem value="contracted">🤝 Contratado</SelectItem>
                    <SelectItem value="not_contracted">❌ Não contratou</SelectItem>
                    <SelectItem value="no_show">🚫 Não compareceu</SelectItem>
                    <SelectItem value="cancelled">🗑️ Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => navigate(`/crm/conversa/${selectedAppointment.lead_id}`)}>Ir para conversa</Button>
                <Button className="flex-1" onClick={async () => {
                  await supabase.from("crm_appointments").update({ status: apptResultStatus }).eq("id", selectedAppointment.id);
                  if (apptMoveStageId) {
                    await supabase.from("crm_leads").update({ stage_id: apptMoveStageId, pipeline_id: apptMovePipelineId }).eq("id", selectedAppointment.lead_id);
                  }
                  toast.success("Agendamento atualizado");
                  setAppointments(prev => prev.map(a => a.id === selectedAppointment.id ? { ...a, status: apptResultStatus } : a));
                  setSelectedAppointment(null);
                }}>Salvar</Button>
              </div>
              <Button variant="destructive" size="sm" className="w-full" onClick={() => { setDeleteApptConfirm(selectedAppointment.id); setSelectedAppointment(null); }}>
                <Trash2 size={14} className="mr-1" /> Excluir agendamento
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
