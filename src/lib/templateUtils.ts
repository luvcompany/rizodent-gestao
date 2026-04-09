/**
 * Strips the random suffix Meta appends to template names.
 * e.g. "agendamento_itabuna_k9jfzi" → "agendamento_itabuna"
 */
export const cleanTemplateName = (name: string): string =>
  name.replace(/_[a-z0-9]{4,10}$/, '');

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