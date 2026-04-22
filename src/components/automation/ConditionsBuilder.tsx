import { useState } from "react";
import { Plus, Trash2, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ConditionsConfig,
  AutomationCondition,
  ConditionField,
  ConditionOperator,
  FIELD_LABELS,
  OPERATOR_LABELS,
  operatorsForField,
} from "@/lib/automationConditions";

interface Props {
  value: ConditionsConfig | undefined;
  onChange: (v: ConditionsConfig | undefined) => void;
}

const FIELD_OPTIONS: ConditionField[] = [
  "tags", "source", "cidade", "ad_id", "ad_account_name",
  "nome_anuncio", "servico_interesse", "assigned_to", "value",
  "has_ad", "no_tags",
];

const OP_NEEDS_VALUE = (op: ConditionOperator) =>
  !["is_empty", "is_not_empty", "is_true", "is_false"].includes(op);

export default function ConditionsBuilder({ value, onChange }: Props) {
  const [expanded, setExpanded] = useState<boolean>(!!value?.rules?.length);
  const conditions: ConditionsConfig = value || { match: "all", rules: [] };

  const addRule = () => {
    const next: ConditionsConfig = {
      match: conditions.match || "all",
      rules: [...conditions.rules, { field: "tags", operator: "contains", value: "" }],
    };
    onChange(next);
    setExpanded(true);
  };

  const removeRule = (idx: number) => {
    const rules = conditions.rules.filter((_, i) => i !== idx);
    if (rules.length === 0) onChange(undefined);
    else onChange({ ...conditions, rules });
  };

  const updateRule = (idx: number, patch: Partial<AutomationCondition>) => {
    const rules = conditions.rules.map((r, i) => {
      if (i !== idx) return r;
      const merged = { ...r, ...patch } as AutomationCondition;
      // If field changed, reset operator if invalid
      if (patch.field && !operatorsForField(patch.field).includes(merged.operator)) {
        merged.operator = operatorsForField(patch.field)[0];
        merged.value = "";
      }
      return merged;
    });
    onChange({ ...conditions, rules });
  };

  if (!conditions.rules.length && !expanded) {
    return (
      <button
        type="button"
        onClick={addRule}
        className="w-full text-xs text-muted-foreground bg-secondary/50 hover:bg-secondary rounded py-2 flex items-center justify-center gap-1.5 border border-dashed border-border transition-colors"
      >
        <Filter size={12} /> Adicionar condição (opcional)
      </button>
    );
  }

  return (
    <div className="space-y-2 p-3 bg-secondary/50 rounded-lg border border-border">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold flex items-center gap-1">
          <Filter size={12} /> Para todos os leads com:
        </Label>
        {conditions.rules.length > 1 && (
          <Select
            value={conditions.match}
            onValueChange={(v) => onChange({ ...conditions, match: v as "all" | "any" })}
          >
            <SelectTrigger className="h-6 text-[10px] w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas (E)</SelectItem>
              <SelectItem value="any">Qualquer (OU)</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {conditions.rules.map((rule, idx) => {
        const ops = operatorsForField(rule.field);
        const needsValue = OP_NEEDS_VALUE(rule.operator);
        return (
          <div key={idx} className="flex items-start gap-1 p-2 bg-card rounded border border-border">
            <div className="flex-1 grid grid-cols-1 gap-1.5">
              <Select value={rule.field} onValueChange={(v) => updateRule(idx, { field: v as ConditionField })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_OPTIONS.map((f) => (
                    <SelectItem key={f} value={f}>{FIELD_LABELS[f]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-1.5">
                <Select value={rule.operator} onValueChange={(v) => updateRule(idx, { operator: v as ConditionOperator })}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ops.map((o) => (
                      <SelectItem key={o} value={o}>{OPERATOR_LABELS[o]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {needsValue ? (
                  <Input
                    className="h-7 text-xs"
                    placeholder="Valor"
                    value={String(rule.value ?? "")}
                    onChange={(e) => updateRule(idx, { value: e.target.value })}
                  />
                ) : <div />}
              </div>
            </div>
            <button
              type="button"
              onClick={() => removeRule(idx)}
              className="text-destructive/70 hover:text-destructive p-1"
            >
              <Trash2 size={12} />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addRule}
        className="w-full text-xs text-primary bg-primary/10 hover:bg-primary/20 rounded py-1.5 flex items-center justify-center gap-1 transition-colors"
      >
        <Plus size={12} /> Adicionar condição
      </button>
      <p className="text-[10px] text-muted-foreground">
        A automação só dispara para leads que satisfazem {conditions.match === "any" ? "qualquer uma" : "todas"} as condições. Deixe vazio para disparar sempre.
      </p>
    </div>
  );
}
