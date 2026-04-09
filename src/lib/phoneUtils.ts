/**
 * Normaliza número de telefone brasileiro para o formato 55 + DDD (2 dígitos) + número (8 dígitos).
 * Remove caracteres não numéricos, adiciona 55 se ausente, e remove o 9 extra do celular.
 * Exemplos:
 *   "77999867564"  → "5577999867564" — wait, 11 digits means has country code? No.
 *   Let me think about Brazilian phone format:
 *   Full format: 55 + DD + 9XXXXXXXX (13 digits) or 55 + DD + XXXXXXXX (12 digits for landline)
 *   Without country code: DD + 9XXXXXXXX (11 digits) or DD + XXXXXXXX (10 digits)
 *
 *   The rule the user wants:
 *   1. Always prepend 55 if missing
 *   2. Remove the leading 9 from the local number (9-digit mobile → 8-digit)
 *      e.g. 77 9 9986-7564 → 77 9986-7564
 *      So final: 5577 + 99867564 (12 digits total)
 */
export function normalizePhone(raw: string): string {
  // Strip non-digits
  let phone = raw.replace(/\D/g, "");

  if (!phone) return "";

  // Remove country code if present to work with local number
  if (phone.startsWith("55") && phone.length >= 12) {
    phone = phone.slice(2);
  }

  // Now phone should be DDD + number (10 or 11 digits)
  // If 11 digits: DDD(2) + 9(1) + number(8) → remove the 9
  if (phone.length === 11) {
    const ddd = phone.slice(0, 2);
    const rest = phone.slice(2); // 9 digits starting with 9
    if (rest.startsWith("9")) {
      phone = ddd + rest.slice(1); // remove leading 9 → 10 digits
    }
  }

  // Prepend 55
  return "55" + phone;
}
