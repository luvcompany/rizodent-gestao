// Unified condition evaluator for automation triggers (frontend)
// Mirror in supabase/functions/_shared/automationConditions.ts

import { supabase } from "@/integrations/supabase/client";

export type ConditionField =
  | "tags"
  | "source"
  | "cidade"
  | "ad_id"
  | "ad_account_id"
  | "ad_account_name"
  | "nome_anuncio"
  | "servico_interesse"
  | "assigned_to"
  | "value"
  | "has_ad"
  | "no_tags";

export type ConditionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "in"
  | "not_in"
  | "is_empty"
  | "is_not_empty"
  | "is_true"
  | "is_false"
  | "gt"
  | "lt";

export interface AutomationCondition {
  field: ConditionField;
  operator: ConditionOperator;
  value?: string | string[] | number | boolean;
}

export interface ConditionsConfig {
  match: "all" | "any"; // AND / OR
  rules: AutomationCondition[];
}

export const FIELD_LABELS: Record<ConditionField, string> = {
  tags: "Tag",
  source: "Fonte",
  cidade: "Cidade",
  ad_id: "ID do anúncio",
  ad_account_id: "ID conta de anúncios",
  ad_account_name: "Conta de anúncios",
  nome_anuncio: "Nome do anúncio",
  servico_interesse: "Serviço de interesse",
  assigned_to: "Responsável",
  value: "Valor",
  has_ad: "Veio de anúncio",
  no_tags: "Sem tags",
};

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: "é igual a",
  not_equals: "é diferente de",
  contains: "contém",
  not_contains: "não contém",
  in: "está em",
  not_in: "não está em",
  is_empty: "está vazio",
  is_not_empty: "não está vazio",
  is_true: "é verdadeiro",
  is_false: "é falso",
  gt: "maior que",
  lt: "menor que",
};

export function operatorsForField(field: ConditionField): ConditionOperator[] {
  if (field === "tags") return ["contains", "not_contains", "is_empty", "is_not_empty"];
  if (field === "has_ad" || field === "no_tags") return ["is_true", "is_false"];
  if (field === "value") return ["equals", "not_equals", "gt", "lt"];
  return ["equals", "not_equals", "contains", "not_contains", "is_empty", "is_not_empty"];
}

function normStr(v: unknown): string {
  return String(v ?? "").toLowerCase().trim();
}

export function evaluateConditions(
  conditions: ConditionsConfig | undefined | null,
  lead: Record<string, any>
): boolean {
  if (!conditions || !conditions.rules?.length) return true;
  const evalRule = (rule: AutomationCondition): boolean => {
    const { field, operator, value } = rule;
    let leadVal: any;
    if (field === "has_ad") leadVal = !!(lead.ad_id || lead.ad_account_id);
    else if (field === "no_tags") leadVal = !((lead.tags as string[] | null)?.length);
    else leadVal = (lead as any)[field];

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
  leadId: string,
  conditions: ConditionsConfig | undefined | null
): Promise<boolean> {
  if (!conditions || !conditions.rules?.length) return true;
  const { data: lead } = await supabase
    .from("crm_leads")
    .select("tags, source, cidade, ad_id, ad_account_id, ad_account_name, nome_anuncio, servico_interesse, assigned_to, value")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return true;
  return evaluateConditions(conditions, lead as any);
}
