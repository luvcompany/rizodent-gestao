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

// ─── Mundo do número (09/10/2026) ───
// O número pertence a uma EQUIPE (whatsapp_numbers.mundo): 'crc' = central
// (CRC/SDR/pós-venda, inclui o número legado = lead com whatsapp_number_id
// NULL e TODOS os números centrais), 'closer'/'recepcao' = números do dono.
// Comparar o id do número separava o mesmo paciente em "mundos" diferentes a
// cada número novo conectado. Mesma regra do banco (mundo_numero_whatsapp) e
// das funções (supabase/functions/_shared/mundoNumero.ts).

export type NumeroComMundo = { id: string; mundo: string | null; dono_user_id: string | null };

/** Números que o usuário enxerga (a RLS já recorta), com o mundo de cada um. */
export async function numerosComMundo(tenantId?: string | null): Promise<NumeroComMundo[]> {
  let q = supabase.from("whatsapp_numbers").select("id, mundo, dono_user_id");
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data, error } = await q;
  if (error) {
    console.error("[mundoNumero] falha ao ler os números:", error);
    return [];
  }
  return ((data as NumeroComMundo[] | null) ?? []).map((n) => ({ ...n, mundo: n.mundo || "crc" }));
}

/**
 * Filtro `.or(...)` do PostgREST para os leads do MESMO MUNDO do número
 * `numberId` (null = número legado, que é do mundo central).
 */
export function orMesmoMundo(numeros: NumeroComMundo[], numberId: string | null): string {
  const ref = numberId ? numeros.find((n) => n.id === numberId) : null;
  const mundo = ref?.mundo || "crc";
  if (mundo === "crc") {
    const fora = numeros.filter((n) => n.mundo !== "crc").map((n) => n.id);
    return fora.length
      ? `whatsapp_number_id.is.null,whatsapp_number_id.not.in.(${fora.join(",")})`
      : "whatsapp_number_id.is.null,whatsapp_number_id.not.is.null";
  }
  const dono = ref?.dono_user_id ?? null;
  const ids = numeros
    .filter((n) => n.mundo === mundo && (!dono || !n.dono_user_id || n.dono_user_id === dono))
    .map((n) => n.id);
  return `whatsapp_number_id.in.(${(ids.length ? ids : [numberId as string]).join(",")})`;
}
