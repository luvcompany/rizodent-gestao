// Para qual WhatsApp ID a Meta deve mandar (campo "to").
//
// O CRM guarda o telefone canônico SEM o 9 do celular (telefone_canonico /
// trg_normalize_lead_phone), mas o WhatsApp ID do paciente nem sempre é esse.
// Nos DDD 11 a 28 o ID tem o 9 (5511 9 3324-6057): mandando 551133246057 a
// Meta só acha o paciente quando adivinha o 9 — com local começando em 1-5 não
// adivinha e devolve 131026 "Message undeliverable" (caso Gilma, 15/10/2026:
// 94 de 94 envios assim falharam desde agosto).
//
// Ordem: o ID exato de onde o paciente escreveu (vem dentro do wamid da
// mensagem recebida); senão, nos DDD 11 a 28, o número com o 9; senão o
// canônico. A comparação de telefone continua sempre pelo canônico.

/** Mesmo resultado de public.telefone_canonico (só dígitos, 55 + DDD + 8). */
export function telefoneCanonico(raw: string | null | undefined): string {
  let v = String(raw ?? "").replace(/\D/g, "");
  if (!v) return "";
  if ((v.length === 11 || v.length === 12) && v[0] === "0") v = v.slice(1);
  if ((v.length === 12 || v.length === 13) && v.startsWith("55")) v = v.slice(2);
  else if (v.length !== 10 && v.length !== 11) return v;
  if (v.length === 11 && v[2] === "9") v = v.slice(0, 2) + v.slice(3);
  return "55" + v;
}

/**
 * WhatsApp ID gravado dentro do wamid. O wamid é base64 de um registro cujo
 * 3º byte é o tamanho do ID e os bytes seguintes são os dígitos
 * ("\x1c\x18\x0d" + "5511933246057" + ...).
 */
export function waIdDoWamid(wamid: string | null | undefined): string | null {
  const s = String(wamid ?? "");
  if (!s.startsWith("wamid.")) return null;
  try {
    const b64 = s.slice(6).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    const tam = bin.charCodeAt(2);
    if (tam < 8 || tam > 15 || bin.length < 3 + tam) return null;
    const id = bin.slice(3, 3 + tam);
    return /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Destino para a Meta a partir do telefone do lead e do ID visto no inbound. */
export function destinoParaMeta(phone: string | null | undefined, waIdVisto?: string | null): string {
  const digitos = String(phone ?? "").replace(/\D/g, "");
  if (!digitos) return "";
  if (waIdVisto && telefoneCanonico(waIdVisto) === telefoneCanonico(digitos)) return waIdVisto;
  const canon = telefoneCanonico(digitos);
  if (canon.length === 12 && canon.startsWith("55")) {
    const ddd = Number(canon.slice(2, 4));
    if (ddd >= 11 && ddd <= 28) return canon.slice(0, 4) + "9" + canon.slice(4);
  }
  return digitos;
}

/** Destino do lead: usa o WhatsApp ID das últimas mensagens que ele mandou. */
export async function destinoDoLead(
  supabase: any,
  leadId: string | null | undefined,
  phone: string | null | undefined,
): Promise<string> {
  let waId: string | null = null;
  if (leadId) {
    try {
      const { data } = await supabase
        .from("messages")
        .select("whatsapp_message_id")
        .eq("lead_id", leadId)
        .eq("direction", "inbound")
        .like("whatsapp_message_id", "wamid.%")
        .order("created_at", { ascending: false })
        .limit(5);
      const canon = telefoneCanonico(phone);
      for (const m of (data || []) as any[]) {
        const id = waIdDoWamid(m?.whatsapp_message_id);
        if (id && telefoneCanonico(id) === canon) { waId = id; break; }
      }
    } catch (_) { /* sem histórico: segue pela regra do DDD */ }
  }
  return destinoParaMeta(phone, waId);
}
