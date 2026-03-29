import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, CalendarDays, Phone, MessageSquare, Clock, CheckCircle2, AlertTriangle, Circle } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isToday, isSameDay, isPast, addMonths, subMonths, addWeeks, subWeeks } from "date-fns";
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
  assigned_to: string | null;
  status: string;
  lead_name?: string;
};

type Profile = { id: string; nome: string };

const typeIcons: Record<string, any> = {
  agendamento: CalendarDays,
  ligacao: Phone,
  followup: MessageSquare,
  personalizado: Clock,
};

const typeLabels: Record<string, string> = {
  agendamento: "Agendamento",
  ligacao: "Ligação",
  followup: "Follow-up",
  personalizado: "Personalizado",
};

export default function CrmCalendario() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"month" | "week">("month");
  const [filterUser, setFilterUser] = useState("");
  const [filterType, setFilterType] = useState("");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  useEffect(() => {
    const fetchAll = async () => {
      const [tasksRes, profilesRes] = await Promise.all([
        supabase.from("crm_tasks").select("*").order("due_date"),
        supabase.from("profiles").select("id, nome"),
      ]);

      const rawTasks = (tasksRes.data || []) as Task[];
      // Fetch lead names
      const leadIds = [...new Set(rawTasks.map((t) => t.lead_id))];
      if (leadIds.length > 0) {
        const { data: leads } = await supabase.from("crm_leads").select("id, name").in("id", leadIds);
        const nameMap = new Map((leads || []).map((l: any) => [l.id, l.name]));
        rawTasks.forEach((t) => (t.lead_name = nameMap.get(t.lead_id) || "Lead"));
      }

      setTasks(rawTasks);
      setProfiles((profilesRes.data as Profile[]) || []);
    };
    fetchAll();
  }, []);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (filterUser && t.assigned_to !== filterUser) return false;
      if (filterType && t.type !== filterType) return false;
      return true;
    });
  }, [tasks, filterUser, filterType]);

  const days = useMemo(() => {
    if (view === "month") {
      const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 });
      const end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 });
      return eachDayOfInterval({ start, end });
    } else {
      const start = startOfWeek(currentDate, { weekStartsOn: 0 });
      const end = endOfWeek(currentDate, { weekStartsOn: 0 });
      return eachDayOfInterval({ start, end });
    }
  }, [currentDate, view]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    filteredTasks.forEach((t) => {
      const key = format(new Date(t.due_date), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    });
    return map;
  }, [filteredTasks]);

  const getStatus = (task: Task) => {
    if (task.status === "done") return "done";
    if (isPast(new Date(task.due_date))) return "late";
    return "pending";
  };

  const nav = (dir: number) => {
    setCurrentDate((prev) => view === "month" ? (dir > 0 ? addMonths(prev, 1) : subMonths(prev, 1)) : (dir > 0 ? addWeeks(prev, 1) : subWeeks(prev, 1)));
  };

  const dayTasks = selectedDay ? tasksByDay.get(format(selectedDay, "yyyy-MM-dd")) || [] : [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => nav(-1)}><ChevronLeft size={16} /></Button>
          <h2 className="text-lg font-bold text-foreground min-w-[180px] text-center">
            {format(currentDate, view === "month" ? "MMMM yyyy" : "'Semana de' dd MMM", { locale: ptBR })}
          </h2>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => nav(1)}><ChevronRight size={16} /></Button>
        </div>
        <div className="flex items-center gap-2">
          <Select value={view} onValueChange={(v) => setView(v as any)}>
            <SelectTrigger className="h-8 text-xs w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Mensal</SelectItem>
              <SelectItem value="week">Semanal</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-8 text-xs w-[120px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="agendamento">Agendamento</SelectItem>
              <SelectItem value="ligacao">Ligação</SelectItem>
              <SelectItem value="followup">Follow-up</SelectItem>
              <SelectItem value="personalizado">Personalizado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterUser} onValueChange={setFilterUser}>
            <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue placeholder="Responsável" /></SelectTrigger>
            <SelectContent>
              {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          {(filterType || filterUser) && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFilterType(""); setFilterUser(""); }}>Limpar</Button>
          )}
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1 flex-shrink-0">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className={cn("grid grid-cols-7 flex-1 gap-px bg-border rounded-lg overflow-hidden", view === "week" ? "grid-rows-1" : "")}>
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayTs = tasksByDay.get(key) || [];
          const hasLate = dayTs.some((t) => getStatus(t) === "late");
          const inMonth = isSameMonth(day, currentDate);

          return (
            <div
              key={key}
              onClick={() => setSelectedDay(day)}
              className={cn(
                "bg-card p-1 min-h-[80px] cursor-pointer hover:bg-secondary/50 transition-colors relative",
                !inMonth && view === "month" && "opacity-40",
                isToday(day) && "ring-1 ring-primary/50",
                selectedDay && isSameDay(day, selectedDay) && "bg-primary/5"
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn("text-xs font-medium", isToday(day) ? "text-primary" : "text-foreground")}>{format(day, "d")}</span>
                {hasLate && <span className="w-2 h-2 rounded-full bg-destructive" />}
              </div>
              <div className="mt-0.5 space-y-0.5">
                {dayTs.slice(0, 3).map((t) => {
                  const st = getStatus(t);
                  return (
                    <div
                      key={t.id}
                      onClick={(e) => { e.stopPropagation(); setSelectedTask(t); }}
                      className={cn(
                        "text-[10px] px-1 py-0.5 rounded truncate cursor-pointer",
                        st === "done" && "bg-green-500/20 text-green-700",
                        st === "late" && "bg-destructive/20 text-destructive",
                        st === "pending" && "bg-primary/20 text-primary"
                      )}
                    >
                      {t.title}
                    </div>
                  );
                })}
                {dayTs.length > 3 && <div className="text-[9px] text-muted-foreground pl-1">+{dayTs.length - 3} mais</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Day summary */}
      {selectedDay && dayTasks.length > 0 && (
        <div className="mt-3 p-3 bg-card border border-border rounded-lg flex-shrink-0">
          <h3 className="text-sm font-medium text-foreground mb-2">
            Tarefas de {format(selectedDay, "dd 'de' MMMM", { locale: ptBR })}
          </h3>
          <div className="space-y-1.5">
            {dayTasks.map((t) => {
              const st = getStatus(t);
              const Icon = typeIcons[t.type] || Clock;
              return (
                <div
                  key={t.id}
                  onClick={() => setSelectedTask(t)}
                  className="flex items-center gap-2 p-2 rounded-md bg-secondary/50 text-xs cursor-pointer hover:bg-secondary transition-colors"
                >
                  {st === "done" ? <CheckCircle2 size={14} className="text-green-500" /> : st === "late" ? <AlertTriangle size={14} className="text-destructive" /> : <Circle size={14} className="text-primary" />}
                  <Icon size={12} className="text-muted-foreground" />
                  <span className="flex-1 truncate font-medium">{t.title}</span>
                  <span className="text-muted-foreground">{t.lead_name}</span>
                  <span className={cn("text-muted-foreground", st === "late" && "text-destructive")}>{format(new Date(t.due_date), "HH:mm")}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Task detail dialog */}
      <Dialog open={!!selectedTask} onOpenChange={(o) => { if (!o) setSelectedTask(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{selectedTask?.title}</DialogTitle></DialogHeader>
          {selectedTask && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant={getStatus(selectedTask) === "done" ? "default" : getStatus(selectedTask) === "late" ? "destructive" : "secondary"}>
                  {getStatus(selectedTask) === "done" ? "Concluída" : getStatus(selectedTask) === "late" ? "Atrasada" : "Pendente"}
                </Badge>
                <Badge variant="outline">{typeLabels[selectedTask.type]}</Badge>
              </div>
              <div className="text-muted-foreground">
                <CalendarDays size={14} className="inline mr-1" />
                {format(new Date(selectedTask.due_date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </div>
              {selectedTask.lead_name && (
                <div>
                  <span className="text-muted-foreground">Lead: </span>
                  <span className="font-medium">{selectedTask.lead_name}</span>
                </div>
              )}
              {selectedTask.notes && <p className="text-muted-foreground bg-secondary/50 p-2 rounded">{selectedTask.notes}</p>}
              <Button size="sm" variant="outline" className="w-full" onClick={() => { setSelectedTask(null); navigate(`/crm/conversa/${selectedTask.lead_id}`); }}>
                Ir para conversa
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
