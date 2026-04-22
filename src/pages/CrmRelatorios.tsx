import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangeFilter, getDateRangeFromFilter, type DateRangeFilterValue } from "@/components/ui/date-range-filter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ptBR } from "date-fns/locale";
import { format } from "date-fns";
import DashboardFunnel from "@/components/DashboardFunnel";
import { Loader2, Calendar, Clock, MapPin, Bell, MessageSquare, Ghost, TrendingUp, CalendarIcon, Activity } from "lucide-react";

// ---------- Tipos ----------
type Pipeline = { id: string; name: string };
type Stage = { id: string; name: string; color: string; position: number; pipeline_id: string };
type Lead = {
  id: string; name: string; pipeline_id: string; stage_id: string; cidade: string | null;
  created_at: string; last_inbound_at: string | null; first_inbound_at: string | null;
};
type StageHistory = { lead_id: string; stage_id: string; entered_at: string };
type Appointment = { id: string; lead_id: string; created_at: string; scheduled_date: string; status: string };
type Msg = { id: string; lead_id: string; direction: string; created_at: string };

const FUNNEL_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#3b82f6", "#ef4444", "#84cc16", "#a855f7"];

// ---------- Helpers ----------
const lower = (s: string | null | undefined) => (s || "").toLowerCase();
const isAgendStage = (n: string) => /agend/.test(lower(n)) && !/n[aã]o\s*agend/.test(lower(n));
const isReagendStage = (n: string) => /(reagend|remarc)/.test(lower(n));
const isComparStage = (n: string) => /compar/.test(lower(n)) && !/n[aã]o\s*compar/.test(lower(n));
const isFaltouStage = (n: string) => /(n[aã]o\s*compar|faltou|n[aã]o\s*compareceu)/.test(lower(n));
const isContratStage = (n: string) => /contrat/.test(lower(n)) && !/n[aã]o\s*contrat/.test(lower(n));
const isProtectedStage = (n: string) => isAgendStage(n) || isReagendStage(n) || isContratStage(n);

function fmtDuration(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}min`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ---------- Página ----------
export default function CrmRelatorios() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  // Filtros
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineId, setPipelineId] = useState<string>("");
  const [period, setPeriod] = useState<DateRangeFilterValue>({ preset: "this_month" });

  // Dados
  const [stages, setStages] = useState<Stage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [history, setHistory] = useState<StageHistory[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);

  // Carregar pipelines
  useEffect(() => {
    supabase.from("crm_pipelines").select("id, name").order("created_at").then(({ data }) => {
      const list = (data || []) as Pipeline[];
      setPipelines(list);
      if (list.length) {
        const principal = list.find(p => /principal/i.test(p.name)) || list[0];
        setPipelineId(prev => prev || principal.id);
      }
    });
  }, []);

  const range = useMemo(() => getDateRangeFromFilter(period), [period]);

  // Carregar dados quando filtros mudam
  useEffect(() => {
    if (!pipelineId) return;
    setLoading(true);
    const startISO = range?.start.toISOString();
    const endISO = range?.end.toISOString();

    (async () => {
      const stagesRes = await supabase.from("crm_stages").select("id, name, color, position, pipeline_id").eq("pipeline_id", pipelineId).order("position");
      const stagesList = (stagesRes.data || []) as Stage[];
      setStages(stagesList);

      const leadsRes = await supabase.from("crm_leads").select("id, name, pipeline_id, stage_id, cidade, created_at, last_inbound_at, first_inbound_at").eq("pipeline_id", pipelineId);
      const leadsAll = (leadsRes.data || []) as Lead[];
      setLeads(leadsAll);

      const leadIds = leadsAll.map(l => l.id);

      let histRows: StageHistory[] = [];
      let apptRows: Appointment[] = [];
      let msgRows: Msg[] = [];

      for (let i = 0; i < leadIds.length; i += 500) {
        const chunk = leadIds.slice(i, i + 500);
        const [h, a, m] = await Promise.all([
          supabase.from("crm_lead_stage_history").select("lead_id, stage_id, entered_at").in("lead_id", chunk),
          supabase.from("crm_appointments").select("id, lead_id, created_at, scheduled_date, status").in("lead_id", chunk),
          (() => {
            // Sempre inclui o dia de hoje para o bloco "Ações do Dia"
            const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
            const lower = startISO && new Date(startISO) < todayStart ? startISO : todayStart.toISOString();
            return supabase.from("messages").select("id, lead_id, direction, created_at").in("lead_id", chunk).gte("created_at", lower).order("created_at");
          })(),
        ]);
        if (h.data) histRows = histRows.concat(h.data as StageHistory[]);
        if (a.data) apptRows = apptRows.concat(a.data as Appointment[]);
        if (m.data) msgRows = msgRows.concat(m.data as Msg[]);
      }

      setHistory(histRows);
      setAppointments(apptRows);
      setMessages(msgRows);
      setLoading(false);
    })();
  }, [pipelineId, range]);

  const inRange = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    if (!range) return true;
    const d = new Date(iso).getTime();
    return d >= range.start.getTime() && d <= range.end.getTime();
  };

  // Coorte = leads criados no período
  const cohort = useMemo(() => leads.filter(l => inRange(l.created_at)), [leads, range]);
  const cohortIds = useMemo(() => new Set(cohort.map(l => l.id)), [cohort]);
  const stageById = useMemo(() => new Map(stages.map(s => [s.id, s])), [stages]);
  const lastStage = useMemo(() => stages.length ? stages[stages.length - 1] : null, [stages]);

  // 1. Funil visual
  const funnelData = useMemo(() => {
    return stages.map((s, i) => ({
      name: s.name,
      value: cohort.filter(l => l.stage_id === s.id).length,
      fill: s.color || FUNNEL_COLORS[i % FUNNEL_COLORS.length],
    }));
  }, [stages, cohort]);

  // 2. Agenda por etapa
  const agenda = useMemo(() => {
    let agendados = 0, compareceram = 0, remarcaram = 0, faltaram = 0;
    cohort.forEach(l => {
      const st = stageById.get(l.stage_id);
      if (!st) return;
      const n = st.name;
      if (isAgendStage(n) || isReagendStage(n) || isComparStage(n) || isFaltouStage(n) || isContratStage(n)) agendados++;
      if (isComparStage(n) || isContratStage(n)) compareceram++;
      if (isReagendStage(n)) remarcaram++;
      if (isFaltouStage(n)) faltaram++;
    });
    const presenca = (compareceram + faltaram) > 0 ? (compareceram / (compareceram + faltaram)) * 100 : 0;
    return { agendados, compareceram, remarcaram, faltaram, presenca };
  }, [cohort, stageById]);

  // 3. Tempo até contratação
  const tempoContratacao = useMemo(() => {
    if (!lastStage) return null;
    const histByLead = new Map<string, StageHistory[]>();
    history.forEach(h => {
      if (!histByLead.has(h.lead_id)) histByLead.set(h.lead_id, []);
      histByLead.get(h.lead_id)!.push(h);
    });
    const durations: number[] = [];
    cohort.forEach(l => {
      const hs = histByLead.get(l.id) || [];
      const lastEntry = hs.filter(h => h.stage_id === lastStage.id).map(h => new Date(h.entered_at).getTime()).sort((a, b) => a - b)[0];
      const target = lastEntry ?? (l.stage_id === lastStage.id ? new Date(l.created_at).getTime() : null);
      if (target == null) return;
      const dur = target - new Date(l.created_at).getTime();
      if (dur > 0) durations.push(dur);
    });
    return {
      count: durations.length,
      media: mean(durations),
      mediana: median(durations),
      min: durations.length ? Math.min(...durations) : 0,
      max: durations.length ? Math.max(...durations) : 0,
    };
  }, [cohort, history, lastStage]);

  // 4. Tempo até primeiro agendamento
  const tempoAgendamento = useMemo(() => {
    const apptByLead = new Map<string, number>();
    appointments.forEach(a => {
      const t = new Date(a.created_at).getTime();
      const prev = apptByLead.get(a.lead_id);
      if (prev === undefined || t < prev) apptByLead.set(a.lead_id, t);
    });
    const durations: number[] = [];
    cohort.forEach(l => {
      const t = apptByLead.get(l.id);
      if (t == null) return;
      const dur = t - new Date(l.created_at).getTime();
      if (dur >= 0) durations.push(dur);
    });
    return { count: durations.length, media: mean(durations), mediana: median(durations) };
  }, [cohort, appointments]);

  // 4b. Distribuição: dias entre agendamento criado e data marcada
  const distribAgendamento = useMemo(() => {
    const buckets = { mesmoDia: 0, proximoDia: 0, restanteSemana: 0, semanaSeguinte: 0, maisLonge: 0 };
    const diffs: number[] = [];
    const detalhe: { dias: number; count: number }[] = [];
    const detalheMap = new Map<number, number>();

    appointments.forEach(a => {
      if (!cohortIds.has(a.lead_id)) return;
      if (!inRange(a.created_at)) return;
      // Normaliza para meia-noite local para contar dias inteiros
      const created = new Date(a.created_at);
      const createdDay = new Date(created.getFullYear(), created.getMonth(), created.getDate());
      const [y, m, d] = a.scheduled_date.split("-").map(Number);
      const scheduledDay = new Date(y, (m || 1) - 1, d || 1);
      const diffDays = Math.round((scheduledDay.getTime() - createdDay.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) return;
      diffs.push(diffDays);
      detalheMap.set(diffDays, (detalheMap.get(diffDays) || 0) + 1);
      if (diffDays === 0) buckets.mesmoDia++;
      else if (diffDays === 1) buckets.proximoDia++;
      else if (diffDays >= 2 && diffDays <= 6) buckets.restanteSemana++;
      else if (diffDays >= 7 && diffDays <= 13) buckets.semanaSeguinte++;
      else buckets.maisLonge++;
    });

    Array.from(detalheMap.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([dias, count]) => detalhe.push({ dias, count }));

    return {
      total: diffs.length,
      mediaDias: diffs.length ? diffs.reduce((s, x) => s + x, 0) / diffs.length : 0,
      medianaDias: median(diffs),
      buckets,
      detalhe,
    };
  }, [appointments, cohortIds, range]);

  // 5. Total por cidade
  const porCidade = useMemo(() => {
    const map = new Map<string, { agendamentos: number; comparecimentos: number; contratacoes: number }>();
    const ensure = (c: string) => {
      if (!map.has(c)) map.set(c, { agendamentos: 0, comparecimentos: 0, contratacoes: 0 });
      return map.get(c)!;
    };
    const cidadeByLead = new Map(cohort.map(l => [l.id, (l.cidade || "Sem cidade").trim() || "Sem cidade"]));

    appointments.forEach(a => {
      if (!cohortIds.has(a.lead_id)) return;
      if (!inRange(a.created_at)) return;
      const c = cidadeByLead.get(a.lead_id)!;
      ensure(c).agendamentos++;
    });
    cohort.forEach(l => {
      const st = stageById.get(l.stage_id);
      const c = cidadeByLead.get(l.id)!;
      if (st && (isComparStage(st.name) || isContratStage(st.name))) ensure(c).comparecimentos++;
      if (st && isContratStage(st.name)) ensure(c).contratacoes++;
    });

    return Array.from(map.entries())
      .map(([cidade, v]) => ({ cidade, ...v }))
      .sort((a, b) => b.contratacoes - a.contratacoes || b.agendamentos - a.agendamentos);
  }, [cohort, appointments, stageById, cohortIds, range]);

  // 6. Inativos
  const inativos = useMemo(() => {
    const now = Date.now();
    const buckets = { d7: 0, d15: 0, d30: 0 };
    leads.forEach(l => {
      const st = stageById.get(l.stage_id);
      if (st && isProtectedStage(st.name)) return;
      if (!l.last_inbound_at) return;
      const days = (now - new Date(l.last_inbound_at).getTime()) / (1000 * 60 * 60 * 24);
      if (days >= 30) buckets.d30++;
      if (days >= 15) buckets.d15++;
      if (days >= 7) buckets.d7++;
    });
    return buckets;
  }, [leads, stageById]);

  // 7. Tempo de resposta
  const tempoResposta = useMemo(() => {
    const byLead = new Map<string, Msg[]>();
    messages.forEach(m => {
      if (!byLead.has(m.lead_id)) byLead.set(m.lead_id, []);
      byLead.get(m.lead_id)!.push(m);
    });
    const respLead: number[] = [];
    const respCRC: number[] = [];
    byLead.forEach(arr => {
      arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      for (let i = 1; i < arr.length; i++) {
        const prev = arr[i - 1], cur = arr[i];
        if (prev.direction === cur.direction) continue;
        const diff = new Date(cur.created_at).getTime() - new Date(prev.created_at).getTime();
        if (diff <= 0 || diff > 7 * 24 * 60 * 60 * 1000) continue;
        if (prev.direction === "outbound" && cur.direction === "inbound") respLead.push(diff);
        if (prev.direction === "inbound" && cur.direction === "outbound") respCRC.push(diff);
      }
    });
    return { lead: mean(respLead), crc: mean(respCRC), nLead: respLead.length, nCRC: respCRC.length };
  }, [messages]);

  // 8. Fantasmas
  const fantasmas = useMemo(() => {
    return cohort.filter(l => {
      if (!l.first_inbound_at || !l.last_inbound_at) return false;
      return l.first_inbound_at === l.last_inbound_at;
    });
  }, [cohort]);

  if (loading && !leads.length) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-sm text-muted-foreground">Análise de conversão, tempo, cidade e inatividade — por funil.</p>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="acoes-dia">Ações por Dia</TabsTrigger>
          <TabsTrigger value="antecedencia">Antecedência de Agendamento</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-4">

      {/* Filtros */}
      <Card className="p-4 sticky top-0 z-20 backdrop-blur bg-card/95 flex flex-wrap items-center gap-4">
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
        <div className="ml-auto text-xs text-muted-foreground">
          {cohort.length} leads na coorte
        </div>
      </Card>

      {/* 1. Funil */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Distribuição por Etapa</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Onde estão os leads criados no período selecionado.</p>
        {funnelData.some(d => d.value > 0) ? (
          <DashboardFunnel data={funnelData} />
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">Sem leads no período.</p>
        )}
      </Card>


      {/* 2. Agenda */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <Calendar className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Agenda por Etapa do Funil</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Classificação pela etapa atual do lead. Faltou = "Não Compareceu", Remarcou = "Reagendado".</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatBox label="Total Agendados" value={agenda.agendados} />
          <StatBox label="Compareceram" value={agenda.compareceram} color="text-green-600" />
          <StatBox label="Remarcaram" value={agenda.remarcaram} color="text-orange-500" />
          <StatBox label="Faltaram" value={agenda.faltaram} color="text-red-500" />
          <StatBox label="Taxa de Presença" value={`${agenda.presenca.toFixed(0)}%`} color="text-primary" />
        </div>
      </Card>

      {/* 3 + 4 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Tempo até Contratação</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Da entrada do lead até chegar em <strong>{lastStage?.name || "última etapa"}</strong>.
          </p>
          {tempoContratacao && tempoContratacao.count > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              <StatBox label="Média" value={fmtDuration(tempoContratacao.media)} />
              <StatBox label="Mediana" value={fmtDuration(tempoContratacao.mediana)} />
              <StatBox label="Mais rápido" value={fmtDuration(tempoContratacao.min)} color="text-green-600" />
              <StatBox label="Mais lento" value={fmtDuration(tempoContratacao.max)} color="text-orange-500" />
              <div className="col-span-2 text-xs text-muted-foreground text-center pt-2">
                Baseado em {tempoContratacao.count} lead(s) contratado(s)
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum lead chegou em "{lastStage?.name}" no período.</p>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Tempo até Agendamento</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">Quanto tempo entre a entrada do lead e o primeiro agendamento criado.</p>
          {tempoAgendamento.count > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              <StatBox label="Média" value={fmtDuration(tempoAgendamento.media)} />
              <StatBox label="Mediana" value={fmtDuration(tempoAgendamento.mediana)} />
              <div className="col-span-2 text-xs text-muted-foreground text-center pt-2">
                Baseado em {tempoAgendamento.count} lead(s) agendado(s)
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum agendamento encontrado.</p>
          )}
        </Card>
      </div>

      {/* 5. Cidade */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <MapPin className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Total por Cidade</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Agendamentos, comparecimentos e contratações por cidade do lead.</p>
        {porCidade.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Sem dados de cidade.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cidade</TableHead>
                <TableHead className="text-right">Agendamentos</TableHead>
                <TableHead className="text-right">Comparecimentos</TableHead>
                <TableHead className="text-right">Contratações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {porCidade.map(r => (
                <TableRow key={r.cidade}>
                  <TableCell className="font-medium">{r.cidade}</TableCell>
                  <TableCell className="text-right">{r.agendamentos}</TableCell>
                  <TableCell className="text-right text-green-600 font-semibold">{r.comparecimentos}</TableCell>
                  <TableCell className="text-right text-primary font-semibold">{r.contratacoes}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold border-t-2">
                <TableCell>Total</TableCell>
                <TableCell className="text-right">{porCidade.reduce((s, r) => s + r.agendamentos, 0)}</TableCell>
                <TableCell className="text-right">{porCidade.reduce((s, r) => s + r.comparecimentos, 0)}</TableCell>
                <TableCell className="text-right">{porCidade.reduce((s, r) => s + r.contratacoes, 0)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Card>

      {/* 6. Inativos */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <Bell className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Leads Inativos</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Leads sem responder há X dias. <strong>Exclui</strong> Contratados, Agendados e Reagendados.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button onClick={() => navigate("/crm/conversas")} className="text-left">
            <StatBox label="Sem resposta há +7 dias" value={inativos.d7} color="text-yellow-600" hover />
          </button>
          <button onClick={() => navigate("/crm/conversas")} className="text-left">
            <StatBox label="Sem resposta há +15 dias" value={inativos.d15} color="text-orange-500" hover />
          </button>
          <button onClick={() => navigate("/crm/conversas")} className="text-left">
            <StatBox label="Sem resposta há +30 dias" value={inativos.d30} color="text-red-500" hover />
          </button>
        </div>
      </Card>

      {/* 7. Resposta */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <MessageSquare className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Tempo Médio de Resposta</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Calculado sobre pares consecutivos de mensagens no período (ignora intervalos &gt; 7d).</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <StatBox label={`Resposta do Lead (${tempoResposta.nLead} amostras)`} value={fmtDuration(tempoResposta.lead)} color="text-blue-500" />
          <StatBox label={`Resposta do Atendente (${tempoResposta.nCRC} amostras)`} value={fmtDuration(tempoResposta.crc)} color="text-primary" />
        </div>
      </Card>

      {/* 8. Fantasmas */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <Ghost className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Leads Fantasmas</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Leads que mandaram a primeira mensagem e nunca mais responderam.</p>
        <div className="flex flex-col md:flex-row items-start md:items-end gap-6">
          <div>
            <p className="text-5xl font-bold text-primary">{fantasmas.length}</p>
            <p className="text-xs text-muted-foreground mt-1">de {cohort.length} na coorte ({cohort.length ? ((fantasmas.length / cohort.length) * 100).toFixed(0) : 0}%)</p>
          </div>
          {fantasmas.length > 0 && (
            <div className="flex-1 max-h-40 overflow-y-auto border-l pl-4 w-full">
              <p className="text-xs font-medium text-muted-foreground mb-2 uppercase">Top 10</p>
              <ul className="space-y-1">
                {fantasmas.slice(0, 10).map(f => (
                  <li key={f.id}>
                    <button onClick={() => navigate(`/crm/conversa/${f.id}`)} className="text-sm text-foreground hover:text-primary text-left truncate w-full">
                      {f.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>

        </TabsContent>

        <TabsContent value="acoes-dia" className="mt-4">
          <AcoesPorDiaTab pipelineId={pipelineId} pipelines={pipelines} setPipelineId={setPipelineId} />
        </TabsContent>

        <TabsContent value="antecedencia" className="mt-4 space-y-6">
          <Card className="p-4 sticky top-0 z-20 backdrop-blur bg-card/95 flex flex-wrap items-center gap-4">
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

          <Card className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <CalendarIcon className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Quando o lead agenda?</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Diferença em dias entre quando o agendamento foi <strong>criado</strong> e a <strong>data marcada</strong>.
              Útil para entender se os leads marcam para o mesmo dia ou para frente.
            </p>

            {distribAgendamento.total === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum agendamento no período.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                  <StatBox label="Mesmo dia" value={distribAgendamento.buckets.mesmoDia} color="text-green-600" />
                  <StatBox label="Próximo dia" value={distribAgendamento.buckets.proximoDia} color="text-emerald-500" />
                  <StatBox label="2 a 6 dias (esta semana)" value={distribAgendamento.buckets.restanteSemana} color="text-blue-500" />
                  <StatBox label="7 a 13 dias (próx. semana)" value={distribAgendamento.buckets.semanaSeguinte} color="text-orange-500" />
                  <StatBox label="14+ dias" value={distribAgendamento.buckets.maisLonge} color="text-red-500" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                  <StatBox label="Total de agendamentos" value={distribAgendamento.total} />
                  <StatBox label="Média de dias até marcar" value={distribAgendamento.mediaDias.toFixed(1)} color="text-primary" />
                  <StatBox label="Mediana de dias" value={distribAgendamento.medianaDias.toFixed(1)} color="text-primary" />
                </div>

                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase">Detalhamento por dias de antecedência</p>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Dias entre criação e data marcada</TableHead>
                          <TableHead className="text-right">Agendamentos</TableHead>
                          <TableHead className="text-right">% do total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {distribAgendamento.detalhe.map(d => (
                          <TableRow key={d.dias}>
                            <TableCell className="font-medium">
                              {d.dias === 0 ? "Mesmo dia" : d.dias === 1 ? "1 dia depois" : `${d.dias} dias depois`}
                            </TableCell>
                            <TableCell className="text-right">{d.count}</TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              {((d.count / distribAgendamento.total) * 100).toFixed(1)}%
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatBox({ label, value, color = "text-foreground", hover = false }: { label: string; value: string | number; color?: string; hover?: boolean }) {
  return (
    <div className={`bg-secondary/40 rounded-lg p-4 text-center ${hover ? "hover:bg-secondary/70 transition cursor-pointer" : ""}`}>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

// ============================================================================
// Aba: Ações por Dia
// ============================================================================

const HOLIDAYS_FIXED: string[] = [
  "01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25",
];
function isWorkingDay(d: Date): boolean {
  if (d.getDay() === 0) return false;
  const md = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return !HOLIDAYS_FIXED.includes(md);
}

type AcoesStage = { id: string; name: string; color: string; position: number };

function AcoesPorDiaTab({
  pipelineId,
  pipelines,
  setPipelineId,
}: {
  pipelineId: string;
  pipelines: { id: string; name: string }[];
  setPipelineId: (id: string) => void;
}) {
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [stages, setStages] = useState<AcoesStage[]>([]);
  const [loading, setLoading] = useState(true);

  const monthStart = useMemo(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1), [selectedDate]);
  const monthEnd = useMemo(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0, 23, 59, 59, 999), [selectedDate]);

  const [history, setHistory] = useState<{ lead_id: string; stage_id: string; entered_at: string }[]>([]);
  const [inboundDays, setInboundDays] = useState<{ lead_id: string; created_at: string }[]>([]);

  useEffect(() => {
    if (!pipelineId) return;
    supabase.from("crm_stages").select("id, name, color, position").eq("pipeline_id", pipelineId).order("position")
      .then(({ data }) => setStages((data || []) as AcoesStage[]));
  }, [pipelineId]);

  useEffect(() => {
    if (!pipelineId || stages.length === 0) return;
    setLoading(true);
    const stageIds = stages.map(s => s.id);
    const startISO = monthStart.toISOString();
    const endISO = monthEnd.toISOString();

    (async () => {
      // Buscar TODOS os leads do pipeline (paginação manual para superar limite de 1000)
      const leadIdsSet = new Set<string>();
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("crm_leads")
          .select("id")
          .eq("pipeline_id", pipelineId)
          .range(from, from + pageSize - 1);
        if (error || !data || data.length === 0) break;
        data.forEach((l: any) => leadIdsSet.add(l.id));
        if (data.length < pageSize) break;
        from += pageSize;
      }
      const leadIds = Array.from(leadIdsSet);

      let histAll: any[] = [];
      let msgsAll: any[] = [];
      for (let i = 0; i < stageIds.length; i += 100) {
        const chunk = stageIds.slice(i, i + 100);
        let hFrom = 0;
        while (true) {
          const { data, error } = await supabase
            .from("crm_lead_stage_history")
            .select("lead_id, stage_id, entered_at")
            .in("stage_id", chunk)
            .gte("entered_at", startISO)
            .lte("entered_at", endISO)
            .order("entered_at", { ascending: true })
            .range(hFrom, hFrom + pageSize - 1);

          if (error || !data || data.length === 0) break;
          histAll = histAll.concat(data);
          if (data.length < pageSize) break;
          hFrom += pageSize;
        }
      }
      // Paginar mensagens inbound do pipeline (filtra via inner join, sem depender de chunks de IDs)
      let mFrom = 0;
      while (true) {
        const { data, error } = await supabase
          .from("messages")
          .select("lead_id, created_at, crm_leads!inner(pipeline_id)")
          .eq("direction", "inbound")
          .eq("crm_leads.pipeline_id", pipelineId)
          .gte("created_at", startISO)
          .lte("created_at", endISO)
          .order("created_at", { ascending: true })
          .range(mFrom, mFrom + pageSize - 1);
        if (error || !data || data.length === 0) break;
        msgsAll = msgsAll.concat(data);
        if (data.length < pageSize) break;
        mFrom += pageSize;
      }
      setHistory(histAll);
      setInboundDays(msgsAll);
      setLoading(false);
    })();
  }, [pipelineId, stages, monthStart, monthEnd]);

  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const selectedKey = dayKey(selectedDate);

  // Identificar etapa de agendamento exata (excluindo "Pré-Agendado" e "Reagendado")
  const agendStage = useMemo(() => {
    return stages.find(s => {
      const n = lower(s.name);
      return isAgendStage(s.name) && !/pr[eé]/.test(n) && !isReagendStage(s.name);
    });
  }, [stages]);

  // Identificar etapa de reagendamento
  const reagendStage = useMemo(() => {
    return stages.find(s => isReagendStage(s.name));
  }, [stages]);

  const falaramDia = useMemo(() => {
    const set = new Set<string>();
    inboundDays.forEach(m => {
      if (dayKey(new Date(m.created_at)) === selectedKey) set.add(m.lead_id);
    });
    return set;
  }, [inboundDays, selectedKey]);

  const agendadosDia = useMemo(() => {
    if (!agendStage) return new Set<string>();
    const set = new Set<string>();
    history.forEach(h => {
      if (h.stage_id !== agendStage.id) return;
      if (dayKey(new Date(h.entered_at)) === selectedKey) set.add(h.lead_id);
    });
    return set;
  }, [history, agendStage, selectedKey]);

  const reagendadosDia = useMemo(() => {
    if (!reagendStage) return new Set<string>();
    const set = new Set<string>();
    history.forEach(h => {
      if (h.stage_id !== reagendStage.id) return;
      if (dayKey(new Date(h.entered_at)) === selectedKey) set.add(h.lead_id);
    });
    return set;
  }, [history, reagendStage, selectedKey]);

  // Interseção: dos que falaram, quantos foram agendados
  const agendadosDosQueFalaram = useMemo(() => {
    const intersection = new Set<string>();
    agendadosDia.forEach(id => {
      if (falaramDia.has(id)) intersection.add(id);
    });
    return intersection;
  }, [agendadosDia, falaramDia]);

  const mediasMes = useMemo(() => {
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const endRef = monthEnd.getTime() < today.getTime() ? monthEnd : today;
    const workingDays: string[] = [];
    const cur = new Date(monthStart);
    while (cur.getTime() <= endRef.getTime()) {
      if (isWorkingDay(cur)) workingDays.push(dayKey(cur));
      cur.setDate(cur.getDate() + 1);
    }
    if (workingDays.length === 0) {
      return { avgFalaram: 0, avgAgendados: 0, avgReagendados: 0, totalDias: 0 };
    }
    const workingSet = new Set(workingDays);

    // Média de pessoas que falaram por dia
    const falaramByDay = new Map<string, Set<string>>();
    inboundDays.forEach(m => {
      const k = dayKey(new Date(m.created_at));
      if (!workingSet.has(k)) return;
      if (!falaramByDay.has(k)) falaramByDay.set(k, new Set());
      falaramByDay.get(k)!.add(m.lead_id);
    });
    let falaramTotal = 0;
    falaramByDay.forEach(s => { falaramTotal += s.size; });
    const avgFalaram = falaramTotal / workingDays.length;

    // Helper: total por dia útil (sem interseção - conta todos os movimentos para a etapa)
    const totalForStage = (stageId: string | undefined) => {
      if (!stageId) return 0;
      const byDay = new Map<string, Set<string>>();
      history.forEach(h => {
        if (h.stage_id !== stageId) return;
        const k = dayKey(new Date(h.entered_at));
        if (!workingSet.has(k)) return;
        if (!byDay.has(k)) byDay.set(k, new Set());
        byDay.get(k)!.add(h.lead_id);
      });
      let total = 0;
      byDay.forEach(s => { total += s.size; });
      return total;
    };

    const avgAgendados = totalForStage(agendStage?.id) / workingDays.length;
    const avgReagendados = totalForStage(reagendStage?.id) / workingDays.length;

    return { avgFalaram, avgAgendados, avgReagendados, totalDias: workingDays.length };
  }, [history, inboundDays, stages, monthStart, monthEnd, agendStage, reagendStage]);

  return (
    <div className="space-y-6">
      <Card className="p-4 sticky top-0 z-20 backdrop-blur bg-card/95 flex flex-wrap items-center gap-4">
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
          <span className="text-xs font-medium text-muted-foreground uppercase">Dia</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("h-9 w-[220px] justify-start text-left font-normal")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(selectedDate, "dd 'de' MMMM yyyy", { locale: ptBR })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarPicker
                mode="single"
                selected={selectedDate}
                onSelect={(d) => d && setSelectedDate(d)}
                locale={ptBR}
                disabled={(d) => d > new Date()}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <div className="ml-auto text-xs text-muted-foreground">
          Média baseada em {mediasMes.totalDias} dia(s) útil(eis) de {format(monthStart, "MMMM/yyyy", { locale: ptBR })}
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="w-5 h-5 text-orange-500" />
          <h2 className="text-lg font-semibold">
            Ações de {format(selectedDate, "dd/MM/yyyy", { locale: ptBR })}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Pessoas que falaram hoje, quantas foram agendadas e quantas reagendadas.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="rounded-lg border border-border p-4 flex flex-col gap-2" style={{ borderLeftWidth: 4, borderLeftColor: "#3b82f6" }}>
            <span className="text-sm text-muted-foreground">Pessoas que falaram comigo</span>
            <span className="text-4xl font-bold text-primary">{falaramDia.size}</span>
            <span className="text-xs text-muted-foreground">Leads distintos com mensagem inbound hoje</span>
          </div>
          <div className="rounded-lg border border-border p-4 flex flex-col gap-2" style={{ borderLeftWidth: 4, borderLeftColor: "#10b981" }}>
            <span className="text-sm text-muted-foreground">Consegui agendar</span>
            <span className="text-4xl font-bold text-green-600">{agendadosDia.size}</span>
            <span className="text-xs text-muted-foreground">Leads movidos para etapa Agendado neste dia</span>
          </div>
          <div className="rounded-lg border border-border p-4 flex flex-col gap-2" style={{ borderLeftWidth: 4, borderLeftColor: "#f59e0b" }}>
            <span className="text-sm text-muted-foreground">Reagendados</span>
            <span className="text-4xl font-bold text-amber-600">{reagendadosDia.size}</span>
            <span className="text-xs text-muted-foreground">Leads movidos para etapa Reagendado neste dia</span>
          </div>
        </div>

        {agendadosDosQueFalaram.size > 0 && falaramDia.size > 0 && (
          <div className="rounded-lg bg-secondary/40 p-4 text-center">
            <span className="text-sm text-muted-foreground">Taxa de conversão (falaram → agendados)</span>
            <p className="text-3xl font-bold text-primary mt-1">{((agendadosDosQueFalaram.size / falaramDia.size) * 100).toFixed(1)}%</p>
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">
            Média Diária — {format(monthStart, "MMMM/yyyy", { locale: ptBR })}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Média por dia útil (excluindo domingos e feriados nacionais) considerando os {mediasMes.totalDias} dia(s) úteis do mês.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="rounded-lg border border-border p-4 flex flex-col gap-2" style={{ borderLeftWidth: 4, borderLeftColor: "#3b82f6" }}>
            <span className="text-sm text-muted-foreground">Média de pessoas/dia</span>
            <span className="text-3xl font-bold text-primary">{mediasMes.avgFalaram.toFixed(1)}</span>
          </div>
          <div className="rounded-lg border border-border p-4 flex flex-col gap-2" style={{ borderLeftWidth: 4, borderLeftColor: "#10b981" }}>
            <span className="text-sm text-muted-foreground">Média de agendamentos/dia</span>
            <span className="text-3xl font-bold text-green-600">{mediasMes.avgAgendados.toFixed(1)}</span>
          </div>
          <div className="rounded-lg border border-border p-4 flex flex-col gap-2" style={{ borderLeftWidth: 4, borderLeftColor: "#f59e0b" }}>
            <span className="text-sm text-muted-foreground">Média de reagendamentos/dia</span>
            <span className="text-3xl font-bold text-amber-600">{mediasMes.avgReagendados.toFixed(1)}</span>
          </div>
        </div>

        {mediasMes.avgFalaram > 0 && (
          <div className="rounded-lg bg-secondary/40 p-4 text-center">
            <span className="text-sm text-muted-foreground">Taxa média de conversão mensal</span>
            <p className="text-3xl font-bold text-primary mt-1">{((mediasMes.avgAgendados / mediasMes.avgFalaram) * 100).toFixed(1)}%</p>
          </div>
        )}
      </Card>
    </div>
  );
}

function StatBoxLite({ label, value, color = "text-foreground" }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-secondary/40 rounded-lg p-4 text-center">
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}
