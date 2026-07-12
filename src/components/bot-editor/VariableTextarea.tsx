import { useMemo, useRef } from "react";
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
        className={className}
      />
      <VariableSelector inputRef={ref} value={value} onChange={onChange} extraVariables={extraVariables} />
      <p className="text-[10px] text-muted-foreground mt-1">
        Digite <kbd className="px-1 py-0.5 rounded bg-secondary text-[10px]">[</kbd> para inserir variáveis do lead
      </p>
      {warnings.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {warnings.map((w, i) => (
            <li key={i} className="text-[10px] text-orange-600 dark:text-orange-400">
              ⚠️ {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
