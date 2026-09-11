import { supabase } from "@/integrations/supabase/client";
import { executeStageAutomations } from "@/lib/automationUtils";

const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

/**
 * Move o lead para uma etapa do MESMO pipeline cujo nome combina com `match`.
 */
export async function moveLeadToStageInCurrentPipeline(
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
  // Sem etapa destino (não existe no funil, ou o papel não a enxerga — a SDR
  // não vê Contratado/Não contratado) ou já nela: NÃO houve movimento. Antes
  // devolvia a etapa atual e o chamador anunciava "movido" e rodava de novo as
  // automações de entrada da etapa em que o lead já estava.
  if (!target || target.id === lead.stage_id) return null;

  const nowIso = new Date().toISOString();
  // RLS barrada não devolve erro — devolve 0 linhas. Sem o throw, o chamador
  // anuncia (toast + mensagem de sistema) um movimento de etapa que não houve.
  const { data: movedRows, error: moveErr } = await supabase
    .from("crm_leads")
    .update({ stage_id: target.id, updated_at: nowIso })
    .eq("id", leadId)
    .select("id");
  if (moveErr) throw moveErr;
  if (!movedRows || movedRows.length === 0) {
    throw new Error("Seu perfil não tem permissão para mover este lead de etapa.");
  }

  // Histórico de etapa é escrito SÓ pelo gatilho sync_lead_stage_history (a
  // dupla escrita front+gatilho duplicou 18.685 passagens até 08/09/2026).

  return target.id;
}

/**
 * Move o lead para o pipeline "Não Contratados" / "Recuperação", primeira etapa.
 */
export async function moveLeadToNaoContratadosPipeline(leadId: string): Promise<string | null> {
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
  if (!firstStage) return null; // sem etapa: não houve movimento

  const nowIso = new Date().toISOString();
  const { data: movedRows, error: moveErr } = await supabase
    .from("crm_leads")
    .update({ pipeline_id: targetPipeline.id, stage_id: firstStage.id, updated_at: nowIso })
    .eq("id", leadId)
    .select("id");
  if (moveErr) throw moveErr;
  if (!movedRows || movedRows.length === 0) {
    throw new Error("Seu perfil não tem permissão para mover este lead de etapa.");
  }

  // Histórico de etapa é escrito só pelo gatilho sync_lead_stage_history.

  return firstStage.id;
}

export type AppointmentOutcome = "no_show" | "contracted" | "not_contracted" | "rescheduled";

/**
 * Move o lead para uma etapa cujo nome combine com `matcher`, procurando
 * primeiro no pipeline atual e, se não achar, no "Funil Principal" do tenant.
 * Retorna null quando nenhuma etapa combina (tenant sem a etapa).
 */
export async function moveLeadToStageCrossPipeline(
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

  if (!target) return null;
  if (target.id === lead.stage_id) return null; // já estava lá: não houve movimento

  const nowIso = new Date().toISOString();
  const crossPipeline = target.pipeline_id !== lead.pipeline_id;
  const updatePayload: any = { stage_id: target.id, updated_at: nowIso };
  if (crossPipeline) updatePayload.pipeline_id = target.pipeline_id;
  const { data: movedRows, error: moveErr } = await supabase
    .from("crm_leads")
    .update(updatePayload)
    .eq("id", leadId)
    .select("id");
  if (moveErr) throw moveErr;
  if (!movedRows || movedRows.length === 0) {
    throw new Error("Seu perfil não tem permissão para mover este lead de etapa.");
  }

  // Histórico de etapa é escrito SÓ pelo gatilho sync_lead_stage_history (a
  // dupla escrita front+gatilho duplicou 18.685 passagens até 08/09/2026).

  return target.id;
}

/**
 * Aplica o desfecho de um agendamento:
 * - atualiza status da appointment (com trava de concorrência em `confirmed`)
 * - move o lead para a etapa adequada
 * - posta mensagem de sistema
 * - dispara automações de etapa
 *
 * Retorna false quando o agendamento já havia recebido desfecho (0 linhas afetadas).
 */
export async function applyAppointmentOutcome(args: {
  leadId: string;
  appointmentId: string;
  outcome: AppointmentOutcome;
  /** default true — só age se o agendamento ainda estiver 'confirmed' */
  requireConfirmed?: boolean;
}): Promise<boolean> {
  const { leadId, appointmentId, outcome, requireConfirmed = true } = args;

  let q = supabase.from("crm_appointments").update({ status: outcome }).eq("id", appointmentId);
  if (requireConfirmed) q = q.eq("status", "confirmed");
  const { data: upd, error: updErr } = await q.select("id");
  if (updErr) throw updErr;
  if (requireConfirmed && (!upd || upd.length === 0)) return false;

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
    label = movedStageId
      ? "❌ Marcado como Não contratou — movido para etapa Não contratado"
      : "❌ Marcado como Não contratou";
  } else if (outcome === "rescheduled") {
    movedStageId = await moveLeadToStageCrossPipeline(
      leadId,
      (n) => n.includes("compareceu") && n.includes("agendou"),
    );
    label = movedStageId
      ? "📅 Compareceu e agendou — movido para etapa Compareceu e agendou"
      : "📅 Compareceu e agendou";
  }

  await supabase.from("messages").insert({
    lead_id: leadId,
    direction: "outbound",
    type: "system",
    content: label,
    status: "system",
  });

  // Automações de entrada SÓ da etapa para a qual o lead acabou de ir. Sem
  // troca de etapa, rodar as da etapa ATUAL reenviaria ao paciente as
  // mensagens de entrada dela (achado da bateria de testes de 09/09).
  if (movedStageId) {
    const { data: lead } = await supabase.from("crm_leads").select("phone").eq("id", leadId).single();
    executeStageAutomations({
      leadId,
      stageId: movedStageId,
      leadPhone: lead?.phone ?? "",
      triggerTypes: ["on_enter"],
    }).catch((e) => console.error("[AppointmentOutcome] Automation error:", e));
  }

  return true;
}

/**
 * applySdrComparecimento foi APAGADA em 10/09/2026.
 *
 * Ela duplicava a mensagem ao paciente: a RPC sdr_marcar_comparecimento move o
 * lead no banco, o UPDATE de stage_id aciona trg_enqueue_stage_entry_automations
 * e a fila envia; esta função disparava executeStageAutomations por cima, direto,
 * sem passar pela fila — logo sem a chave de deduplicação dela. Além disso o
 * calendário, único chamador, mostrava um aviso fixo dizendo que a etapa não
 * mudava, o que deixou de ser verdade quando a RPC voltou a mover o lead.
 *
 * Use marcarComparecimentoSdr de src/lib/appointmentActions.ts: ela monta o texto
 * com o que o servidor respondeu e não dispara automação nenhuma.
 */
