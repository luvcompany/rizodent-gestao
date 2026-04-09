import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cleanTemplateName } from "@/lib/templateUtils";
import { Search } from "lucide-react";

interface Template {
  id: string;
  name: string;
  body_text?: string | null;
}

interface Props {
  templates: Template[];
  value: string | undefined;
  onValueChange: (value: string) => void;
  placeholder?: string;
  /** Show a "Nenhum" option at the top */
  allowNone?: boolean;
  noneLabel?: string;
}

export default function TemplateSearchSelect({
  templates,
  value,
  onValueChange,
  placeholder = "Selecionar template",
  allowNone = false,
  noneLabel = "Nenhum",
}: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return templates;
    const q = search.toLowerCase();
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.body_text || "").toLowerCase().includes(q)
    );
  }, [templates, search]);

  const display = (name: string) => cleanTemplateName(name);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground z-10" />
        <Input
          placeholder="Pesquisar modelo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-7 h-8 text-xs bg-secondary"
        />
      </div>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="text-sm">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value="__none__">{noneLabel}</SelectItem>}
          {filtered.length === 0 && (
            <SelectItem value="__empty__" disabled>
              Nenhum template encontrado
            </SelectItem>
          )}
          {filtered.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {display(t.name)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}