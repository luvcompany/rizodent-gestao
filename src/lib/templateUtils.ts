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
 * Meta ("modelo não existe na conta deste número"). Por isso a chave leva a
 * CONTA (WABA) — o modelo é da conta, e dois números da mesma WABA usam o
 * mesmo modelo; sem WABA, o número. Chamadas que não informam nenhum dos dois
 * continuam com a chave só pelo nome.
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
    const numero = t.waba_id ?? t.whatsapp_number_id ?? "";
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

/**
 * Uma linha por (conta, nome, idioma) na tela de Modelos. A conta é a WABA do
 * modelo; rascunho sem WABA usa a do número dele (`wabaDoNumero`). Entre
 * repetidos fica o que já está na Meta e, depois, o atualizado por último.
 * Mantém a ordem de chegada.
 */
export function deduplicarNaConta<
  T extends {
    name: string;
    language?: string | null;
    waba_id?: string | null;
    whatsapp_number_id?: string | null;
    meta_template_id?: string | null;
    updated_at?: string;
    created_at?: string;
  },
>(modelos: T[], wabaDoNumero: Map<string, string | null> = new Map()): T[] {
  const conta = (t: T) =>
    t.waba_id || (t.whatsapp_number_id ? wabaDoNumero.get(t.whatsapp_number_id) : null) || t.whatsapp_number_id || "";
  const preferir = (a: T, b: T) => {
    if (!!a.meta_template_id !== !!b.meta_template_id) return !!a.meta_template_id;
    return (a.updated_at || a.created_at || "") > (b.updated_at || b.created_at || "");
  };
  const escolhidos = new Map<string, T>();
  const ordem: string[] = [];
  for (const t of modelos) {
    const k = `${conta(t)}\u0000${t.name}\u0000${t.language ?? ""}`;
    const atual = escolhidos.get(k);
    if (!atual) {
      escolhidos.set(k, t);
      ordem.push(k);
    } else if (preferir(t, atual)) {
      escolhidos.set(k, t);
    }
  }
  return ordem.map((k) => escolhidos.get(k)!);
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
