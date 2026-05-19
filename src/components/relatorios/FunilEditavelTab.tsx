import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { DateRangeFilter, getDateRangeFromFilter, type DateRangeFilterValue } from "@/components/ui/date-range-filter";
import { Loader2, Save, Trash2, TrendingDown, TrendingUp, AlertTriangle, Target, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek, subWeeks } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toLocalDateISO } from "@/lib/utils";

type Pipeline = { id: string; name: string };

type StageRow = {
  key: "atendidos" | "agendados" | "compareceram" | "avaliados" | "fecharam";
  label: string;
  from: "total_leads" | "atendidos" | "agendados" | "compareceram" | "avaliados";
  fromLabel: string;
};

const STAGES: StageRow[] = [
  { key: "atendidos",    label: "Leads Atendidos",                    from: "total_leads",  fromLabel: "Leads recebidos" },
  { key: "agendados",    label: "Atendidos que Agendaram",            from: "atendidos",    fromLabel: "Atendidos" },
  { key: "compareceram", label: "Agendados que Compareceram",         from: "agendados",    fromLabel: "Agendados" },
  { key: "avaliados",    label: "Comparecidos que fizeram Avaliação", from: "compareceram", fromLabel: "Compareceram" },
  { key: "fecharam",     label: "Avaliados que Fecharam tratamento",  from: "avaliados",    fromLabel: "Avaliados" },
];

type FunnelValues = {
  total_leads: number;
  atendidos: number;
  agendados: number;
  compareceram: number;
  avaliados: number;
  fecharam: number;
};

type Goals = {
  meta_atendidos: number;
  meta_agendados: number;
  meta_compareceram: number;
  meta_avaliados: number;
  meta_fecharam: number;
};

const DEFAULT_GOALS: Goals = {
  meta_atendidos: 80,
  meta_agendados: 60,
  meta_compareceram: 70,
  meta_avaliados: 80,
  meta_fecharam: 50,
};

interface Props {
  pipelineId: string;
  pipelines: Pipeline[];
  setPipelineId: (id: string) => void;
}

export default function FunilEditavelTab({ pipelineId, pipelines, setPipelineId }: Props) {
  const [period, setPeriod] = useState<DateRangeFilterValue>({ preset: "this_month" });
  const [periodType, setPeriodType] = useState<"month" | "week" | "custom">("month");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [values, setValues] = useState<FunnelValues>({
    total_leads: 0, atendidos: 0, agendados: 0, compareceram: 0, avaliados: 0, fecharam: 0,
  });
  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);
  const [autoFilled, setAutoFilled] = useState<FunnelValues | null>(null);

  // Período anterior (mesma duração, antes)
  const [prevValues, setPrevValues] = useState<FunnelValues | null>(null);

  // Relatórios salvos
  const [savedReports, setSavedReports] = useState<any[]>([]);
  const [loadedReportId, setLoadedReportId] = useState<string | null>(null);

  const range = useMemo(() => getDateRangeFromFilter(period), [period]);

  // Auto-preenchimento com base nos dados reais do CRM
  useEffect(() => {
    if (!pipelineId || !range) return;
    setLoading(true);
    const startISO = range.start.toISOString();
    const endISO = range.end.toISOString();
    const prevDur = range.end.getTime() - range.start.getTime();
    const prevEnd = new Date(range.start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - prevDur);

    (async () => {
      const computed = await computeFunnel(pipelineId, startISO, endISO);
      const computedPrev = await computeFunnel(pipelineId, prevStart.toISOString(), prevEnd.toISOString());
      setAutoFilled(computed);
      setPrevValues(computedPrev);
      if (!loadedReportId) {
        setValues(computed);
      }
      setLoading(false);
    })();
  }, [pipelineId, range, loadedReportId]);

  // Carrega relatórios salvos
  useEffect(() => {
    if (!pipelineId) return;
    supabase
      .from("crm_funnel_custom_reports")
      .select("*")
      .eq("pipeline_id", pipelineId)
      .order("period_start", { ascending: false })
      .limit(50)
      .then(({ data }) => setSavedReports(data || []));
  }, [pipelineId, saving]);

  const calc = useMemo(() => computeMetrics(values, goals), [values, goals]);
  const calcPrev = useMemo(() => prevValues ? computeMetrics(prevValues, goals) : null, [prevValues, goals]);

  const maiorPerdaIdx = useMemo(() => {
    let idx = -1, maxLoss = -1;
    calc.rows.forEach((r, i) => {
      if (r.lossAbs > maxLoss) { maxLoss = r.lossAbs; idx = i; }
    });
    return idx;
  }, [calc]);

  const handleSave = async () => {
    if (!pipelineId || !range) return;
    setSaving(true);
    const periodLabel = buildPeriodLabel(period, range, periodType);
    const payload = {
      pipeline_id: pipelineId,
      period_label: periodLabel,
      period_type: periodType,
      period_start: toLocalDateISO(range.start),
      period_end: toLocalDateISO(range.end),
      ...values,
      ...goals,
    };
    let resp;
    if (loadedReportId) {
      resp = await supabase.from("crm_funnel_custom_reports").update(payload).eq("id", loadedReportId);
    } else {
      resp = await supabase.from("crm_funnel_custom_reports").insert(payload);
    }
    setSaving(false);
    if (resp.error) {
      toast.error("Erro ao salvar: " + resp.error.message);
    } else {
      toast.success(loadedReportId ? "Relatório atualizado" : "Relatório salvo");
    }
  };

  const handleLoad = (rep: any) => {
    setLoadedReportId(rep.id);
    setValues({
      total_leads: rep.total_leads, atendidos: rep.atendidos, agendados: rep.agendados,
      compareceram: rep.compareceram, avaliados: rep.avaliados, fecharam: rep.fecharam,
    });
    setGoals({
      meta_atendidos: Number(rep.meta_atendidos), meta_agendados: Number(rep.meta_agendados),
      meta_compareceram: Number(rep.meta_compareceram), meta_avaliados: Number(rep.meta_avaliados),
      meta_fecharam: Number(rep.meta_fecharam),
    });
    setPeriod({ preset: "custom", from: new Date(rep.period_start), to: new Date(rep.period_end) });
    toast.success("Relatório carregado: " + rep.period_label);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este relatório?")) return;
    const { error } = await supabase.from("crm_funnel_custom_reports").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Excluído");
      if (loadedReportId === id) setLoadedReportId(null);
      setSavedReports(s => s.filter(r => r.id !== id));
    }
  };

  const resetToAuto = () => {
    if (autoFilled) {
      setValues(autoFilled);
      setLoadedReportId(null);
      toast.success("Valores restaurados do CRM");
    }
  };

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <Card className="p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase">Funil</span>
          <Select value={pipelineId} onValueChange={setPipelineId}>
            <SelectTrigger className="w-[240px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase">Período</span>
          <Select value={periodType} onValueChange={(v: any) => {
            setPeriodType(v);
            const today = new Date();
            if (v === "month") setPeriod({ preset: "custom", from: startOfMonth(today), to: endOfMonth(today) });
            else if (v === "week") setPeriod({ preset: "custom", from: startOfWeek(today, { weekStartsOn: 1 }), to: endOfWeek(today, { weekStartsOn: 1 }) });
          }}>
            <SelectTrigger className="w-[120px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Mês</SelectItem>
              <SelectItem value="week">Semana</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          <DateRangeFilter value={period} onChange={setPeriod} excludePresets={["all"]} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          <Button variant="outline" size="sm" onClick={resetToAuto} disabled={!autoFilled}>
            <RotateCcw className="w-4 h-4 mr-1" /> Auto
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !pipelineId}>
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            {loadedReportId ? "Atualizar" : "Salvar"}
          </Button>
        </div>
      </Card>

      {/* Indicadores consolidados */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase">Conversão total</div>
          <div className="text-3xl font-bold text-primary">{calc.totalConv.toFixed(1)}%</div>
          {calcPrev && (
            <div className="text-xs mt-1 flex items-center gap-1">
              {calc.totalConv >= calcPrev.totalConv
                ? <TrendingUp className="w-3 h-3 text-emerald-600" />
                : <TrendingDown className="w-3 h-3 text-red-500" />}
              <span className="text-muted-foreground">
                anterior: {calcPrev.totalConv.toFixed(1)}%
              </span>
            </div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase">Total fechamentos</div>
          <div className="text-3xl font-bold text-emerald-600">{values.fecharam}</div>
          {calcPrev && (
            <div className="text-xs mt-1 text-muted-foreground">
              anterior: {prevValues?.fecharam}
            </div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase">Perdas absolutas</div>
          <div className="text-3xl font-bold text-red-600">{calc.totalLoss}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase">Maior perda</div>
          <div className="text-base font-bold text-orange-600 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" />
            {maiorPerdaIdx >= 0 ? calc.rows[maiorPerdaIdx].label.replace(/.+que /, "").replace(/.+fizeram /, "") : "—"}
          </div>
          {maiorPerdaIdx >= 0 && (
            <div className="text-xs text-muted-foreground mt-1">
              −{calc.rows[maiorPerdaIdx].lossAbs} ({calc.rows[maiorPerdaIdx].lossPct.toFixed(0)}%)
            </div>
          )}
        </Card>
      </div>

      {/* Tabela editável */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Funil de Conversão por Etapa</h3>
          <span className="text-xs text-muted-foreground">
            Valores auto-preenchidos do CRM • edite livremente
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Etapa</TableHead>
              <TableHead className="text-right w-[110px]">Quantidade</TableHead>
              <TableHead className="text-right w-[140px]">Conversão</TableHead>
              <TableHead className="text-right w-[110px]">Perda</TableHead>
              <TableHead className="w-[200px]">Meta (%)</TableHead>
              <TableHead className="w-[160px]">vs Meta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Linha base: Total de Leads */}
            <TableRow className="bg-muted/30">
              <TableCell className="font-medium">Total de Leads recebidos</TableCell>
              <TableCell className="text-right">
                <Input
                  type="number" min={0}
                  value={values.total_leads}
                  onChange={(e) => setValues(v => ({ ...v, total_leads: Number(e.target.value) || 0 }))}
                  className="h-8 text-right w-24 ml-auto"
                />
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">100% (base)</TableCell>
              <TableCell className="text-right text-muted-foreground">—</TableCell>
              <TableCell colSpan={2}></TableCell>
            </TableRow>

            {STAGES.map((stage, i) => {
              const row = calc.rows[i];
              const goalKey = `meta_${stage.key}` as keyof Goals;
              const goalVal = goals[goalKey];
              const aboveGoal = row.conv >= goalVal;
              const isMaiorPerda = i === maiorPerdaIdx;

              return (
                <TableRow key={stage.key} className={isMaiorPerda ? "bg-orange-50 dark:bg-orange-950/20" : ""}>
                  <TableCell className="font-medium">
                    {stage.label}
                    {isMaiorPerda && <AlertTriangle className="inline w-3 h-3 ml-1 text-orange-600" />}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number" min={0}
                      value={values[stage.key]}
                      onChange={(e) => setValues(v => ({ ...v, [stage.key]: Number(e.target.value) || 0 }))}
                      className="h-8 text-right w-24 ml-auto"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={`font-bold ${aboveGoal ? "text-emerald-600" : "text-red-600"}`}>
                      {row.conv.toFixed(1)}%
                    </span>
                    <div className="text-xs text-muted-foreground">de {stage.fromLabel}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="text-red-600 font-medium">−{row.lossAbs}</div>
                    <div className="text-xs text-muted-foreground">{row.lossPct.toFixed(1)}%</div>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number" min={0} max={100} step={1}
                      value={goalVal}
                      onChange={(e) => setGoals(g => ({ ...g, [goalKey]: Number(e.target.value) || 0 }))}
                      className="h-8 w-20"
                    />
                  </TableCell>
                  <TableCell>
                    <Progress
                      value={Math.min(100, (row.conv / Math.max(goalVal, 1)) * 100)}
                      className={`h-2 ${aboveGoal ? "[&>div]:bg-emerald-500" : "[&>div]:bg-red-500"}`}
                    />
                    <div className="text-xs mt-1">
                      {aboveGoal
                        ? <span className="text-emerald-600">+{(row.conv - goalVal).toFixed(1)}pp acima</span>
                        : <span className="text-red-600">{(row.conv - goalVal).toFixed(1)}pp abaixo</span>}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Comparativo período anterior */}
      {calcPrev && prevValues && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Target className="w-4 h-4" /> Comparativo com período anterior
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Etapa</TableHead>
                <TableHead className="text-right">Atual</TableHead>
                <TableHead className="text-right">Anterior</TableHead>
                <TableHead className="text-right">Variação</TableHead>
                <TableHead className="text-right">Conv. atual</TableHead>
                <TableHead className="text-right">Conv. anterior</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["total_leads", ...STAGES.map(s => s.key)] as (keyof FunnelValues)[]).map((k, i) => {
                const cur = values[k]; const prev = prevValues[k];
                const delta = cur - prev;
                const label = i === 0 ? "Total de Leads" : STAGES[i - 1].label;
                const curConv = i === 0 ? null : calc.rows[i - 1].conv;
                const prevConv = i === 0 ? null : calcPrev.rows[i - 1].conv;
                return (
                  <TableRow key={k}>
                    <TableCell>{label}</TableCell>
                    <TableCell className="text-right font-medium">{cur}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{prev}</TableCell>
                    <TableCell className="text-right">
                      <span className={delta >= 0 ? "text-emerald-600" : "text-red-600"}>
                        {delta >= 0 ? "+" : ""}{delta}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{curConv !== null ? `${curConv.toFixed(1)}%` : "—"}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{prevConv !== null ? `${prevConv.toFixed(1)}%` : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Relatórios salvos */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Relatórios Salvos</h3>
        {savedReports.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum relatório salvo neste funil.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Fecharam</TableHead>
                <TableHead className="text-right">Conv.</TableHead>
                <TableHead className="w-[180px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {savedReports.map(r => {
                const conv = r.total_leads > 0 ? (r.fecharam / r.total_leads) * 100 : 0;
                return (
                  <TableRow key={r.id} className={loadedReportId === r.id ? "bg-primary/5" : ""}>
                    <TableCell className="font-medium">{r.period_label}</TableCell>
                    <TableCell className="capitalize">{r.period_type}</TableCell>
                    <TableCell className="text-right">{r.total_leads}</TableCell>
                    <TableCell className="text-right text-emerald-600">{r.fecharam}</TableCell>
                    <TableCell className="text-right font-bold">{conv.toFixed(1)}%</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleLoad(r)}>Carregar</Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(r.id)}>
                          <Trash2 className="w-3 h-3 text-red-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ====================== HELPERS ======================

function computeMetrics(v: FunnelValues, goals: Goals) {
  const rows = STAGES.map(stage => {
    const from = v[stage.from];
    const cur = v[stage.key];
    const conv = from > 0 ? (cur / from) * 100 : 0;
    const lossAbs = Math.max(0, from - cur);
    const lossPct = 100 - conv;
    return { label: stage.label, conv, lossAbs, lossPct, from, cur };
  });
  const totalLoss = rows.reduce((s, r) => s + r.lossAbs, 0);
  const totalConv = v.total_leads > 0 ? (v.fecharam / v.total_leads) * 100 : 0;
  return { rows, totalLoss, totalConv };
}

function buildPeriodLabel(period: DateRangeFilterValue, range: { start: Date; end: Date }, type: string): string {
  if (type === "month") return format(range.start, "MMMM yyyy", { locale: ptBR });
  if (type === "week") return `Semana ${format(range.start, "w/yyyy")}`;
  return `${format(range.start, "dd/MM/yy")} → ${format(range.end, "dd/MM/yy")}`;
}

async function fetchAllPages<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

/**
 * Calcula valores reais do funil a partir do CRM:
 * - total_leads = leads criados no período
 * - atendidos = leads que receberam ao menos uma resposta (outbound após inbound)
 * - agendados = leads únicos com appointment cuja data marcada está no período
 * - compareceram = appointments com status contracted OU not_contracted
 * - avaliados = mesma definição de compareceram (proxy: quem compareceu fez avaliação)
 * - fecharam = appointments com status='contracted'
 */
async function computeFunnel(pipelineId: string, startISO: string, endISO: string): Promise<FunnelValues> {
  // Leads da coorte
  const cohort = await fetchAllPages<{ id: string; created_at: string; first_inbound_at: string | null }>((f, t) =>
    supabase
      .from("crm_leads")
      .select("id, created_at, first_inbound_at")
      .eq("pipeline_id", pipelineId)
      .gte("created_at", startISO)
      .lte("created_at", endISO)
      .order("created_at")
      .range(f, t)
  );
  const total_leads = cohort.length;
  const leadIds = cohort.map(l => l.id);

  // Mensagens para calcular atendidos
  let allMsgs: { lead_id: string; direction: string; created_at: string }[] = [];
  let allAppts: { lead_id: string; scheduled_date: string; status: string; is_rescheduled?: boolean }[] = [];
  const CHUNK = 300;
  for (let i = 0; i < leadIds.length; i += CHUNK) {
    const chunk = leadIds.slice(i, i + CHUNK);
    const msgs = await fetchAllPages<{ lead_id: string; direction: string; created_at: string }>((f, t) =>
      supabase.from("messages")
        .select("lead_id,direction,created_at")
        .in("lead_id", chunk)
        .order("created_at")
        .range(f, t));
    allMsgs = allMsgs.concat(msgs);
    const apps = await fetchAllPages<any>((f, t) =>
      supabase.from("crm_appointments")
        .select("lead_id,scheduled_date,status,is_rescheduled")
        .in("lead_id", chunk)
        .range(f, t));
    allAppts = allAppts.concat(apps);
  }

  // Atendidos = leads com ao menos um outbound após o primeiro inbound
  const firstInbound = new Map<string, number>();
  const outboundsByLead = new Map<string, number[]>();
  allMsgs.forEach(m => {
    const t = new Date(m.created_at).getTime();
    if (m.direction === "inbound") {
      const cur = firstInbound.get(m.lead_id);
      if (cur === undefined || t < cur) firstInbound.set(m.lead_id, t);
    } else if (m.direction === "outbound") {
      if (!outboundsByLead.has(m.lead_id)) outboundsByLead.set(m.lead_id, []);
      outboundsByLead.get(m.lead_id)!.push(t);
    }
  });
  let atendidos = 0;
  cohort.forEach(l => {
    const ib = firstInbound.get(l.id) ?? (l.first_inbound_at ? new Date(l.first_inbound_at).getTime() : null);
    if (ib === null) return;
    const obs = outboundsByLead.get(l.id) || [];
    if (obs.some(t => t > ib)) atendidos++;
  });

  // Appointments filtrados por data marcada no período
  const startDateStr = startISO.slice(0, 10);
  const endDateStr = endISO.slice(0, 10);
  const apptsPeriodo = allAppts.filter(a =>
    a.scheduled_date >= startDateStr && a.scheduled_date <= endDateStr && !a.is_rescheduled
  );
  const agendadosLeads = new Set(apptsPeriodo.map(a => a.lead_id));
  const agendados = agendadosLeads.size;
  const compareceram = apptsPeriodo.filter(a => a.status === "contracted" || a.status === "not_contracted").length;
  const fecharam = apptsPeriodo.filter(a => a.status === "contracted").length;
  // Avaliados: proxy = compareceram (todos que compareceram fizeram avaliação)
  const avaliados = compareceram;

  return { total_leads, atendidos, agendados, compareceram, avaliados, fecharam };
}
