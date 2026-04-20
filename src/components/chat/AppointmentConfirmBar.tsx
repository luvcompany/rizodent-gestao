import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, CalendarCheck, CheckCircle2, Plus, Pencil, Trash2, X } from "lucide-react";
import { format, isPast } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { executeStageAutomations } from "@/lib/automationUtils";

type Task = {
  id: string;
  title: string;
  due_date: string;
  type: string;
  status: string;
  notes: string | null;
};

type Appointment = {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  notes: string | null;
  task_id: string | null;
};

export default function AppointmentConfirmBar({ leadId }: { leadId: string }) {
  const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState("09:00");
  const [saving, setSaving] = useState(false);

  // Manual scheduling state
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDate, setManualDate] = useState<Date | undefined>(undefined);
  const [manualTime, setManualTime] = useState("09:00");
  const [manualNotes, setManualNotes] = useState("");
  const [manualSaving, setManualSaving] = useState(false);

  // Edit appointment state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState<Date | undefined>(undefined);
  const [editTime, setEditTime] = useState("09:00");
  const [editNotes, setEditNotes] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const [isRescheduleMode, setIsRescheduleMode] = useState(false);

  const fetchTasks = useCallback(async () => {
    const { data } = await supabase
      .from("crm_tasks")
      .select("id, title, due_date, type, status, notes")
      .eq("lead_id", leadId)
      .eq("type", "agendamento")
      .eq("status", "pending")
      .order("due_date");
    setPendingTasks((data as Task[]) || []);
  }, [leadId]);

  const fetchAppointments = useCallback(async () => {
    const { data } = await supabase
      .from("crm_appointments")
      .select("id, scheduled_date, scheduled_time, status, notes, task_id")
      .eq("lead_id", leadId)
      .in("status", ["confirmed", "pending"])
      .order("scheduled_date", { ascending: true });
    setAppointments((data as Appointment[]) || []);
  }, [leadId]);

  const checkRescheduleMode = useCallback(async () => {
    const { data: leadData } = await supabase.from("crm_leads").select("stage_id").eq("id", leadId).single();
    if (leadData?.stage_id) {
      const { data: stageData } = await supabase.from("crm_stages").select("name").eq("id", leadData.stage_id).single();
      const sn = stageData?.name?.toLowerCase() || "";
      setIsRescheduleMode(
        sn.includes("não compareceu") ||
        sn.includes("reagend") || false
      );
    }
  }, [leadId]);

  useEffect(() => {
    fetchTasks();
    fetchAppointments();
    checkRescheduleMode();
  }, [fetchTasks, fetchAppointments, checkRescheduleMode]);

  // Realtime for tasks and appointments
  useEffect(() => {
    const ch1 = supabase
      .channel(`appt-tasks-${leadId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_tasks", filter: `lead_id=eq.${leadId}` }, () => fetchTasks())
      .subscribe();
    const ch2 = supabase
      .channel(`appt-records-${leadId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_appointments", filter: `lead_id=eq.${leadId}` }, () => {
        fetchAppointments();
        checkRescheduleMode();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); };
  }, [leadId, fetchTasks, fetchAppointments, checkRescheduleMode]);

  const moveLeadToScheduledStage = useCallback(async () => {
    const { data: leadData } = await supabase
      .from("crm_leads")
      .select("stage_id, pipeline_id")
      .eq("id", leadId)
      .single();

    if (!leadData) return null;

    const { data: allStages } = await supabase
      .from("crm_stages")
      .select("id, name, pipeline_id")
      .eq("pipeline_id", leadData.pipeline_id)
      .order("position");

    const currentStageId = leadData.stage_id;
    const currentStage = allStages?.find((stage) => stage.id === currentStageId);

    // Prefer exact "Agendado" stage, excluding "Pré-agendado", "Reagendado", etc.
    const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const isPreOrRe = (n: string) => n.includes("pre") || n.includes("pré") || n.startsWith("reagend") || n.includes("nao compareceu") || n.includes("não compareceu");

    let scheduledStage = allStages?.find((stage) => {
      const n = normalize(stage.name);
      return (n === "agendado" || n === "agendados" || n === "agendamento" || n === "agendamentos");
    });
    // Fallback: any stage containing "agendad"/"agendamento" but NOT pre/re/no-show
    if (!scheduledStage) {
      scheduledStage = allStages?.find((stage) => {
        const n = normalize(stage.name);
        return (n.includes("agendad") || n.includes("agendamento")) && !isPreOrRe(n);
      });
    }

    if (!scheduledStage || scheduledStage.id === currentStageId) {
      return leadData.stage_id;
    }

    const nowIso = new Date().toISOString();

    const { error: moveError } = await supabase
      .from("crm_leads")
      .update({ stage_id: scheduledStage.id, updated_at: nowIso })
      .eq("id", leadId);

    if (moveError) throw moveError;

    const { data: openEntry } = await supabase
      .from("crm_lead_stage_history")
      .select("id")
      .eq("lead_id", leadId)
      .eq("stage_id", currentStageId)
      .is("exited_at", null)
      .maybeSingle();

    if (openEntry) {
      await supabase
        .from("crm_lead_stage_history")
        .update({ exited_at: nowIso })
        .eq("id", openEntry.id);
    }

    await supabase.from("crm_lead_stage_history").insert({
      lead_id: leadId,
      stage_id: scheduledStage.id,
      from_stage_id: currentStageId,
      entered_at: nowIso,
    } as any);

    await supabase.from("messages").insert({
      lead_id: leadId,
      direction: "outbound",
      type: "system",
      content: `📋 Etapa alterada: ${currentStage?.name || "Etapa anterior"} → ${scheduledStage.name}`,
      status: "system",
    });

    return scheduledStage.id;
  }, [leadId]);

  const handleConfirm = async (task: Task) => {
    if (!date) { toast.error("Selecione a data do agendamento"); return; }
    setSaving(true);
    const { data: session } = await supabase.auth.getSession();
    const userId = session?.session?.user?.id;

    const { error: apptError } = await supabase.from("crm_appointments").insert({
      lead_id: leadId, task_id: task.id,
      scheduled_date: format(date, "yyyy-MM-dd"), scheduled_time: time,
      status: "confirmed", notes: task.notes,
      confirmed_by: userId || null, confirmed_at: new Date().toISOString(),
    });
    if (apptError) { toast.error("Erro ao criar agendamento"); setSaving(false); return; }

    await supabase.from("crm_tasks").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", task.id);

    const movedStageId = await moveLeadToScheduledStage();

    await supabase.from("messages").insert({
      lead_id: leadId, direction: "outbound", type: "system",
      content: `✅ Agendamento confirmado: ${format(date, "dd/MM/yyyy")} às ${time}`, status: "system",
    });

    const { data: leadForAuto } = await supabase.from("crm_leads").select("stage_id, phone").eq("id", leadId).single();
    if (leadForAuto) {
      executeStageAutomations({
        leadId,
        stageId: movedStageId || leadForAuto.stage_id,
        leadPhone: leadForAuto.phone,
        triggerTypes: ["after_appointment_confirmed"],
      }).catch(e => console.error("[Appointment] Automation error:", e));
    }

    toast.success("Agendamento confirmado!");
    setConfirmingId(null); setDate(undefined); setTime("09:00"); setSaving(false);
    await Promise.all([fetchAppointments(), fetchTasks(), checkRescheduleMode()]);
  };

  const handleManualSchedule = async () => {
    if (!manualDate) { toast.error("Selecione a data do agendamento"); return; }
    setManualSaving(true);
    const { data: session } = await supabase.auth.getSession();
    const userId = session?.session?.user?.id;

    const { error: apptError } = await supabase.from("crm_appointments").insert({
      lead_id: leadId,
      scheduled_date: format(manualDate, "yyyy-MM-dd"), scheduled_time: manualTime,
      status: "confirmed", notes: manualNotes || null,
      confirmed_by: userId || null, confirmed_at: new Date().toISOString(),
      is_rescheduled: isRescheduleMode,
    } as any);
    if (apptError) { toast.error("Erro ao criar agendamento"); setManualSaving(false); return; }

    // Auto-conclude any pending scheduling tasks for this lead
    if (pendingTasks.length > 0) {
      await supabase
        .from("crm_tasks")
        .update({ status: "done", updated_at: new Date().toISOString() })
        .in("id", pendingTasks.map(t => t.id));
    }

    const movedStageId = await moveLeadToScheduledStage();

    const label = isRescheduleMode ? "Reagendamento" : "Agendamento";
    await supabase.from("messages").insert({
      lead_id: leadId, direction: "outbound", type: "system",
      content: `✅ ${label} confirmado: ${format(manualDate, "dd/MM/yyyy")} às ${manualTime}`, status: "system",
    });

    const { data: leadForAuto2 } = await supabase.from("crm_leads").select("stage_id, phone").eq("id", leadId).single();
    if (leadForAuto2) {
      executeStageAutomations({
        leadId,
        stageId: movedStageId || leadForAuto2.stage_id,
        leadPhone: leadForAuto2.phone,
        triggerTypes: ["after_appointment_confirmed"],
      }).catch(e => console.error("[Appointment] Automation error:", e));
    }

    toast.success(`${label} confirmado!`);
    setManualOpen(false); setManualDate(undefined); setManualTime("09:00"); setManualNotes(""); setManualSaving(false);
    await Promise.all([fetchAppointments(), checkRescheduleMode()]);
  };

  const handleEditAppointment = async (appt: Appointment) => {
    if (!editDate) { toast.error("Selecione a data"); return; }
    setEditSaving(true);
    await supabase.from("crm_appointments").update({
      scheduled_date: format(editDate, "yyyy-MM-dd"),
      scheduled_time: editTime,
      notes: editNotes || null,
      updated_at: new Date().toISOString(),
    }).eq("id", appt.id);

    await supabase.from("messages").insert({
      lead_id: leadId, direction: "outbound", type: "system",
      content: `📅 Agendamento atualizado: ${format(editDate, "dd/MM/yyyy")} às ${editTime}`, status: "system",
    });

    toast.success("Agendamento atualizado!");
    setEditingId(null); setEditSaving(false);
    await fetchAppointments();
  };

  const handleDeleteAppointment = async (appt: Appointment) => {
    await supabase.from("crm_appointments").delete().eq("id", appt.id);
    await supabase.from("messages").insert({
      lead_id: leadId, direction: "outbound", type: "system",
      content: `❌ Agendamento cancelado`, status: "system",
    });
    toast.success("Agendamento excluído");
    await fetchAppointments();
  };

  const handleDeletePendingTask = async (taskId: string) => {
    const { error } = await supabase.from("crm_tasks").delete().eq("id", taskId);
    if (error) { toast.error("Erro ao excluir solicitação"); return; }
    toast.success("Solicitação excluída");
    fetchTasks();
  };

  return (
    <div className="p-4 border-b border-border">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase flex items-center gap-1.5">
          <CalendarCheck size={12} />
          Agendamento
        </h3>
        {pendingTasks.length > 0 && (
          <span className="text-xs text-orange-600 font-medium">{pendingTasks.length} pendente(s)</span>
        )}
      </div>

      {/* Existing confirmed appointments */}
      {appointments.map(appt => {
        const isEditing = editingId === appt.id;
        const apptDate = new Date(appt.scheduled_date + "T12:00:00");

        if (isEditing) {
          return (
            <div key={appt.id} className="mb-2 p-3 rounded-lg border border-primary/30 bg-primary/5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">Editar agendamento</span>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditingId(null)}>
                  <X size={12} />
                </Button>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">Data</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("h-8 text-xs w-full justify-start", !editDate && "text-muted-foreground")}>
                      <CalendarIcon size={12} className="mr-1.5" />
                      {editDate ? format(editDate, "dd/MM/yyyy") : "Selecionar data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={editDate} onSelect={setEditDate} locale={ptBR} className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">Horário</label>
                <Input type="time" value={editTime} onChange={e => setEditTime(e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">Observações</label>
                <Input value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Opcional..." className="h-8 text-xs" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => setEditingId(null)}>Cancelar</Button>
                <Button size="sm" className="flex-1 h-7 text-xs bg-primary hover:bg-primary/90 text-primary-foreground gap-1" onClick={() => handleEditAppointment(appt)} disabled={editSaving}>
                  {editSaving ? "Salvando..." : "Salvar"}
                </Button>
              </div>
            </div>
          );
        }

        return (
          <div key={appt.id} className="mb-2 p-3 rounded-lg border border-green-500/30 bg-green-500/10 flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={12} className="text-green-600 shrink-0" />
                <span className="text-sm font-medium text-foreground">
                  {format(apptDate, "dd/MM/yyyy")} às {appt.scheduled_time?.slice(0, 5)}
                </span>
              </div>
              {appt.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{appt.notes}</p>}
            </div>
            <div className="flex items-center gap-1 ml-2 shrink-0">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => {
                setEditingId(appt.id);
                setEditDate(apptDate);
                setEditTime(appt.scheduled_time?.slice(0, 5) || "09:00");
                setEditNotes(appt.notes || "");
              }}>
                <Pencil size={12} />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDeleteAppointment(appt)}>
                <Trash2 size={12} />
              </Button>
            </div>
          </div>
        );
      })}

      {/* Manual scheduling button */}
      {!manualOpen ? (
        <Button variant="outline" size="sm" className="w-full h-8 text-sm gap-1.5 mb-2" onClick={() => setManualOpen(true)}>
          <Plus size={14} /> {isRescheduleMode ? "Reagendar" : "Agendar manualmente"}
        </Button>
      ) : (
        <div className="space-y-2 mb-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block">Data</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("h-8 text-xs w-full justify-start", !manualDate && "text-muted-foreground")}>
                  <CalendarIcon size={12} className="mr-1.5" />
                  {manualDate ? format(manualDate, "dd/MM/yyyy") : "Selecionar data"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={manualDate} onSelect={setManualDate} locale={ptBR} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block">Horário</label>
            <Input type="time" value={manualTime} onChange={e => setManualTime(e.target.value)} className="h-8 text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block">Observações</label>
            <Input value={manualNotes} onChange={e => setManualNotes(e.target.value)} placeholder="Opcional..." className="h-8 text-xs" />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => { setManualOpen(false); setManualDate(undefined); }}>Cancelar</Button>
            <Button size="sm" className="flex-1 h-7 text-xs bg-green-600 hover:bg-green-700 text-white gap-1" onClick={handleManualSchedule} disabled={manualSaving}>
              {manualSaving ? "Salvando..." : isRescheduleMode ? "Reagendar" : "Agendar"}
            </Button>
          </div>
        </div>
      )}

      {/* Pending appointment tasks */}
      {pendingTasks.length > 0 && (
        <div className="space-y-2">
          {pendingTasks.map(task => {
            const isConfirming = confirmingId === task.id;
            const taskDate = new Date(task.due_date);
            return (
              <div key={task.id} className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-foreground">{task.title}</span>
                  <span className={cn("text-[10px]", isPast(taskDate) ? "text-destructive" : "text-muted-foreground")}>
                    {format(taskDate, "dd/MM HH:mm")}
                  </span>
                </div>
                {task.notes && <p className="text-xs text-muted-foreground mb-2">{task.notes}</p>}
                {!isConfirming ? (
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1 h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white" onClick={() => {
                      setConfirmingId(task.id); setDate(taskDate); setTime(format(taskDate, "HH:mm"));
                    }}>
                      <CheckCircle2 size={12} /> Confirmar Agendamento
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeletePendingTask(task.id)} title="Excluir solicitação">
                      <Trash2 size={12} />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2 mt-2 pt-2 border-t border-orange-500/20">
                    <div>
                      <label className="text-[10px] text-muted-foreground mb-1 block">Data</label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className={cn("h-8 text-xs w-full justify-start", !date && "text-muted-foreground")}>
                            <CalendarIcon size={12} className="mr-1.5" />
                            {date ? format(date, "dd/MM/yyyy") : "Selecionar data"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={date} onSelect={setDate} locale={ptBR} className="p-3 pointer-events-auto" />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground mb-1 block">Horário</label>
                      <Input type="time" value={time} onChange={e => setTime(e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => { setConfirmingId(null); setDate(undefined); }}>Cancelar</Button>
                      <Button size="sm" className="flex-1 h-7 text-xs bg-green-600 hover:bg-green-700 text-white gap-1" onClick={() => handleConfirm(task)} disabled={saving}>
                        {saving ? "Confirmando..." : "Confirmar"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
