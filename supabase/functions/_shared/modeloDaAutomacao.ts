/**
 * O modelo (template) de uma automação ainda serve para o disparo?
 *
 * Antes do disparo em massa (enqueue-stage-automation) só se olhava se havia
 * um template_id na automação. Modelo excluído na Meta, reprovado, ou criado
 * na WABA de outro número (o número antigo do closer, a WABA de outro cliente
 * do mesmo dono) só falhava lá na frente, lead por lead, no
 * send-whatsapp-message ("Template não existe na WABA deste número") — a tela
 * dizia "N leads enfileirados" e ninguém recebia nada.
 *
 * Regra: o modelo tem de existir no cliente, estar APPROVED e ser da WABA do
 * número por onde a mensagem vai sair — o número de saída de um lead de
 * amostra (regra única de _shared/numeroDeSaida.ts) ou, sem lead, o número
 * padrão da equipe do funil. O envio casa o modelo por NOME e idioma dentro da
 * WABA de saída; por isso um modelo APPROVED de mesmo nome e idioma na WABA de
 * saída também vale (é o que o envio vai usar).
 */

import { numeroDeSaida } from "./numeroDeSaida.ts";
import { escopoDoLead } from "./wabaEscopo.ts";
import type { MundoRef } from "./mundoNumero.ts";

export const MODELO_INVALIDO =
  "O modelo desta automação foi excluído ou não está aprovado — edite a automação e escolha outro";

/** Lead que não existe: simula "um lead novo da equipe" para achar o número padrão dela. */
const LEAD_FICTICIO = "00000000-0000-0000-0000-000000000000";

export type ConferenciaModelo =
  | { ok: true; wabaId: string | null; numero: string; motivo: string }
  | { ok: false; status: number; error: string; detalhe: string };

export async function conferirModeloDaAutomacao(
  admin: any,
  p: {
    templateId: string;
    tenantId: string;
    pipelineId: string | null;
    /** Mundo (equipe) do disparo — usado quando não há lead de amostra. */
    mundo: MundoRef;
    /** Um lead que vai receber o disparo (o 1º elegível), se houver. */
    amostra: { leadId: string; leadNumberId: string | null } | null;
  },
): Promise<ConferenciaModelo> {
  const { data: tpl, error: tplErr } = await admin
    .from("crm_whatsapp_templates")
    .select("id, name, language, status, waba_id")
    .eq("id", p.templateId)
    .eq("tenant_id", p.tenantId)
    .maybeSingle();
  if (tplErr) return { ok: false, status: 500, error: `Erro ao ler o modelo: ${tplErr.message}`, detalhe: "leitura" };
  if (!tpl) return { ok: false, status: 400, error: MODELO_INVALIDO, detalhe: "modelo não existe no cliente" };
  if (String((tpl as any).status || "").toUpperCase() !== "APPROVED") {
    return { ok: false, status: 400, error: MODELO_INVALIDO, detalhe: `status ${(tpl as any).status ?? "vazio"}` };
  }

  // Número de saída: o do lead de amostra ou o padrão da equipe do funil.
  let leadNumberId: string | null;
  let leadId: string;
  if (p.amostra) {
    leadId = p.amostra.leadId;
    leadNumberId = p.amostra.leadNumberId;
  } else {
    leadId = LEAD_FICTICIO;
    // Um número qualquer da equipe só para dizer QUAL é a equipe (o
    // numeroDeSaida escolhe o ativo/padrão dela); NULL = equipe do legado.
    leadNumberId = p.mundo.semNumero ? null : (p.mundo.numberIds[0] ?? null);
    if (!p.mundo.semNumero && !leadNumberId) {
      return { ok: false, status: 400, error: "Nenhum número de WhatsApp ativo da equipe deste funil", detalhe: "equipe sem número" };
    }
  }
  const saida = await numeroDeSaida(admin, { leadId, tenantId: p.tenantId, leadNumberId, pipelineId: p.pipelineId });
  if (!saida.ok) return { ok: false, status: saida.status, error: saida.error, detalhe: "sem número de saída" };

  // WABA do envio: a mesma conta que o send-whatsapp-message usa para casar o modelo.
  const escopo = await escopoDoLead(admin, { whatsapp_number_id: saida.numberId ?? leadNumberId, tenant_id: p.tenantId });
  const wabaSaida = escopo.wabaId ?? null;
  if (!wabaSaida) {
    // Sem WABA conhecida o envio casa só por nome no cliente — não há o que comparar.
    return { ok: true, wabaId: null, numero: saida.phoneNumberId, motivo: "WABA de saída desconhecida" };
  }
  if ((tpl as any).waba_id === wabaSaida) {
    return { ok: true, wabaId: wabaSaida, numero: saida.phoneNumberId, motivo: "modelo da WABA de saída" };
  }

  const { data: gemeos, error: gemErr } = await admin
    .from("crm_whatsapp_templates")
    .select("id")
    .eq("tenant_id", p.tenantId)
    .eq("waba_id", wabaSaida)
    .eq("name", (tpl as any).name)
    .eq("language", (tpl as any).language)
    .eq("status", "APPROVED")
    .limit(1);
  if (gemErr) return { ok: false, status: 500, error: `Erro ao ler os modelos: ${gemErr.message}`, detalhe: "leitura" };
  if ((gemeos ?? []).length > 0) {
    return { ok: true, wabaId: wabaSaida, numero: saida.phoneNumberId, motivo: "modelo de mesmo nome na WABA de saída" };
  }
  return {
    ok: false,
    status: 400,
    error: MODELO_INVALIDO,
    detalhe: `modelo da WABA ${(tpl as any).waba_id ?? "(sem WABA)"}, saída pela WABA ${wabaSaida}`,
  };
}
