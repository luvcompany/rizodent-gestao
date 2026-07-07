import { supabase } from "@/integrations/supabase/client";
import { executeStageAutomations } from "@/lib/automationUtils";

const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

/**
 * Move o lead para uma etapa do MESMO pipeline cujo nome combina com `match`.
 */
async function moveLeadToStageInCurrentPipeline(
  leadId: string,
  matcher: (n: string) => boolean,
): Promise<string | null> {
  const { data: lead } = await supabase
    .from("crm_leads")
    .select("stage_id, pipeline_id, phone")
    .eq("id", leadId)
    .single();
  if (!lead) return null;

  const { data: stages } = await supabase
    .from("crm_stages")
    .select("id, name, pipeline_id")
    .eq("pipeline_id", lead.pipeline_id)
    .order("position");

  const target = (stages || []).find((s) => matcher(norm(s.name)));
  if (!target || target.id === lead.stage_id) return lead.stage_id;

  const nowIso = new Date().toISOString();
  await supabase.from("crm_leads").update({ stage_id: target.id, updated_at: nowIso }).eq("id", leadId);

  const { data: openEntry } = await supabase
    .from("crm_lead_stage_history")
    .select("id")
    .eq("lead_id", leadId)
    .eq("stage_id", lead.stage_id)
    .is("exited_at", null)
    .maybeSingle();
  if (openEntry) {
    await supabase.from("crm_lead_stage_history").update({ exited_at: nowIso }).eq("id", openEntry.id);
  }
  await supabase.from("crm_lead_stage_history").insert({
    lead_id: leadId,
    stage_id: target.id,
    from_stage_id: lead.stage_id,
    entered_at: nowIso,
  } as any);

  return target.id;
}

/**
 * Move o lead para o pipeline "Não Contratados" / "Recuperação", primeira etapa.
 */
async function moveLeadToNaoContratadosPipeline(leadId: string): Promise<string | null> {
  const { data: lead } = await supabase
    .from("crm_leads")
    .select("stage_id, pipeline_id")
    .eq("id", leadId)
    .single();
  if (!lead) return null;

  const { data: pipelines } = await supabase.from("crm_pipelines").select("id, name");
  const targetPipeline = (pipelines || []).find((p) => {
    const n = norm(p.name);
    return n.includes("nao contrat") || n.includes("recupera");
  });
  if (!targetPipeline || targetPipeline.id === lead.pipeline_id) {
    // Fallback: move dentro do pipeline atual para etapa "Não contratado"
    return moveLeadToStageInCurrentPipeline(leadId, (n) => n.includes("nao contrat"));
  }

  const { data: stages } = await supabase
    .from("crm_stages")
    .select("id, name")
    .eq("pipeline_id", targetPipeline.id)
    .order("position");
  const firstStage = stages?.[0];
  if (!firstStage) return lead.stage_id;

  const nowIso = new Date().toISOString();
  await supabase
    .from("crm_leads")
    .update({ pipeline_id: targetPipeline.id, stage_id: firstStage.id, updated_at: nowIso })
    .eq("id", leadId);

  const { data: openEntry } = await supabase
    .from("crm_lead_stage_history")
    .select("id")
    .eq("lead_id", leadId)
    .eq("stage_id", lead.stage_id)
    .is("exited_at", null)
    .maybeSingle();
  if (openEntry) {
    await supabase.from("crm_lead_stage_history").update({ exited_at: nowIso }).eq("id", openEntry.id);
  }
  await supabase.from("crm_lead_stage_history").insert({
    lead_id: leadId,
    stage_id: firstStage.id,
    from_stage_id: lead.stage_id,
    entered_at: nowIso,
  } as any);

  return firstStage.id;
}

export type AppointmentOutcome = "no_show" | "contracted" | "not_contracted" | "rescheduled";

/**
 * Move o lead para uma etapa cujo nome combine com `matcher`, procurando
 * primeiro no pipeline atual e, se não achar, no "Funil Principal" do tenant.
 */
async function moveLeadToStageCrossPipeline(
  leadId: string,
  matcher: (n: string) => boolean,
): Promise<string | null> {
  const { data: lead } = await supabase
    .from("crm_leads")
    .select("stage_id, pipeline_id, tenant_id")
    .eq("id", leadId)
    .single();
  if (!lead) return null;

  // Tenta no pipeline atual
  const { data: currentStages } = await supabase
    .from("crm_stages")
    .select("id, name, pipeline_id")
    .eq("pipeline_id", lead.pipeline_id)
    .order("position");
  let target = (currentStages || []).find((s) => matcher(norm(s.name)));

  // Fallback: Funil Principal do tenant
  if (!target) {
    const { data: pipelines } = await supabase
      .from("crm_pipelines")
      .select("id, name")
      .eq("tenant_id", (lead as any).tenant_id);
    const principal = (pipelines || []).find((p: any) => /funil principal/i.test(p.name));
    if (principal) {
      const { data: fpStages } = await supabase
        .from("crm_stages")
        .select("id, name, pipeline_id")
        .eq("pipeline_id", (principal as any).id)
        .order("position");
      target = (fpStages || []).find((s) => matcher(norm(s.name)));
    }
  }

  if (!target || target.id === lead.stage_id) return lead.stage_id;

  const nowIso = new Date().toISOString();
  const crossPipeline = target.pipeline_id !== lead.pipeline_id;
  const updatePayload: any = { stage_id: target.id, updated_at: nowIso };
  if (crossPipeline) updatePayload.pipeline_id = target.pipeline_id;
  await supabase.from("crm_leads").update(updatePayload).eq("id", leadId);

  const { data: openEntry } = await supabase
    .from("crm_lead_stage_history")
    .select("id")
    .eq("lead_id", leadId)
    .eq("stage_id", lead.stage_id)
    .is("exited_at", null)
    .maybeSingle();
  if (openEntry) {
    await supabase.from("crm_lead_stage_history").update({ exited_at: nowIso }).eq("id", openEntry.id);
  }
  await supabase.from("crm_lead_stage_history").insert({
    lead_id: leadId,
    stage_id: target.id,
    from_stage_id: lead.stage_id,
    entered_at: nowIso,
  } as any);

  return target.id;
}

/**
 * Aplica o desfecho de um agendamento:
 * - atualiza status da appointment
 * - move o lead para a etapa adequada
 * - posta mensagem de sistema
 * - dispara automações de etapa
 */
export async function applyAppointmentOutcome(args: {
  leadId: string;
  appointmentId: string;
  outcome: AppointmentOutcome;
}): Promise<void> {
  const { leadId, appointmentId, outcome } = args;

  await supabase.from("crm_appointments").update({ status: outcome }).eq("id", appointmentId);

  let movedStageId: string | null = null;
  let label = "";

  if (outcome === "no_show") {
    movedStageId = await moveLeadToStageInCurrentPipeline(leadId, (n) => n.includes("nao compar"));
    label = "🚫 Marcado como Não compareceu";
  } else if (outcome === "contracted") {
    movedStageId = await moveLeadToStageInCurrentPipeline(
      leadId,
      (n) => n === "contratado" || n === "contratados" || (n.includes("contrat") && !n.includes("nao contrat")),
    );
    label = "🤝 Marcado como Contratado";
  } else if (outcome === "not_contracted") {
    movedStageId = await moveLeadToStageInCurrentPipeline(leadId, (n) => n.includes("nao contrat"));
    label = "❌ Marcado como Não contratou — movido para etapa Não contratado";
  }

  await supabase.from("messages").insert({
    lead_id: leadId,
    direction: "outbound",
    type: "system",
    content: label,
    status: "system",
  });

  const { data: lead } = await supabase.from("crm_leads").select("stage_id, phone").eq("id", leadId).single();
  if (lead) {
    executeStageAutomations({
      leadId,
      stageId: movedStageId || lead.stage_id,
      leadPhone: lead.phone,
      triggerTypes: ["on_enter"],
    }).catch((e) => console.error("[AppointmentOutcome] Automation error:", e));
  }
}
