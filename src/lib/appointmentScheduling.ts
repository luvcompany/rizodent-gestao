import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { executeStageAutomations } from "@/lib/automationUtils";

// Normaliza cidade para comparação robusta (minúsculo, sem acento, só letras/espaço).
// Espelha normalizeCity do edge generate-reply-suggestion.
export function normalizeCity(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}

const normStage = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

// Detecta se o lead está em modo reagendamento (etapa "não compareceu"/"reagendado"),
// espelhando AppointmentConfirmBar.checkRescheduleMode (linhas 119-129).
export async function detectRescheduleMode(leadId: string): Promise<boolean> {
  const { data: leadData } = await supabase.from("crm_leads").select("stage_id").eq("id", leadId).single();
  if (!leadData?.stage_id) return false;
  const { data: stageData } = await supabase.from("crm_stages").select("name").eq("id", leadData.stage_id).single();
  const sn = (stageData?.name || "").toLowerCase();
  return sn.includes("não compareceu") || sn.includes("nao compareceu") || sn.includes("reagend");
}

// Move o lead para a etapa "Agendado" (com fallback cross-pipeline p/ Funil Principal),
// registra histórico e posta nota de sistema. Cópia fiel de
// AppointmentConfirmBar.moveLeadToScheduledStage (linhas 153-278) — mantida como função
// pura para ser reutilizada pelo card de agendamento da Bia e garantir paridade exata.
export async function moveLeadToScheduledStage(leadId: string, isRescheduleMode: boolean): Promise<string | null> {
  const { data: leadData } = await supabase
    .from("crm_leads")
    .select("stage_id, pipeline_id, tenant_id")
    .eq("id", leadId)
    .single();

  if (!leadData) return null;

  const isPreOrRe = (n: string) =>
    n.includes("pre") || n.includes("pré") || n.startsWith("reagend") ||
    n.includes("nao compareceu") || n.includes("não compareceu");

  const pickStage = (stages: { id: string; name: string; pipeline_id: string }[] | null | undefined) => {
    if (!stages) return undefined;
    let found;
    if (isRescheduleMode) {
      found = stages.find((s) => normStage(s.name).startsWith("reagend"));
      if (found) return found;
    }
    found = stages.find((s) => {
      const n = normStage(s.name);
      return n === "agendado" || n === "agendados" || n === "agendamento" || n === "agendamentos";
    });
    if (found) return found;
    return stages.find((s) => {
      const n = normStage(s.name);
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

  const { error: moveError } = await supabase.from("crm_leads").update(updatePayload).eq("id", leadId);
  if (moveError) throw moveError;

  const { data: openEntry } = await supabase
    .from("crm_lead_stage_history")
    .select("id")
    .eq("lead_id", leadId)
    .eq("stage_id", currentStageId)
    .is("exited_at", null)
    .maybeSingle();

  if (openEntry) {
    await supabase.from("crm_lead_stage_history").update({ exited_at: nowIso }).eq("id", openEntry.id);
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
  } as any);

  return scheduledStage.id;
}

// Cria um agendamento confirmado espelhando AppointmentConfirmBar.handleManualSchedule
// (linhas 318-362): INSERT em crm_appointments + conclui tarefas de agendamento pendentes
// + move o lead para "Agendado" + nota de sistema + dispara automações after_appointment_confirmed.
export async function createConfirmedAppointment(opts: {
  leadId: string;
  date: Date;
  time: string; // 'HH:mm'
  notes?: string | null;
  isRescheduleMode?: boolean;
}): Promise<{ movedStageId: string | null }> {
  const { leadId, date, time, notes = null, isRescheduleMode = false } = opts;
  const { data: session } = await supabase.auth.getSession();
  const userId = session?.session?.user?.id;

  const { error: apptError } = await supabase.from("crm_appointments").insert({
    lead_id: leadId,
    scheduled_date: format(date, "yyyy-MM-dd"),
    scheduled_time: time,
    status: "confirmed",
    notes: notes || null,
    confirmed_by: userId || null,
    confirmed_at: new Date().toISOString(),
    is_rescheduled: isRescheduleMode,
  } as any);
  if (apptError) throw apptError;

  // Conclui tarefas de agendamento pendentes (paridade com o manual).
  const { data: pend } = await supabase
    .from("crm_tasks")
    .select("id")
    .eq("lead_id", leadId)
    .eq("type", "agendamento")
    .eq("status", "pending");
  if (pend && pend.length) {
    await supabase
      .from("crm_tasks")
      .update({ status: "done", updated_at: new Date().toISOString() })
      .in("id", pend.map((t: any) => t.id));
  }

  const movedStageId = await moveLeadToScheduledStage(leadId, isRescheduleMode);

  const label = isRescheduleMode ? "Reagendamento" : "Agendamento";
  await supabase.from("messages").insert({
    lead_id: leadId,
    direction: "outbound",
    type: "system",
    content: `✅ ${label} confirmado: ${format(date, "dd/MM/yyyy")} às ${time}`,
    status: "system",
  } as any);

  const { data: leadForAuto } = await supabase.from("crm_leads").select("stage_id, phone").eq("id", leadId).single();
  if (leadForAuto) {
    executeStageAutomations({
      leadId,
      stageId: movedStageId || (leadForAuto as any).stage_id,
      leadPhone: (leadForAuto as any).phone,
      triggerTypes: ["after_appointment_confirmed"],
    }).catch((e) => console.error("[Appointment] Automation error:", e));
  }

  return { movedStageId };
}

export type AppointmentTemplateOption = {
  clinicaId: string;
  nome: string | null;
  cidade: string | null;
  templateName: string;
};

// Resolve o(s) modelo(s) de agendamento configurado(s) para a cidade do lead, de forma
// genérica: lê clinicas.appointment_template_name do tenant (nada hardcoded).
// - options: todos os modelos de agendamento configurados no tenant (para o seletor).
// - resolved: o modelo cuja unidade/cidade bate com a cidade do lead (ou null).
export async function resolveAppointmentTemplate(
  tenantId: string | null | undefined,
  cidade: string | null | undefined,
): Promise<{ options: AppointmentTemplateOption[]; resolved: string | null }> {
  if (!tenantId) return { options: [], resolved: null };
  const { data: rows } = await supabase
    .from("clinicas")
    .select("id, nome, cidade, appointment_template_name")
    .eq("tenant_id", tenantId)
    .not("appointment_template_name", "is", null);

  const options: AppointmentTemplateOption[] = (rows || [])
    .filter((r: any) => r.appointment_template_name && String(r.appointment_template_name).trim())
    .map((r: any) => ({
      clinicaId: r.id,
      nome: r.nome,
      cidade: r.cidade,
      templateName: String(r.appointment_template_name).trim(),
    }));

  const key = normalizeCity(cidade);
  const match = key ? options.find((o) => normalizeCity(o.cidade) === key) : undefined;

  // Dedup por templateName mantendo a ordem (o seletor não deve repetir modelos).
  const seen = new Set<string>();
  const dedup = options.filter((o) => (seen.has(o.templateName) ? false : (seen.add(o.templateName), true)));

  return { options: dedup, resolved: match?.templateName || null };
}
