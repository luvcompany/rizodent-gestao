import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangeFilter, getDateRangeFromFilter, type DateRangeFilterValue } from "@/components/ui/date-range-filter";
import { Loader2, TrendingUp, TrendingDown, Award, AlertTriangle } from "lucide-react";

type Pipeline = { id: string; name: string };
type Lead = {
  id: string; name: string; pipeline_id: string; cidade: string | null;
  source: string | null; nome_anuncio: string | null;
  created_at: string; first_inbound_at: string | null;
};
type Appointment = { id: string; lead_id: string; scheduled_date: string; status: string };
type Msg = { lead_id: string; direction: string; created_at: string };

const CITIES = ["Vitória da Conquista", "Guanambi", "Itabuna", "Ipiaú"];
const ORIGENS = ["Anúncio", "WhatsApp Direto", "Indicação", "Orgânico", "Outros"];

function classifyOrigem(o: string | null): string {
  const v = (o || "").toLowerCase();
  if (/an[uú]ncio|ads?|meta|facebook|instagram/.test(v)) return "Anúncio";
  if (/whats/.test(v)) return "WhatsApp Direto";
  if (/indica/.test(v)) return "Indicação";
  if (/org[aâ]nico|google|seo/.test(v)) return "Orgânico";
  return "Outros";
}

function pct(num: number, den: number): string {
  if (!den) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

interface Props {
  pipelineId: string;
  pipelines: Pipeline[];
  setPipelineId: (id: string) => void;
}

export default function OrigemConversaoTab({ pipelineId, pipelines, setPipelineId }: Props) {
  const [period, setPeriod] = useState<DateRangeFilterValue>({ preset: "this_month" });
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);

  useEffect(() => {
    if (!pipelineId) return;
    const range = getDateRangeFromFilter(period);
    if (!range) return;
    setLoading(true);
    (async () => {
      const { data: ls } = await supabase
        .from("crm_leads")
        .select("id,name,pipeline_id,cidade,source,nome_anuncio,created_at,first_inbound_at")
        .eq("pipeline_id", pipelineId)
        .gte("created_at", range.start.toISOString())
        .lte("created_at", range.end.toISOString())
        .limit(5000);
      const leadIds = (ls || []).map(l => l.id);
      const [{ data: aps }, { data: ms }] = await Promise.all([
        leadIds.length
          ? supabase.from("crm_appointments").select("id,lead_id,scheduled_date,status").in("lead_id", leadIds).limit(5000)
          : Promise.resolve({ data: [] as Appointment[] }),
        leadIds.length
          ? supabase.from("messages").select("lead_id,direction,created_at").in("lead_id", leadIds).limit(20000)
          : Promise.resolve({ data: [] as Msg[] }),
      ]);
      setLeads((ls as Lead[]) || []);
      setAppts((aps as Appointment[]) || []);
      setMsgs((ms as Msg[]) || []);
      setLoading(false);
    })();
  }, [pipelineId, period]);

  // City × Origin matrix
  const cityOrigin = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    [...CITIES, "Outras"].forEach(c => { m[c] = {}; ORIGENS.forEach(o => m[c][o] = 0); });
    leads.forEach(l => {
      const city = CITIES.includes(l.cidade || "") ? (l.cidade as string) : "Outras";
      const origem = classifyOrigem(l.source);
      m[city][origem]++;
    });
    return m;
  }, [leads]);

  // Response rates
  const responseStats = useMemo(() => {
    const firstOutboundByLead = new Map<string, Date>();
    const firstInboundByLead = new Map<string, Date>();
    msgs.forEach(m => {
      const t = new Date(m.created_at);
      if (m.direction === "outbound" && (!firstOutboundByLead.get(m.lead_id) || t < firstOutboundByLead.get(m.lead_id)!)) {
        firstOutboundByLead.set(m.lead_id, t);
      }
      if (m.direction === "inbound" && (!firstInboundByLead.get(m.lead_id) || t < firstInboundByLead.get(m.lead_id)!)) {
        firstInboundByLead.set(m.lead_id, t);
      }
    });
    let in1h = 0, sameDay = 0, in24h = 0, notAnswered = 0, totalAnswered = 0;
    leads.forEach(l => {
      const ib = firstInboundByLead.get(l.id) || (l.first_inbound_at ? new Date(l.first_inbound_at) : null);
      const ob = firstOutboundByLead.get(l.id);
      if (!ib) { notAnswered++; return; }
      const after = ob && ob > ib ? ob : null;
      if (!after) { notAnswered++; return; }
      totalAnswered++;
      const diff = after.getTime() - ib.getTime();
      if (diff <= 3600_000) in1h++;
      if (after.toDateString() === ib.toDateString()) sameDay++;
      if (diff <= 86400_000) in24h++;
    });
    return { total: leads.length, totalAnswered, in1h, sameDay, in24h, notAnswered };
  }, [leads, msgs]);

  // Funnel
  const funnel = useMemo(() => {
    const totalLeads = leads.length;
    const answered = responseStats.totalAnswered;
    const leadIdsWithAppt = new Set(appts.map(a => a.lead_id));
    const scheduled = leadIdsWithAppt.size;
    const apptOutcome = appts.filter(a => a.status === "contracted" || a.status === "not_contracted" || a.status === "no_show");
    const showed = appts.filter(a => a.status === "contracted" || a.status === "not_contracted").length;
    const noShow = appts.filter(a => a.status === "no_show").length;
    const contracted = appts.filter(a => a.status === "contracted").length;
    return {
      totalLeads, answered, scheduled, showed, noShow, contracted,
      attendanceRate: pct(showed, showed + noShow),
      leadToAnswered: pct(answered, totalLeads),
      answeredToScheduled: pct(scheduled, answered),
      scheduledToShowed: pct(showed, apptOutcome.length),
      showedToContracted: pct(contracted, showed),
      leadToContracted: pct(contracted, totalLeads),
    };
  }, [leads, appts, responseStats]);

  // Ranking by origem
  const ranking = useMemo(() => {
    const byOrigem: Record<string, { leads: number; contracted: number }> = {};
    const apptsByLead = new Map<string, Appointment[]>();
    appts.forEach(a => {
      if (!apptsByLead.has(a.lead_id)) apptsByLead.set(a.lead_id, []);
      apptsByLead.get(a.lead_id)!.push(a);
    });
    leads.forEach(l => {
      const o = classifyOrigem(l.source);
      if (!byOrigem[o]) byOrigem[o] = { leads: 0, contracted: 0 };
      byOrigem[o].leads++;
      if ((apptsByLead.get(l.id) || []).some(a => a.status === "contracted")) byOrigem[o].contracted++;
    });
    const list = Object.entries(byOrigem)
      .filter(([, v]) => v.leads >= 5)
      .map(([k, v]) => ({ origem: k, leads: v.leads, contracted: v.contracted, rate: v.leads ? v.contracted / v.leads : 0 }))
      .sort((a, b) => b.rate - a.rate);
    return list;
  }, [leads, appts]);

  // City performance
  const cityPerf = useMemo(() => {
    const apptsByLead = new Map<string, Appointment[]>();
    appts.forEach(a => {
      if (!apptsByLead.has(a.lead_id)) apptsByLead.set(a.lead_id, []);
      apptsByLead.get(a.lead_id)!.push(a);
    });
    return CITIES.map(c => {
      const cl = leads.filter(l => l.cidade === c);
      const contracted = cl.filter(l => (apptsByLead.get(l.id) || []).some(a => a.status === "contracted")).length;
      return { city: c, leads: cl.length, contracted, rate: cl.length ? contracted / cl.length : 0 };
    }).sort((a, b) => b.rate - a.rate);
  }, [leads, appts]);

  return (
    <div className="space-y-6">
      <Card className="p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase">Funil</span>
          <Select value={pipelineId} onValueChange={setPipelineId}>
            <SelectTrigger className="w-[260px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase">Período</span>
          <DateRangeFilter value={period} onChange={setPeriod} excludePresets={["all"]} />
        </div>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </Card>

      {/* Cidade × Origem */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Leads por Cidade × Origem</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Origem</TableHead>
              {CITIES.map(c => <TableHead key={c} className="text-right">{c}</TableHead>)}
              <TableHead className="text-right">Outras</TableHead>
              <TableHead className="text-right font-bold">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ORIGENS.map(o => {
              const total = [...CITIES, "Outras"].reduce((s, c) => s + (cityOrigin[c]?.[o] || 0), 0);
              return (
                <TableRow key={o}>
                  <TableCell className="font-medium">{o}</TableCell>
                  {CITIES.map(c => <TableCell key={c} className="text-right">{cityOrigin[c]?.[o] || 0}</TableCell>)}
                  <TableCell className="text-right">{cityOrigin["Outras"]?.[o] || 0}</TableCell>
                  <TableCell className="text-right font-bold">{total}</TableCell>
                </TableRow>
              );
            })}
            <TableRow className="border-t-2">
              <TableCell className="font-bold">Total</TableCell>
              {CITIES.map(c => {
                const t = ORIGENS.reduce((s, o) => s + (cityOrigin[c]?.[o] || 0), 0);
                return <TableCell key={c} className="text-right font-bold">{t}</TableCell>;
              })}
              <TableCell className="text-right font-bold">
                {ORIGENS.reduce((s, o) => s + (cityOrigin["Outras"]?.[o] || 0), 0)}
              </TableCell>
              <TableCell className="text-right font-bold">{leads.length}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      {/* Tempo de Resposta */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Leads Atendidos (Tempo de Resposta)</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="p-3 rounded border bg-card">
            <div className="text-xs text-muted-foreground">Total leads</div>
            <div className="text-2xl font-bold">{responseStats.total}</div>
          </div>
          <div className="p-3 rounded border bg-card">
            <div className="text-xs text-muted-foreground">Respondidos em ≤1h</div>
            <div className="text-2xl font-bold text-emerald-600">{responseStats.in1h}</div>
            <div className="text-xs text-muted-foreground">{pct(responseStats.in1h, responseStats.total)}</div>
          </div>
          <div className="p-3 rounded border bg-card">
            <div className="text-xs text-muted-foreground">Mesmo dia</div>
            <div className="text-2xl font-bold text-blue-600">{responseStats.sameDay}</div>
            <div className="text-xs text-muted-foreground">{pct(responseStats.sameDay, responseStats.total)}</div>
          </div>
          <div className="p-3 rounded border bg-card">
            <div className="text-xs text-muted-foreground">Em 24h</div>
            <div className="text-2xl font-bold">{responseStats.in24h}</div>
            <div className="text-xs text-muted-foreground">{pct(responseStats.in24h, responseStats.total)}</div>
          </div>
          <div className="p-3 rounded border bg-card">
            <div className="text-xs text-muted-foreground">Não respondidos</div>
            <div className="text-2xl font-bold text-rose-600">{responseStats.notAnswered}</div>
            <div className="text-xs text-muted-foreground">{pct(responseStats.notAnswered, responseStats.total)}</div>
          </div>
        </div>
      </Card>

      {/* Funil */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Funil de Conversão</h3>
        <div className="space-y-2">
          {[
            { label: "Lead → Atendido", value: funnel.leadToAnswered },
            { label: "Atendido → Agendado", value: funnel.answeredToScheduled },
            { label: "Agendado → Compareceu", value: funnel.scheduledToShowed },
            { label: "Compareceu → Contratado", value: funnel.showedToContracted },
            { label: "Lead → Contratado (geral)", value: funnel.leadToContracted, highlight: true },
          ].map(r => (
            <div key={r.label} className={`flex justify-between p-2 rounded ${r.highlight ? "bg-primary/10 font-bold" : "bg-muted/30"}`}>
              <span>{r.label}</span>
              <span>{r.value}</span>
            </div>
          ))}
          <div className="flex justify-between p-2 rounded bg-emerald-500/10">
            <span>Taxa de Comparecimento</span>
            <span className="font-bold">{funnel.attendanceRate}</span>
          </div>
        </div>
      </Card>

      {/* Ranking */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Award className="w-4 h-4" /> Ranking por Origem</h3>
          {ranking.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dados suficientes (mín. 5 leads).</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Origem</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Contratados</TableHead>
                  <TableHead className="text-right">Conversão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ranking.map((r, i) => (
                  <TableRow key={r.origem}>
                    <TableCell className="font-medium">
                      {i === 0 && <TrendingUp className="inline w-3 h-3 text-emerald-600 mr-1" />}
                      {i === ranking.length - 1 && ranking.length > 1 && <TrendingDown className="inline w-3 h-3 text-rose-600 mr-1" />}
                      {r.origem}
                    </TableCell>
                    <TableCell className="text-right">{r.leads}</TableCell>
                    <TableCell className="text-right">{r.contracted}</TableCell>
                    <TableCell className="text-right font-bold">{(r.rate * 100).toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Performance por Unidade</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cidade</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Contratados</TableHead>
                <TableHead className="text-right">Conversão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cityPerf.map((c, i) => (
                <TableRow key={c.city}>
                  <TableCell className="font-medium">
                    {i === 0 && <TrendingUp className="inline w-3 h-3 text-emerald-600 mr-1" />}
                    {c.city}
                  </TableCell>
                  <TableCell className="text-right">{c.leads}</TableCell>
                  <TableCell className="text-right">{c.contracted}</TableCell>
                  <TableCell className="text-right font-bold">{(c.rate * 100).toFixed(1)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
