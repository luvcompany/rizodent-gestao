/**
 * Resultado de uma chamada ao send-whatsapp-message feita por outra função
 * (automações, fila, transmissão, lembretes, sugestão automática, bot).
 *
 * O send-whatsapp-message responde HTTP 200 com {ok:false, error, error_code}
 * quando a Meta RECUSA a mensagem (janela fechada, modelo inválido, número
 * bloqueado…). Quem olhava só `resp.ok` gravava "enviado" para o que nunca
 * saiu — em 09/10 eram 71 follow-ups marcados 'sent' que a Meta recusou.
 *
 * Devolve null quando saiu; senão o motivo, já no formato que a fila entende:
 *   - "WHATSAPP_DISCONNECTED" → número desconectado da Meta (adiar, não falhar);
 *   - limite da Meta (130429/131056) → "Rate limit exceeded … Retry after N ms"
 *     (a fila reagenda com espera);
 *   - o resto → "<código> - <motivo>" (falha definitiva, sem reenvio).
 */
export function erroDoEnvio(status: number, texto: string): string | null {
  if (texto.includes("whatsapp_disconnected")) return "WHATSAPP_DISCONNECTED";
  let corpo: any = null;
  try { corpo = JSON.parse(texto); } catch { /* resposta não-JSON */ }
  const recusou = status < 200 || status >= 300 ||
    corpo?.ok === false ||
    (typeof corpo?.error === "string" && corpo.error.length > 0);
  if (!recusou) return null;
  const codigo = corpo?.error_code != null && corpo.error_code !== "" ? String(corpo.error_code) : String(status);
  if (codigo === "130429" || codigo === "131056") {
    return `Rate limit exceeded (Meta ${codigo}). Retry after 60000 ms`;
  }
  const motivo = typeof corpo?.error === "string" && corpo.error ? corpo.error : texto.substring(0, 300);
  return `${codigo} - ${motivo}`.substring(0, 1000);
}

/** Lê a resposta e LANÇA quando o envio não saiu (para a fila gravar 'failed'). */
export async function conferirEnvio(resp: Response, contexto: string): Promise<void> {
  const texto = await resp.text();
  const erro = erroDoEnvio(resp.status, texto);
  if (erro) throw new Error(erro === "WHATSAPP_DISCONNECTED" ? erro : `${contexto}: ${erro}`);
}

/**
 * Códigos da Meta que não adianta repetir (destinatário que não recebe, janela
 * fechada, opt-out, modelo inválido/pausado). Reenviar só gasta cota e pode
 * piorar a qualidade do número.
 */
const CODIGOS_DEFINITIVOS = new Set([
  "131026", "131047", "131049", "131050", "130472", "131051", "131052",
  "132000", "132001", "132005", "132007", "132012", "132015", "132016", "132068", "132069", "470",
]);

/** A falha (texto devolvido por erroDoEnvio) é definitiva? */
export function falhaDefinitiva(erro: string | null | undefined): boolean {
  const t = String(erro ?? "");
  if (/lead sem telefone/i.test(t)) return true;
  const m = t.match(/(?:^|:\s)(\d{3,6}) - /);
  return !!m && CODIGOS_DEFINITIVOS.has(m[1]);
}

/**
 * Como gravar na fila (crm_automation_queue) o resultado de um envio feito
 * pelo automation-engine: saiu → 'sent'; número desconectado → 'pending' daqui
 * a 10 min (o queue-worker manda quando voltar); o resto → 'failed' com o
 * motivo. Antes tudo virava 'sent'.
 */
export function linhaDaFila(envio: { ok: true } | { ok: false; erro: string }): {
  status: "sent" | "pending" | "failed";
  error_message: string | null;
  scheduled_at?: string;
} {
  if (envio.ok) return { status: "sent", error_message: null };
  if (envio.erro.includes("WHATSAPP_DISCONNECTED")) {
    const depois = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    return { status: "pending", error_message: `pausado — WhatsApp desconectado da Meta; nova tentativa em ${depois}`, scheduled_at: depois };
  }
  return { status: "failed", error_message: envio.erro.substring(0, 1000) };
}
