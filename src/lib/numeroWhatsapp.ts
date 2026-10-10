import { supabase } from "@/integrations/supabase/client";

/**
 * Identificação e número padrão de um número de WhatsApp do cliente
 * (whatsapp_numbers).
 */

/**
 * Telefone do próprio número para identificação: o E.164 gravado como está.
 * Não usa formatPhoneDisplayBR, que completa o 9º dígito e mostraria um número
 * que não existe (AGENTS.md).
 */
export function telefoneDoNumero(e164: string | null | undefined): string {
  const bruto = String(e164 || "").replace(/\D/g, "");
  if (!bruto) return "";
  const semPais = bruto.startsWith("55") && bruto.length >= 12 ? bruto.slice(2) : bruto;
  if (semPais.length === 10) return `(${semPais.slice(0, 2)}) ${semPais.slice(2, 6)}-${semPais.slice(6)}`;
  if (semPais.length === 11) return `(${semPais.slice(0, 2)}) ${semPais.slice(2, 7)}-${semPais.slice(7)}`;
  return `+${bruto}`;
}

/** "nome · telefone" (ou só o que existir). */
export function rotuloDoNumero(n: { display_name: string | null; phone_e164: string | null }): string {
  const nome = (n.display_name ?? "").trim();
  const telefone = telefoneDoNumero(n.phone_e164);
  if (nome && telefone) return `${nome} · ${telefone}`;
  return nome || telefone || "Número sem nome";
}

/** Evento que as telas escutam para recarregar o número padrão. */
export const EVENTO_PADRAO_ALTERADO = "whatsapp-padrao-alterado";

/**
 * Troca o número padrão de envio do cliente numa chamada só (RPC
 * definir_numero_padrao, migration 0018): o banco zera os outros e marca este
 * na mesma transação, e recusa número desativado ou fora da equipe central.
 * Antes eram 2 UPDATEs soltos — se o 2º falhasse, o cliente ficava sem padrão;
 * dois cliques juntos podiam deixar dois.
 */
export async function definirNumeroPadrao(numeroId: string): Promise<{ error: unknown }> {
  // Cast: RPC nova (types.ts não é editado aqui).
  const { error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc("definir_numero_padrao", { p_numero: numeroId });
  return { error };
}
