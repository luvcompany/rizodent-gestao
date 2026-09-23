import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Bloqueio do contato NA META, além do bloqueio local do CRClin.
 *
 * O bloqueio local (crm_leads.is_blocked) só esconde o lead: a pessoa continua
 * mandando mensagem para o número da clínica. Quem fecha a porta é a Block
 * Users API da Meta, chamada pela function whatsapp-bloquear-contato.
 *
 * Regra de perfil: só gestão (crc/gerente/superadmin) bloqueia na Meta — a SDR
 * continua com o bloqueio local, que é reversível e não afeta o número.
 *
 * NUNCA lança: o bloqueio local já aconteceu antes desta chamada, e uma recusa
 * da Meta (o caso comum é o paciente não ter escrito nas últimas 24 h) não pode
 * virar erro de tela.
 */
export function papelBloqueiaNaMeta(userRole: string | null | undefined): boolean {
  return userRole === "crc" || userRole === "gerente" || userRole === "superadmin";
}

export async function bloquearContatoNaMeta(
  leadId: string,
  acao: "bloquear" | "desbloquear",
  opcoes: { silencioso?: boolean } = {},
): Promise<{ ok: boolean; motivo?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("whatsapp-bloquear-contato", {
      body: { lead_id: leadId, acao },
    });
    if (error) {
      if (!opcoes.silencioso) toast.warning("Bloqueado no CRClin. Não consegui falar com a Meta agora.");
      return { ok: false, motivo: error.message };
    }
    const resposta = (data ?? {}) as { ok?: boolean; motivo?: string; mensagem?: string };
    if (resposta.ok) {
      if (!opcoes.silencioso) toast.success(resposta.mensagem || "Feito na Meta.");
      return { ok: true };
    }
    if (!opcoes.silencioso && resposta.motivo) toast.warning(resposta.motivo);
    return { ok: false, motivo: resposta.motivo };
  } catch (e) {
    if (!opcoes.silencioso) toast.warning("Bloqueado no CRClin. Não consegui falar com a Meta agora.");
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) };
  }
}
