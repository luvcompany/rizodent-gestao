import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, ChevronDown, Plus, X } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";
import type { DatePreset, DateRangeFilterValue } from "@/lib/dateRangeFilter";
export { getDateRangeFromFilter, getDateRangesFromFilter } from "@/lib/dateRangeFilter";
export type { DatePreset, DateRangeFilterValue } from "@/lib/dateRangeFilter";

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: "all", label: "Todo período" },
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "this_week", label: "Esta semana" },
  { value: "last_week", label: "Semana passada" },
  { value: "7days", label: "Últimos 7 dias" },
  { value: "this_month", label: "Este mês" },
  { value: "last_month", label: "Mês passado" },
  { value: "custom", label: "Personalizado" },
  { value: "multi", label: "Múltiplos períodos" },
];

interface DateRangeFilterProps {
  value: DateRangeFilterValue;
  onChange: (value: DateRangeFilterValue) => void;
  /** Presets to exclude, e.g. ["all"] */
  excludePresets?: DatePreset[];
  className?: string;
  triggerClassName?: string;
}

export function DateRangeFilter({ value, onChange, excludePresets = [], className, triggerClassName }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  // Modo do PAINEL (qual tela do popover está aberta) — separado do valor aplicado.
  const [panel, setPanel] = useState<"presets" | "custom" | "multi">("presets");
  // Rascunhos locais — nunca sobem para o pai até "Aplicar".
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(undefined);
  const [draftMulti, setDraftMulti] = useState<{ from: Date; to: Date }[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const presets = useMemo(
    () => PRESETS.filter((p) => !excludePresets.includes(p.value)),
    [excludePresets]
  );

  // Ao ABRIR o popover, semear os rascunhos com o valor já aplicado.
  useEffect(() => {
    if (!open) return;
    if (value.preset === "custom") {
      setPanel("custom");
      setDraftRange(value.customFrom ? { from: value.customFrom, to: value.customTo } : undefined);
      setEditingIndex(null);
    } else if (value.preset === "multi") {
      setPanel("multi");
      setDraftMulti((value.customRanges || []).filter((r) => r.from && r.to));
      setEditingIndex(null);
    } else {
      setPanel("presets");
      setDraftRange(undefined);
      setDraftMulti([]);
      setEditingIndex(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentLabel = useMemo(() => {
    if (value.preset === "custom" && value.customFrom) {
      const from = format(value.customFrom, "dd/MM/yy");
      const to = value.customTo ? format(value.customTo, "dd/MM/yy") : "...";
      return `${from} — ${to}`;
    }
    if (value.preset === "multi") {
      const list = (value.customRanges || []).filter((r) => r.from && r.to);
      if (list.length === 0) return "Múltiplos períodos";
      if (list.length === 1) return `${format(list[0].from, "dd/MM/yy")} — ${format(list[0].to, "dd/MM/yy")}`;
      return `${list.length} períodos`;
    }
    return PRESETS.find((p) => p.value === value.preset)?.label || "Período";
  }, [value]);

  const handlePreset = (preset: DatePreset) => {
    if (preset === "custom") {
      setPanel("custom");
      setDraftRange(
        value.preset === "custom" && value.customFrom
          ? { from: value.customFrom, to: value.customTo }
          : undefined
      );
      return; // NÃO chama onChange — ainda não há período
    }
    if (preset === "multi") {
      setPanel("multi");
      const existing = (value.customRanges || []).filter((r) => r.from && r.to);
      setDraftMulti(existing);
      setEditingIndex(existing.length === 0 ? 0 : null);
      return; // NÃO chama onChange
    }
    onChange({ preset });
    setOpen(false);
  };

  const applyCustom = (range: DateRange | undefined) => {
    if (!range?.from || !range?.to) return;
    onChange({ preset: "custom", customFrom: range.from, customTo: range.to });
    setOpen(false);
  };

  const handleDraftRangeSelect = (range: DateRange | undefined) => {
    setDraftRange(range);
    if (range?.from && range?.to) {
      setTimeout(() => applyCustom(range), 150);
    }
  };

  const handleDraftMultiSelect = (range: DateRange | undefined) => {
    if (!range?.from) return;
    const list = [...draftMulti];
    const newRange = { from: range.from, to: range.to || range.from };
    if (editingIndex !== null && editingIndex < list.length) list[editingIndex] = newRange;
    else list.push(newRange);
    setDraftMulti(list);
    if (range.from && range.to) setEditingIndex(null);
  };
  const handleRemoveMulti = (idx: number) => {
    setDraftMulti(draftMulti.filter((_, i) => i !== idx));
    if (editingIndex === idx) setEditingIndex(null);
  };
  const applyMulti = () => {
    const list = draftMulti.filter((r) => r.from && r.to);
    if (list.length === 0) {
      setOpen(false);
      return;
    }
    onChange({ preset: "multi", customRanges: list });
    setOpen(false);
  };
  const editingMultiRange: DateRange | undefined =
    editingIndex !== null && editingIndex < draftMulti.length
      ? { from: draftMulti[editingIndex].from, to: draftMulti[editingIndex].to }
      : undefined;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditingIndex(null); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 text-xs gap-1.5 justify-between min-w-[140px]", triggerClassName)}
        >
          <CalendarIcon size={14} className="shrink-0" />
          <span className="truncate">{currentLabel}</span>
          <ChevronDown size={12} className="shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn(
          "w-[200px] p-0 pointer-events-auto",
          (panel === "custom" || panel === "multi") && "w-auto",
          className
        )}
        align="end"
        side="bottom"
      >
        {panel === "presets" ? (
          <div className="p-2 space-y-0.5">
            {presets.map((p) => (
              <button
                key={p.value}
                onClick={() => handlePreset(p.value)}
                className={cn(
                  "w-full text-left text-xs px-3 py-1.5 rounded-md transition-colors",
                  value.preset === p.value
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : panel === "custom" ? (
          <div className="flex flex-col">
            <div className="flex items-center justify-between px-3 pt-2">
              <button
                onClick={() => setPanel("presets")}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Voltar aos presets
              </button>
              <span className="text-xs text-muted-foreground">
                {draftRange?.from
                  ? `${format(draftRange.from, "dd/MM/yy")} — ${draftRange.to ? format(draftRange.to, "dd/MM/yy") : "..."}`
                  : "Selecione o início e o fim"}
              </span>
            </div>
            <Calendar
              mode="range"
              selected={draftRange}
              onSelect={handleDraftRangeSelect}
              numberOfMonths={1}
              locale={ptBR}
              className="pointer-events-auto p-3"
            />
            <div className="flex justify-end gap-2 px-3 pb-2 pt-1 border-t border-border">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={!draftRange?.from || !draftRange?.to}
                onClick={() => applyCustom(draftRange)}
              >
                Aplicar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col w-[320px]">
            <div className="flex items-center justify-between px-3 pt-2 pb-1">
              <button
                onClick={() => setPanel("presets")}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Voltar aos presets
              </button>
              <span className="text-[11px] text-muted-foreground">União dos períodos</span>
            </div>

            {/* List of draft ranges */}
            <div className="px-3 py-2 space-y-1 max-h-[140px] overflow-y-auto">
              {draftMulti.length === 0 && editingIndex === null && (
                <p className="text-xs text-muted-foreground italic">Nenhum período. Clique em "Adicionar período" abaixo.</p>
              )}
              {draftMulti.map((r, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs",
                    editingIndex === idx ? "bg-primary/15 ring-1 ring-primary/40" : "bg-accent/40"
                  )}
                >
                  <button
                    className="flex-1 text-left truncate hover:text-foreground"
                    onClick={() => setEditingIndex(idx)}
                  >
                    Período {idx + 1}: {format(r.from, "dd/MM/yy")} — {format(r.to, "dd/MM/yy")}
                  </button>
                  <button
                    onClick={() => handleRemoveMulti(idx)}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    aria-label="Remover período"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setEditingIndex(draftMulti.length)}
                className={cn(
                  "w-full flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs border border-dashed transition-colors",
                  editingIndex === draftMulti.length
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-primary/50"
                )}
              >
                <Plus size={12} /> Adicionar período
              </button>
            </div>

            {editingIndex !== null && (
              <>
                <div className="px-3 pt-1 pb-0 text-[11px] text-muted-foreground">
                  {editingIndex < draftMulti.length ? `Editando período ${editingIndex + 1}` : "Selecione o intervalo"}
                </div>
                <Calendar
                  mode="range"
                  selected={editingMultiRange}
                  onSelect={handleDraftMultiSelect}
                  numberOfMonths={1}
                  locale={ptBR}
                  className="pointer-events-auto p-3"
                />
              </>
            )}

            <div className="flex justify-end gap-2 px-3 pb-2 pt-1 border-t border-border">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={draftMulti.filter((r) => r.from && r.to).length === 0}
                onClick={applyMulti}
              >
                Aplicar
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
