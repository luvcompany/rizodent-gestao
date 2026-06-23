// Mirror of src/lib/automationConditions.ts for edge runtime.
// Keep in sync.

export type ConditionsConfig = {
  match: "all" | "any";
  rules: Array<{
    field: string;
    operator: string;
    value?: string | string[] | number | boolean;
  }>;
};

function normStr(v: unknown): string {
  return String(v ?? "").toLowerCase().trim();
}

export function evaluateConditions(
  conditions: ConditionsConfig | null | undefined,
  lead: Record<string, any>
): boolean {
  if (!conditions || !Array.isArray(conditions.rules) || conditions.rules.length === 0) return true;
  const evalRule = (rule: any): boolean => {
    const { field, operator, value } = rule;
    let leadVal: any;
    if (field === "has_ad") leadVal = !!(lead.ad_id || lead.ad_account_id);
    else if (field === "no_tags") leadVal = !((lead.tags as string[] | null)?.length);
    else leadVal = lead[field];

    switch (operator) {
      case "is_true": return leadVal === true;
      case "is_false": return leadVal === false || leadVal == null || leadVal === "";
      case "is_empty":
        if (Array.isArray(leadVal)) return leadVal.length === 0;
        return leadVal == null || String(leadVal).trim() === "";
      case "is_not_empty":
        if (Array.isArray(leadVal)) return leadVal.length > 0;
        return leadVal != null && String(leadVal).trim() !== "";
      case "equals": return normStr(leadVal) === normStr(value);
      case "not_equals": return normStr(leadVal) !== normStr(value);
      case "contains":
        if (Array.isArray(leadVal)) return leadVal.map(normStr).includes(normStr(value));
        return normStr(leadVal).includes(normStr(value));
      case "not_contains":
        if (Array.isArray(leadVal)) return !leadVal.map(normStr).includes(normStr(value));
        return !normStr(leadVal).includes(normStr(value));
      case "in": {
        const arr = Array.isArray(value) ? value : String(value || "").split(",");
        return arr.map(normStr).includes(normStr(leadVal));
      }
      case "not_in": {
        const arr = Array.isArray(value) ? value : String(value || "").split(",");
        return !arr.map(normStr).includes(normStr(leadVal));
      }
      case "gt": {
        const a = Number(leadVal), b = Number(value);
        return Number.isFinite(a) && Number.isFinite(b) && a > b;
      }
      case "lt": {
        const a = Number(leadVal), b = Number(value);
        return Number.isFinite(a) && Number.isFinite(b) && a < b;
      }
      default: return true;
    }
  };
  if (conditions.match === "any") return conditions.rules.some(evalRule);
  return conditions.rules.every(evalRule);
}

export async function fetchLeadAndEvaluate(
  supabase: any,
  leadId: string,
  conditions: ConditionsConfig | null | undefined
): Promise<boolean> {
  if (!conditions || !Array.isArray(conditions.rules) || conditions.rules.length === 0) return true;
  const { data: lead } = await supabase
    .from("crm_leads")
    .select("tags, source, cidade, ad_id, ad_account_id, ad_account_name, nome_anuncio, servico_interesse, assigned_to, value")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return true;
  return evaluateConditions(conditions, lead);
}
