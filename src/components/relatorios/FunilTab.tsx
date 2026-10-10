import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { contaComoLeadNovo } from "@/lib/leadNovo";
import { fetchAllPaged, motivoDaFalhaDeLeitura, rangeNoFuso } from "@/lib/reportKit";
import { RpcErrorCard } from "@/components/RpcErrorCard";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangeFilter, getDateRangeFromFilter, type DateRangeFilterValue } from "@/components/ui/date-range-filter";
import { Loader2, Trophy, XCircle, CircleDot, Wallet, Info } from "lucide-react";

// Análise de Funil (genérica por pipeline). Coorte = leads criados no período,
// dentro do funil escolhido. Usa crm_stages (is_won/is_lost = Ganho/Perda/Aberta),
// crm_leads (etapa atual + valor) e crm_lead_stage_history (passagens + duração).

type Pipeline = { id: string; name: string };
type Stage = { id: string; name: string; position: number; color: string | null; is_won: boolean; is_lost: boolean; funcao: string | null };
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
  const [erroDeCarga, setErroDeCarga] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);

  useEffect(() => { if (!pid && pipelines[0]) setPid(pipelines[0].id); }, [pipelines, pid]);

  useEffect(() => {
    if (!pid) return;
    const range = getDateRangeFromFilter(period);
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data: st, error: stErr } = await supabase.from("crm_stages")
          .select("id,name,position,color,is_won,is_lost").eq("pipeline_id", pid).order("position");
        if (stErr) { const e = new Error(stErr.message); (e as { cause?: unknown }).cause = stErr; throw e; }
        // Coorte de leads novos pela regra única do banco (eh_lead_novo, ver
        // leadNovo.ts). Período no fuso da clínica.
        const janela = range ? rangeNoFuso(range.start, range.end) : null;
        // A coluna calculada vem no select e o corte é feito aqui (filtro por
        // coluna calculada não é usado: contagem HEAD com ele falhou no PostgREST).
        const todos = await fetchAllPaged<Lead & { eh_lead_novo?: boolean | null }>(() => {
          let q = supabase.from("crm_leads").select("id,stage_id,value,created_at,eh_lead_novo" as "*").eq("pipeline_id", pid);
          if (janela) q = q.gte("created_at", janela.gteIso).lte("created_at", janela.lteIso);
          return q as never;
        }, "id");
        const ld = todos.filter(contaComoLeadNovo);
        const leadIds = ld.map((l) => l.id);
        const hrows: Hist[] = [];
        for (let i = 0; i < leadIds.length; i += 200) {
          const batch = leadIds.slice(i, i + 200);
          const h = await fetchAllPaged<Hist>(() => supabase.from("crm_lead_stage_history")
            .select("lead_id,stage_id,entered_at,exited_at").in("lead_id", batch) as never, "id");
          hrows.push(...h);
        }
        if (cancelled) return;
        setStages((st || []) as Stage[]);
        setLeads(ld);
        setHist(hrows);
        setErroDeCarga(null);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setErroDeCarga(motivoDaFalhaDeLeitura(e));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pid, period, tentativa]);

  const model = useMemo(() => {
    const posById = new Map(stages.map((s) => [s.id, s.position]));
    // "Não compareceu" é volta para reagendar, não passo do caminho: fica fora
    // da conversão por etapa (continua em "Tempo médio por etapa").
    const openStages = stages
      .filter((s) => !s.is_won && !s.is_lost && s.funcao !== "nao_compareceu")
      .sort((a, b) => a.position - b.position);
    const wonIds = new Set(stages.filter((s) => s.is_won).map((s) => s.id));
    const lostIds = new Set(stages.filter((s) => s.is_lost).map((s) => s.id));
    const temGanho = wonIds.size > 0;
    const temPerda = lostIds.size > 0;
    const hasOutcomeStages = temGanho || temPerda;

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

    return { total, won, lost, open, openValue, wonValue, funnel, firstCount, timePerStage, hasOutcomeStages, temGanho, temPerda, openStages };
  }, [stages, leads, hist]);

  const tiles = [
    { label: "Coorte (leads no período)", value: String(model.total), icon: CircleDot, tone: "text-foreground" },
    { label: "Em aberto", value: String(model.open), icon: CircleDot, tone: "text-info-soft-foreground" },
    { label: "Ganho", value: String(model.won), icon: Trophy, tone: "text-success-soft-foreground" },
    { label: "Perda", value: String(model.lost), icon: XCircle, tone: "text-destructive-soft-foreground" },
    { label: "Taxa de ganho", value: pct(model.won, model.won + model.lost), sub: "ganhos ÷ decididos", tone: "text-success-soft-foreground" },
    { label: "Conversão geral", value: pct(model.won, model.total), sub: "ganhos ÷ coorte", tone: "text-foreground" },
    { label: "Valor em aberto", value: brl.format(model.openValue), icon: Wallet, tone: "text-foreground" },
  ];

  return (
    <div className="space-y-5 lg:space-y-6">
      <Card className="px-4 py-3 rounded-card border-border/60 bg-card shadow-card flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-semibold text-tertiary uppercase tracking-wide">Funil</span>
          <Select value={pid} onValueChange={setPid}>
            <SelectTrigger className="w-[220px] max-w-full h-9 rounded-xl"><SelectValue placeholder="Escolha um funil" /></SelectTrigger>
            <SelectContent>
              {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-tertiary uppercase tracking-wide">Período</span>
          <DateRangeFilter value={period} onChange={setPeriod} excludePresets={["all", "multi"]} />
        </div>
        {loading && <Loader2 className="animate-spin text-primary" size={18} />}
      </Card>

      {!model.hasOutcomeStages ? (
        <div className="flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-relaxed text-warning-soft-foreground [&_strong]:font-semibold">
          <Info size={18} className="mt-0.5 shrink-0 text-warning" />
          <span>Nenhuma etapa marcada como <strong>Ganho</strong> ou <strong>Perda</strong> neste funil. Marque em <strong>Automações → etapas</strong> para ver conversão e ganho × perda.</span>
        </div>
      ) : !model.temPerda ? (
        <div className="flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-relaxed text-warning-soft-foreground [&_strong]:font-semibold">
          <Info size={18} className="mt-0.5 shrink-0 text-warning" />
          <span>Nenhuma etapa marcada como <strong>Perda</strong> neste funil: a taxa de ganho fica inflada. Marque em <strong>Automações → etapas</strong>.</span>
        </div>
      ) : !model.temGanho ? (
        <div className="flex items-start gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm leading-relaxed text-warning-soft-foreground [&_strong]:font-semibold">
          <Info size={18} className="mt-0.5 shrink-0 text-warning" />
          <span>Nenhuma etapa marcada como <strong>Ganho</strong> neste funil: a taxa de ganho fica inflada. Marque em <strong>Automações → etapas</strong>.</span>
        </div>
      ) : null}

      {/* Tiles de resultado */}
      {erroDeCarga ? (
        <RpcErrorCard title="Não foi possível carregar o funil" message={erroDeCarga} onRetry={recarregar} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 lg:gap-4">
          {tiles.map((t) => (
            <Card key={t.label} className="flex min-w-0 flex-col rounded-card border-border/60 p-4 sm:p-5 shadow-card [container-type:inline-size]">
              <div className="min-h-[2lh] text-xs sm:text-[13px] font-semibold leading-snug text-muted-foreground">{t.label}</div>
              <div className={`mt-2 sm:mt-3 whitespace-nowrap [font-size:clamp(20px,13cqi,28px)] font-bold leading-tight tracking-tight tabular-nums ${t.tone}`}>{t.value}</div>
              {t.sub && <div className="text-xs text-tertiary leading-snug mt-1">{t.sub}</div>}
            </Card>
          ))}
        </div>
      )}

      {/* Funil de conversão por etapa */}
      <Card className="p-5 sm:p-6 rounded-card border-border/60 shadow-card">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4 mb-5">
          <h3 className="text-base font-semibold text-foreground">Conversão por etapa</h3>
          <span className="text-xs text-tertiary">Leads que alcançaram cada etapa do caminho · coorte do período</span>
        </div>
        {model.funnel.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8 rounded-xl bg-surface-sunken">Sem etapas abertas neste funil.</p>
        ) : (
          <div className="space-y-3">
            {model.funnel.map((row, i) => {
              const prev = i > 0 ? model.funnel[i - 1].count : row.count;
              const widthPct = model.firstCount ? Math.max(2, (row.count / model.firstCount) * 100) : 2;
              const conv = i > 0 ? pct(row.count, prev) : "100%";
              return (
                <div key={row.stage.id} className="grid grid-cols-[minmax(0,1fr)_56px] sm:grid-cols-[180px_minmax(0,1fr)_64px] items-center gap-x-3 sm:gap-x-4 gap-y-1.5">
                  <div className="min-w-0 text-sm font-medium leading-snug break-words text-foreground sm:text-right">{row.stage.name}</div>
                  <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-1 sm:col-start-2 min-w-0">
                    <div className="h-7 rounded-full overflow-hidden bg-surface-sunken relative">
                      <div className="h-full rounded-full flex items-center justify-end px-2.5 transition-all"
                        style={{ width: `${widthPct}%`, minWidth: "2.25rem", backgroundColor: (row.stage.color || "#0E7490") + "40", boxShadow: `inset -4px 0 0 ${row.stage.color || "#0E7490"}` }}>
                        <span className="text-xs font-bold tabular-nums text-foreground">{row.count}</span>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground sm:col-start-3">{conv}</div>
                </div>
              );
            })}
            {/* Passo final: Ganho */}
            <div className="grid grid-cols-[minmax(0,1fr)_56px] sm:grid-cols-[180px_minmax(0,1fr)_64px] items-center gap-x-3 sm:gap-x-4 gap-y-1.5 pt-3 border-t border-dashed border-border mt-1">
              <div className="min-w-0 text-sm font-semibold break-words text-success-soft-foreground sm:text-right">Ganho</div>
              <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-1 sm:col-start-2 min-w-0">
                <div className="h-7 rounded-full overflow-hidden bg-surface-sunken relative">
                  <div className="h-full rounded-full flex items-center justify-end px-2.5 bg-success"
                    style={{ width: `${model.firstCount ? Math.max(2, (model.won / model.firstCount) * 100) : 2}%`, minWidth: "2.25rem" }}>
                    <span className="text-xs font-bold tabular-nums text-success-foreground">{model.won}</span>
                  </div>
                </div>
              </div>
              <div className="shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground sm:col-start-3">{pct(model.won, model.total)}</div>
            </div>
          </div>
        )}
      </Card>

      {/* Tempo médio por etapa */}
      <Card className="p-5 sm:p-6 rounded-card border-border/60 shadow-card min-w-0">
        <h3 className="text-base font-semibold text-foreground mb-1">Tempo médio por etapa</h3>
        <p className="text-[13px] text-muted-foreground mb-4">Média do tempo que os leads ficaram em cada etapa antes de sair (passagens concluídas).</p>
        <div className="overflow-x-auto rounded-xl border border-border/60 [&_th]:h-11 [&_th]:bg-surface-sunken [&_th]:text-xs [&_th]:font-semibold [&_th]:whitespace-nowrap [&_tr]:border-border/60 max-sm:[&_td]:px-3 max-sm:[&_th]:px-3 max-sm:[&_td]:text-[13px] max-sm:[&_th]:whitespace-normal max-sm:[&_th]:leading-tight">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Etapa</TableHead>
                <TableHead className="text-right">Passagens</TableHead>
                <TableHead className="text-right">Tempo médio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {model.timePerStage.map((r) => (
                <TableRow key={r.stage.id} className="hover:bg-surface-sunken/60">
                  <TableCell>
                    <span className="relative block pl-[18px] font-medium leading-6 text-foreground">
                      <span className="absolute left-0 top-[7px] w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.stage.color || "#888" }} />
                      {r.stage.name}
                      {r.stage.is_won && <span className="ml-2 inline-flex h-6 items-center rounded-full bg-success-soft px-2.5 align-top text-[11px] font-semibold text-success-soft-foreground">Ganho</span>}
                      {r.stage.is_lost && <span className="ml-2 inline-flex h-6 items-center rounded-full bg-destructive-soft px-2.5 align-top text-[11px] font-semibold text-destructive-soft-foreground">Perda</span>}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.passages}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-foreground whitespace-nowrap">{fmtDur(r.avg)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <p className="rounded-xl bg-muted px-4 py-3 text-[13px] leading-relaxed text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground">
        Coorte = leads <strong>criados no período</strong> dentro do funil selecionado, acompanhados por todas as etapas.
        “Conversão por etapa” conta leads que já alcançaram cada etapa (ou uma posterior).
      </p>
    </div>
  );
}
