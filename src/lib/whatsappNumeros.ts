import { supabase } from "@/integrations/supabase/client";

/**
 * Ids dos números de WhatsApp desativados (ex.: integração excluída).
 * Modelos desses números não devem aparecer nas telas de Modelos,
 * Transmissão, gatilhos nem no seletor de modelos do chat.
 */
export async function listarIdsNumerosInativos(): Promise<Set<string>> {
  const { data } = await supabase
    .from("whatsapp_numbers")
    .select("id")
    .eq("is_active", false);
  return new Set(((data as { id: string }[] | null) ?? []).map((n) => n.id));
}

/** Remove da lista os modelos cujo número está desativado. */
export function somenteModelosDeNumerosAtivos<T extends { whatsapp_number_id?: string | null }>(
  modelos: T[],
  inativos: Set<string>,
): T[] {
  return modelos.filter((m) => !m.whatsapp_number_id || !inativos.has(m.whatsapp_number_id));
}
