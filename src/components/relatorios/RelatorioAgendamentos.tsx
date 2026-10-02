import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, subWeeks,
  startOfMonth, endOfMonth, subMonths, format,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import {
  CalendarIcon, UserPlus, CalendarCheck, CheckCircle2, XCircle, Repeat, Ban, Loader2,
  ChevronDown, Check, ArrowLeft,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Dados = {
  chegaram: number;
  agendados: string[]; compareceram: string[]; faltas: string[];
  remarcados: string[]; rem_compareceram: string[]; rem_faltas: string[];
  cancelados: string[];
  geral_agendados: string[]; geral_compareceram: string[]; geral_faltas: string[];
};

type Tom = "primary" | "success" | "destructive" | "purple" | "slate" | "info";
const TOM: Record<Tom, string> = {
  primary: "bg-primary-soft text-primary-soft-fg",
  success: "bg-success-soft text-success-soft-foreground",
  destructive: "bg-destructive-soft text-destructive-soft-foreground",
  purple: "bg-purple-soft text-purple-soft-foreground",
  slate: "bg-slate-soft text-slate-soft-foreground",
  info: "bg-info-soft text-info-soft-foreground",
};

const hoje = () => new Date();
const semana = { weekStartsOn: 1 as const };
const PRESETS: { id: string; label: string; range: () => [Date, Date] }[] = [
  { id: "hoje", label: "Hoje", range: () => [startOfDay(hoje()), endOfDay(hoje())] },
  { id: "ontem", label: "Ontem", range: () => [startOfDay(subDays(hoje(), 1)), endOfDay(subDays(hoje(), 1))] },
  { id: "semana", label: "Esta semana", range: () => [startOfWeek(hoje(), semana), endOfWeek(hoje(), semana)] },
  { id: "semana-passada", label: "Semana passada", range: () => [startOfWeek(subWeeks(hoje(), 1), semana), endOfWeek(subWeeks(hoje(), 1), semana)] },
  { id: "mes", label: "Este mês", range: () => [startOfMonth(hoje()), endOfMonth(hoje())] },
  { id: "mes-passado", label: "Mês passado", range: () => [startOfMonth(subMonths(hoje(), 1)), endOfMonth(subMonths(hoje(), 1))] },
];

function Kpi({ label, value, icon: Icon, tom, onClick, hint }: {
  label: string; value: number | null; icon: LucideIcon; tom: Tom; onClick?: () => void; hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick || !value}
      className="text-left rounded-2xl border border-border/60 bg-card p-5 shadow-card transition hover:shadow-md disabled:cursor-default disabled:hover:shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm text-muted-foreground leading-snug">{label}</span>
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", TOM[tom])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 text-[30px] font-bold leading-none tabular-nums text-foreground">
        {value === null ? "—" : value.toLocaleString("pt-BR")}
      </div>
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </button>
  );
}

export default function RelatorioAgendamentos() {
  const navigate = useNavigate();
  const [preset, setPreset] = useState<string>("mes");
  const [range, setRange] = useState<[Date, Date]>(PRESETS[4].range());
  const [custom, setCustom] = useState<DateRange | undefined>();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"lista" | "calendario">("lista");
  const [dados, setDados] = useState<Dados | null>(null);
  const [loading, setLoading] = useState(false);
  const [lista, setLista] = useState<{ titulo: string; ids: string[] } | null>(null);
  const [nomes, setNomes] = useState<{ id: string; name: string | null; phone: string | null }[]>([]);

  const inicio = format(range[0], "yyyy-MM-dd");
  const fim = format(range[1], "yyyy-MM-dd");

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    (supabase.rpc as any)("relatorio_agendamentos", { _inicio: inicio, _fim: fim }).then(({ data, error }: any) => {
      if (!vivo) return;
      if (!error) setDados(data as Dados);
      setLoading(false);
    });
    return () => { vivo = false; };
  }, [inicio, fim]);

  useEffect(() => {
    if (!lista) return;
    setNomes([]);
    const ids = lista.ids.slice(0, 500);
    supabase.from("crm_leads").select("id, name, phone").in("id", ids).order("name")
      .then(({ data }) => setNomes((data || []) as any));
  }, [lista]);

  const n = (k: keyof Dados) => (dados ? (Array.isArray(dados[k]) ? (dados[k] as string[]).length : (dados[k] as number)) : null);
  const abrir = (titulo: string, k: keyof Dados) => () => dados && setLista({ titulo, ids: dados[k] as string[] });

  const rotulo = useMemo(() => {
    const [a, b] = range;
    if (format(a, "yyyy-MM-dd") === format(b, "yyyy-MM-dd")) return format(a, "dd/MM/yy");
    if (format(a, "MMyyyy") === format(b, "MMyyyy")) return `${format(a, "dd")}–${format(b, "dd/MM/yy")}`;
    if (format(a, "yyyy") === format(b, "yyyy")) return `${format(a, "dd/MM")} – ${format(b, "dd/MM/yy")}`;
    return `${format(a, "dd/MM/yy")} – ${format(b, "dd/MM/yy")}`;
  }, [range]);

  const presetLabel = preset === "custom"
    ? "Personalizado"
    : PRESETS.find((p) => p.id === preset)?.label ?? "Período";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
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
          <PopoverContent className="w-[280px] rounded-2xl p-0" align="start">
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
                      onClick={() => { setPreset(p.id); setRange(p.range()); setOpen(false); }}
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
                  onClick={() => setPanel("calendario")}
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
                      setPreset("custom");
                      setRange([startOfDay(r.from), endOfDay(r.to)]);
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
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Agendamentos do período</h2>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Leads que chegaram" value={n("chegaram")} icon={UserPlus} tom="info" />
          <Kpi label="Agendados" value={n("agendados")} icon={CalendarCheck} tom="primary" onClick={abrir("Agendados", "agendados")} hint="Primeira consulta no período" />
          <Kpi label="Compareceram" value={n("compareceram")} icon={CheckCircle2} tom="success" onClick={abrir("Agendados que compareceram", "compareceram")} />
          <Kpi label="Faltas" value={n("faltas")} icon={XCircle} tom="destructive" onClick={abrir("Faltas dos agendados", "faltas")} hint="Cada lead conta uma vez" />
          <Kpi label="Remarcados" value={n("remarcados")} icon={Repeat} tom="purple" onClick={abrir("Remarcados", "remarcados")} hint="Já descontados dos agendados" />
          <Kpi label="Remarcados que compareceram" value={n("rem_compareceram")} icon={CheckCircle2} tom="success" onClick={abrir("Remarcados que compareceram", "rem_compareceram")} />
          <Kpi label="Faltas dos remarcados" value={n("rem_faltas")} icon={XCircle} tom="destructive" onClick={abrir("Faltas dos remarcados", "rem_faltas")} hint="Cada lead conta uma vez" />
          <Kpi label="Cancelamentos" value={n("cancelados")} icon={Ban} tom="slate" onClick={abrir("Cancelamentos", "cancelados")} hint="Avisaram e não remarcaram" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">No geral</h2>
        <p className="text-sm text-muted-foreground -mt-2">Primeiras consultas e remarcações juntas, cada lead contado uma vez.</p>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Leads agendados" value={n("geral_agendados")} icon={CalendarCheck} tom="primary" onClick={abrir("Leads agendados (geral)", "geral_agendados")} />
          <Kpi label="Comparecimentos" value={n("geral_compareceram")} icon={CheckCircle2} tom="success" onClick={abrir("Comparecimentos (geral)", "geral_compareceram")} />
          <Kpi label="Faltas" value={n("geral_faltas")} icon={XCircle} tom="destructive" onClick={abrir("Faltas (geral)", "geral_faltas")} />
          <Kpi label="Cancelamentos" value={n("cancelados")} icon={Ban} tom="slate" onClick={abrir("Cancelamentos", "cancelados")} />
        </div>
      </section>

      <Dialog open={!!lista} onOpenChange={(o) => !o && setLista(null)}>
        <DialogContent className="rounded-2xl max-w-lg">
          <DialogHeader>
            <DialogTitle>{lista?.titulo} ({lista?.ids.length ?? 0})</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-border/60">
            {nomes.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => navigate(`../conversas?lead=${l.id}`, { relative: "path" })}
                className="flex w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-surface-sunken rounded-lg"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-fg">
                  {(l.name || "?").trim().slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{l.name || "Sem nome"}</span>
                  <span className="block text-xs text-muted-foreground">{l.phone}</span>
                </span>
              </button>
            ))}
            {lista && !nomes.length && <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
