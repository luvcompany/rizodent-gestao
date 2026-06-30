import { supabase } from "@/integrations/supabase/client";
import { cleanTemplateName } from "@/lib/templateUtils";

/**
 * Sorts templates by most recently used (last_used_at desc), then by original order.
 * Usage is read from outbound messages with content prefixed by "📋 Template:".
 */
export async function sortTemplatesByUsage<T extends { name: string }>(
  templates: T[],
  tenantId: string | null | undefined,
): Promise<T[]> {
  if (!tenantId || templates.length === 0) return templates;
  try {
    const { data, error } = await supabase.rpc("crm_template_usage_counts", {
      _tenant_id: tenantId,
    });
    if (error || !data) return templates;

    const lastUsed = new Map<string, number>();
    for (const row of data as { template_name: string; usage_count: number; last_used_at: string | null }[]) {
      if (!row.template_name) continue;
      const ts = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
      const prev1 = lastUsed.get(row.template_name) ?? 0;
      if (ts > prev1) lastUsed.set(row.template_name, ts);
      const cleaned = cleanTemplateName(row.template_name);
      const prev2 = lastUsed.get(cleaned) ?? 0;
      if (ts > prev2) lastUsed.set(cleaned, ts);
    }

    const indexed = templates.map((t, i) => ({
      t,
      i,
      ts: lastUsed.get(t.name) ?? lastUsed.get(cleanTemplateName(t.name)) ?? 0,
    }));
    indexed.sort((a, b) => (b.ts - a.ts) || (a.i - b.i));
    return indexed.map((x) => x.t);
  } catch {
    return templates;
  }
}
