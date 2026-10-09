/**
 * Strips the random suffix Meta appends to template names.
 * Only strips suffixes that look like random hashes (mix of letters AND digits),
 * preserving real words like "boas_vindas".
 * e.g. "agendamento_itabuna_k9jfzi" → "agendamento_itabuna"
 *      "boas_vindas" → "boas_vindas" (preserved)
 */
export const cleanTemplateName = (name: string): string => {
  const match = name.match(/^(.+)_([a-z0-9]{4,10})$/);
  if (!match) return name;
  const suffix = match[2];
  // Only strip if suffix contains both letters and digits (random hash pattern)
  const hasLetter = /[a-z]/.test(suffix);
  const hasDigit = /[0-9]/.test(suffix);
  if (hasLetter && hasDigit) return match[1];
  return name;
};

/**
 * Deduplicates templates by base name, keeping the most recently updated one.
 *
 * O MESMO nome pode existir em números diferentes (ex.: "agendamento" no número
 * principal e no de contingência — a Meta aprova o mesmo texto em cada conta).
 * Juntar os dois só pelo nome fazia a lista de Transmissão sortear um dos dois,
 * e se o sorteado fosse o do número errado o disparo inteiro era recusado pela
 * Meta ("modelo não existe na conta deste número"). Por isso a chave leva o
 * número: só junta nomes que são do mesmo número. Chamadas que não informam
 * número (as outras telas) continuam com a chave só pelo nome.
 */
export function deduplicateTemplates<
  T extends {
    name: string;
    updated_at?: string;
    created_at?: string;
    whatsapp_number_id?: string | null;
    waba_id?: string | null;
  },
>(templates: T[]): T[] {
  const map = new Map<string, T>();
  for (const t of templates) {
    const numero = t.whatsapp_number_id ?? t.waba_id ?? "";
    const key = numero ? `${cleanTemplateName(t.name)}|${numero}` : cleanTemplateName(t.name);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, t);
    } else {
      const tDate = t.updated_at || t.created_at || '';
      const eDate = existing.updated_at || existing.created_at || '';
      if (tDate > eDate) {
        map.set(key, t);
      }
    }
  }
  return Array.from(map.values());
}

// ─── Utilitário puro usado pelas telas do redesign (01/10/2026) ───
export function indicesDasVariaveis(texto: string | null | undefined): number[] {
  if (!texto) return [];
  const vistos = new Set<number>();
  for (const m of texto.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) vistos.add(n);
  }
  return [...vistos].sort((a, b) => a - b);
}

/** Busca sem acento e sem diferenciar maiúsculas: "endereço" acha "endereco_vca". */
export function normalizarBusca(texto: string | null | undefined): string {
  return (texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[_\s]+/g, " ").toLowerCase().trim();
}
