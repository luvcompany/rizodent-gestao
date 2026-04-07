import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, CalendarCheck, CheckCircle2, Plus } from "lucide-react";
import { format, isPast } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Task = {
  id: string;
  title: string;
  due_date: string;
  type: string;
  status: string;
  notes: string | null;
};

export default function AppointmentConfirmBar({ leadId }: { leadId: string }) {
  const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
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

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // Realtime subscription for instant updates
  useEffect(() => {
    const channel = supabase
      .channel(`appt-tasks-${leadId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "crm_tasks",
        filter: `lead_id=eq.${leadId}`,
      }, () => fetchTasks())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [leadId, fetchTasks]);

  const handleConfirm = async (task: Task) => {
    if (!date) {
      toast.error("Selecione a data do agendamento");
      return;
    }
    setSaving(true);

    const { data: session } = await supabase.auth.getSession();
    const userId = session?.session?.user?.id;

    const { error: apptError } = await supabase.from("crm_appointments").insert({
      lead_id: leadId,
      task_id: task.id,
      scheduled_date: format(date, "yyyy-MM-dd"),
      scheduled_time: time,
      status: "confirmed",
      notes: task.notes,
      confirmed_by: userId || null,
      confirmed_at: new Date().toISOString(),
    });

    if (apptError) {
      toast.error("Erro ao criar agendamento");
      setSaving(false);
      return;
    }

    // Mark task as done
    await supabase.from("crm_tasks").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", task.id);

    // Insert system message
    await supabase.from("messages").insert({
      lead_id: leadId,
      direction: "outbound",
      type: "system",
      content: `✅ Agendamento confirmado: ${format(date, "dd/MM/yyyy")} às ${time}`,
      status: "system",
    });

    toast.success("Agendamento confirmado!");
    setPendingTasks(prev => prev.filter(t => t.id !== task.id));
    setConfirmingId(null);
    setDate(undefined);
    setTime("09:00");
    setSaving(false);
  };

  const handleManualSchedule = async () => {
    if (!manualDate) {
      toast.error("Selecione a data do agendamento");
      return;
    }
    setManualSaving(true);

    const { data: session } = await supabase.auth.getSession();
    const userId = session?.session?.user?.id;

    // Check if lead is already in an "agendado" stage (for reschedule logic)
    const { data: leadData } = await supabase.from("crm_leads").select("stage_id").eq("id", leadId).single();
    const { data: stageData } = leadData?.stage_id
      ? await supabase.from("crm_stages").select("name").eq("id", leadData.stage_id).single()
      : { data: null };
    const isReschedule = stageData?.name?.toLowerCase().includes("agendado") || stageData?.name?.toLowerCase().includes("reagend");

    const { error: apptError } = await supabase.from("crm_appointments").insert({
      lead_id: leadId,
      scheduled_date: format(manualDate, "yyyy-MM-dd"),
      scheduled_time: manualTime,
      status: "confirmed",
      notes: manualNotes || null,
      confirmed_by: userId || null,
      confirmed_at: new Date().toISOString(),
    });

    if (apptError) {
      toast.error("Erro ao criar agendamento");
      setManualSaving(false);
      return;
    }

    // Move lead to "agendado" stage if not already there
    const { data: allStages } = await supabase.from("crm_stages").select("id, name, pipeline_id").order("position");
    if (allStages && leadData) {
      const currentStage = allStages.find(s => s.id === leadData.stage_id);
      const agendadoStage = allStages.find(s =>
        s.pipeline_id === currentStage?.pipeline_id &&
        (s.name.toLowerCase().includes("agendado") || s.name.toLowerCase().includes("agendamento"))
      );
      if (agendadoStage && agendadoStage.id !== leadData.stage_id) {
        await supabase.from("crm_leads").update({ stage_id: agendadoStage.id, updated_at: new Date().toISOString() }).eq("id", leadId);
      }
    }

    // Insert system message
    const label = isReschedule ? "Reagendamento" : "Agendamento";
    await supabase.from("messages").insert({
      lead_id: leadId,
      direction: "outbound",
      type: "system",
      content: `✅ ${label} confirmado: ${format(manualDate, "dd/MM/yyyy")} às ${manualTime}`,
      status: "system",
    });

    toast.success(`${label} confirmado!`);
    setManualOpen(false);
    setManualDate(undefined);
    setManualTime("09:00");
    setManualNotes("");
    setManualSaving(false);
  };

  // Check if lead is in an "agendado" stage for label
  const [isRescheduleMode, setIsRescheduleMode] = useState(false);
  useEffect(() => {
    (async () => {
      const { data: leadData } = await supabase.from("crm_leads").select("stage_id").eq("id", leadId).single();
      if (leadData?.stage_id) {
        const { data: stageData } = await supabase.from("crm_stages").select("name").eq("id", leadData.stage_id).single();
        setIsRescheduleMode(
          stageData?.name?.toLowerCase().includes("agendado") ||
          stageData?.name?.toLowerCase().includes("reagend") || false
        );
      }
    })();
  }, [leadId]);

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

      {/* Manual scheduling button */}
      {!manualOpen ? (
        <Button
          variant="outline"
          size="sm"
          className="w-full h-7 text-xs gap-1 mb-2"
          onClick={() => setManualOpen(true)}
        >
          <Plus size={12} /> {isRescheduleMode ? "Reagendar" : "Agendar manualmente"}
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
            <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => { setManualOpen(false); setManualDate(undefined); }}>
              Cancelar
            </Button>
            <Button
              size="sm"
              className="flex-1 h-7 text-xs bg-green-600 hover:bg-green-700 text-white gap-1"
              onClick={handleManualSchedule}
              disabled={manualSaving}
            >
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
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1 w-full bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => {
                      setConfirmingId(task.id);
                      setDate(taskDate);
                      setTime(format(taskDate, "HH:mm"));
                    }}
                  >
                    <CheckCircle2 size={12} /> Confirmar Agendamento
                  </Button>
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
                      <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => { setConfirmingId(null); setDate(undefined); }}>
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 h-7 text-xs bg-green-600 hover:bg-green-700 text-white gap-1"
                        onClick={() => handleConfirm(task)}
                        disabled={saving}
                      >
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
