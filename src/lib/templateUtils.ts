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
 */
export function deduplicateTemplates<T extends { name: string; updated_at?: string; created_at?: string }>(
  templates: T[]
): T[] {
  const map = new Map<string, T>();
  for (const t of templates) {
    const key = cleanTemplateName(t.name);
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