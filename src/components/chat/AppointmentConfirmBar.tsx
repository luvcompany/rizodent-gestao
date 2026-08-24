import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CalendarIcon, CalendarCheck, CheckCircle2, Plus, Pencil, Trash2, X, Handshake, XCircle, Repeat, Ban } from "lucide-react";
import { format, isPast, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { executeStageAutomations } from "@/lib/automationUtils";
import {
  applyAppointmentOutcome,
  moveLeadToStageInCurrentPipeline,
  moveLeadToNaoContratadosPipeline,
} from "@/lib/appointmentOutcome";
import { useAuth } from "@/contexts/AuthContext";
import {
  cancelAppointment, rescheduleAppointment, compareceuEAgendou,
  iniciarReagendamento, isBeforeScheduled, formatBahiaLabel, toastDbError,
} from "@/lib/appointmentActions";

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

type PickerMode = "reschedule" | "agendou";

/** Consulta que já recebeu desfecho (terminal) — usada quando não há consulta ativa. */
type TerminalAppointment = {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  notes: string | null;
  outcome_source: string | null;
  outcome_at: string | null;
  outcome_by: string | null;
};

const TERMINAL_STATUSES = ["no_show", "rescheduled", "cancelled", "contracted", "not_contracted"];

const TERMINAL_LABEL: Record<string, string> = {
  no_show: "Falta",
  rescheduled: "Remarcada",
  cancelled: "Cancelada",
  contracted: "Contratado",
  not_contracted: "Não contratado",
};

const AUTO_SOURCES = ["dontus-sync", "auto_reagendar_expirado", "service"];

/** "às 18:00" no fuso America/Bahia. */
function bahiaHourLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
}

function terminalSourceLabel(t: TerminalAppointment): string {
  const hora = bahiaHourLabel(t.outcome_at);
  const sufixo = hora ? ` às ${hora}` : "";
  if (t.outcome_source && AUTO_SOURCES.includes(t.outcome_source)) {
    return `definida automaticamente (sem confirmação no Dontus)${sufixo}`;
  }
  if (t.outcome_source === "ui") return `definida manualmente${sufixo}`;
  return hora ? `desfecho registrado${sufixo}` : "";
}

export default function AppointmentConfirmBar({ leadId }: { leadId: string }) {
  const { userRole } = useAuth();
  const isManager = userRole === "gerente" || userRole === "superadmin";
  const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [lastTerminal, setLastTerminal] = useState<TerminalAppointment | null>(null);
  const [terminalBusy, setTerminalBusy] = useState(false);
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
  // Lead está na etapa de espera "Reagendar" (pediu remarcação, ainda sem novo horário)
  const [isAwaitingReschedule, setIsAwaitingReschedule] = useState(false);

  // Novo horário (remarcação ou "compareceu e agendou")
  const [picker, setPicker] = useState<{ apptId: string; mode: PickerMode } | null>(null);
  const [pickerDate, setPickerDate] = useState<Date | undefined>(undefined);
  const [pickerTime, setPickerTime] = useState("09:00");
  const [pickerNotes, setPickerNotes] = useState("");
  const [pickerSaving, setPickerSaving] = useState(false);

  // Cancelamento com motivo
  const [cancelFor, setCancelFor] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSaving, setCancelSaving] = useState(false);

  // Confirmação extra para desfecho antes do horário marcado
  const [earlyConfirm, setEarlyConfirm] = useState<{ appt: Appointment; run: () => void } | null>(null);

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
    const ativos = (data as Appointment[]) || [];
    setAppointments(ativos);

    // Sem consulta ativa: o cron de comparecimento pode ter fechado a última
    // (no_show 3h depois). Mostramos a consulta terminal para não deixar o lead
    // sem caminho de ação na etapa Agendado.
    if (ativos.length === 0) {
      const { data: term } = await supabase
        .from("crm_appointments")
        .select("id, scheduled_date, scheduled_time, status, notes, outcome_source, outcome_at, outcome_by")
        .eq("lead_id", leadId)
        .in("status", TERMINAL_STATUSES)
        .order("scheduled_date", { ascending: false })
        .order("scheduled_time", { ascending: false })
        .limit(1);
      setLastTerminal(((term as TerminalAppointment[]) || [])[0] || null);
    } else {
      setLastTerminal(null);
    }
  }, [leadId]);

  const confirmedAppointments = appointments.filter((a) => a.status === "confirmed");
  const pendingAppointments = appointments.filter((a) => a.status === "pending");

  const [outcomeStep, setOutcomeStep] = useState<Record<string, "init" | "compareceu">>({});
  const [outcomeSaving, setOutcomeSaving] = useState<string | null>(null);

  const checkRescheduleMode = useCallback(async () => {
    const { data: leadData } = await supabase.from("crm_leads").select("stage_id").eq("id", leadId).single();
    if (leadData?.stage_id) {
      const { data: stageData } = await supabase.from("crm_stages").select("name").eq("id", leadData.stage_id).single();
      const sn = stageData?.name?.toLowerCase() || "";
      const snNorm = sn.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      setIsRescheduleMode(sn.includes("não compareceu") || sn.includes("reagend") || false);
      setIsAwaitingReschedule(snNorm === "reagendar");
    }
  }, [leadId]);

  const doOutcome = async (apptId: string, outcome: "no_show" | "contracted" | "not_contracted") => {
    setOutcomeSaving(apptId);
    try {
      const ok = await applyAppointmentOutcome({ leadId, appointmentId: apptId, outcome });
      if (!ok) {
        toast.error("Este agendamento já recebeu desfecho — recarregando");
      } else {
        toast.success(
          outcome === "no_show"
            ? "Lead movido para Não compareceu"
            : outcome === "contracted"
            ? "Lead movido para Contratado"
            : "Lead movido para etapa Não contratado",
        );
      }
      await Promise.all([fetchAppointments(), checkRescheduleMode()]);
      setOutcomeStep((prev) => {
        const { [apptId]: _, ...rest } = prev;
        return rest;
      });
    } catch (e) {
      toastDbError(e, "Erro ao registrar desfecho");
    } finally {
      setOutcomeSaving(null);
    }
  };

  /** Roda a ação, pedindo confirmação extra se ainda não chegou o horário marcado. */
  const guardEarly = (appt: Appointment, run: () => void) => {
    if (isBeforeScheduled(appt.scheduled_date, appt.scheduled_time)) {
      setEarlyConfirm({ appt, run });
      return;
    }
    run();
  };

  const openPicker = (appt: Appointment, mode: PickerMode) => {
    setPicker({ apptId: appt.id, mode });
    setPickerDate(undefined);
    setPickerTime("09:00");
    setPickerNotes("");
  };

  const [startingReschedule, setStartingReschedule] = useState(false);

  /** Passo 1 do reagendar: move para a etapa de espera "Reagendar" (o novo
   *  horário é registrado depois, quando o lead responder). Tenant sem a
   *  etapa cai no fluxo antigo: seletor de data direto. */
  const handleStartReschedule = async (appt: Appointment) => {
    setStartingReschedule(true);
    try {
      const ok = await iniciarReagendamento(leadId);
      if (!ok) { openPicker(appt, "reschedule"); return; }
      await checkRescheduleMode();
    } catch (e) {
      toastDbError(e, "Erro ao mover para Reagendar");
    } finally {
      setStartingReschedule(false);
    }
  };

  const handlePickerSubmit = async (appt: Appointment) => {
    if (!picker) return;
    if (!pickerDate) { toast.error("Selecione a nova data"); return; }
    setPickerSaving(true);
    try {
      const fn = picker.mode === "reschedule" ? rescheduleAppointment : compareceuEAgendou;
      const ok = await fn({
        leadId,
        old: { id: appt.id, scheduled_date: appt.scheduled_date, scheduled_time: appt.scheduled_time },
        newDate: format(pickerDate, "yyyy-MM-dd"),
        newTime: pickerTime,
        notes: pickerNotes || null,
      });
      if (ok) setPicker(null);
      await Promise.all([fetchAppointments(), checkRescheduleMode()]);
    } catch (e) {
      toastDbError(e);
    } finally {
      setPickerSaving(false);
    }
  };

  const handleCancelSubmit = async () => {
    if (!cancelFor) return;
    setCancelSaving(true);
    try {
      const ok = await cancelAppointment({ leadId, appointmentId: cancelFor.id, reason: cancelReason });
      if (ok) { setCancelFor(null); setCancelReason(""); }
      await fetchAppointments();
    } catch (e) {
      toastDbError(e, "Erro ao cancelar agendamento");
    } finally {
      setCancelSaving(false);
    }
  };

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
      .select("stage_id, pipeline_id, tenant_id")
      .eq("id", leadId)
      .single();

    if (!leadData) return null;

    const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const isPreOrRe = (n: string) =>
      n.includes("pre") || n.includes("pré") || n.startsWith("reagend") ||
      n.includes("nao compareceu") || n.includes("não compareceu");

    const pickStage = (stages: { id: string; name: string; pipeline_id: string }[] | null | undefined) => {
      if (!stages) return undefined;
      let found;
      if (isRescheduleMode) {
        found = stages.find((s) => normalize(s.name).startsWith("reagendado"));
        if (found) return found;
      }
      found = stages.find((s) => {
        const n = normalize(s.name);
        return (n === "agendado" || n === "agendados" || n === "agendamento" || n === "agendamentos");
      });
      if (found) return found;
      return stages.find((s) => {
        const n = normalize(s.name);
        return (n.includes("agendad") || n.includes("agendamento")) && !isPreOrRe(n);
      });
    };

    // 1) Tenta no pipeline atual
    const { data: currentStages } = await supabase
      .from("crm_stages")
      .select("id, name, pipeline_id")
      .eq("pipeline_id", leadData.pipeline_id)
      .order("position");

    const currentStageId = leadData.stage_id;
    const currentStage = currentStages?.find((s) => s.id === currentStageId);

    let scheduledStage = pickStage(currentStages as any);
    let targetPipelineName: string | null = null;

    // 2) Fallback cross-pipeline: Funil Principal do mesmo tenant
    if (!scheduledStage) {
      const { data: pipelines } = await supabase
        .from("crm_pipelines")
        .select("id, name, allowed_roles")
        .eq("tenant_id", leadData.tenant_id);

      const funilPrincipal =
        (pipelines || []).find((p: any) => /funil principal/i.test(p.name)) ||
        (pipelines || []).find((p: any) => {
          const ar = p.allowed_roles;
          return !ar || ar.length === 0;
        });

      if (funilPrincipal) {
        const { data: fpStages } = await supabase
          .from("crm_stages")
          .select("id, name, pipeline_id")
          .eq("pipeline_id", (funilPrincipal as any).id)
          .order("position");
        scheduledStage = pickStage(fpStages as any);
        if (scheduledStage) targetPipelineName = (funilPrincipal as any).name;
      }
    }

    if (!scheduledStage || scheduledStage.id === currentStageId) {
      return leadData.stage_id;
    }

    const nowIso = new Date().toISOString();
    const crossPipeline = scheduledStage.pipeline_id !== leadData.pipeline_id;

    const updatePayload: { stage_id: string; updated_at: string; pipeline_id?: string } = {
      stage_id: scheduledStage.id,
      updated_at: nowIso,
    };
    if (crossPipeline) updatePayload.pipeline_id = scheduledStage.pipeline_id;

    const { error: moveError } = await supabase
      .from("crm_leads")
      .update(updatePayload)
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

    const sysContent = crossPipeline && targetPipelineName
      ? `📋 Etapa alterada: ${currentStage?.name || "Etapa anterior"} → ${targetPipelineName} • ${scheduledStage.name}`
      : `📋 Etapa alterada: ${currentStage?.name || "Etapa anterior"} → ${scheduledStage.name}`;

    await supabase.from("messages").insert({
      lead_id: leadId,
      direction: "outbound",
      type: "system",
      content: sysContent,
      status: "system",
    });

    return scheduledStage.id;
  }, [leadId, isRescheduleMode]);

  const handleConfirm = async (task: Task) => {
    if (!date) { toast.error("Selecione a data do agendamento"); return; }
    setSaving(true);

    const { error: apptError } = await supabase.from("crm_appointments").insert({
      lead_id: leadId, task_id: task.id,
      scheduled_date: format(date, "yyyy-MM-dd"), scheduled_time: time,
      status: "confirmed", notes: task.notes,
    });
    if (apptError) { toastDbError(apptError, "Erro ao criar agendamento"); setSaving(false); return; }

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

    // Em modo reagendamento com consulta ainda pendente, remarcar de verdade
    // (desfecho no antigo + vínculo) — nunca deixar duas consultas 'confirmed'.
    if (isRescheduleMode && confirmedAppointments.length > 0) {
      const old = confirmedAppointments[0];
      setManualSaving(true);
      try {
        const ok = await rescheduleAppointment({
          leadId,
          old: { id: old.id, scheduled_date: old.scheduled_date, scheduled_time: old.scheduled_time },
          newDate: format(manualDate, "yyyy-MM-dd"),
          newTime: manualTime,
          notes: manualNotes || null,
        });
        if (ok) { setManualOpen(false); setManualDate(undefined); setManualTime("09:00"); setManualNotes(""); }
        await Promise.all([fetchAppointments(), checkRescheduleMode()]);
      } catch (e) {
        toastDbError(e);
      } finally {
        setManualSaving(false);
      }
      return;
    }

    setManualSaving(true);

    const { error: apptError } = await supabase.from("crm_appointments").insert({
      lead_id: leadId,
      scheduled_date: format(manualDate, "yyyy-MM-dd"), scheduled_time: manualTime,
      status: "confirmed", notes: manualNotes || null,
    } as any);
    if (apptError) { toastDbError(apptError, "Erro ao criar agendamento"); setManualSaving(false); return; }

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
    const { error } = await supabase.from("crm_appointments").update({
      scheduled_date: format(editDate, "yyyy-MM-dd"),
      scheduled_time: editTime,
      notes: editNotes || null,
      updated_at: new Date().toISOString(),
    }).eq("id", appt.id);
    if (error) { toastDbError(error, "Erro ao atualizar agendamento"); setEditSaving(false); return; }

    await supabase.from("messages").insert({
      lead_id: leadId, direction: "outbound", type: "system",
      content: `📅 Agendamento atualizado: ${format(editDate, "dd/MM/yyyy")} às ${editTime}`, status: "system",
    });

    toast.success("Agendamento atualizado!");
    setEditingId(null); setEditSaving(false);
    await fetchAppointments();
  };

  const handleConfirmPendingAppointment = async (appt: Appointment) => {
    const { error } = await supabase
      .from("crm_appointments")
      .update({ status: "confirmed" })
      .eq("id", appt.id)
      .eq("status", "pending");
    if (error) { toastDbError(error, "Erro ao confirmar agendamento"); return; }
    await supabase.from("messages").insert({
      lead_id: leadId, direction: "outbound", type: "system",
      content: `✅ Agendamento confirmado: ${appt.scheduled_date.split("-").reverse().join("/")} às ${appt.scheduled_time?.slice(0, 5)}`,
      status: "system",
    });
    toast.success("Agendamento confirmado!");
    await fetchAppointments();
  };

  const handleDeletePendingTask = async (taskId: string) => {
    const { error } = await supabase.from("crm_tasks").delete().eq("id", taskId);
    if (error) { toast.error("Erro ao excluir solicitação"); return; }
    toast.success("Solicitação excluída");
    fetchTasks();
  };

  const renderEditForm = (appt: Appointment) => (
    <div key={appt.id} className="mb-2 p-3 rounded-lg border border-primary/30 bg-primary/5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">Corrigir agendamento</span>
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

  const renderPicker = (appt: Appointment, mode: PickerMode) => (
    <div className="space-y-2 pt-2 border-t border-border/60">
      <p className="text-xs font-medium text-foreground">
        {mode === "reschedule" ? "Novo horário da remarcação" : "Novo horário agendado na clínica"}
      </p>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className={cn("h-8 text-xs w-full justify-start", !pickerDate && "text-muted-foreground")}>
            <CalendarIcon size={12} className="mr-1.5" />
            {pickerDate ? format(pickerDate, "dd/MM/yyyy") : "Selecionar data"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={pickerDate} onSelect={setPickerDate} locale={ptBR} className="p-3 pointer-events-auto" />
        </PopoverContent>
      </Popover>
      <Input type="time" value={pickerTime} onChange={e => setPickerTime(e.target.value)} className="h-8 text-xs" />
      <Input value={pickerNotes} onChange={e => setPickerNotes(e.target.value)} placeholder="Observações (opcional)" className="h-8 text-xs" />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => setPicker(null)}>Voltar</Button>
        <Button size="sm" className="flex-1 h-7 text-xs bg-primary hover:bg-primary/90 text-primary-foreground" disabled={pickerSaving} onClick={() => handlePickerSubmit(appt)}>
          {pickerSaving ? "Salvando..." : mode === "reschedule" ? "Remarcar" : "Salvar"}
        </Button>
      </div>
    </div>
  );

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

      {/* Agendamentos criados por bot, aguardando confirmação humana */}
      {pendingAppointments.map((appt) => {
        if (editingId === appt.id) return renderEditForm(appt);
        const apptDate = new Date(appt.scheduled_date + "T12:00:00");
        return (
          <div key={appt.id} className="mb-2 p-3 rounded-lg border border-orange-500/30 bg-orange-500/10 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {format(apptDate, "dd/MM/yyyy")} às {appt.scheduled_time?.slice(0, 5)}
                </p>
                <p className="text-xs text-muted-foreground">Aguardando confirmação</p>
              </div>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => {
                setEditingId(appt.id);
                setEditDate(apptDate);
                setEditTime(appt.scheduled_time?.slice(0, 5) || "09:00");
                setEditNotes(appt.notes || "");
              }}>
                <Pencil size={12} />
              </Button>
            </div>
            <Button size="sm" className="h-8 w-full text-xs gap-1 bg-green-600 hover:bg-green-700 text-white" onClick={() => handleConfirmPendingAppointment(appt)}>
              <CheckCircle2 size={12} /> Confirmar agendamento
            </Button>
          </div>
        );
      })}

      {/* Card único por agendamento confirmado */}
      {confirmedAppointments.map((appt) => {
        if (editingId === appt.id) return renderEditForm(appt);

        const apptDate = new Date(appt.scheduled_date + "T12:00:00");
        const daysAgo = differenceInCalendarDays(new Date(), apptDate);
        const step = outcomeStep[appt.id] || "init";
        const busy = outcomeSaving === appt.id;
        const pickerOpen = picker?.apptId === appt.id;

        return (
          <div key={appt.id} className="mb-2 p-3 rounded-lg border border-green-500/30 bg-green-500/10 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={12} className="text-green-600 shrink-0" />
                  <span className="text-sm font-medium text-foreground">
                    {format(apptDate, "dd/MM/yyyy")} às {appt.scheduled_time?.slice(0, 5)}
                  </span>
                </div>
                {daysAgo > 0 && (
                  <p className="text-xs text-muted-foreground">há {daysAgo} dia{daysAgo > 1 ? "s" : ""}</p>
                )}
                {appt.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{appt.notes}</p>}
              </div>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" title="Corrigir data/hora" onClick={() => {
                setEditingId(appt.id);
                setEditDate(apptDate);
                setEditTime(appt.scheduled_time?.slice(0, 5) || "09:00");
                setEditNotes(appt.notes || "");
              }}>
                <Pencil size={12} />
              </Button>
            </div>

            {pickerOpen ? (
              renderPicker(appt, picker!.mode)
            ) : step === "init" ? (
              <div className="space-y-2">
                {isAwaitingReschedule && (
                  <p className="text-[11px] text-blue-600">
                    Aguardando novo horário — sem reagendamento até o fim do expediente, vira falta.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white"
                    disabled={busy}
                    onClick={() => guardEarly(appt, () => setOutcomeStep((prev) => ({ ...prev, [appt.id]: "compareceu" })))}
                  >
                    <CheckCircle2 size={12} /> Compareceu
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                    disabled={busy}
                    onClick={() => guardEarly(appt, () => doOutcome(appt.id, "no_show"))}
                  >
                    <XCircle size={12} /> Não compareceu
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1 border-blue-500/40 text-blue-600 hover:bg-blue-500/10"
                    disabled={busy || startingReschedule}
                    onClick={() => (isAwaitingReschedule ? openPicker(appt, "reschedule") : handleStartReschedule(appt))}
                  >
                    <Repeat size={12} /> {isAwaitingReschedule ? "Novo horário" : "Reagendar"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs gap-1 text-muted-foreground"
                    disabled={busy}
                    onClick={() => { setCancelFor(appt); setCancelReason(""); }}
                  >
                    <Ban size={12} /> Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 pt-1 border-t border-green-500/20">
                <p className="text-xs text-muted-foreground">Resultado da avaliação:</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1 bg-primary hover:bg-primary/90 text-primary-foreground"
                    disabled={busy}
                    onClick={() => doOutcome(appt.id, "contracted")}
                  >
                    <Handshake size={12} /> Contratou
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={busy}
                    onClick={() => doOutcome(appt.id, "not_contracted")}
                  >
                    Não contratou
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs w-full gap-1 border-blue-500/40 text-blue-600 hover:bg-blue-500/10"
                  disabled={busy}
                  onClick={() => openPicker(appt, "agendou")}
                >
                  <CalendarCheck size={12} /> Agendou
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] w-full"
                  onClick={() => setOutcomeStep((prev) => ({ ...prev, [appt.id]: "init" }))}
                >
                  ← Voltar
                </Button>
              </div>
            )}
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

      {/* Cancelamento com motivo obrigatório */}
      <Dialog open={!!cancelFor} onOpenChange={(o) => { if (!o) { setCancelFor(null); setCancelReason(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Cancelar agendamento</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            {cancelFor && `${cancelFor.scheduled_date.split("-").reverse().join("/")} às ${cancelFor.scheduled_time?.slice(0, 5)}`}
          </p>
          <Textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Motivo do cancelamento (obrigatório)"
            className="text-sm"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => { setCancelFor(null); setCancelReason(""); }}>Voltar</Button>
            <Button variant="destructive" size="sm" disabled={cancelSaving || cancelReason.trim().length < 3} onClick={handleCancelSubmit}>
              {cancelSaving ? "Cancelando..." : "Cancelar agendamento"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Desfecho antes do horário marcado */}
      <Dialog open={!!earlyConfirm} onOpenChange={(o) => { if (!o) setEarlyConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Confirmar agora?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {earlyConfirm && `A consulta é só ${formatBahiaLabel(earlyConfirm.appt.scheduled_date, earlyConfirm.appt.scheduled_time)} — registrar o resultado agora?`}
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setEarlyConfirm(null)}>Voltar</Button>
            <Button size="sm" onClick={() => { const run = earlyConfirm?.run; setEarlyConfirm(null); run?.(); }}>Confirmar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
