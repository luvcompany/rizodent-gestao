import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, CheckCircle2, Circle, Clock, Phone, CalendarDays, MessageSquare, Plus, AlertTriangle } from "lucide-react";
import { format, isPast } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
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
  created_at: string;
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

export default function TaskPanel({ leadId }: { leadId: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("personalizado");
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [dueTime, setDueTime] = useState("09:00");
  const [notes, setNotes] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchTasks = async () => {
    const { data } = await supabase
      .from("crm_tasks")
      .select("*")
      .eq("lead_id", leadId)
      .order("due_date", { ascending: true });
    setTasks((data as Task[]) || []);
  };

  useEffect(() => {
    fetchTasks();
    supabase.from("profiles").select("id, nome").then(({ data }) => setProfiles((data as Profile[]) || []));
  }, [leadId]);

  const handleSave = async () => {
    if (!title.trim() || !dueDate) { toast.error("Preencha título e data"); return; }
    setSaving(true);
    const [h, m] = dueTime.split(":").map(Number);
    const dt = new Date(dueDate);
    dt.setHours(h, m, 0, 0);

    const { error } = await supabase.from("crm_tasks").insert({
      lead_id: leadId,
      title: title.trim(),
      type,
      due_date: dt.toISOString(),
      notes: notes.trim() || null,
      assigned_to: assignedTo || null,
    });
    setSaving(false);
    if (error) { toast.error("Erro ao salvar tarefa"); return; }
    toast.success("Tarefa criada");
    setDialogOpen(false);
    setTitle(""); setType("personalizado"); setDueDate(undefined); setDueTime("09:00"); setNotes(""); setAssignedTo("");
    fetchTasks();
  };

  const toggleDone = async (task: Task) => {
    const newStatus = task.status === "done" ? "pending" : "done";
    await supabase.from("crm_tasks").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", task.id);
    fetchTasks();
  };

  const getStatus = (task: Task) => {
    if (task.status === "done") return "done";
    if (isPast(new Date(task.due_date))) return "late";
    return "pending";
  };

  return (
    <div className="p-4 border-b border-border">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase">Tarefas</h3>
        <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setDialogOpen(true)}>
          <Plus size={12} /> Adicionar
        </Button>
      </div>

      {tasks.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma tarefa</p>}

      <div className="space-y-1.5">
        {tasks.map((task) => {
          const st = getStatus(task);
          const Icon = typeIcons[task.type] || Clock;
          return (
            <div key={task.id} className="flex items-start gap-2 p-2 rounded-md bg-secondary/50 text-xs">
              <button onClick={() => toggleDone(task)} className="mt-0.5 flex-shrink-0">
                {st === "done" ? (
                  <CheckCircle2 size={16} className="text-green-500" />
                ) : st === "late" ? (
                  <AlertTriangle size={16} className="text-destructive" />
                ) : (
                  <Circle size={16} className="text-muted-foreground" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <div className={cn("font-medium", st === "done" && "line-through text-muted-foreground")}>{task.title}</div>
                <div className="flex items-center gap-1.5 mt-0.5 text-muted-foreground">
                  <Icon size={10} />
                  <span>{typeLabels[task.type]}</span>
                  <span>·</span>
                  <span className={cn(st === "late" && "text-destructive font-medium")}>
                    {format(new Date(task.due_date), "dd/MM HH:mm")}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nova Tarefa</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Título</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Ligar para o lead" className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Tipo</label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="agendamento">Agendamento</SelectItem>
                  <SelectItem value="ligacao">Ligação</SelectItem>
                  <SelectItem value="followup">Follow-up</SelectItem>
                  <SelectItem value="personalizado">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">Data</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("h-8 text-sm w-full justify-start", !dueDate && "text-muted-foreground")}>
                      <CalendarIcon size={14} className="mr-1" />
                      {dueDate ? format(dueDate, "dd/MM/yyyy") : "Selecionar"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={dueDate} onSelect={setDueDate} className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="w-24">
                <label className="text-xs text-muted-foreground mb-1 block">Hora</label>
                <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="h-8 text-sm" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Observação</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações..." className="text-sm min-h-[60px]" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Responsável</label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando..." : "Criar Tarefa"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
