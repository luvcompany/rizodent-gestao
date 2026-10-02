/**
 * Tempo de resposta médio de uma conversa (painel "Tempo de Resposta Médio").
 *
 * Resposta da EQUIPE = mensagem enviada por uma pessoa: pelo sistema
 * (sender_id) ou pelo celular na coexistência (from_device). Bot, automação,
 * IA e modelos de lembrete não têm remetente e não contam — a mesma régua do
 * servidor (rodizio_msg_humana, migration 20260929002120). Falha, nota de
 * sistema, mensagem apagada e histórico importado ficam de fora.
 */
export type MensagemParaTempo = {
  id: string;
  direction: string;
  created_at: string;
  status: string;
  type?: string | null;
  sender_id?: string | null;
  from_device?: boolean | null;
  importada_do_historico?: boolean | null;
  deleted_at?: string | null;
};

const STATUS_SEM_ENVIO = new Set(["system", "failed", "error"]);

function contaNaConversa(m: MensagemParaTempo): boolean {
  if (m.deleted_at) return false;
  if (m.importada_do_historico) return false;
  if ((m.type ?? "") === "system" || STATUS_SEM_ENVIO.has(m.status)) return false;
  if (m.direction === "inbound") return true;
  return m.direction === "outbound" && (!!m.sender_id || !!m.from_device);
}

/** Médias (ms) de resposta do lead e da equipe; -1 quando não há par. */
export function temposDeResposta(messages: MensagemParaTempo[]): { avgLeadResponse: number; avgUserResponse: number } {
  const sorted = messages
    .filter(contaNaConversa)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const leadDeltas: number[] = [];
  const userDeltas: number[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const delta = new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();

    // O lead respondeu à equipe
    if (prev.direction === "outbound" && curr.direction === "inbound") leadDeltas.push(delta);
    // A equipe respondeu ao lead
    if (prev.direction === "inbound" && curr.direction === "outbound") userDeltas.push(delta);
  }

  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : -1);
  return { avgLeadResponse: avg(leadDeltas), avgUserResponse: avg(userDeltas) };
}
