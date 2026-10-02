import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, subWeeks,
  startOfMonth, endOfMonth, subMonths, format,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { CalendarIcon, ChevronDown, Check, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const hoje = () => new Date();
const semana = { weekStartsOn: 1 as const };

export const PRESETS: { id: string; label: string; range: () => [Date, Date] }[] = [
  { id: "hoje", label: "Hoje", range: () => [startOfDay(hoje()), endOfDay(hoje())] },
  { id: "ontem", label: "Ontem", range: () => [startOfDay(subDays(hoje(), 1)), endOfDay(subDays(hoje(), 1))] },
  { id: "semana", label: "Esta semana", range: () => [startOfWeek(hoje(), semana), endOfWeek(hoje(), semana)] },
  { id: "semana-passada", label: "Semana passada", range: () => [startOfWeek(subWeeks(hoje(), 1), semana), endOfWeek(subWeeks(hoje(), 1), semana)] },
  { id: "mes", label: "Este mês", range: () => [startOfMonth(hoje()), endOfMonth(hoje())] },
  { id: "mes-passado", label: "Mês passado", range: () => [startOfMonth(subMonths(hoje(), 1)), endOfMonth(hoje(), 1))] },
];

export type Periodo = { preset: string; range: [Date, Date] };

export function rotuloPeriodo(range: [Date, Date]): string {
  const [a, b] = range;
  if (format(a, "yyyy-MM-dd") === format(b, "yyyy-MM-dd")) return format(a, "dd/MM/yy");
  if (format(a, "MMyyyy") === format(b, "MMyyyy")) return `${format(a, "dd")}–${format(b, "dd/MM/yy")}`;
  if (format(a, "yyyy") === format(b, "yyyy")) return `${format(a, "dd/MM")} – ${format(b, "dd/MM/yy")}`;
  return `${format(a, "dd/MM/yy")} – ${format(b, "dd/MM/yy")}`;
}

/** Estado do período, para a página manter o filtro ao lado das abas e passar o range aos relatórios. */
export function usePeriodo(): Periodo & { aplicar: (preset: string, range: [Date, Date]) => void } {
  const [estado, setEstado] = useState<Periodo>({ preset: "mes", range: PRESETS[4].range() });
  const aplicar = (preset: string, range: [Date, Date]) => setEstado({ preset, range });
  return { ...estado, aplicar };
}

export function FiltroPeriodo({ preset, range, onAplicar }: {
  preset: string;
  range: [Date, Date];
  onAplicar: (preset: string, range: [Date, Date]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"lista" | "calendario">("lista");
  const [custom, setCustom] = useState<DateRange | undefined>();

  const rotulo = useMemo(() => rotuloPeriodo(range), [range]);
  const presetLabel = preset === "custom"
    ? "Personalizado"
    : PRESETS.find((p) => p.id === preset)?.label ?? "Período";

  const abrirCalendario = () => {
    setCustom({ from: range[0], to: range[1] });
    setPanel("calendario");
  };

  return (
    <div className="ml-auto shrink-0">
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setPanel(preset === "custom" ? "calendario" : "lista");
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-10 w-auto min-w-[250px] justify-between gap-3 rounded-xl px-3 font-normal">
            <span className="flex min-w-0 items-center gap-2">
              <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{presetLabel}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="text-xs tabular-nums text-muted-foreground">{rotulo}</span>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] rounded-2xl p-0" align="end">
          {panel === "lista" ? (
            <div className="p-2">
              <p className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Período
              </p>
              <div className="space-y-0.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { onAplicar(p.id, p.range()); setOpen(false); }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm transition",
                      preset === p.id
                        ? "bg-primary-soft font-semibold text-primary-soft-fg"
                        : "text-foreground hover:bg-surface-sunken",
                    )}
                  >
                    {p.label}
                    {preset === p.id && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                ))}
              </div>
              <div className="my-1 border-t border-border/60" />
              <button
                type="button"
                onClick={abrirCalendario}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition",
                  preset === "custom"
                    ? "bg-primary-soft font-semibold text-primary-soft-fg"
                    : "text-foreground hover:bg-surface-sunken",
                )}
              >
                <CalendarIcon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">Personalizado</span>
                {preset === "custom" && <Check className="h-4 w-4 shrink-0" />}
              </button>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-3">
                <button
                  type="button"
                  onClick={() => setPanel("lista")}
                  className="flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Períodos
                </button>
                <span className="text-xs tabular-nums text-muted-foreground">{rotulo}</span>
              </div>
              <Calendar
                mode="range"
                locale={ptBR}
                selected={custom}
                onSelect={(r) => {
                  setCustom(r);
                  if (r?.from && r?.to) {
                    onAplicar("custom", [startOfDay(r.from), endOfDay(r.to)]);
                    setOpen(false);
                  }
                }}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
