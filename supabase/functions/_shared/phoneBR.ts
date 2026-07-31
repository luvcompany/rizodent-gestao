// Normalização de telefone BR para o formato canônico do CRM.
//
// O canônico do banco é "55" + DDD + 8 dígitos (SEM o 9 do celular) — imposto
// pelo trigger normalize_lead_phone (migração 20260525160000) — e é exatamente
// o formato que a Meta usa em msg.from. Buscar lead com 13 dígitos não casa com
// nada e cria duplicata, então quem alimenta o CRM a partir de fonte externa
// (Dontus) precisa passar por aqui antes.

export type PhoneMotivo = "ok" | "sem_celular" | "sem_ddd" | "fixo" | "invalido";

export interface PhoneResult {
  phone: string | null;
  motivo: PhoneMotivo;
}

/**
 * @param raw       telefone como veio da fonte (pode ter máscara, DDI, 9º dígito)
 * @param dddPadrao DDD da unidade, usado quando o cadastro veio sem DDD
 */
export function normalizeBrPhone(raw: string | null | undefined, dddPadrao?: string | null): PhoneResult {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return { phone: null, motivo: "sem_celular" };

  // Prefixo de operadora (021, 015...) antes do número completo.
  if (digits.startsWith("0") && digits.length > 11) digits = digits.slice(1);

  // DDI do Brasil.
  if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);

  // Cadastro sem DDD: usa o da unidade.
  if (digits.length === 8 || digits.length === 9) {
    const ddd = String(dddPadrao ?? "").replace(/\D/g, "");
    if (ddd.length !== 2) return { phone: null, motivo: "sem_ddd" };
    digits = ddd + digits;
  }

  // Celular com 9º dígito → remove (formato aceito pela WhatsApp API).
  if (digits.length === 11 && digits[2] === "9") digits = digits.slice(0, 2) + digits.slice(3);

  if (digits.length !== 10) return { phone: null, motivo: "invalido" };

  // Fixo não recebe WhatsApp: local começando em 2-5.
  const local = digits.slice(2);
  if (["2", "3", "4", "5"].includes(local[0])) return { phone: null, motivo: "fixo" };

  return { phone: "55" + digits, motivo: "ok" };
}

/** Primeiro nome, capitalizado — para saudação de template. */
export function primeiroNome(nome: string | null | undefined): string {
  const limpo = String(nome ?? "").trim().replace(/\s+/g, " ");
  if (!limpo) return "";
  const primeiro = limpo.split(" ")[0];
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}
