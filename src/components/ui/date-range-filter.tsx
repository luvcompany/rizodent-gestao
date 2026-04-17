import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, ChevronDown, Plus, X } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek, subWeeks, subDays, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";

export type DatePreset = "all" | "today" | "yesterday" | "this_week" | "last_week" | "7days" | "this_month" | "last_month" | "custom" | "multi";

export interface DateRangeFilterValue {
  preset: DatePreset;
  customFrom?: Date;
  customTo?: Date;
  /** Used when preset === "multi" — list of independent intervals to be unioned */
  customRanges?: { from: Date; to: Date }[];
}

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

/** Returns one envelope range (min start → max end) covering all selected intervals. Useful for fetching/coarse filters. */
export function getDateRangeFromFilter(value: DateRangeFilterValue): { start: Date; end: Date } | null {
  const list = getDateRangesFromFilter(value);
  if (!list || list.length === 0) return null;
  const start = list.reduce((min, r) => (r.start < min ? r.start : min), list[0].start);
  const end = list.reduce((max, r) => (r.end > max ? r.end : max), list[0].end);
  return { start, end };
}

/** Returns all selected intervals (multi-mode returns 2+; others return 1). */
export function getDateRangesFromFilter(value: DateRangeFilterValue): { start: Date; end: Date }[] | null {
  const now = new Date();
  switch (value.preset) {
    case "today": return [{ start: startOfDay(now), end: endOfDay(now) }];
    case "yesterday": { const y = subDays(now, 1); return [{ start: startOfDay(y), end: endOfDay(y) }]; }
    case "this_week": return [{ start: startOfWeek(now, { locale: ptBR }), end: endOfWeek(now, { locale: ptBR }) }];
    case "last_week": return [{ start: startOfWeek(subWeeks(now, 1), { locale: ptBR }), end: endOfWeek(subWeeks(now, 1), { locale: ptBR }) }];
    case "7days": return [{ start: subDays(now, 7), end: now }];
    case "this_month": return [{ start: startOfMonth(now), end: endOfMonth(now) }];
    case "last_month": return [{ start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)) }];
    case "custom":
      if (value.customFrom && value.customTo) return [{ start: startOfDay(value.customFrom), end: endOfDay(value.customTo) }];
      if (value.customFrom) return [{ start: startOfDay(value.customFrom), end: now }];
      return null;
    case "multi": {
      const ranges = (value.customRanges || []).filter((r) => r.from && r.to);
      if (ranges.length === 0) return null;
      return ranges.map((r) => ({ start: startOfDay(r.from), end: endOfDay(r.to) }));
    }
    default: return null;
  }
}

/** True if a date falls in any of the selected intervals. */
export function isDateInFilter(date: Date | string, value: DateRangeFilterValue): boolean {
  const ranges = getDateRangesFromFilter(value);
  if (!ranges) return true; // "all" or empty → no restriction
  const d = typeof date === "string" ? new Date(date.length <= 10 ? date + "T12:00:00" : date) : date;
  const t = d.getTime();
  return ranges.some((r) => t >= r.start.getTime() && t <= r.end.getTime());
}

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
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const presets = useMemo(
    () => PRESETS.filter((p) => !excludePresets.includes(p.value)),
    [excludePresets]
  );

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
      onChange({ preset: "custom", customFrom: value.customFrom, customTo: value.customTo });
    } else if (preset === "multi") {
      const existing = (value.customRanges || []).filter((r) => r.from && r.to);
      onChange({ preset: "multi", customRanges: existing });
      setEditingIndex(existing.length); // open new range editor
    } else {
      onChange({ preset });
      setOpen(false);
    }
  };

  const handleRangeSelect = (range: DateRange | undefined) => {
    onChange({
      preset: "custom",
      customFrom: range?.from || undefined,
      customTo: range?.to || undefined,
    });
    if (range?.from && range?.to) {
      setTimeout(() => setOpen(false), 300);
    }
  };

  const calendarRange: DateRange | undefined =
    value.preset === "custom" && value.customFrom
      ? { from: value.customFrom, to: value.customTo }
      : undefined;

  // Multi handlers
  const multiRanges = (value.customRanges || []).filter((r) => r.from && r.to);
  const handleMultiRangeSelect = (range: DateRange | undefined) => {
    if (!range?.from) return;
    const list = [...multiRanges];
    const newRange = { from: range.from, to: range.to || range.from };
    if (editingIndex !== null && editingIndex < list.length) {
      list[editingIndex] = newRange;
    } else {
      list.push(newRange);
    }
    onChange({ preset: "multi", customRanges: list });
    if (range.from && range.to) {
      setEditingIndex(null);
    }
  };
  const handleRemoveMulti = (idx: number) => {
    const list = multiRanges.filter((_, i) => i !== idx);
    onChange({ preset: "multi", customRanges: list });
    if (editingIndex === idx) setEditingIndex(null);
  };
  const editingMultiRange: DateRange | undefined =
    editingIndex !== null && editingIndex < multiRanges.length
      ? { from: multiRanges[editingIndex].from, to: multiRanges[editingIndex].to }
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
          (value.preset === "custom" || value.preset === "multi") && "w-auto",
          className
        )}
        align="end"
        side="bottom"
      >
        {value.preset !== "custom" && value.preset !== "multi" ? (
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
        ) : value.preset === "custom" ? (
          <div className="flex flex-col">
            <div className="flex items-center justify-between px-3 pt-2">
              <button
                onClick={() => onChange({ preset: "all" })}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Voltar aos presets
              </button>
              {value.customFrom && value.customTo && (
                <span className="text-xs text-muted-foreground">
                  {format(value.customFrom, "dd/MM/yy")} — {format(value.customTo, "dd/MM/yy")}
                </span>
              )}
            </div>
            <Calendar
              mode="range"
              selected={calendarRange}
              onSelect={handleRangeSelect}
              numberOfMonths={1}
              locale={ptBR}
              className="pointer-events-auto p-3"
            />
          </div>
        ) : (
          <div className="flex flex-col w-[320px]">
            <div className="flex items-center justify-between px-3 pt-2 pb-1">
              <button
                onClick={() => onChange({ preset: "all" })}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Voltar aos presets
              </button>
              <span className="text-[11px] text-muted-foreground">União dos períodos</span>
            </div>

            {/* List of selected ranges */}
            <div className="px-3 py-2 space-y-1 max-h-[140px] overflow-y-auto">
              {multiRanges.length === 0 && editingIndex === null && (
                <p className="text-xs text-muted-foreground italic">Nenhum período. Clique em "Adicionar período" abaixo.</p>
              )}
              {multiRanges.map((r, idx) => (
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
                onClick={() => setEditingIndex(multiRanges.length)}
                className={cn(
                  "w-full flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs border border-dashed transition-colors",
                  editingIndex === multiRanges.length
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
                  {editingIndex < multiRanges.length ? `Editando período ${editingIndex + 1}` : "Selecione o intervalo"}
                </div>
                <Calendar
                  mode="range"
                  selected={editingMultiRange}
                  onSelect={handleMultiRangeSelect}
                  numberOfMonths={1}
                  locale={ptBR}
                  className="pointer-events-auto p-3"
                />
              </>
            )}

            <div className="flex justify-end px-3 pb-2 pt-1 border-t border-border">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>
                Concluir
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
