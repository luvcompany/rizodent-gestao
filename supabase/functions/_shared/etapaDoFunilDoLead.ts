// A etapa que uma automação manda mover é uma ETAPA; quem manda no FUNIL é onde
// o lead está.
//
// O DEFEITO QUE ISTO CONSERTA (provado em 11/09/2026 com o lead JOSEFINA): a SDR
// movia o lead para outro funil e, segundos depois, ele voltava sozinho. O nó
// move_stage do bot "Áudio Inicial" carrega o ID FIXO de uma etapa do Funil
// Principal, e crm_leads tem um gatilho (trg_sync_lead_pipeline_with_stage) que
// puxa o pipeline_id da etapa nova — então gravar só o stage_id MOVE O LEAD DE
// FUNIL em silêncio. Como as etapas de funis diferentes têm o mesmo nome
// ("Conversando"), nem a mensagem no chat denunciava.
//
// A régua: destino em outro funil que tenha etapa de MESMO NOME no funil atual
// do lead → vale a do funil atual. Sem equivalente, move entre funis como
// sempre — é assim que o Follow-UP manda lead frio para "Nutrição", que só
// existe lá.
//
// Corrigido primeiro no bot-engine (migration 20260911230000). Este arquivo leva
// a mesma régua para o automation-engine (lead_stale, no_show) e para o
// automation-queue-worker (move_stage), que tinham a mesma classe de defeito.

// deno-lint-ignore-file no-explicit-any

/**
 * Devolve o stage_id que deve ser gravado, ou null quando não há nada a fazer
 * (o lead já está na etapa certa, ou o destino não existe).
 */
export async function etapaDestinoRespeitandoFunil(
  supabase: any,
  leadId: string,
  targetStageId: string,
): Promise<string | null> {
  if (!leadId || !targetStageId) return null;

  const { data: lead } = await supabase
    .from("crm_leads")
    .select("id, stage_id, pipeline_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return null;

  if (lead.stage_id === targetStageId) return null; // já está lá

  const { data: destino } = await supabase
    .from("crm_stages")
    .select("id, pipeline_id")
    .eq("id", targetStageId)
    .maybeSingle();
  if (!destino) return null;

  // Mesmo funil (ou lead sem funil): nada a decidir.
  if (!lead.pipeline_id || !destino.pipeline_id || destino.pipeline_id === lead.pipeline_id) {
    return targetStageId;
  }

  const { data: equivalenteId, error } = await supabase.rpc("etapa_equivalente_no_funil", {
    _stage_id: targetStageId,
    _pipeline_id: lead.pipeline_id,
  });

  // Falha na consulta: mantém o comportamento antigo em vez de travar a
  // automação. Uma troca de funil indevida é ruim; automação parada é pior.
  if (error) {
    console.warn(`[etapaDoFunilDoLead] etapa_equivalente_no_funil falhou (lead ${leadId}): ${error.message}`);
    return targetStageId;
  }

  if (equivalenteId) {
    if (equivalenteId === lead.stage_id) return null; // já está na equivalente
    return equivalenteId as string;
  }

  // Sem equivalente: a troca de funil é intencional.
  return targetStageId;
}
