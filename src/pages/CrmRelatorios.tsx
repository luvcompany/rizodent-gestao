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
import OrigemConversaoTab from "@/components/relatorios/OrigemConversaoTab";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Calendar, Clock, MapPin, Bell, MessageSquare, Ghost, TrendingUp, CalendarIcon, Activity, Users, CheckCircle2, XCircle, Target, ArrowDown, ArrowUpDown, ArrowUp, Inbox, AlertTriangle, HelpCircle } from "lucide-react";

// ============================================================================
// REGRA DE OURO (toda a aba segue esta regra):
//
//  - "Agendamentos no período" = COUNT(crm_appointments) com scheduled_date
//    dentro do período, contados INDIVIDUALMENTE (não por lead). Bate 1:1
//    com o que o calendário exibe.
//  - Compareceram = appts com status IN ('contracted','not_contracted')
//  - Contrataram = appts com status = 'contracted'
//  - Faltas      = appts com status = 'no_show'
//  - Pendentes   = appts com status IN ('pending','confirmed')
//
//  Separadamente, métricas de ATIVIDADE DA EQUIPE usam created_at:
//  - "Agendamentos criados no dia" = COUNT(appts) WHERE created_at = dia
//  - "Novos leads no dia"          = COUNT(leads) WHERE created_at = dia
//  - "Leads que conversaram"       = DISTINCT lead_id com inbound no dia
// ============================================================================

// ---------- Tipos ----------
type Pipeline = { id: string; name: string };
type Stage = { id: string; name: string; color: string; position: number; pipeline_id: string };
type Lead = {
  id: string; name: string; pipeline_id: string; stage_id: string; cidade: string | null;
  created_at: string; last_inbound_at: string | null; first_inbound_at: string | null;
};
type StageHistory = { lead_id: string; stage_id: string; entered_at: string };
type Appointment = {
  id: string; lead_id: string; created_at: string;
  scheduled_date: string; status: string;
  is_rescheduled?: boolean | null;
  lead_cidade?: string | null;
};
type Msg = { id: string; lead_id: string; direction: string; created_at: string };

// ---------- Helpers ----------
const lower = (s: string | null | undefined) => (s || "").toLowerCase();
const isAgendStage = (n: string) => /agend/.test(lower(n)) && !/n[aã]o\s*agend/.test(lower(n));
const isReagendStage = (n: string) => /(reagend|remarc)/.test(lower(n));
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

async function fetchAllPages<T>(
  build: (from: number, to: number) => any
): Promise<T[]> {
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

// Formata uma Date em "YYYY-MM-DD" no horário LOCAL (evita o off-by-one de
// fuso quando convertemos via toISOString — endOfDay BRT vira o dia seguinte em UTC,
// fazendo a query lte(scheduled_date, ...) incluir um dia a mais).
const localDateOnly = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayKeyFromDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

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
  const [leads, setLeads] = useState<Lead[]>([]);                    // leads relevantes (coorte + atividade)
  const [apptsPeriodo, setApptsPeriodo] = useState<Appointment[]>([]); // appts com scheduled_date no período (= calendário)
  const [apptsCriadosPeriodo, setApptsCriadosPeriodo] = useState<Appointment[]>([]); // appts criados no período (atividade)
  const [messages, setMessages] = useState<Msg[]>([]);
  const [history, setHistory] = useState<StageHistory[]>([]);

  // Carregar pipelines (mantido para a aba "Origem & Conversão")
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

  // Carregar dados quando o período muda — SEM filtro de funil (todos os pipelines)
  useEffect(() => {
    if (!range) return;
    setLoading(true);

    const startISO = range.start.toISOString();
    const endISO = range.end.toISOString();
    const startDate = localDateOnly(range.start);
    const endDate = localDateOnly(range.end);

    (async () => {
      // 1. Stages (todos os pipelines)
      const stagesRes = await supabase
        .from("crm_stages")
        .select("id, name, color, position, pipeline_id")
        .order("position");
      const stagesList = (stagesRes.data || []) as Stage[];
      setStages(stagesList);

      // 2. APPOINTMENTS DO PERÍODO (data marcada no intervalo) — fonte da verdade
      //    Query equivalente à do CrmCalendario.tsx.
      //    Filtramos por pipeline depois (precisamos do lead_id para fazer o filtro).
      const apptsByScheduled = await fetchAllPages<Appointment>((f, t) =>
        supabase
          .from("crm_appointments")
          .select("id, lead_id, created_at, scheduled_date, status, is_rescheduled, lead_cidade")
          .gte("scheduled_date", startDate)
          .lte("scheduled_date", endDate)
          .range(f, t)
      );

      // 3. APPOINTMENTS CRIADOS NO PERÍODO (ação da equipe)
      const apptsByCreated = await fetchAllPages<Appointment>((f, t) =>
        supabase
          .from("crm_appointments")
          .select("id, lead_id, created_at, scheduled_date, status, is_rescheduled, lead_cidade")
          .gte("created_at", startISO)
          .lte("created_at", endISO)
          .range(f, t)
      );

      // Leads envolvidos (qualquer um que apareça em qualquer agendamento do período +
      // leads criados no período + leads com atividade inbound)
      const leadIdsFromAppts = new Set<string>();
      apptsByScheduled.forEach(a => leadIdsFromAppts.add(a.lead_id));
      apptsByCreated.forEach(a => leadIdsFromAppts.add(a.lead_id));

      // 4. LEADS criados no período (todos os pipelines)
      const cohortLeads = await fetchAllPages<Lead>((f, t) =>
        supabase
          .from("crm_leads")
          .select("id, name, pipeline_id, stage_id, cidade, created_at, last_inbound_at, first_inbound_at")
          .gte("created_at", startISO)
          .lte("created_at", endISO)
          .order("created_at")
          .range(f, t)
      );

      // 5. LEADS com inbound no período (todos os pipelines)
      const activityInbound = await fetchAllPages<Lead>((f, t) =>
        supabase
          .from("crm_leads")
          .select("id, name, pipeline_id, stage_id, cidade, created_at, last_inbound_at, first_inbound_at")
          .gte("last_inbound_at", startISO)
          .lte("last_inbound_at", endISO)
          .range(f, t)
      );

      // 6. LEADS dos appointments do período — SEM filtro de pipeline.
      //    Leads mudam de funil (ex: "Não contratados", "Pós-venda") e seus
      //    agendamentos NÃO podem sumir do relatório. Calendário = verdade.
      let activityByAppt: Lead[] = [];
      const apptIds = Array.from(leadIdsFromAppts);
      for (let i = 0; i < apptIds.length; i += 300) {
        const chunk = apptIds.slice(i, i + 300);
        const rows = await fetchAllPages<Lead>((f, t) =>
          supabase
            .from("crm_leads")
            .select("id, name, pipeline_id, stage_id, cidade, created_at, last_inbound_at, first_inbound_at")
            .in("id", chunk)
            .range(f, t)
        );
        activityByAppt = activityByAppt.concat(rows);
      }

      const mergedLeads = new Map<string, Lead>();
      [...cohortLeads, ...activityInbound, ...activityByAppt].forEach(l => mergedLeads.set(l.id, l));
      const leadsAll = Array.from(mergedLeads.values());

      // NÃO filtramos appts por pipeline: o calendário mostra todos os
      // agendamentos do período, independente do funil atual do lead.
      setLeads(leadsAll);
      setApptsPeriodo(apptsByScheduled);
      setApptsCriadosPeriodo(apptsByCreated);

      // 7. Mensagens do período (todos os pipelines)
      let msgRows: Msg[] = [];
      let mFrom = 0;
      while (true) {
        const { data, error } = await supabase
          .from("messages")
          .select("id, lead_id, direction, created_at")
          .gte("created_at", startISO)
          .lte("created_at", endISO)
          .order("created_at")
          .range(mFrom, mFrom + 999);
        if (error || !data || data.length === 0) break;
        msgRows = msgRows.concat(data as any);
        if (data.length < 1000) break;
        mFrom += 1000;
      }
      setMessages(msgRows);

      // 8. Stage history para coorte (tempo de contratação)
      const cohortIds = cohortLeads.map(l => l.id);
      let histRows: StageHistory[] = [];
      for (let i = 0; i < cohortIds.length; i += 500) {
        const chunk = cohortIds.slice(i, i + 500);
        const rows = await fetchAllPages<StageHistory>((f, t) =>
          supabase
            .from("crm_lead_stage_history")
            .select("lead_id, stage_id, entered_at")
            .in("lead_id", chunk)
            .order("entered_at")
            .range(f, t)
        );
        histRows = histRows.concat(rows);
      }
      setHistory(histRows);

      setLoading(false);
    })();
  }, [range]);

  const inRange = (iso: string | null | undefined): boolean => {
    if (!iso || !range) return false;
    const d = new Date(iso).getTime();
    return d >= range.start.getTime() && d <= range.end.getTime();
  };

  // Coorte: leads criados no período (todos os pipelines)
  const cohort = useMemo(
    () => leads.filter(l => inRange(l.created_at)),
    [leads, range]
  );
  const cohortIds = useMemo(() => new Set(cohort.map(l => l.id)), [cohort]);
  const stageById = useMemo(() => new Map(stages.map(s => [s.id, s])), [stages]);
  const contratStage = useMemo(
    () => stages.find(s => isContratStage(s.name)) ?? (stages.length ? stages[stages.length - 1] : null),
    [stages]
  );

  // ============= MÉTRICAS DO CALENDÁRIO (regra de ouro) =============
  // Tudo contado por APPOINTMENT, não por lead.
  const calendario = useMemo(() => {
    const total = apptsPeriodo.length;
    const contrataram = apptsPeriodo.filter(a => a.status === "contracted").length;
    const naoContrataram = apptsPeriodo.filter(a => a.status === "not_contracted").length;
    const faltas = apptsPeriodo.filter(a => a.status === "no_show").length;
    const pendentes = apptsPeriodo.filter(a => a.status === "pending" || a.status === "confirmed").length;
    const cancelados = apptsPeriodo.filter(a => a.status === "cancelled").length;
    const compareceram = contrataram + naoContrataram;
    const desfecho = compareceram + faltas; // appts com decisão (excluindo pendentes/cancelados)
    return {
      total, contrataram, naoContrataram, faltas, pendentes, cancelados,
      compareceram, desfecho,
      taxaComparecimento: desfecho > 0 ? (compareceram / desfecho) * 100 : 0,
      taxaContratacao: compareceram > 0 ? (contrataram / compareceram) * 100 : 0,
    };
  }, [apptsPeriodo]);

  // ============= ATIVIDADE (criação no período) =============
  const atividadePeriodo = useMemo(() => {
    return {
      novosLeads: cohort.length,
      agendamentosCriados: apptsCriadosPeriodo.length,
    };
  }, [cohort, apptsCriadosPeriodo]);

  // Conversaram: leads com inbound no período (distintos)
  const leadsQueConversaram = useMemo(() => {
    const s = new Set<string>();
    messages.forEach(m => {
      if (m.direction === "inbound") s.add(m.lead_id);
    });
    leads.forEach(l => {
      if (inRange(l.first_inbound_at) || inRange(l.last_inbound_at)) s.add(l.id);
    });
    return s;
  }, [messages, leads, range]);

  // ============= CONTRATOS DIRETOS (informativo) =============
  // Leads na etapa Contratado que NÃO têm appointment 'contracted' no período.
  // Recorrentes do sistema antigo — ficam fora das taxas.
  const contratosDirectos = useMemo(() => {
    if (!contratStage) return [] as Lead[];
    const leadsComContratoNoPeriodo = new Set<string>();
    apptsPeriodo.forEach(a => { if (a.status === "contracted") leadsComContratoNoPeriodo.add(a.lead_id); });
    return cohort.filter(l => l.stage_id === contratStage.id && !leadsComContratoNoPeriodo.has(l.id));
  }, [cohort, contratStage, apptsPeriodo]);

  // ============= ATIVIDADE DIÁRIA =============
  const dailyActivity = useMemo(() => {
    if (!range) return { rows: [] as any[], totals: { conversaram: 0, novos: 0, agendamentosCriados: 0, agendamentosDoDia: 0, contratosDoDia: 0 } };

    const days: string[] = [];
    const cur = new Date(range.start); cur.setHours(0, 0, 0, 0);
    const end = new Date(range.end);
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const endRef = end.getTime() < today.getTime() ? end : today;
    while (cur.getTime() <= endRef.getTime()) {
      days.push(dayKeyFromDate(cur));
      cur.setDate(cur.getDate() + 1);
    }

    const conversaramByDay = new Map<string, Set<string>>();
    const novosByDay = new Map<string, number>();
    const agendCriadosByDay = new Map<string, number>(); // criados no dia (ação CRC)
    const agendDoDiaByDay = new Map<string, number>();   // com data marcada para o dia
    const contratosDoDiaByDay = new Map<string, number>(); // contratados no dia (marcados)

    messages.forEach(m => {
      if (m.direction !== "inbound") return;
      const k = dayKeyFromDate(new Date(m.created_at));
      if (!conversaramByDay.has(k)) conversaramByDay.set(k, new Set());
      conversaramByDay.get(k)!.add(m.lead_id);
    });
    cohort.forEach(l => {
      const k = dayKeyFromDate(new Date(l.created_at));
      novosByDay.set(k, (novosByDay.get(k) || 0) + 1);
    });
    apptsCriadosPeriodo.forEach(a => {
      const k = dayKeyFromDate(new Date(a.created_at));
      agendCriadosByDay.set(k, (agendCriadosByDay.get(k) || 0) + 1);
    });
    apptsPeriodo.forEach(a => {
      const k = a.scheduled_date; // já YYYY-MM-DD
      agendDoDiaByDay.set(k, (agendDoDiaByDay.get(k) || 0) + 1);
      if (a.status === "contracted") {
        contratosDoDiaByDay.set(k, (contratosDoDiaByDay.get(k) || 0) + 1);
      }
    });

    const rows = days.map(k => {
      const conv = conversaramByDay.get(k)?.size || 0;
      const agCriados = agendCriadosByDay.get(k) || 0;
      return {
        day: k,
        conversaram: conv,
        novos: novosByDay.get(k) || 0,
        agendamentosCriados: agCriados,
        agendamentosDoDia: agendDoDiaByDay.get(k) || 0,
        contratosDoDia: contratosDoDiaByDay.get(k) || 0,
        taxaConvCriados: conv > 0 ? (agCriados / conv) * 100 : 0,
      };
    });

    const totals = rows.reduce((acc, r) => ({
      conversaram: acc.conversaram + r.conversaram,
      novos: acc.novos + r.novos,
      agendamentosCriados: acc.agendamentosCriados + r.agendamentosCriados,
      agendamentosDoDia: acc.agendamentosDoDia + r.agendamentosDoDia,
      contratosDoDia: acc.contratosDoDia + r.contratosDoDia,
    }), { conversaram: 0, novos: 0, agendamentosCriados: 0, agendamentosDoDia: 0, contratosDoDia: 0 });

    return { rows, totals };
  }, [range, messages, cohort, apptsCriadosPeriodo, apptsPeriodo]);

  // ============= TEMPO ATÉ CONTRATAÇÃO (coorte) =============
  const tempoContratacao = useMemo(() => {
    const contratIds = new Set<string>();
    apptsPeriodo.forEach(a => { if (a.status === "contracted") contratIds.add(a.lead_id); });

    const durations: number[] = [];
    cohort.forEach(l => {
      if (!contratIds.has(l.id)) return;
      // Pega o primeiro appointment contratado deste lead
      const aps = apptsPeriodo.filter(a => a.lead_id === l.id && a.status === "contracted");
      const ts = aps.map(a => new Date(a.scheduled_date).getTime()).sort((a, b) => a - b);
      if (!ts.length) return;
      const dur = ts[0] - new Date(l.created_at).getTime();
      if (dur > 0) durations.push(dur);
    });
    return {
      count: durations.length,
      media: mean(durations), mediana: median(durations),
      min: durations.length ? Math.min(...durations) : 0,
      max: durations.length ? Math.max(...durations) : 0,
    };
  }, [cohort, apptsPeriodo]);

  // ============= TEMPO ATÉ AGENDAMENTO (coorte) =============
  const tempoAgendamento = useMemo(() => {
    const firstByLead = new Map<string, number>();
    apptsCriadosPeriodo.forEach(a => {
      const t = new Date(a.created_at).getTime();
      const prev = firstByLead.get(a.lead_id);
      if (prev === undefined || t < prev) firstByLead.set(a.lead_id, t);
    });
    const durations: number[] = [];
    cohort.forEach(l => {
      const t = firstByLead.get(l.id);
      if (t == null) return;
      const dur = t - new Date(l.created_at).getTime();
      if (dur >= 0) durations.push(dur);
    });
    return { count: durations.length, media: mean(durations), mediana: median(durations) };
  }, [cohort, apptsCriadosPeriodo]);

  // ============= ANTECEDÊNCIA DE AGENDAMENTO =============
  // Distribuição de quantos dias antes o agendamento foi criado.
  // Usa TODOS os agendamentos com data marcada no período (1 linha por appointment).
  const distribAgendamento = useMemo(() => {
    const buckets = { mesmoDia: 0, proximoDia: 0, restanteSemana: 0, semanaSeguinte: 0, maisLonge: 0 };
    const diffs: number[] = [];
    const detalheMap = new Map<number, number>();

    apptsPeriodo.forEach(a => {
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
      else if (diffDays <= 6) buckets.restanteSemana++;
      else if (diffDays <= 13) buckets.semanaSeguinte++;
      else buckets.maisLonge++;
    });

    const detalhe = Array.from(detalheMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([dias, count]) => ({ dias, count }));

    return {
      total: diffs.length,
      mediaDias: diffs.length ? diffs.reduce((s, x) => s + x, 0) / diffs.length : 0,
      medianaDias: median(diffs),
      buckets,
      detalhe,
    };
  }, [apptsPeriodo]);

  // ============= POR CIDADE =============
  const porCidade = useMemo(() => {
    const map = new Map<string, { agendamentos: number; comparecimentos: number; contratacoes: number; faltas: number }>();
    const ensure = (c: string) => {
      if (!map.has(c)) map.set(c, { agendamentos: 0, comparecimentos: 0, contratacoes: 0, faltas: 0 });
      return map.get(c)!;
    };
    const cidadeByLead = new Map(leads.map(l => [l.id, (l.cidade || "Sem cidade").trim() || "Sem cidade"]));

    apptsPeriodo.forEach(a => {
      const c = a.lead_cidade?.trim() || cidadeByLead.get(a.lead_id) || "Sem cidade";
      const row = ensure(c);
      row.agendamentos++;
      if (a.status === "contracted" || a.status === "not_contracted") row.comparecimentos++;
      if (a.status === "contracted") row.contratacoes++;
      if (a.status === "no_show") row.faltas++;
    });

    return Array.from(map.entries())
      .map(([cidade, v]) => ({ cidade, ...v }))
      .sort((a, b) => b.contratacoes - a.contratacoes || b.agendamentos - a.agendamentos);
  }, [apptsPeriodo, leads]);

  // ============= INATIVOS =============
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

  // ============= TEMPO DE RESPOSTA =============
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

  // ============= FANTASMAS =============
  const fantasmas = useMemo(() => {
    return cohort.filter(l => {
      if (!l.first_inbound_at || !l.last_inbound_at) return false;
      return new Date(l.first_inbound_at).getTime() === new Date(l.last_inbound_at).getTime();
    });
  }, [cohort]);

  // Ordenação da tabela de cidades
  const [citySort, setCitySort] = useState<{ key: "cidade" | "agendamentos" | "comparecimentos" | "contratacoes" | "faltas"; dir: "asc" | "desc" }>({ key: "contratacoes", dir: "desc" });
  const porCidadeSorted = useMemo(() => {
    const arr = [...porCidade];
    arr.sort((a, b) => {
      const av = a[citySort.key] as any;
      const bv = b[citySort.key] as any;
      if (typeof av === "string") return citySort.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return citySort.dir === "asc" ? (av - bv) : (bv - av);
    });
    return arr;
  }, [porCidade, citySort]);
  const toggleCitySort = (key: typeof citySort.key) => {
    setCitySort(prev => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "cidade" ? "asc" : "desc" });
  };

  if (loading && !apptsPeriodo.length && !leads.length) {
    return <CrmRelatoriosSkeleton />;
  }

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-sm text-muted-foreground">
          Dados alinhados ao calendário. Métricas de agendamento contadas por <strong>agendamento</strong> (não por lead).
        </p>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="origem-conversao">Origem & Conversão</TabsTrigger>
          <TabsTrigger value="acoes-dia">Ações por Dia</TabsTrigger>
          <TabsTrigger value="antecedencia">Antecedência de Agendamento</TabsTrigger>
        </TabsList>

        <TabsContent value="origem-conversao" className="mt-4">
          <OrigemConversaoTab pipelineId={pipelineId} pipelines={pipelines} setPipelineId={setPipelineId} />
        </TabsContent>

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
              {calendario.total} agendamentos · {cohort.length} novos leads
            </div>
          </Card>

          {/* KPIs do período — espelham o calendário */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <KpiCard icon={Calendar} label="Agendamentos" value={calendario.total} accent="blue"
              hint="Com data marcada no período (= calendário)" />
            <KpiCard icon={CheckCircle2} label="Compareceram" value={calendario.compareceram} accent="green"
              hint={`Contratados + Não contratados`} />
            <KpiCard icon={Target} label="Contrataram" value={calendario.contrataram} accent="emerald"
              hint={`${calendario.taxaContratacao.toFixed(0)}% dos que compareceram`} />
            <KpiCard icon={XCircle} label="Não contrataram" value={calendario.naoContrataram} accent="amber" />
            <KpiCard icon={Ghost} label="Faltas" value={calendario.faltas} accent="red"
              hint="Status: no_show" />
            <KpiCard icon={Clock} label="Pendentes" value={calendario.pendentes} accent="indigo"
              hint="Sem desfecho ainda" />
            <KpiCard icon={TrendingUp} label="Taxa comparec." value={`${calendario.taxaComparecimento.toFixed(0)}%`} accent="green"
              hint={`${calendario.compareceram}/${calendario.desfecho} com desfecho`} />
          </div>

          {/* Funil do período */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Funil do Período</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Atividade real do mês. Cada métrica tem uma definição independente — não é uma coorte estrita.
            </p>

            <div className="space-y-2">
              <FunnelRow label="Leads que conversaram" hint="Distintos, com mensagem inbound no período" value={leadsQueConversaram.size} color="#6366f1" />
              <FunnelRow label="Agendamentos criados" hint="Ação da equipe — appts criados no período" value={atividadePeriodo.agendamentosCriados} color="#f59e0b" />
              <FunnelRow label="Agendamentos do período" hint="Data marcada para o período (= calendário)" value={calendario.total} color="#3b82f6" />
              <FunnelRow label="Compareceram" hint="Contratados + Não contratados" value={calendario.compareceram} color="#10b981" />
              <FunnelRow label="Contrataram" hint="Status final: contracted" value={calendario.contrataram} color="#059669" />
            </div>

            <div className="mt-6 border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground mb-3 uppercase">Onde estou perdendo</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <StatBox label="Faltas" value={calendario.faltas} color="text-red-500" />
                <StatBox label="Não contrataram" value={calendario.naoContrataram} color="text-orange-500" />
                <StatBox label="Pendentes (sem decisão)" value={calendario.pendentes} color="text-indigo-500" />
              </div>
            </div>
          </Card>

          {/* Atividade Diária */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Atividade Diária</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Por dia: leads que falaram comigo, leads novos, agendamentos <strong>criados</strong> (ação CRC) e agendamentos <strong>marcados</strong> para o dia (espelha o calendário).
            </p>
            {dailyActivity.rows.length === 0 ? (
              <EmptyState icon={Calendar} title="Sem dados no período" />
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                  <StatBox label="Leads conversaram" value={dailyActivity.totals.conversaram} color="text-indigo-600" />
                  <StatBox label="Novos leads" value={dailyActivity.totals.novos} color="text-blue-600" />
                  <StatBox label="Agend. criados" value={dailyActivity.totals.agendamentosCriados} color="text-amber-600" />
                  <StatBox label="Agend. do dia" value={dailyActivity.totals.agendamentosDoDia} color="text-sky-600" />
                  <StatBox label="Contratos do dia" value={dailyActivity.totals.contratosDoDia} color="text-emerald-600" />
                </div>
                <div className="max-h-[420px] overflow-y-auto border rounded-lg">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow>
                        <TableHead>Dia</TableHead>
                        <TableHead className="text-right">Conversaram</TableHead>
                        <TableHead className="text-right">Novos</TableHead>
                        <TableHead className="text-right">Agend. criados</TableHead>
                        <TableHead className="text-right">Agend. do dia</TableHead>
                        <TableHead className="text-right">Contratos</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dailyActivity.rows.map(r => (
                        <TableRow key={r.day}>
                          <TableCell className="font-medium">
                            {format(new Date(r.day + "T12:00:00"), "EEE, dd/MM", { locale: ptBR })}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{r.conversaram}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{r.novos}</TableCell>
                          <TableCell className="text-right tabular-nums text-amber-600 font-semibold">{r.agendamentosCriados}</TableCell>
                          <TableCell className="text-right tabular-nums text-sky-600 font-semibold">{r.agendamentosDoDia}</TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-600 font-semibold">{r.contratosDoDia}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </Card>

          {/* Resultado dos Agendados (espelho do calendário) */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Resultado dos Agendados</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Quebra dos <strong>{calendario.total}</strong> agendamentos com data no período. Cada agendamento conta uma vez (mesmo lead com 2 agendamentos = 2).
            </p>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <StatBox label="Agendamentos" value={calendario.total} />
              <StatBox label="Compareceram" value={calendario.compareceram} color="text-green-600" />
              <StatBox label="Contrataram" value={calendario.contrataram} color="text-emerald-600" />
              <StatBox label="Não contrataram" value={calendario.naoContrataram} color="text-orange-500" />
              <StatBox label="Faltas" value={calendario.faltas} color="text-red-500" />
              <StatBox label="Pendentes" value={calendario.pendentes} color="text-muted-foreground" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              <StatBox label="Taxa de comparecimento" value={`${calendario.taxaComparecimento.toFixed(0)}%`} color="text-primary"
                hint={`${calendario.compareceram} de ${calendario.desfecho} appts com desfecho`} />
              <StatBox label="Taxa de contratação" value={`${calendario.taxaContratacao.toFixed(0)}%`} color="text-emerald-600"
                hint={`${calendario.contrataram} contratos / ${calendario.compareceram} comparecimentos`} />
            </div>
          </Card>




          {/* Tempos */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold">Tempo até Contratação</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-4">Da entrada do lead até o agendamento contratado no período.</p>
              {tempoContratacao.count > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  <StatBox label="Média" value={fmtDuration(tempoContratacao.media)} />
                  <StatBox label="Mediana" value={fmtDuration(tempoContratacao.mediana)} />
                  <StatBox label="Mais rápido" value={fmtDuration(tempoContratacao.min)} color="text-green-600" />
                  <StatBox label="Mais lento" value={fmtDuration(tempoContratacao.max)} color="text-orange-500" />
                  <div className="col-span-2 text-xs text-muted-foreground text-center pt-2">
                    Baseado em {tempoContratacao.count} lead(s) contratado(s) no período
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhum lead contratado no período.</p>
              )}
            </Card>

            <Card className="p-6">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold">Tempo até Agendamento</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-4">Da entrada do lead até a criação do primeiro agendamento.</p>
              {tempoAgendamento.count > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  <StatBox label="Média" value={fmtDuration(tempoAgendamento.media)} />
                  <StatBox label="Mediana" value={fmtDuration(tempoAgendamento.mediana)} />
                  <div className="col-span-2 text-xs text-muted-foreground text-center pt-2">
                    Baseado em {tempoAgendamento.count} lead(s) agendado(s) no período
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhum agendamento no período.</p>
              )}
            </Card>
          </div>

          {/* Cidade */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <MapPin className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Por Cidade</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">Agendamentos do período por cidade (1 linha por agendamento).</p>
            {porCidade.length === 0 ? (
              <EmptyState icon={MapPin} title="Sem agendamentos no período" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead label="Cidade" sortKey="cidade" current={citySort} onClick={toggleCitySort} />
                    <SortableHead label="Agendamentos" sortKey="agendamentos" current={citySort} onClick={toggleCitySort} align="right" />
                    <SortableHead label="Compareceram" sortKey="comparecimentos" current={citySort} onClick={toggleCitySort} align="right" />
                    <SortableHead label="Contrataram" sortKey="contratacoes" current={citySort} onClick={toggleCitySort} align="right" />
                    <SortableHead label="Faltas" sortKey="faltas" current={citySort} onClick={toggleCitySort} align="right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porCidadeSorted.map(r => (
                    <TableRow key={r.cidade}>
                      <TableCell className="font-medium">{r.cidade}</TableCell>
                      <TableCell className="text-right">{r.agendamentos}</TableCell>
                      <TableCell className="text-right text-green-600 font-semibold">{r.comparecimentos}</TableCell>
                      <TableCell className="text-right text-emerald-600 font-semibold">{r.contratacoes}</TableCell>
                      <TableCell className="text-right text-red-500 font-semibold">{r.faltas}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold border-t-2">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">{porCidade.reduce((s, r) => s + r.agendamentos, 0)}</TableCell>
                    <TableCell className="text-right">{porCidade.reduce((s, r) => s + r.comparecimentos, 0)}</TableCell>
                    <TableCell className="text-right">{porCidade.reduce((s, r) => s + r.contratacoes, 0)}</TableCell>
                    <TableCell className="text-right">{porCidade.reduce((s, r) => s + r.faltas, 0)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </Card>

          {/* Inativos */}
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

          {/* Resposta */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Tempo Médio de Resposta</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">Pares consecutivos de mensagens no período (ignora intervalos &gt; 7d).</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <StatBox label={`Resposta do Lead (${tempoResposta.nLead} amostras)`} value={fmtDuration(tempoResposta.lead)} color="text-blue-500" />
              <StatBox label={`Resposta do Atendente (${tempoResposta.nCRC} amostras)`} value={fmtDuration(tempoResposta.crc)} color="text-primary" />
            </div>
          </Card>

          {/* Fantasmas */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <Ghost className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Leads Fantasmas</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">Leads que mandaram a primeira mensagem e nunca mais responderam.</p>
            <div className="flex flex-col md:flex-row items-start md:items-end gap-6">
              <div>
                <p className="text-5xl font-bold text-primary">{fantasmas.length}</p>
                <p className="text-xs text-muted-foreground mt-1">de {cohort.length} novos leads ({cohort.length ? ((fantasmas.length / cohort.length) * 100).toFixed(0) : 0}%)</p>
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
              Diferença em dias entre a <strong>criação do agendamento</strong> e a <strong>data marcada</strong>.
              Considera os {calendario.total} agendamentos do período (1 linha por agendamento).
            </p>

            {distribAgendamento.total === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum agendamento no período.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                  <StatBox label="Mesmo dia" value={distribAgendamento.buckets.mesmoDia} color="text-green-600" />
                  <StatBox label="Próximo dia" value={distribAgendamento.buckets.proximoDia} color="text-emerald-500" />
                  <StatBox label="2 a 6 dias" value={distribAgendamento.buckets.restanteSemana} color="text-blue-500" />
                  <StatBox label="7 a 13 dias" value={distribAgendamento.buckets.semanaSeguinte} color="text-orange-500" />
                  <StatBox label="14+ dias" value={distribAgendamento.buckets.maisLonge} color="text-red-500" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                  <StatBox label="Total de agendamentos" value={distribAgendamento.total} />
                  <StatBox label="Média de dias" value={distribAgendamento.mediaDias.toFixed(1)} color="text-primary" />
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

// ============================================================================
// Componentes auxiliares
// ============================================================================

function FunnelRow({ label, hint, value, color }: { label: string; hint?: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg" style={{ background: `${color}15`, borderLeft: `4px solid ${color}` }}>
      <div className="flex-1 min-w-0">
        <div className="font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}

function StatBox({ label, value, color = "text-foreground", hover = false, hint }: { label: string; value: string | number; color?: string; hover?: boolean; hint?: string }) {
  return (
    <div className={`bg-secondary/40 rounded-lg p-4 text-center ${hover ? "hover:bg-secondary/70 transition cursor-pointer" : ""}`}>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
      {hint && <p className="text-[10px] text-muted-foreground/80 mt-1">{hint}</p>}
    </div>
  );
}

// ============================================================================
// Aba: Ações por Dia (preservada)
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
  pipelineId, pipelines, setPipelineId,
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

  const [inboundDays, setInboundDays] = useState<{ lead_id: string; created_at: string }[]>([]);
  // Substituímos stage history por appointments (= calendário) para "agendados"
  const [apptsMonth, setApptsMonth] = useState<{ lead_id: string; created_at: string; scheduled_date: string; is_rescheduled: boolean | null }[]>([]);

  useEffect(() => {
    if (!pipelineId) return;
    supabase.from("crm_stages").select("id, name, color, position").eq("pipeline_id", pipelineId).order("position")
      .then(({ data }) => setStages((data || []) as AcoesStage[]));
  }, [pipelineId]);

  useEffect(() => {
    if (!pipelineId) return;
    setLoading(true);
    const startISO = monthStart.toISOString();
    const endISO = monthEnd.toISOString();
    const startDate = localDateOnly(monthStart);
    const endDate = localDateOnly(monthEnd);

    (async () => {
      // Mensagens inbound do mês (filtra pipeline via join)
      let msgsAll: any[] = [];
      let mFrom = 0;
      while (true) {
        const { data, error } = await supabase
          .from("messages")
          .select("lead_id, created_at, crm_leads!inner(pipeline_id)")
          .eq("direction", "inbound")
          .eq("crm_leads.pipeline_id", pipelineId)
          .gte("created_at", startISO)
          .lte("created_at", endISO)
          .order("created_at")
          .range(mFrom, mFrom + 999);
        if (error || !data || data.length === 0) break;
        msgsAll = msgsAll.concat(data);
        if (data.length < 1000) break;
        mFrom += 1000;
      }

      // Appointments criados no mês — TODOS, sem filtro de pipeline
      // (leads mudam de funil e suas ações não podem sumir do relatório)
      const apptsCreated = await fetchAllPages<any>((f, t) =>
        supabase
          .from("crm_appointments")
          .select("lead_id, created_at, scheduled_date, is_rescheduled")
          .gte("created_at", startISO)
          .lte("created_at", endISO)
          .range(f, t)
      );

      setInboundDays(msgsAll);
      setApptsMonth(apptsCreated);
      setLoading(false);
    })();
  }, [pipelineId, monthStart, monthEnd]);

  const selectedKey = dayKeyFromDate(selectedDate);

  const falaramDia = useMemo(() => {
    const set = new Set<string>();
    inboundDays.forEach(m => {
      if (dayKeyFromDate(new Date(m.created_at)) === selectedKey) set.add(m.lead_id);
    });
    return set;
  }, [inboundDays, selectedKey]);

  // Agendamentos criados no dia (não reagendados)
  const agendadosDia = useMemo(() => {
    return apptsMonth.filter(a =>
      dayKeyFromDate(new Date(a.created_at)) === selectedKey && a.is_rescheduled !== true
    ).length;
  }, [apptsMonth, selectedKey]);

  // Reagendamentos criados no dia
  const reagendadosDia = useMemo(() => {
    return apptsMonth.filter(a =>
      dayKeyFromDate(new Date(a.created_at)) === selectedKey && a.is_rescheduled === true
    ).length;
  }, [apptsMonth, selectedKey]);

  // Dos que falaram, quantos agendaram (interseção por lead_id)
  const agendadosDosQueFalaram = useMemo(() => {
    const leadsAgendDia = new Set(
      apptsMonth
        .filter(a => dayKeyFromDate(new Date(a.created_at)) === selectedKey && a.is_rescheduled !== true)
        .map(a => a.lead_id)
    );
    let cnt = 0;
    falaramDia.forEach(id => { if (leadsAgendDia.has(id)) cnt++; });
    return cnt;
  }, [apptsMonth, falaramDia, selectedKey]);

  const mediasMes = useMemo(() => {
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const endRef = monthEnd.getTime() < today.getTime() ? monthEnd : today;
    const workingDays: string[] = [];
    const cur = new Date(monthStart);
    while (cur.getTime() <= endRef.getTime()) {
      if (isWorkingDay(cur)) workingDays.push(dayKeyFromDate(cur));
      cur.setDate(cur.getDate() + 1);
    }
    if (workingDays.length === 0) {
      return { avgFalaram: 0, avgAgendados: 0, avgReagendados: 0, totalDias: 0 };
    }
    const workingSet = new Set(workingDays);

    const falaramByDay = new Map<string, Set<string>>();
    inboundDays.forEach(m => {
      const k = dayKeyFromDate(new Date(m.created_at));
      if (!workingSet.has(k)) return;
      if (!falaramByDay.has(k)) falaramByDay.set(k, new Set());
      falaramByDay.get(k)!.add(m.lead_id);
    });
    let falaramTotal = 0;
    falaramByDay.forEach(s => { falaramTotal += s.size; });

    let agendTotal = 0, reagTotal = 0;
    apptsMonth.forEach(a => {
      const k = dayKeyFromDate(new Date(a.created_at));
      if (!workingSet.has(k)) return;
      if (a.is_rescheduled === true) reagTotal++;
      else agendTotal++;
    });

    return {
      avgFalaram: falaramTotal / workingDays.length,
      avgAgendados: agendTotal / workingDays.length,
      avgReagendados: reagTotal / workingDays.length,
      totalDias: workingDays.length,
    };
  }, [apptsMonth, inboundDays, monthStart, monthEnd]);

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
          <h2 className="text-lg font-semibold">Ações de {format(selectedDate, "dd/MM/yyyy", { locale: ptBR })}</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Pessoas que falaram, agendamentos criados e reagendamentos criados <strong>neste dia</strong>.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="rounded-lg border border-border p-4 flex flex-col gap-2" style={{ borderLeftWidth: 4, borderLeftColor: "#3b82f6" }}>
            <span className="text-sm text-muted-foreground">Pessoas que falaram comigo</span>
            <span className="text-4xl font-bold text-primary">{falaramDia.size}</span>
            <span className="text-xs text-muted-foreground">Leads distintos com mensagem inbound no dia</span>
          </div>
          <div className="rounded-lg border border-border p-4 flex flex-col gap-2" style={{ borderLeftWidth: 4, borderLeftColor: "#10b981" }}>
            <span className="text-sm text-muted-foreground">Agendamentos criados</span>
            <span className="text-4xl font-bold text-green-600">{agendadosDia}</span>
            <span className="text-xs text-muted-foreground">Novos agendamentos (não reagendados) criados no dia</span>
          </div>
          <div className="rounded-lg border border-border p-4 flex flex-col gap-2" style={{ borderLeftWidth: 4, borderLeftColor: "#f59e0b" }}>
            <span className="text-sm text-muted-foreground">Reagendamentos</span>
            <span className="text-4xl font-bold text-amber-600">{reagendadosDia}</span>
            <span className="text-xs text-muted-foreground">Appts marcados como reagendados no dia</span>
          </div>
        </div>

        {agendadosDosQueFalaram > 0 && falaramDia.size > 0 && (
          <div className="rounded-lg bg-secondary/40 p-4 text-center">
            <span className="text-sm text-muted-foreground">Taxa de conversão (falaram → agendados)</span>
            <p className="text-3xl font-bold text-primary mt-1">{((agendadosDosQueFalaram / falaramDia.size) * 100).toFixed(1)}%</p>
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Média Diária — {format(monthStart, "MMMM/yyyy", { locale: ptBR })}</h2>
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

// ============================================================================
// Componentes UI auxiliares
// ============================================================================

const ACCENTS: Record<string, { icon: string; ring: string; value: string }> = {
  blue:    { icon: "text-blue-500 bg-blue-500/10",       ring: "border-blue-500/30",    value: "text-blue-600" },
  indigo:  { icon: "text-indigo-500 bg-indigo-500/10",   ring: "border-indigo-500/30",  value: "text-indigo-600" },
  green:   { icon: "text-green-600 bg-green-600/10",     ring: "border-green-600/30",   value: "text-green-600" },
  emerald: { icon: "text-emerald-600 bg-emerald-600/10", ring: "border-emerald-600/30", value: "text-emerald-600" },
  red:     { icon: "text-red-500 bg-red-500/10",         ring: "border-red-500/30",     value: "text-red-500" },
  amber:   { icon: "text-amber-500 bg-amber-500/10",     ring: "border-amber-500/30",   value: "text-amber-600" },
};

function KpiCard({
  icon: Icon, label, value, accent = "blue", hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  accent?: keyof typeof ACCENTS;
  hint?: string;
}) {
  const a = ACCENTS[accent] ?? ACCENTS.blue;
  return (
    <Card className={cn("p-4 border-l-4", a.ring)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase truncate">{label}</p>
          <p className={cn("text-3xl font-bold mt-1 tabular-nums", a.value)}>{value}</p>
          {hint && <p className="text-xs text-muted-foreground mt-1 truncate">{hint}</p>}
        </div>
        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", a.icon)}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </Card>
  );
}

function EmptyState({
  icon: Icon, title, description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
        <Icon className="w-6 h-6 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="text-xs text-muted-foreground mt-1 max-w-sm">{description}</p>}
    </div>
  );
}

function SortableHead({
  label, sortKey, current, onClick, align = "left",
}: {
  label: string;
  sortKey: string;
  current: { key: string; dir: "asc" | "desc" };
  onClick: (k: any) => void;
  align?: "left" | "right";
}) {
  const active = current.key === sortKey;
  const Icon = !active ? ArrowUpDown : current.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground transition-colors",
          align === "right" && "ml-auto",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
        <Icon className="w-3 h-3" />
      </button>
    </TableHead>
  );
}

function CrmRelatoriosSkeleton() {
  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-14 w-full" />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-80 w-full" />
      <Skeleton className="h-80 w-full" />
      <Skeleton className="h-60 w-full" />
    </div>
  );
}
