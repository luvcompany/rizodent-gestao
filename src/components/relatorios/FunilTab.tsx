import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangeFilter, getDateRangeFromFilter, type DateRangeFilterValue } from "@/components/ui/date-range-filter";
import { Loader2, Trophy, XCircle, CircleDot, Wallet, Info } from "lucide-react";

// Análise de Funil (genérica por pipeline). Coorte = leads criados no período,
// dentro do funil escolhido. Usa crm_stages (is_won/is_lost = Ganho/Perda/Aberta),
// crm_leads (etapa atual + valor) e crm_lead_stage_history (passagens + duração).

type Pipeline = { id: string; name: string };
type Stage = { id: string; name: string; position: number; color: string | null; is_won: boolean; is_lost: boolean };
type Lead = { id: string; stage_id: string | null; value: number | string | null; created_at: string };
type Hist = { lead_id: string; stage_id: string; entered_at: string; exited_at: string | null };

interface Props {
  pipelines: Pipeline[];
  pipelineId: string;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function asNum(v: unknown): number { const n = typeof v === "string" ? parseFloat(v) : Number(v); return Number.isFinite(n) ? n : 0; }
function pct(n: number, d: number): string { return d ? `${((n / d) * 100).toFixed(1)}%` : "—"; }
function fmtDur(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 24) return `${h.toFixed(1)} h`;
  const d = h / 24;
  return d < 60 ? `${d.toFixed(1)} dias` : `${(d / 30).toFixed(1)} meses`;
}

export default function FunilTab({ pipelines, pipelineId }: Props) {
  const initial = pipelineId && pipelineId !== "todos" ? pipelineId : (pipelines[0]?.id || "");
  const [pid, setPid] = useState(initial);
  const [period, setPeriod] = useState<DateRangeFilterValue>({ preset: "this_month" });
  const [loading, setLoading] = useState(false);
  const [stages, setStages] = useState<Stage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [hist, setHist] = useState<Hist[]>([]);

  useEffect(() => { if (!pid && pipelines[0]) setPid(pipelines[0].id); }, [pipelines, pid]);

  useEffect(() => {
    if (!pid) return;
    const range = getDateRangeFromFilter(period);
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: st } = await supabase.from("crm_stages")
        .select("id,name,position,color,is_won,is_lost").eq("pipeline_id", pid).order("position");
      let lq = supabase.from("crm_leads").select("id,stage_id,value,created_at").eq("pipeline_id", pid);
      if (range) lq = lq.gte("created_at", range.start.toISOString()).lte("created_at", range.end.toISOString());
      const { data: ld } = await lq;
      const leadIds = (ld || []).map((l: any) => l.id);
      const hrows: Hist[] = [];
      for (let i = 0; i < leadIds.length; i += 200) {
        const batch = leadIds.slice(i, i + 200);
        const { data: h } = await supabase.from("crm_lead_stage_history")
          .select("lead_id,stage_id,entered_at,exited_at").in("lead_id", batch);
        if (h) hrows.push(...(h as any));
      }
      if (cancelled) return;
      setStages((st || []) as any);
      setLeads((ld || []) as any);
      setHist(hrows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [pid, period]);

  const model = useMemo(() => {
    const posById = new Map(stages.map((s) => [s.id, s.position]));
    const openStages = stages.filter((s) => !s.is_won && !s.is_lost).sort((a, b) => a.position - b.position);
    const wonIds = new Set(stages.filter((s) => s.is_won).map((s) => s.id));
    const lostIds = new Set(stages.filter((s) => s.is_lost).map((s) => s.id));
    const hasOutcomeStages = wonIds.size > 0 || lostIds.size > 0;

    const histByLead = new Map<string, Hist[]>();
    hist.forEach((h) => { const a = histByLead.get(h.lead_id) || []; a.push(h); histByLead.set(h.lead_id, a); });

    // Posição máxima (entre etapas abertas/ganho — perda é saída lateral) alcançada.
    const reachedPos = (l: Lead): number => {
      let mx = -1;
      const consider = (sid: string | null) => {
        if (!sid || lostIds.has(sid)) return;
        const p = posById.get(sid);
        if (p != null && p > mx) mx = p;
      };
      consider(l.stage_id);
      (histByLead.get(l.id) || []).forEach((h) => consider(h.stage_id));
      return mx;
    };

    let won = 0, lost = 0, open = 0, openValue = 0, wonValue = 0;
    leads.forEach((l) => {
      if (l.stage_id && wonIds.has(l.stage_id)) { won++; wonValue += asNum(l.value); }
      else if (l.stage_id && lostIds.has(l.stage_id)) lost++;
      else { open++; openValue += asNum(l.value); }
    });
    const total = leads.length;

    const funnel = openStages.map((s) => ({
      stage: s,
      count: leads.filter((l) => reachedPos(l) >= s.position).length,
    }));
    const firstCount = funnel[0]?.count || total || 1;

    const timePerStage = stages
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((s) => {
        const durs = hist.filter((h) => h.stage_id === s.id && h.exited_at)
          .map((h) => new Date(h.exited_at!).getTime() - new Date(h.entered_at).getTime())
          .filter((d) => d > 0);
        const avg = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0;
        const passages = new Set(hist.filter((h) => h.stage_id === s.id).map((h) => h.lead_id)).size;
        return { stage: s, avg, passages };
      });

    return { total, won, lost, open, openValue, wonValue, funnel, firstCount, timePerStage, hasOutcomeStages, openStages };
  }, [stages, leads, hist]);

  const tiles = [
    { label: "Coorte (leads no período)", value: String(model.total), icon: CircleDot, tone: "text-foreground" },
    { label: "Em aberto", value: String(model.open), icon: CircleDot, tone: "text-blue-600 dark:text-blue-400" },
    { label: "Ganho", value: String(model.won), icon: Trophy, tone: "text-emerald-600 dark:text-emerald-500" },
    { label: "Perda", value: String(model.lost), icon: XCircle, tone: "text-destructive" },
    { label: "Taxa de ganho", value: pct(model.won, model.won + model.lost), sub: "ganhos ÷ decididos", tone: "text-emerald-600 dark:text-emerald-500" },
    { label: "Conversão geral", value: pct(model.won, model.total), sub: "ganhos ÷ coorte", tone: "text-foreground" },
    { label: "Valor em aberto", value: brl.format(model.openValue), icon: Wallet, tone: "text-foreground" },
  ];

  return (
    <div className="space-y-6">
      <Card className="p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase">Funil</span>
          <Select value={pid} onValueChange={setPid}>
            <SelectTrigger className="w-[220px] h-9"><SelectValue placeholder="Escolha um funil" /></SelectTrigger>
            <SelectContent>
              {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase">Período</span>
          <DateRangeFilter value={period} onChange={setPeriod} excludePresets={["all", "multi"]} />
        </div>
        {loading && <Loader2 className="animate-spin text-muted-foreground" size={18} />}
      </Card>

      {!model.hasOutcomeStages && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <Info size={16} className="mt-0.5 shrink-0" />
          <span>Nenhuma etapa marcada como <strong>Ganho</strong> ou <strong>Perda</strong> neste funil. Marque em <strong>Automações → etapas</strong> para ver conversão e ganho × perda.</span>
        </div>
      )}

      {/* Tiles de resultado */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {tiles.map((t) => (
          <Card key={t.label} className="p-4 min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground leading-tight line-clamp-2">{t.label}</div>
            <div className={`text-xl font-bold leading-tight truncate mt-1 ${t.tone}`}>{t.value}</div>
            {t.sub && <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{t.sub}</div>}
          </Card>
        ))}
      </div>

      {/* Funil de conversão por etapa */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Conversão por etapa</h3>
          <span className="text-xs text-muted-foreground">Leads que passaram por cada etapa (abertas) · coorte do período</span>
        </div>
        {model.funnel.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem etapas abertas neste funil.</p>
        ) : (
          <div className="space-y-2.5">
            {model.funnel.map((row, i) => {
              const prev = i > 0 ? model.funnel[i - 1].count : row.count;
              const widthPct = model.firstCount ? Math.max(2, (row.count / model.firstCount) * 100) : 2;
              const conv = i > 0 ? pct(row.count, prev) : "100%";
              return (
                <div key={row.stage.id} className="flex items-center gap-3">
                  <div className="w-40 shrink-0 text-sm truncate text-right text-muted-foreground">{row.stage.name}</div>
                  <div className="flex-1 min-w-0">
                    <div className="h-8 rounded-md overflow-hidden bg-muted/50 relative">
                      <div className="h-full rounded-md flex items-center px-2 transition-all"
                        style={{ width: `${widthPct}%`, backgroundColor: (row.stage.color || "#0E7490") + "33", borderRight: `3px solid ${row.stage.color || "#0E7490"}` }}>
                        <span className="text-xs font-semibold tabular-nums">{row.count}</span>
                      </div>
                    </div>
                  </div>
                  <div className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{conv}</div>
                </div>
              );
            })}
            {/* Passo final: Ganho */}
            <div className="flex items-center gap-3 pt-1 border-t border-dashed border-border mt-1">
              <div className="w-40 shrink-0 text-sm truncate text-right font-medium text-emerald-600 dark:text-emerald-500">Ganho</div>
              <div className="flex-1 min-w-0">
                <div className="h-8 rounded-md overflow-hidden bg-muted/50 relative">
                  <div className="h-full rounded-md flex items-center px-2"
                    style={{ width: `${model.firstCount ? Math.max(2, (model.won / model.firstCount) * 100) : 2}%`, backgroundColor: "rgba(16,185,129,.20)", borderRight: "3px solid #10B981" }}>
                    <span className="text-xs font-semibold tabular-nums">{model.won}</span>
                  </div>
                </div>
              </div>
              <div className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{pct(model.won, model.total)}</div>
            </div>
          </div>
        )}
      </Card>

      {/* Tempo médio por etapa */}
      <Card className="p-5">
        <h3 className="font-semibold mb-1">Tempo médio por etapa</h3>
        <p className="text-xs text-muted-foreground mb-3">Média do tempo que os leads ficaram em cada etapa antes de sair (passagens concluídas).</p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Etapa</TableHead>
                <TableHead className="text-right">Passagens</TableHead>
                <TableHead className="text-right">Tempo médio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {model.timePerStage.map((r) => (
                <TableRow key={r.stage.id}>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.stage.color || "#888" }} />
                      {r.stage.name}
                      {r.stage.is_won && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-500">Ganho</span>}
                      {r.stage.is_lost && <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/15 text-destructive">Perda</span>}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.passages}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtDur(r.avg)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Coorte = leads <strong>criados no período</strong> dentro do funil selecionado, acompanhados por todas as etapas.
        “Conversão por etapa” conta leads que já alcançaram cada etapa (ou uma posterior).
      </p>
    </div>
  );
}
