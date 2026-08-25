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
