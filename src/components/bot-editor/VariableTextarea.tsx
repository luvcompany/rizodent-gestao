import { useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import VariableSelector from "./VariableSelector";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  extraVariables?: { key: string; label: string; example: string }[];
};

function detectImbalance(text: string): string[] {
  const warnings: string[] = [];
  if (!text) return warnings;

  // Ignore VariableSelector placeholders like [nome], [lead.telefone] etc.
  const stripped = text.replace(/\[[a-zA-Z0-9_.]+\]/g, "");
  const openSq = (stripped.match(/\[/g) || []).length;
  const closeSq = (stripped.match(/\]/g) || []).length;
  if (openSq !== closeSq) {
    warnings.push(`Colchetes desbalanceados: ${openSq} "[" e ${closeSq} "]"`);
  }

  const openCurly = (text.match(/\{\{/g) || []).length;
  const closeCurly = (text.match(/\}\}/g) || []).length;
  if (openCurly !== closeCurly) {
    warnings.push(`Placeholders desbalanceados: ${openCurly} "{{" e ${closeCurly} "}}"`);
  }

  const asterisks = (text.match(/\*/g) || []).length;
  if (asterisks % 2 !== 0) {
    warnings.push(`Negrito com "*" ímpar (${asterisks}) — pode não renderizar como esperado no WhatsApp`);
  }

  return warnings;
}

export default function VariableTextarea({ value, onChange, placeholder, rows = 4, className, extraVariables }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const warnings = useMemo(() => detectImbalance(value || ""), [value]);

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Digite a mensagem... Use [ para variáveis"}
        rows={rows}
        className={cn("rounded-xl leading-relaxed", className)}
      />
      <VariableSelector inputRef={ref} value={value} onChange={onChange} extraVariables={extraVariables} />
      <p className="text-[11px] text-tertiary mt-1.5">
        Digite <kbd className="px-1.5 py-0.5 rounded-md border border-border/60 bg-surface-sunken font-mono text-[10px] text-foreground">[</kbd> para inserir variáveis do lead
      </p>
      {warnings.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {warnings.map((w, i) => (
            <li key={i} className="text-[10px] text-warning">
              ⚠️ {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
