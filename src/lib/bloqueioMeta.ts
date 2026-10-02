import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Bloqueio do contato NA META, além do bloqueio local do sistema.
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
 *
 * Os avisos não citam o nome do produto (CONV-28): cliente com marca própria
 * (white-label) lia "Bloqueado no CRClin". O texto é neutro — "aqui no
 * sistema" — para qualquer marca. `nomeSistema` continua aceito só para não
 * quebrar quem ainda passa (é ignorado).
 */
export function papelBloqueiaNaMeta(userRole: string | null | undefined): boolean {
  return userRole === "crc" || userRole === "gerente" || userRole === "superadmin";
}

/**
 * O lead tem telefone para a Meta do WhatsApp? Lead só do Instagram (sem
 * telefone) não passa pela Block Users API: a function responde "Lead sem
 * telefone" e o aviso "Não consegui falar com a Meta" saía falso (INTEG-20).
 * Quem chama confere antes, como Configurações › Bloqueados.
 */
export function temTelefoneParaMeta(phone: string | null | undefined): boolean {
  return !!String(phone ?? "").replace(/\D/g, "");
}

/**
 * Aviso de quando o bloqueio (ou desbloqueio) local valeu, mas a Meta não respondeu.
 * O 1º parâmetro é o antigo `nomeSistema`, mantido na assinatura e ignorado.
 */
export function avisoSemMeta(_nomeSistema?: string | null, acao: "bloquear" | "desbloquear" = "bloquear"): string {
  const feito = acao === "desbloquear" ? "Desbloqueado" : "Bloqueado";
  return `${feito} aqui no sistema. Não consegui falar com a Meta agora.`;
}

export async function bloquearContatoNaMeta(
  leadId: string,
  acao: "bloquear" | "desbloquear",
  opcoes: {
    silencioso?: boolean;
    /** @deprecated ignorado: os avisos não citam mais o nome do produto (CONV-28). */
    nomeSistema?: string | null;
  } = {},
): Promise<{ ok: boolean; motivo?: string }> {
  const aviso = avisoSemMeta(null, acao);
  try {
    const { data, error } = await supabase.functions.invoke("whatsapp-bloquear-contato", {
      body: { lead_id: leadId, acao },
    });
    if (error) {
      if (!opcoes.silencioso) toast.warning(aviso);
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
    if (!opcoes.silencioso) toast.warning(aviso);
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) };
  }
}
