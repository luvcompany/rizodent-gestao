import { useEffect, useState } from "react";
import { Plus, Trash2, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HIDDEN_USER_IDS_PG } from "@/lib/hiddenUsers";
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
  defaultOperatorForField,
} from "@/lib/automationConditions";
import { supabase } from "@/integrations/supabase/client";
import { useServicosDoTenant, comValorAtual } from "@/hooks/useOpcoesDoTenant";
import { useVocab } from "@/hooks/useVocab";

// Operadores oferecidos por tipo de campo (o avaliador suporta os 12).
const NO_VALUE_OPERATORS: ConditionOperator[] = ["is_empty", "is_not_empty", "is_true", "is_false"];
const MULTI_VALUE_OPERATORS: ConditionOperator[] = ["in", "not_in"]; // valores separados por vírgula
function operatorsFor(field: ConditionField): ConditionOperator[] {
  if (field === "has_ad" || field === "no_tags") return ["is_true", "is_false"];
  if (field === "tags") return ["contains", "not_contains", "is_empty", "is_not_empty"];
  if (field === "value") return ["equals", "not_equals", "gt", "lt"];
  return ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"];
}

interface Props {
  value: ConditionsConfig | undefined;
  onChange: (v: ConditionsConfig | undefined) => void;
}

const FIELD_OPTIONS: ConditionField[] = [
  "source", "has_ad", "tags", "cidade", "servico_interesse", "value", "nome_anuncio", "ad_account_name", "assigned_to",
];

// Serviço de interesse: os serviços cadastrados do cliente (tipos_procedimento
// ativos); sem cadastro, a lista sugerida do segmento. O valor já salvo na
// condição continua na lista mesmo se sair do cadastro.
function useOpcoesDeServico(): string[] {
  const servicosDoTenant = useServicosDoTenant();
  const vocab = useVocab();
  return servicosDoTenant.length > 0 ? servicosDoTenant : vocab.servicosInteresse;
}

// Fields that should be loaded dynamically from the database (distinct values).
// `source` (Origem) é dinâmico p/ mostrar as origens REAIS dos leads — não uma
// lista fixa desatualizada. Idem nome/conta de anúncio.
const DYNAMIC_FIELDS: ConditionField[] = [
  "tags", "cidade", "assigned_to", "source", "nome_anuncio", "ad_account_name",
];

function useDynamicOptions(field: ConditionField | null) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    if (!field || !DYNAMIC_FIELDS.includes(field)) { setOptions([]); return; }
    let cancelled = false;
    (async () => {
      try {
        if (field === "assigned_to") {
          // profiles tem "nome" (full_name não existe: dava 42703, a lista vinha
          // vazia e o campo virava texto livre pedindo o UUID do usuário).
          const { data, error } = await supabase.from("profiles").select("id, nome, email").not("id","in",HIDDEN_USER_IDS_PG).limit(500);
          if (error) console.error("[ConditionsBuilder] responsáveis:", error.message);
          if (cancelled) return;
          setOptions((data || []).map((u: any) => ({
            value: u.id,
            label: u.nome || u.email || u.id,
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
  const servicos = useOpcoesDeServico();
  const opts = field === "servico_interesse"
    ? comValorAtual(servicos, value == null ? null : String(value)).map((v) => ({ value: v, label: v }))
    : dynamic;

  if (opts.length > 0) {
    return (
      <Select value={String(value ?? "")} onValueChange={onChange}>
        <SelectTrigger className="h-9 rounded-lg bg-card text-[13px]"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
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
      className="h-9 rounded-lg bg-card text-[13px]"
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
        className="w-full h-10 text-[13px] font-semibold text-muted-foreground rounded-xl flex items-center justify-center gap-2 border border-dashed border-border transition-colors hover:border-primary/50 hover:bg-primary-soft/50 hover:text-primary"
      >
        <Filter size={15} strokeWidth={1.75} /> Adicionar condição (opcional)
      </button>
    );
  }

  return (
    <div className="space-y-2.5 rounded-xl border border-border/60 bg-surface-sunken p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-[13px] font-semibold flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><Filter size={14} strokeWidth={1.75} /></span> Para todos os leads com:
        </Label>
        {conditions.rules.length > 1 && (
          <Select
            value={conditions.match}
            onValueChange={(v) => onChange({ ...conditions, match: v as "all" | "any" })}
          >
            <SelectTrigger className="h-8 w-36 rounded-full bg-card px-3 text-xs font-semibold"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas (E)</SelectItem>
              <SelectItem value="any">Qualquer (OU)</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {conditions.rules.map((rule, idx) => (
        <div key={idx} className="flex items-start gap-1.5 rounded-xl border border-border/60 bg-card p-2.5 shadow-xs">
          <div className="min-w-0 flex-1 flex flex-wrap gap-2">
            {/* Campo */}
            <Select value={rule.field} onValueChange={(v) => updateRule(idx, { field: v as ConditionField })}>
              <SelectTrigger className="h-9 min-w-[130px] flex-1 rounded-lg bg-card text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FIELD_OPTIONS.map((f) => (
                  <SelectItem key={f} value={f}>{FIELD_LABELS[f]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Operador */}
            <Select value={rule.operator} onValueChange={(v) => updateRule(idx, { operator: v as ConditionOperator })}>
              <SelectTrigger className="h-9 min-w-[130px] flex-1 rounded-lg bg-card text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {operatorsFor(rule.field).map((op) => (
                  <SelectItem key={op} value={op}>{OPERATOR_LABELS[op]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Valor — some p/ operadores sem valor (vazio/preenchido/sim/não) */}
            {!NO_VALUE_OPERATORS.includes(rule.operator) && (
              MULTI_VALUE_OPERATORS.includes(rule.operator) ? (
                <Input
                  className="h-9 min-w-[130px] flex-1 rounded-lg bg-card text-[13px]"
                  placeholder="valor1, valor2"
                  value={String(rule.value ?? "")}
                  onChange={(e) => updateRule(idx, { value: e.target.value })}
                />
              ) : (
                <div className="min-w-[130px] flex-1">
                  <ValueSelector
                    field={rule.field}
                    value={rule.value}
                    onChange={(v) => updateRule(idx, { value: v })}
                  />
                </div>
              )
            )}
          </div>
          <button
            type="button"
            onClick={() => removeRule(idx)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-tertiary transition-colors hover:bg-destructive-soft hover:text-destructive"
          >
            <Trash2 size={15} strokeWidth={1.75} />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addRule}
        className="w-full h-9 text-[13px] font-semibold text-primary bg-card border border-dashed border-primary/40 rounded-xl flex items-center justify-center gap-1.5 transition-colors hover:bg-primary-soft/60"
      >
        <Plus size={15} strokeWidth={2} /> Adicionar condição
      </button>
      <p className="text-xs leading-relaxed text-tertiary">
        A automação só dispara para leads que satisfazem {conditions.match === "any" ? "qualquer uma" : "todas"} as condições. Deixe vazio para disparar sempre.
      </p>
    </div>
  );
}
