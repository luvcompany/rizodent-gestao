import { supabase } from "@/integrations/supabase/client";

/**
 * Motivo de desqualificação (pedido da gestão, 21/09/2026): quem move o lead
 * para "Desqualificado" pela tela escolhe o motivo. Ele fica gravado na
 * passagem de etapa (crm_lead_stage_history.motivo) e aparece no histórico da
 * conversa.
 *
 * As movidas feitas pelo sistema (automações, bot) continuam sem motivo — não
 * há quem escolher.
 */
export const MOTIVOS_DESQUALIFICACAO = [
  "Currículo / propaganda",
  "Sem interesse",
  "Clicou errado",
  "Já é paciente",
] as const;

export const MOTIVO_OUTRO = "Outro";

const normalizar = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export function ehEtapaDesqualificado(nomeDaEtapa: string | null | undefined): boolean {
  return normalizar(nomeDaEtapa || "").includes("desqualific");
}

/**
 * Grava o motivo na passagem que ACABOU de ser aberta pelo gatilho
 * sync_lead_stage_history (a linha aberta do lead nessa etapa). Devolve false
 * quando nenhuma linha foi atualizada — a tela avisa em vez de fingir que
 * gravou.
 */
export async function gravarMotivoDesqualificacao(leadId: string, stageId: string, motivo: string): Promise<boolean> {
  const { data, error } = await (supabase as any)
    .from("crm_lead_stage_history")
    .update({ motivo })
    .eq("lead_id", leadId)
    .eq("stage_id", stageId)
    .is("exited_at", null)
    .select("id");
  if (error) {
    console.error("[desqualificacao] motivo não gravado:", error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}
