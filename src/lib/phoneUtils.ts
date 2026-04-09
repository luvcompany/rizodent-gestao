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
