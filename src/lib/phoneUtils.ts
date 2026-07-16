/**
 * Normaliza número de telefone brasileiro para o formato: 55 + DDD + número (8 dígitos).
 * - Remove caracteres não numéricos
 * - Adiciona prefixo 55 se ausente
 * - Remove o 9 extra de celular (11 dígitos locais → 10)
 */
export function normalizePhone(raw: string): string {
  let phone = raw.replace(/\D/g, "");
  if (!phone) return "";

  // Remove country code if present
  if (phone.startsWith("55") && phone.length >= 12) {
    phone = phone.slice(2);
  }

  // 11 digits = DDD(2) + 9(1) + number(8) → remove the leading 9
  if (phone.length === 11) {
    const ddd = phone.slice(0, 2);
    const rest = phone.slice(2);
    if (rest.startsWith("9")) {
      phone = ddd + rest.slice(1);
    }
  }

  return "55" + phone;
}

/**
 * Retorna o número em E.164 (ex.: +5577999998888) a partir de qualquer formato.
 * Usado no href tel: para o click-to-call da extensão discar corretamente.
 */
export function toE164BR(raw: string | null | undefined): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  return "+" + (d.startsWith("55") ? d : "55" + d);
}

/**
 * Formata um telefone BR para exibição legível: +55 (DD) NNNNN-NNNN.
 * Formato que o click-to-call (Api4Com e afins) reconhece na página.
 * Se não conseguir interpretar, devolve o valor original.
 */
export function formatPhoneDisplayBR(raw: string | null | undefined): string {
  const original = String(raw || "");
  let d = original.replace(/\D/g, "");
  if (!d) return original;
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2); // tira DDI
  if (d.length !== 10 && d.length !== 11) return original;   // formato inesperado
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  const meio = rest.length === 9 ? rest.slice(0, 5) : rest.slice(0, 4);
  const fim = rest.length === 9 ? rest.slice(5) : rest.slice(4);
  return `+55 (${ddd}) ${meio}-${fim}`;
}
