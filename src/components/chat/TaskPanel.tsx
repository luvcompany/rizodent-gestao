import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HIDDEN_USER_IDS_PG } from "@/lib/hiddenUsers";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, CheckCircle2, Circle, Plus, AlertTriangle, Pencil, Trash2, ListTodo } from "lucide-react";
import { ptBR } from "date-fns/locale";
import { format, isPast, startOfToday } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { mensagemDeErro } from "@/lib/mensagemDeErro";
import { ROTULO_TIPO_DE_TAREFA, TIPOS_DE_TAREFA, iconeTipoDeTarefa, rotuloTipoDeTarefa, tipoDeTarefa } from "@/lib/tarefaTipo";

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

// Rótulo e ícone do tipo: src/lib/tarefaTipo.ts (fonte única com o
// Calendário; traduz também 'call' e 'follow_up', gravados pelas automações —
// antes apareciam crus aqui e no Calendário).

/** Instante da tarefa: o dia escolhido às HH:MM (hora do navegador, como sempre foi). */
function instanteDaTarefa(dia: Date, hora: string): Date {
  const [h, m] = hora.split(":").map(Number);
  const dt = new Date(dia);
  dt.setHours(h || 0, m || 0, 0, 0);
  return dt;
}

export default function TaskPanel({ leadId }: { leadId: string }) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  // Carregando: sem isto a tela dizia "Nenhuma tarefa" enquanto buscava.
  const [carregando, setCarregando] = useState(true);
  const [erroAoCarregar, setErroAoCarregar] = useState(false);
  // Lead da última busca: resposta atrasada de outro lead não sobrescreve a lista.
  const leadAtualRef = useRef(leadId);
  leadAtualRef.current = leadId;
  const [calendarioAberto, setCalendarioAberto] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("personalizado");
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [dueTime, setDueTime] = useState("09:00");
  const [notes, setNotes] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchTasks = async () => {
    const doLead = leadId;
    const { data, error } = await supabase
      .from("crm_tasks")
      .select("*")
      .eq("lead_id", doLead)
      .order("due_date", { ascending: true });
    if (leadAtualRef.current !== doLead) return;
    setErroAoCarregar(!!error);
    if (error) console.error("[TaskPanel] tarefas:", error.message);
    else setTasks((data as Task[]) || []);
    setCarregando(false);
  };

  useEffect(() => {
    setCarregando(true);
    setTasks([]);
    fetchTasks();
    supabase.from("profiles").select("id, nome").not("id","in",HIDDEN_USER_IDS_PG).then(({ data }) => setProfiles((data as Profile[]) || []));
  }, [leadId]);

  const resetForm = () => {
    setTitle(""); setType("personalizado"); setDueDate(undefined); setDueTime("09:00"); setNotes(""); setAssignedTo("");
    setEditingTask(null);
  };

  // Tarefa nova já nasce com quem está criando como Responsável (X-16): sem
  // responsável ela não entrava no contador do menu nem no lembrete de ninguém.
  const openCreate = () => {
    resetForm();
    setAssignedTo(user?.id ?? "");
    setDialogOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditingTask(task);
    setTitle(task.title);
    // 'call' → 'ligacao' etc.: o seletor mostra o tipo certo (e salvar grava o canônico).
    setType(tipoDeTarefa(task.type) ?? task.type);
    const d = new Date(task.due_date);
    setDueDate(d);
    setDueTime(format(d, "HH:mm"));
    setNotes(task.notes || "");
    setAssignedTo(task.assigned_to || "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!title.trim() || !dueDate) { toast.error("Preencha título e data"); return; }
    setSaving(true);
    const dt = instanteDaTarefa(dueDate, dueTime);

    const payload = {
      title: title.trim(),
      type,
      due_date: dt.toISOString(),
      notes: notes.trim() || null,
      assigned_to: assignedTo || null,
      updated_at: new Date().toISOString(),
    };

    if (editingTask) {
      // RLS que barra o update devolve sucesso com 0 linhas — o .select() torna isso visível.
      const { data, error } = await supabase.from("crm_tasks").update(payload).eq("id", editingTask.id).select("id");
      setSaving(false);
      if (error) { toast.error("Erro ao atualizar tarefa: " + mensagemDeErro(error)); return; }
      if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para editar esta tarefa."); return; }
      toast.success("Tarefa atualizada");
    } else {
      const { error } = await supabase.from("crm_tasks").insert({ ...payload, lead_id: leadId });
      setSaving(false);
      if (error) { toast.error("Erro ao salvar tarefa: " + mensagemDeErro(error)); return; }
      toast.success("Tarefa criada");
    }
    setDialogOpen(false);
    resetForm();
    fetchTasks();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { data, error } = await supabase.from("crm_tasks").delete().eq("id", deleteId).select("id");
    if (error) { toast.error("Erro ao excluir tarefa: " + mensagemDeErro(error)); return; }
    if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para excluir esta tarefa."); return; }
    toast.success("Tarefa excluída");
    setDeleteId(null);
    fetchTasks();
  };

  const toggleDone = async (task: Task) => {
    const newStatus = task.status === "done" ? "pending" : "done";
    const { data, error } = await supabase
      .from("crm_tasks")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", task.id)
      .select("id");
    if (error) { toast.error("Erro ao atualizar tarefa: " + mensagemDeErro(error)); return; }
    if (!data || data.length === 0) { toast.error("Seu perfil não tem permissão para atualizar esta tarefa."); return; }
    fetchTasks();
  };

  const getStatus = (task: Task) => {
    if (task.status === "done") return "done";
    if (isPast(new Date(task.due_date))) return "late";
    return "pending";
  };

  return (
    <div className="border-b border-border/60 px-5 py-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-2 gap-y-2.5">
        <h3 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-foreground">
          <ListTodo size={16} strokeWidth={1.75} className="shrink-0 text-tertiary" />
          Tarefas
        </h3>
        <Button variant="ghost" size="sm" className="-my-[5px] ml-auto h-8 shrink-0 gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-primary hover:bg-primary-soft-2 hover:text-primary" onClick={openCreate}>
          <Plus size={15} strokeWidth={1.75} /> Adicionar
        </Button>
      </div>

      {carregando ? (
        <div className="space-y-2" aria-busy="true" aria-label="Carregando tarefas">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      ) : erroAoCarregar ? (
        <p className="rounded-xl bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-destructive-soft-foreground">Não foi possível carregar as tarefas deste lead.</p>
      ) : tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface-sunken/60 px-4 py-3 text-center text-[13px] text-muted-foreground">Nenhuma tarefa</p>
      ) : null}

      <div className="space-y-2">
        {tasks.map((task) => {
          const st = getStatus(task);
          const Icon = iconeTipoDeTarefa(task.type);
          return (
            <div key={task.id} className={cn("group flex flex-wrap items-start gap-x-3 gap-y-1 rounded-xl border border-border/60 bg-card p-3 pb-2 text-xs transition-shadow hover:shadow-xs", st === "late" && "border-destructive/30 bg-destructive-soft/40", st === "done" && "bg-surface-sunken/60")}>
              <button onClick={() => toggleDone(task)} className="-m-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors hover:bg-surface-sunken">
                {st === "done" ? (
                  <CheckCircle2 size={18} strokeWidth={1.75} className="text-success" />
                ) : st === "late" ? (
                  <AlertTriangle size={18} strokeWidth={1.75} className="text-destructive" />
                ) : (
                  <Circle size={18} strokeWidth={1.75} className="text-tertiary" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className={cn("break-words text-[13px] font-semibold leading-snug text-foreground", st === "done" && "font-medium text-muted-foreground line-through")}>{task.title}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-muted-foreground">
                  <span className="inline-flex h-6 max-w-full items-center gap-1 whitespace-nowrap rounded-full bg-muted px-2.5 text-[11px] font-medium text-muted-foreground">
                    <Icon size={12} strokeWidth={1.75} className="shrink-0" />
                    <span className="truncate">{rotuloTipoDeTarefa(task.type)}</span>
                  </span>
                  <span className={cn("inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full bg-surface-sunken pl-2 pr-2.5 text-[11px] font-medium tabular-nums text-muted-foreground", st === "late" && "bg-destructive-soft font-semibold text-destructive-soft-foreground", st === "done" && "bg-success-soft text-success-soft-foreground")}>
                    <span className="text-base font-bold leading-none">·</span>
                    {format(new Date(task.due_date), "dd/MM HH:mm")}
                  </span>
                </div>
              </div>
              <div className="flex basis-full items-center justify-end gap-0.5">
                <button onClick={() => openEdit(task)} className="grid h-7 w-7 place-items-center rounded-lg text-tertiary transition-colors hover:bg-surface-sunken hover:text-foreground"><Pencil size={14} strokeWidth={1.75} /></button>
                <button onClick={() => setDeleteId(task.id)} className="grid h-7 w-7 place-items-center rounded-lg text-destructive/70 transition-colors hover:bg-destructive-soft hover:text-destructive"><Trash2 size={14} strokeWidth={1.75} /></button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { resetForm(); setCalendarioAberto(false); } setDialogOpen(open); }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle className="text-lg font-semibold tracking-tight">{editingTask ? "Editar Tarefa" : "Nova Tarefa"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Título</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Ligar para o lead" className="h-10 rounded-xl text-sm" />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Tipo</label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="h-10 rounded-xl text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS_DE_TAREFA.map((t) => <SelectItem key={t} value={t}>{ROTULO_TIPO_DE_TAREFA[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <div className="min-w-0 flex-1">
                <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Data</label>
                {/* Controlado: fecha ao escolher o dia (CRC-25). Dias passados
                    ficam desabilitados — tarefa nova não nasce vencida. */}
                <Popover open={calendarioAberto} onOpenChange={setCalendarioAberto}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("h-10 w-full justify-start gap-2 rounded-xl text-sm font-normal tabular-nums", !dueDate && "text-muted-foreground")}>
                      <CalendarIcon size={16} strokeWidth={1.75} className="shrink-0 text-tertiary" />
                      {dueDate ? format(dueDate, "dd/MM/yyyy") : "Selecionar"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto rounded-2xl p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dueDate}
                      onSelect={(d) => { setDueDate(d); if (d) setCalendarioAberto(false); }}
                      disabled={(d) => d < startOfToday()}
                      locale={ptBR}
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="w-28 shrink-0">
                <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Hora</label>
                <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="h-10 rounded-xl text-sm tabular-nums" />
              </div>
            </div>
            {/* Horário que já passou: avisa antes de salvar. Na edição a
                tarefa já existe — ela "fica" atrasada, não "nasce". */}
            {dueDate && instanteDaTarefa(dueDate, dueTime) < new Date() && (
              <p className="rounded-xl bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-destructive-soft-foreground">
                {editingTask
                  ? "Esse horário já passou — a tarefa fica atrasada."
                  : "Esse horário já passou — a tarefa vai nascer atrasada."}
              </p>
            )}
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Observação</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações..." className="min-h-20 rounded-xl text-sm" />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Responsável</label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger className="h-10 rounded-xl text-sm"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button className="h-10 rounded-xl px-5" onClick={handleSave} disabled={saving}>{saving ? "Salvando..." : editingTask ? "Salvar" : "Criar Tarefa"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader><DialogTitle className="text-lg font-semibold tracking-tight">Excluir tarefa?</DialogTitle></DialogHeader>
          <p className="text-sm leading-relaxed text-muted-foreground">Esta ação não pode ser desfeita.</p>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" className="h-10 rounded-xl px-4" onClick={() => setDeleteId(null)}>Cancelar</Button>
            <Button variant="destructive" className="h-10 rounded-xl px-5" onClick={handleDelete}>Excluir</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
