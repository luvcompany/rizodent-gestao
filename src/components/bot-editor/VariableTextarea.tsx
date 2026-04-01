import { useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import VariableSelector from "./VariableSelector";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
};

export default function VariableTextarea({ value, onChange, placeholder, rows = 4, className }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

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
      <VariableSelector inputRef={ref} value={value} onChange={onChange} />
      <p className="text-[10px] text-muted-foreground mt-1">
        Digite <kbd className="px-1 py-0.5 rounded bg-secondary text-[10px]">[</kbd> para inserir variáveis do lead
      </p>
    </div>
  );
}
