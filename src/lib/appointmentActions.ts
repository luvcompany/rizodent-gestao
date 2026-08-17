import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { executeStageAutomations } from "@/lib/automationUtils";
import { moveLeadToStageCrossPipeline } from "@/lib/appointmentOutcome";

/**
 * Ações de agendamento compartilhadas entre o chat e o calendário.
 *
 * Regras de negócio já garantidas por gatilho no banco (Etapa 1):
 * - `is_rescheduled` é derivado de `rescheduled_from_id`
 * - autor/hora do desfecho são carimbados sozinhos
 * - reabrir desfecho e mudar data/hora após desfecho são restritos a gerente
 */

/** America/Bahia é UTC-3 fixo (sem horário de verão). */
const BAHIA_OFFSET = "-03:00";

/** Instante (ms epoch) do horário marcado, interpretado no fuso America/Bahia. */
export function bahiaScheduledMs(scheduled_date: string, scheduled_time?: string | null): number {
  const t = (scheduled_time || "00:00:00").slice(0, 5);
  return new Date(`${scheduled_date}T${t}:00${BAHIA_OFFSET}`).getTime();
}

/** Data/hora atual em ms epoch (comparação de instantes é independente de fuso). */
export function nowMs(): number {
  return Date.now();
}

/** Formata "sábado às 09:30" a partir dos campos do agendamento (fuso America/Bahia). */
export function formatBahiaLabel(scheduled_date: string, scheduled_time?: string | null): string {
  const ms = bahiaScheduledMs(scheduled_date, scheduled_time);
  if (Number.isNaN(ms)) return scheduled_date;
  const d = new Date(ms);
  const dia = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
  return `${dia} às ${hora}`;
}

/** Desfecho ainda não aconteceu no relógio? (clique antecipado) */
export function isBeforeScheduled(scheduled_date: string, scheduled_time?: string | null): boolean {
  const ms = bahiaScheduledMs(scheduled_date, scheduled_time);
  return !Number.isNaN(ms) && nowMs() < ms;
}

/**
 * Régua anti-lavagem: remarcar depois do horário marcado + 3h conta como falta.
 */
export function statusForRescheduledOrigin(scheduled_date: string, scheduled_time?: string | null): "no_show" | "rescheduled" {
  const ms = bahiaScheduledMs(scheduled_date, scheduled_time);
  if (Number.isNaN(ms)) return "rescheduled";
  return nowMs() >= ms + 3 * 60 * 60 * 1000 ? "no_show" : "rescheduled";
}

const TRIGGER_HINTS = ["imutável", "imutavel", "reabertura é ação de gerente", "reabertura e acao de gerente", "após o desfecho", "apos o desfecho", "remarcação"];

/** Mostra a mensagem do gatilho do banco quando existir; senão um erro genérico. */
export function toastDbError(error: unknown, fallback = "Erro ao atualizar agendamento") {
  const msg = (error as any)?.message ? String((error as any).message) : "";
  const lower = msg.toLowerCase();
  if (msg && TRIGGER_HINTS.some((h) => lower.includes(h))) {
    toast.error(msg);
  } else {
    console.error(error);
    toast.error(fallback);
  }
}

async function systemMessage(leadId: string, content: string) {
  await supabase.from("messages").insert({
    lead_id: leadId,
    direction: "outbound",
    type: "system",
    content,
    status: "system",
  });
}

const STALE = "Este agendamento já recebeu desfecho — recarregando";

/** Cancela um agendamento com motivo obrigatório. Retorna false se já houve desfecho. */
export async function cancelAppointment(args: {
  leadId: string;
  appointmentId: string;
  reason: string;
}): Promise<boolean> {
  const { leadId, appointmentId, reason } = args;
  const motivo = reason.trim();
  if (motivo.length < 3) {
    toast.error("Informe o motivo do cancelamento (mín. 3 caracteres)");
    return false;
  }
  const { data, error } = await supabase
    .from("crm_appointments")
    .update({ status: "cancelled", cancelled_reason: motivo } as any)
    .eq("id", appointmentId)
    .eq("status", "confirmed")
    .select("id");
  if (error) { toastDbError(error, "Erro ao cancelar agendamento"); return false; }
  if (!data || data.length === 0) { toast.error(STALE); return false; }

  await systemMessage(leadId, `🗓️ Agendamento cancelado — ${motivo}`);
  toast.success("Agendamento cancelado");
  return true;
}

/**
 * Remarca um agendamento:
 * 1. desfecho no antigo (`no_show` após horário+3h, senão `rescheduled`) com trava
 * 2. cria o novo vinculado por `rescheduled_from_id`
 * 3. UM movimento de etapa para "Reagendado"
 * 4. mensagem de sistema
 */
export async function rescheduleAppointment(args: {
  leadId: string;
  old: { id: string; scheduled_date: string; scheduled_time: string | null };
  newDate: string;
  newTime: string;
  notes?: string | null;
}): Promise<boolean> {
  const { leadId, old, newDate, newTime, notes } = args;

  const novoStatusAntigo = statusForRescheduledOrigin(old.scheduled_date, old.scheduled_time);

  const { data: upd, error: updErr } = await supabase
    .from("crm_appointments")
    .update({ status: novoStatusAntigo })
    .eq("id", old.id)
    .eq("status", "confirmed")
    .select("id");
  if (updErr) { toastDbError(updErr, "Erro ao remarcar agendamento"); return false; }
  if (!upd || upd.length === 0) { toast.error(STALE); return false; }

  const { error: insErr } = await supabase.from("crm_appointments").insert({
    lead_id: leadId,
    scheduled_date: newDate,
    scheduled_time: newTime,
    status: "confirmed",
    notes: notes || null,
    rescheduled_from_id: old.id,
  } as any);
  if (insErr) { toastDbError(insErr, "Erro ao criar o novo agendamento"); return false; }

  const movedStageId = await moveLeadToStageCrossPipeline(leadId, (n) => n.includes("reagend"));

  const antigo = `${old.scheduled_date.split("-").reverse().join("/")} às ${(old.scheduled_time || "").slice(0, 5)}`;
  const novo = `${newDate.split("-").reverse().join("/")} às ${newTime}`;
  await systemMessage(leadId, `🔁 Consulta remarcada de ${antigo} para ${novo}`);

  const { data: lead } = await supabase.from("crm_leads").select("stage_id, phone").eq("id", leadId).single();
  if (lead) {
    executeStageAutomations({
      leadId,
      stageId: movedStageId || lead.stage_id,
      leadPhone: lead.phone,
      triggerTypes: ["on_enter"],
    }).catch((e) => console.error("[Reschedule] Automation error:", e));
  }

  toast.success("Consulta remarcada");
  return true;
}

/**
 * "Compareceu e agendou": desfecho `not_contracted` no atual, novo agendamento
 * vinculado e UM movimento de etapa para "Compareceu e agendou".
 */
export async function compareceuEAgendou(args: {
  leadId: string;
  old: { id: string; scheduled_date: string; scheduled_time: string | null };
  newDate: string;
  newTime: string;
  notes?: string | null;
}): Promise<boolean> {
  const { leadId, old, newDate, newTime, notes } = args;

  const { data: upd, error: updErr } = await supabase
    .from("crm_appointments")
    .update({ status: "not_contracted" })
    .eq("id", old.id)
    .eq("status", "confirmed")
    .select("id");
  if (updErr) { toastDbError(updErr); return false; }
  if (!upd || upd.length === 0) { toast.error(STALE); return false; }

  const { error: insErr } = await supabase.from("crm_appointments").insert({
    lead_id: leadId,
    scheduled_date: newDate,
    scheduled_time: newTime,
    status: "confirmed",
    notes: notes || null,
    rescheduled_from_id: old.id,
  } as any);
  if (insErr) { toastDbError(insErr, "Erro ao criar o novo agendamento"); return false; }

  const movedStageId = await moveLeadToStageCrossPipeline(
    leadId,
    (n) => n.includes("compareceu") && n.includes("agendou"),
  );

  const novo = `${newDate.split("-").reverse().join("/")} às ${newTime}`;
  await systemMessage(leadId, `📅 Compareceu e agendou — novo horário ${novo}`);

  const { data: lead } = await supabase.from("crm_leads").select("stage_id, phone").eq("id", leadId).single();
  if (lead) {
    executeStageAutomations({
      leadId,
      stageId: movedStageId || lead.stage_id,
      leadPhone: lead.phone,
      triggerTypes: ["on_enter"],
    }).catch((e) => console.error("[CompareceuEAgendou] Automation error:", e));
  }

  toast.success("Comparecimento registrado com novo agendamento");
  return true;
}
