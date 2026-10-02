import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensagemDeErro } from "@/lib/mensagemDeErro";

// Versão CRClin: o v2 grava a nota pela RPC conversa_nota_de_sistema, que não
// existe aqui. O CRClin sempre gravou nota de sistema direto em `messages`
// (type/status "system") — é o mesmo caminho do AppointmentConfirmBar.
const PADRAO = "A anotação no histórico da conversa não foi gravada.";

export async function gravarNotaDeSistema(
  leadId: string,
  texto: string,
): Promise<{ ok: true; id: string | null } | { ok: false; motivo: string }> {
  try {
    const { data, error } = await supabase
      .from("messages")
      .insert({ lead_id: leadId, direction: "outbound", type: "system", content: texto, status: "system" })
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, motivo: mensagemDeErro(error, PADRAO) };
    return { ok: true, id: (data as { id?: string } | null)?.id ?? null };
  } catch (e) {
    return { ok: false, motivo: mensagemDeErro(e, PADRAO) };
  }
}

export async function anotarNoHistorico(leadId: string, texto: string) {
  const nota = await gravarNotaDeSistema(leadId, texto);
  if (nota.ok === false) {
    toast.warning(`A ação foi registrada, mas a anotação no histórico da conversa não foi gravada: ${nota.motivo}`);
  }
  return nota;
}
