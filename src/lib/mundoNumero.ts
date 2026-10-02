import { supabase } from "@/integrations/supabase/client";

/**
 * "Cada número é um mundo": leads criados manualmente nascem carimbados com o
 * número de quem cria. Closer/recepção têm um número concedido (a RLS de
 * whatsapp_numbers já filtra pelos números acessíveis ao usuário); crc/gerente
 * operam o número principal = mundo legado (whatsapp_number_id NULL).
 *
 * Retorna o id do número do criador ou null (mundo legado).
 */
export async function getMyWhatsappNumberId(userRole: string | null | undefined): Promise<string | null> {
  if (userRole !== "closer" && userRole !== "recepcao") return null;
  const { data, error } = await supabase
    .from("whatsapp_numbers")
    .select("id, is_default, created_at")
    .eq("is_active", true)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) {
    console.error("[mundoNumero] falha ao resolver número do usuário:", error);
    return null;
  }
  return (data as any[])?.[0]?.id ?? null;
}

// ─── Adaptador para as telas do redesign (01/10/2026) ───
// O v2 escolhe o número do lead novo pelo canal do funil (colunas que o CRClin
// não tem). Aqui vale a regra de sempre do CRClin: o número de quem cria
// (closer/recepção) ou nenhum — e o gatilho do banco carimba pelo funil. Se a
// tela deixar escolher um número, ele é respeitado.
export async function numeroDoLeadNovo(
  userRole: string | null | undefined,
  _pipelineId: string,
  escolhido?: string | null,
): Promise<{ carimbo: string | null; mundo: string | null }> {
  if (escolhido) return { carimbo: escolhido, mundo: escolhido };
  const id = await getMyWhatsappNumberId(userRole);
  return { carimbo: id, mundo: id };
}
