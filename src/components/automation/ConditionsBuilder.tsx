import { useEffect, useState } from "react";
import { Plus, Trash2, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ConditionsConfig,
  AutomationCondition,
  ConditionField,
  FIELD_LABELS,
  defaultOperatorForField,
} from "@/lib/automationConditions";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  value: ConditionsConfig | undefined;
  onChange: (v: ConditionsConfig | undefined) => void;
}

const FIELD_OPTIONS: ConditionField[] = [
  "tags", "cidade", "servico_interesse", "source", "assigned_to",
];

// Static option presets per field
const STATIC_FIELD_OPTIONS: Partial<Record<ConditionField, string[]>> = {
  servico_interesse: ["PRÓTESE", "IMPLANTE", "ZIGOMÁTICO", "FACETA", "PROTOCÓLO", "OUTROS"],
  source: ["whatsapp", "instagram", "manual", "webhook", "import"],
};

// Fields that should be loaded dynamically from the database (distinct values)
const DYNAMIC_FIELDS: ConditionField[] = [
  "tags", "cidade", "assigned_to",
];

function useDynamicOptions(field: ConditionField | null) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    if (!field || !DYNAMIC_FIELDS.includes(field)) { setOptions([]); return; }
    let cancelled = false;
    (async () => {
      try {
        if (field === "assigned_to") {
          const { data } = await supabase.from("profiles").select("id, full_name, email").limit(500);
          if (cancelled) return;
          setOptions((data || []).map((u: any) => ({
            value: u.id,
            label: u.full_name || u.email || u.id,
          })));
          return;
        }
        if (field === "tags") {
          const { data } = await supabase.from("crm_leads").select("tags").not("tags", "is", null).limit(2000);
          if (cancelled) return;
          const set = new Set<string>();
          (data || []).forEach((r: any) => (r.tags || []).forEach((t: string) => t && set.add(t)));
          setOptions([...set].sort().map((v) => ({ value: v, label: v })));
          return;
        }
        const { data } = await supabase
          .from("crm_leads")
          .select(field)
          .not(field, "is", null)
          .limit(2000);
        if (cancelled) return;
        const set = new Set<string>();
        (data || []).forEach((r: any) => {
          const v = r[field];
          if (v && String(v).trim()) set.add(String(v).trim());
        });
        setOptions([...set].sort().map((v) => ({ value: v, label: v })));
      } catch (_e) {
        if (!cancelled) setOptions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [field]);
  return options;
}

function ValueSelector({
  field, value, onChange,
}: {
  field: ConditionField;
  value: any;
  onChange: (v: string) => void;
}) {
  const dynamic = useDynamicOptions(field);
  const staticOpts = STATIC_FIELD_OPTIONS[field];
  const opts = staticOpts
    ? staticOpts.map((v) => ({ value: v, label: v }))
    : dynamic;

  if (opts.length > 0) {
    return (
      <Select value={String(value ?? "")} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
        <SelectContent className="max-h-64">
          {opts.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      className="h-7 text-xs"
      placeholder="Valor"
      value={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export default function ConditionsBuilder({ value, onChange }: Props) {
  const [expanded, setExpanded] = useState<boolean>(!!value?.rules?.length);
  const conditions: ConditionsConfig = value || { match: "all", rules: [] };

  const addRule = () => {
    const field: ConditionField = "tags";
    const next: ConditionsConfig = {
      match: conditions.match || "all",
      rules: [...conditions.rules, { field, operator: defaultOperatorForField(field), value: "" }],
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
      // If field changed, reset operator to its default and clear value
      if (patch.field) {
        merged.operator = defaultOperatorForField(patch.field);
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
                  <ValueSelector
                    field={rule.field}
                    operator={rule.operator}
                    value={rule.value}
                    onChange={(v) => updateRule(idx, { value: v })}
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
