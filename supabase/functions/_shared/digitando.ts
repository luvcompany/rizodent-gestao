import { BASE_GRAPH_META } from "./metaVersao.ts";

/**
 * "Digitando…" + mensagem lida, no WhatsApp.
 *
 * A Meta documenta UM payload só, e ele já traz status:"read": mostrar
 * "digitando" é, na forma oficial, marcar como lida no mesmo pedido. O
 * indicador cai sozinho quando a resposta sai, ou em 25 segundos.
 *
 * Regra que seguimos, da própria doc ("only display a typing indicator if you
 * are going to respond"): só chamamos quando uma resposta automática vai sair
 * em seguida — bot ou automação por palavra-chave. Mensagem que vai para a
 * fila humana não recebe dois tiques azuis seguidos de silêncio.
 *
 * NUNCA lança e NUNCA atrasa o webhook além do timeout curto: se a Meta
 * recusar (janela de 24 h fechada, wamid inválido), a conversa segue igual.
 */
export async function avisarLidaEDigitando(opts: {
  phoneNumberId: string | null | undefined;
  token: string | null | undefined;
  wamid: string | null | undefined;
  /** Só para log: de onde veio a chamada. */
  origem?: string;
}): Promise<boolean> {
  const { phoneNumberId, token, wamid } = opts;
  if (!phoneNumberId || !token || !wamid) return false;
  // wamid de mensagem RECEBIDA. Id de saída devolve 131009.
  if (!String(wamid).startsWith("wamid.")) return false;

  try {
    const res = await fetch(`${BASE_GRAPH_META}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: wamid,
        typing_indicator: { type: "text" },
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      const corpo = await res.text().catch(() => "");
      console.warn(
        `[digitando] Meta recusou (${res.status}) origem=${opts.origem ?? "-"}: ${corpo.slice(0, 200)}`,
      );
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[digitando] falhou origem=${opts.origem ?? "-"}: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
