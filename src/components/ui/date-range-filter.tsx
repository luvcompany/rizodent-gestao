import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek, subWeeks, subDays, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";

export type DatePreset = "all" | "today" | "yesterday" | "this_week" | "last_week" | "7days" | "this_month" | "last_month" | "custom";

export interface DateRangeFilterValue {
  preset: DatePreset;
  customFrom?: Date;
  customTo?: Date;
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
];

export function getDateRangeFromFilter(value: DateRangeFilterValue): { start: Date; end: Date } | null {
  const now = new Date();
  switch (value.preset) {
    case "today": return { start: startOfDay(now), end: endOfDay(now) };
    case "yesterday": { const y = subDays(now, 1); return { start: startOfDay(y), end: endOfDay(y) }; }
    case "this_week": return { start: startOfWeek(now, { locale: ptBR }), end: endOfWeek(now, { locale: ptBR }) };
    case "last_week": return { start: startOfWeek(subWeeks(now, 1), { locale: ptBR }), end: endOfWeek(subWeeks(now, 1), { locale: ptBR }) };
    case "7days": return { start: subDays(now, 7), end: now };
    case "this_month": return { start: startOfMonth(now), end: endOfMonth(now) };
    case "last_month": return { start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)) };
    case "custom":
      if (value.customFrom && value.customTo) return { start: startOfDay(value.customFrom), end: endOfDay(value.customTo) };
      if (value.customFrom) return { start: startOfDay(value.customFrom), end: now };
      return null;
    default: return null;
  }
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
    return PRESETS.find((p) => p.value === value.preset)?.label || "Período";
  }, [value]);

  const handlePreset = (preset: DatePreset) => {
    if (preset === "custom") {
      onChange({ preset: "custom", customFrom: value.customFrom, customTo: value.customTo });
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
    // Auto-close when both dates selected
    if (range?.from && range?.to) {
      setTimeout(() => setOpen(false), 300);
    }
  };

  const calendarRange: DateRange | undefined =
    value.preset === "custom" && value.customFrom
      ? { from: value.customFrom, to: value.customTo }
      : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
      <PopoverContent className={cn("w-auto p-0 pointer-events-auto", className)} align="start" side="bottom">
        {value.preset !== "custom" ? (
          <div className="p-2 space-y-0.5 min-w-[160px]">
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
        ) : (
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
        )}
      </PopoverContent>
    </Popover>
  );
}
