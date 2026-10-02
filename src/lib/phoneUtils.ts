/**
 * Telefone brasileiro no CRM (espelho de supabase/functions/_shared/phoneBR.ts):
 *  - GRAVAR: normalizePhoneParaGravar — 55 + DDD + número, mantendo o 9 do celular;
 *  - CASAR: phoneKey — 55 + DDD + 8 últimos dígitos, sem o 9 (a mesma chave da
 *    coluna crm_leads.phone_key, SQL normaliza_telefone_br). O wa_id da Meta vem
 *    às vezes sem o 9; só a chave casa os dois formatos;
 *  - EXIBIR/DISCAR: formatPhoneDisplayBR e toE164BR, que reinserem o 9 do celular.
 */

/**
 * Normaliza número de telefone brasileiro para o formato: 55 + DDD + número (8 dígitos).
 * - Remove caracteres não numéricos
 * - Adiciona prefixo 55 se ausente
 * - Remove o 9 extra de celular (11 dígitos locais → 10)
 *
 * É o formato do wa_id sem o 9. Para GRAVAR use normalizePhoneParaGravar; para
 * comparar/deduplicar, phoneKey.
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
 * Chave de casamento (igual à SQL normaliza_telefone_br e a crm_leads.phone_key):
 * número brasileiro reconhecível — 10/11 dígitos, ou 12/13 começando com 55 —
 * vira 55 + DDD + 8 últimos dígitos; o resto fica só com os dígitos. null sem dígitos.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 || d.length === 11) return "55" + d.slice(0, 2) + d.slice(-8);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return "55" + d.slice(2, 4) + d.slice(-8);
  return d;
}

/**
 * Formato de GRAVAÇÃO: 55 + DDD + número como veio (com o 9 do celular, se
 * veio). Aceita máscara, "+55" e o zero de discagem ("0 77 …"). Número que não
 * é brasileiro reconhecível volta só com os dígitos; "" sem dígitos.
 */
export function normalizePhoneParaGravar(raw: string | null | undefined): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  // Zero de discagem nacional antes do DDD ("077 98123-4567").
  if (d.startsWith("0") && (d.length === 11 || d.length === 12)) d = d.slice(1);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  if (d.length === 10 || d.length === 11) return "55" + d;
  return d;
}

/** Gravado no formato brasileiro completo (55 + DDD + 8 ou 9 dígitos)? */
export function ehTelefoneBRCompleto(gravado: string | null | undefined): boolean {
  return /^55\d{10,11}$/.test(String(gravado ?? ""));
}

/**
 * Parte local (DDD + número) de um telefone brasileiro, com o 9 do celular
 * reinserido quando o número local tem 8 dígitos e começa com 6–9 (o wa_id da
 * Meta costuma vir sem ele). null quando não é brasileiro reconhecível.
 */
function localComNove(raw: string | null | undefined): string | null {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2); // tira DDI
  if (d.length !== 10 && d.length !== 11) return null;
  if (d.length === 10 && /[6-9]/.test(d[2])) d = d.slice(0, 2) + "9" + d.slice(2);
  return d;
}

/**
 * Retorna o número em E.164 (ex.: +5577999998888) a partir de qualquer formato.
 * Usado no href tel: para o click-to-call da extensão discar corretamente —
 * celular sem o 9 ganha o 9 (senão a ligação não completa).
 */
export function toE164BR(raw: string | null | undefined): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  const local = localComNove(d);
  if (local) return "+55" + local;
  return "+" + (d.startsWith("55") ? d : "55" + d);
}

/**
 * Formata um telefone BR para exibição legível: +55 (DD) NNNNN-NNNN.
 * Formato que o click-to-call (Api4Com e afins) reconhece na página. Celular
 * gravado sem o 9 é exibido com ele. Se não conseguir interpretar, devolve o
 * valor original.
 */
export function formatPhoneDisplayBR(raw: string | null | undefined): string {
  const original = String(raw || "");
  const d = localComNove(original);
  if (!d) return original;   // formato inesperado
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  const meio = rest.length === 9 ? rest.slice(0, 5) : rest.slice(0, 4);
  const fim = rest.length === 9 ? rest.slice(5) : rest.slice(4);
  return `+55 (${ddd}) ${meio}-${fim}`;
}

/**
 * Lê o telefone digitado num formulário: devolve o que gravar (BR com 55 e o 9;
 * estrangeiro só com "+"/"00" explícito), ou a frase de erro / aviso.
 */
const MINIMO_DIGITOS_ESTRANGEIRO = 8;
const MAXIMO_DIGITOS_E164_DIGITADO = 15;
const AVISO_ESTRANGEIRO = "Número estrangeiro: confira o código do país.";

export function lerTelefoneDigitado(digitado: string): { gravar: string | null; erro: string | null; aviso: string | null } {
  const t = (digitado ?? "").trim();
  if (!t) return { gravar: null, erro: null, aviso: null };
  const digitos = t.replace(/\D/g, "");
  const compacto = t.replace(/[\s().-]/g, "");
  // Com DDI explícito: "+" ou o prefixo internacional "00" (DDD nunca começa com 0).
  const comDdi = compacto.startsWith("+") ? digitos : compacto.startsWith("00") ? digitos.slice(2) : null;
  if (comDdi !== null && !comDdi.startsWith("55")) {
    if (comDdi.length < MINIMO_DIGITOS_ESTRANGEIRO || comDdi.length > MAXIMO_DIGITOS_E164_DIGITADO) {
      return { gravar: null, erro: "Telefone estrangeiro incompleto: informe o código do país e o número (ex.: +351 912 345 678).", aviso: null };
    }
    return { gravar: comDdi, erro: null, aviso: AVISO_ESTRANGEIRO };
  }
  const gravar = normalizePhoneParaGravar(comDdi ?? t);
  if (!ehTelefoneBRCompleto(gravar)) {
    // Muitos dígitos sem o 55: provavelmente estrangeiro digitado sem o "+".
    const semDdi = comDdi === null && digitos.length > 11 && !digitos.startsWith("55") && !digitos.startsWith("0");
    return {
      gravar: null,
      erro: semDdi
        ? "Número estrangeiro? Comece com + e o código do país (ex.: +351 912 345 678)."
        : "Telefone incompleto: informe DDD + número (ex.: (77) 98123-4567).",
      aviso: null,
    };
  }
  return { gravar, erro: null, aviso: null };
}
