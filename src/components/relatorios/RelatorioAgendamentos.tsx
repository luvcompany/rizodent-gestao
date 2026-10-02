import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "date-fns";
import {
  CalendarCheck, CalendarX, UserCheck, UserX, Users, Repeat, Ban, Loader2, UserPlus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Dados = {
  chegaram: number;
  agendados: string[]; compareceram: string[]; faltas: string[];
  remarcados: string[]; rem_compareceram: string[]; rem_faltas: string[];
  cancelados: string[]; agd_cancelados: string[]; rem_cancelados: string[];
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

export default function RelatorioAgendamentos({ range }: { range: [Date, Date] }) {
  const navigate = useNavigate();
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

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <div className="relative">
          <Kpi label="Leads que chegaram" value={n("chegaram")} icon={UserPlus} tom="info" />
          {loading && <Loader2 className="absolute right-4 top-4 h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      <section className="rounded-2xl bg-card p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Agendados (primeiro agendamento)</h2>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Agendados" value={n("agendados")} icon={CalendarCheck} tom="primary" onClick={abrir("Agendados", "agendados")} hint="Sem quem remarcou" />
          <Kpi label="Compareceram" value={n("compareceram")} icon={UserCheck} tom="success" onClick={abrir("Agendados que compareceram", "compareceram")} />
          <Kpi label="Faltas" value={n("faltas")} icon={UserX} tom="destructive" onClick={abrir("Faltas dos agendados", "faltas")} hint="Cada lead conta uma vez" />
          <Kpi label="Cancelamentos" value={n("agd_cancelados")} icon={Ban} tom="slate" onClick={abrir("Cancelamentos dos agendados", "agd_cancelados")} hint="Avisou e não remarcou" />
        </div>
      </section>

      <section className="rounded-2xl bg-card p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Remarcados</h2>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Remarcados" value={n("remarcados")} icon={Repeat} tom="purple" onClick={abrir("Remarcados", "remarcados")} />
          <Kpi label="Compareceram" value={n("rem_compareceram")} icon={UserCheck} tom="success" onClick={abrir("Remarcados que compareceram", "rem_compareceram")} />
          <Kpi label="Faltas" value={n("rem_faltas")} icon={UserX} tom="destructive" onClick={abrir("Faltas dos remarcados", "rem_faltas")} hint="Cada lead conta uma vez" />
          <Kpi label="Cancelamentos" value={n("rem_cancelados")} icon={CalendarX} tom="slate" onClick={abrir("Cancelamentos dos remarcados", "rem_cancelados")} />
        </div>
      </section>

      <section className="rounded-2xl bg-card p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Geral</h2>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Leads agendados" value={n("geral_agendados")} icon={Users} tom="primary" onClick={abrir("Leads agendados (geral)", "geral_agendados")} hint="Sem contar remarcações" />
          <Kpi label="Comparecimentos" value={n("geral_compareceram")} icon={UserCheck} tom="success" onClick={abrir("Comparecimentos (geral)", "geral_compareceram")} />
          <Kpi label="Faltas" value={n("geral_faltas")} icon={UserX} tom="destructive" onClick={abrir("Faltas (geral)", "geral_faltas")} />
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
