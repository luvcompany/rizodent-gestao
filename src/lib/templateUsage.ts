import { supabase } from "@/integrations/supabase/client";
import { cleanTemplateName } from "@/lib/templateUtils";

/**
 * Sorts templates by usage count (most used first), then by original order.
 * Usage is counted from outbound messages with content prefixed by "📋 Template:".
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

    const counts = new Map<string, number>();
    for (const row of data as { template_name: string; usage_count: number }[]) {
      if (!row.template_name) continue;
      // Normalize for matching against template.name and its cleaned variant
      counts.set(row.template_name, Number(row.usage_count) || 0);
      counts.set(cleanTemplateName(row.template_name), Number(row.usage_count) || 0);
    }

    const indexed = templates.map((t, i) => ({
      t,
      i,
      count: counts.get(t.name) ?? counts.get(cleanTemplateName(t.name)) ?? 0,
    }));
    indexed.sort((a, b) => (b.count - a.count) || (a.i - b.i));
    return indexed.map((x) => x.t);
  } catch {
    return templates;
  }
}
