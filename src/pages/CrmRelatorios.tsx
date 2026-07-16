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
import FunilTab from "@/components/relatorios/FunilTab";
import CrmMetricas from "@/pages/CrmMetricas";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Calendar, Clock, MapPin, Bell, MessageSquare, Ghost, TrendingUp, CalendarIcon, Activity, CheckCircle2, XCircle, Target, ArrowDown, ArrowUpDown, ArrowUp, AlertTriangle, Wallet } from "lucide-react";
import {
  fetchAllPaged,
  dayKeyBahia,
  rangeBahia,
  asDateParam,
  normalizeCidade,
  rptKpisAgendamentos,
  rptContratados,
  rptLeadsInativos,
  type KpisAgendamentos,
  type ContratadoRow,
  type LeadsInativos,
} from "@/lib/reportKit";

// ============================================================================
// REGRA DE OURO (toda a aba segue esta regra):
//
//  - "Agendamentos no período" = COUNT(crm_appointments) com scheduled_date
//    dentro do período, contados INDIVIDUALMENTE (não por lead). Bate 1:1
//    com o que o calendário exibe.
//  - Os KPIs oficiais vêm da RPC rpt_kpis_agendamentos (SECURITY DEFINER):
//    buckets exaustivos e disjuntos (contracted, not_contracted, no_show,
//    rescheduled, cancelled e pending = catch-all) — o total fecha sem resíduo
//    e é O MESMO para qualquer usuário do tenant (não depende de RLS).
//  - Compareceram = contracted + not_contracted + rescheduled
//    ('rescheduled' = compareceu e saiu com novo agendamento).
//  - Contratados de verdade = pacientes com 1º pagamento no período
//    (RPC rpt_contratados, tabela pagamentos) — mostrado lado a lado com os
//    contratos marcados na consulta, com rótulos honestos.
//
//  Separadamente, métricas de ATIVIDADE DA EQUIPE usam created_at:
//  - "Agendamentos criados no dia" = COUNT(appts) WHERE created_at = dia
//  - "Novos leads no dia"          = COUNT(leads) WHERE created_at = dia
//  - "Leads que conversaram"       = DISTINCT lead_id com inbound no dia
//  Dias sempre calculados em America/Bahia (dayKeyBahia).
// ============================================================================

// ---------- Tipos ----------
type Pipeline = { id: string; name: string };
type Lead = {
  id: string; name: string; pipeline_id: string; stage_id: string; cidade: string | null;
  created_at: string; last_inbound_at: string | null; first_inbound_at: string | null;
};
type Appointment = {
  id: string; lead_id: string; created_at: string;
  scheduled_date: string; status: string;
  is_rescheduled?: boolean | null;
  lead_cidade?: string | null;
};
type MessageActivityDay = { dia: string; conversaram: number };
type ResponseTimes = { leadMs: number; crcMs: number; nLead: number; nCrc: number };

// ---------- Helpers ----------
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

// Duração em dias corridos (aceita 0 = fechou no mesmo dia).
function fmtDias(d: number): string {
  if (!isFinite(d) || d < 0) return "—";
  if (d < 0.5) return "mesmo dia";
  const v = Number.isInteger(d) ? String(d) : d.toFixed(1).replace(".", ",");
  return `${v} ${d >= 1 && d < 2 ? "dia" : "dias"}`;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function asNumber(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Estado de cada RPC canônica: nunca vira zero silencioso — ou carrega,
// ou mostra o dado, ou mostra o erro.
type RpcState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: T };

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

// Dia-calendário "YYYY-MM-DD" de uma Date local (date-pickers). Para converter
// timestamptz ISO em dia local, use dayKeyBahia (America/Bahia) da reportKit.
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
  const [leads, setLeads] = useState<Lead[]>([]);                    // leads relevantes (coorte + atividade)
  const [apptsPeriodo, setApptsPeriodo] = useState<Appointment[]>([]); // appts com scheduled_date no período (= calendário)
  const [apptsCriadosPeriodo, setApptsCriadosPeriodo] = useState<Appointment[]>([]); // appts criados no período (atividade)
  const [messageActivity, setMessageActivity] = useState<MessageActivityDay[]>([]);
  const [messagePeriodCount, setMessagePeriodCount] = useState(0);
  const [responseTimes, setResponseTimes] = useState<ResponseTimes>({ leadMs: 0, crcMs: 0, nLead: 0, nCrc: 0 });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // RPCs canônicas (SECURITY DEFINER — mesmo número para qualquer usuário do tenant)
  const [kpisState, setKpisState] = useState<RpcState<KpisAgendamentos>>({ status: "loading" });
  const [contratadosState, setContratadosState] = useState<RpcState<ContratadoRow[]>>({ status: "loading" });
  const [inativosState, setInativosState] = useState<RpcState<LeadsInativos>>({ status: "loading" });

  // Carregar pipelines (mantido para a aba "Origem & Conversão")
  useEffect(() => {
    supabase.from("crm_pipelines").select("id, name").order("created_at").then(({ data }) => {
      const list = (data || []) as Pipeline[];
      setPipelines(list);
      // Abre em "Todos os funis" por padrão (bate com a Visão Geral, que conta
      // todos os pipelines). O seletor da aba permite filtrar um funil específico.
      if (list.length) {
        setPipelineId(prev => prev || "todos");
      }
    });
  }, []);

  const range = useMemo(() => getDateRangeFromFilter(period), [period]);

  // Fronteiras do período em America/Bahia (períodos inclusivos: último dia inteiro)
  const bahiaBounds = useMemo(() => (range ? rangeBahia(range.start, range.end) : null), [range]);

  // Carregar dados quando o período muda — SEM filtro de funil (todos os pipelines)
  useEffect(() => {
    if (!range || !bahiaBounds) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);

    const startISO = bahiaBounds.gteIso;
    const endISO = bahiaBounds.lteIso;
    const startDate = asDateParam(range.start);
    const endDate = asDateParam(range.end);

    (async () => {
      try {
        // Rodamos as consultas base em PARALELO — antes eram sequenciais,
        // e com ~12k mensagens/mês a página levava 20s+ só esperando fila
        // (o usuário reportava a aba como "não carregando").
        const [
          apptsByScheduled,
          apptsByCreated,
          cohortLeads,
          activityInbound,
          messageActivityRes,
          messagePeriodCountRes,
          responseTimesRes,
        ] = await Promise.all([
          fetchAllPaged<Appointment>(() =>
            supabase
              .from("crm_appointments")
              .select("id, lead_id, created_at, scheduled_date, status, is_rescheduled, lead_cidade")
              .gte("scheduled_date", startDate)
              .lte("scheduled_date", endDate),
            "id"
          ),
          fetchAllPaged<Appointment>(() =>
            supabase
              .from("crm_appointments")
              .select("id, lead_id, created_at, scheduled_date, status, is_rescheduled, lead_cidade")
              .gte("created_at", startISO)
              .lte("created_at", endISO),
            "id"
          ),
          fetchAllPaged<Lead>(() =>
            supabase
              .from("crm_leads")
              .select("id, name, pipeline_id, stage_id, cidade, created_at, last_inbound_at, first_inbound_at")
              .gte("created_at", startISO)
              .lte("created_at", endISO),
            "id"
          ),
          fetchAllPaged<Lead>(() =>
            supabase
              .from("crm_leads")
              .select("id, name, pipeline_id, stage_id, cidade, created_at, last_inbound_at, first_inbound_at")
              .gte("last_inbound_at", startISO)
              .lte("last_inbound_at", endISO),
            "id"
          ),
          (supabase.rpc as any)("rpt_crm_message_activity", { p_from: startISO, p_to: endISO }),
          (supabase.rpc as any)("rpt_crm_message_period_count", { p_from: startISO, p_to: endISO }),
          (supabase.rpc as any)("rpt_crm_response_times", { p_from: startISO, p_to: endISO }),
        ]);

        if (messageActivityRes.error) throw new Error(`rpt_crm_message_activity: ${messageActivityRes.error.message}`);
        if (messagePeriodCountRes.error) throw new Error(`rpt_crm_message_period_count: ${messagePeriodCountRes.error.message}`);
        if (responseTimesRes.error) throw new Error(`rpt_crm_response_times: ${responseTimesRes.error.message}`);

        const activityRows = ((messageActivityRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
          dia: String(r.dia),
          conversaram: asNumber(r.conversaram),
        }));
        const responseRow = ((responseTimesRes.data ?? []) as Record<string, unknown>[])[0] ?? {};

        // Leads envolvidos em qualquer agendamento do período — só dá pra
        // consultar depois que os dois lotes de appointments retornaram.
        const leadIdsFromAppts = new Set<string>();
        apptsByScheduled.forEach(a => leadIdsFromAppts.add(a.lead_id));
        apptsByCreated.forEach(a => leadIdsFromAppts.add(a.lead_id));

        // Sem filtro de pipeline: leads mudam de funil e não podem sumir
        // do relatório (Calendário = verdade). Chunks em paralelo.
        const apptIds = Array.from(leadIdsFromAppts);
        const chunks: string[][] = [];
        for (let i = 0; i < apptIds.length; i += 300) chunks.push(apptIds.slice(i, i + 300));
        const activityByApptGroups = await Promise.all(
          chunks.map(chunk =>
            fetchAllPaged<Lead>(() =>
              supabase
                .from("crm_leads")
                .select("id, name, pipeline_id, stage_id, cidade, created_at, last_inbound_at, first_inbound_at")
                .in("id", chunk),
              "id"
            )
          )
        );
        const activityByAppt = activityByApptGroups.flat();

        const mergedLeads = new Map<string, Lead>();
        [...cohortLeads, ...activityInbound, ...activityByAppt].forEach(l => mergedLeads.set(l.id, l));
        const leadsAll = Array.from(mergedLeads.values());

        if (!alive) return;
        // NÃO filtramos appts por pipeline: o calendário mostra todos os
        // agendamentos do período, independente do funil atual do lead.
        setLeads(leadsAll);
        setApptsPeriodo(apptsByScheduled);
        setApptsCriadosPeriodo(apptsByCreated);
        setMessageActivity(activityRows);
        setMessagePeriodCount(asNumber(messagePeriodCountRes.data));
        setResponseTimes({
          leadMs: asNumber(responseRow.lead_ms),
          crcMs: asNumber(responseRow.crc_ms),
          nLead: asNumber(responseRow.n_lead),
          nCrc: asNumber(responseRow.n_crc),
        });
      } catch (e: any) {
        if (!alive) return;
        setLoadError(e?.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [range, bahiaBounds, reloadKey]);

  // RPCs canônicas (SECURITY DEFINER): KPIs de agendamento, contratados por
  // 1º pagamento e estoque de leads inativos. Cada uma com estado próprio de
  // carregamento/erro — se a RPC ainda não existir no banco, o painel mostra
  // o erro em vez de um zero enganoso.
  useEffect(() => {
    if (!range) return;
    let alive = true;
    const from = asDateParam(range.start);
    const to = asDateParam(range.end);

    setKpisState({ status: "loading" });
    setContratadosState({ status: "loading" });
    setInativosState({ status: "loading" });

    rptKpisAgendamentos(from, to)
      .then(data => { if (alive) setKpisState({ status: "ok", data }); })
      .catch(e => { if (alive) setKpisState({ status: "error", message: e?.message || String(e) }); });
    rptContratados(from, to)
      .then(data => { if (alive) setContratadosState({ status: "ok", data }); })
      .catch(e => { if (alive) setContratadosState({ status: "error", message: e?.message || String(e) }); });
    rptLeadsInativos()
      .then(data => { if (alive) setInativosState({ status: "ok", data }); })
      .catch(e => { if (alive) setInativosState({ status: "error", message: e?.message || String(e) }); });

    return () => { alive = false; };
  }, [range, reloadKey]);

  const inRange = (iso: string | null | undefined): boolean => {
    if (!iso || !bahiaBounds) return false;
    const d = new Date(iso).getTime();
    return d >= Date.parse(bahiaBounds.gteIso) && d <= Date.parse(bahiaBounds.lteIso);
  };

  // Coorte: leads criados no período (todos os pipelines)
  const cohort = useMemo(
    () => leads.filter(l => inRange(l.created_at)),
    [leads, range]
  );
  // ============= MÉTRICAS DO CALENDÁRIO (regra de ouro) =============
  // Tudo contado por APPOINTMENT, não por lead. Buckets EXAUSTIVOS e
  // DISJUNTOS (mesma regra da RPC rpt_kpis_agendamentos): os 5 status
  // nomeados + "pendentes" como catch-all — o total fecha sem resíduo.
  const calendario = useMemo(() => {
    const total = apptsPeriodo.length;
    const contrataram = apptsPeriodo.filter(a => a.status === "contracted").length;
    const naoContrataram = apptsPeriodo.filter(a => a.status === "not_contracted").length;
    const faltas = apptsPeriodo.filter(a => a.status === "no_show").length;
    const reagendaram = apptsPeriodo.filter(a => a.status === "rescheduled").length;
    const cancelados = apptsPeriodo.filter(a => a.status === "cancelled").length;
    // Catch-all: 'confirmed' (estado inicial do app) e qualquer status desconhecido.
    const NOMEADOS = new Set(["contracted", "not_contracted", "no_show", "rescheduled", "cancelled"]);
    const pendentes = apptsPeriodo.filter(a => !NOMEADOS.has(a.status)).length;
    // 'rescheduled' = compareceu e saiu com novo agendamento → conta como comparecimento.
    const compareceram = contrataram + naoContrataram + reagendaram;
    const desfecho = compareceram + faltas; // appts com decisão (excluindo pendentes/cancelados)
    return {
      total, contrataram, naoContrataram, faltas, reagendaram, pendentes, cancelados,
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

  // Conversaram: leads distintos com mensagem inbound no período (agregado no backend)
  const leadsQueConversaram = messagePeriodCount;

  // ============= ATIVIDADE DIÁRIA =============
  const dailyActivity = useMemo(() => {
    if (!range) return { rows: [] as any[], totals: { conversaram: 0, novos: 0, agendamentosCriados: 0, agendamentosDoDia: 0, contratosDoDia: 0 } };

    // O array de dias cobre o período INTEIRO (inclusive dias futuros).
    // Obs.: este painel consulta via client (sob RLS) — o total de "Agend. do
    // dia" pode ficar ABAIXO do KPI canônico (RPC SECURITY DEFINER) para
    // usuários cujo papel não enxerga todos os funis.
    const days: string[] = [];
    const cur = new Date(range.start); cur.setHours(0, 0, 0, 0);
    const end = new Date(range.end);
    while (cur.getTime() <= end.getTime()) {
      days.push(dayKeyFromDate(cur));
      cur.setDate(cur.getDate() + 1);
    }

    const conversaramByDay = new Map<string, number>();
    const novosByDay = new Map<string, number>();
    const agendCriadosByDay = new Map<string, number>(); // criados no dia (ação CRC)
    const agendDoDiaByDay = new Map<string, number>();   // com data marcada para o dia
    const contratosDoDiaByDay = new Map<string, number>(); // contratados no dia (marcados)

    messageActivity.forEach((r) => {
      conversaramByDay.set(r.dia, r.conversaram);
    });
    cohort.forEach(l => {
      const k = dayKeyBahia(l.created_at);
      novosByDay.set(k, (novosByDay.get(k) || 0) + 1);
    });
    apptsCriadosPeriodo.forEach(a => {
      const k = dayKeyBahia(a.created_at);
      agendCriadosByDay.set(k, (agendCriadosByDay.get(k) || 0) + 1);
    });
    apptsPeriodo.forEach(a => {
      const k = a.scheduled_date; // já YYYY-MM-DD
      agendDoDiaByDay.set(k, (agendDoDiaByDay.get(k) || 0) + 1);
      if (a.status === "contracted") {
        contratosDoDiaByDay.set(k, (contratosDoDiaByDay.get(k) || 0) + 1);
      }
    });

    const rows = days.map(k => ({
      day: k,
      conversaram: conversaramByDay.get(k) || 0,
      novos: novosByDay.get(k) || 0,
      agendamentosCriados: agendCriadosByDay.get(k) || 0,
      agendamentosDoDia: agendDoDiaByDay.get(k) || 0,
      contratosDoDia: contratosDoDiaByDay.get(k) || 0,
    }));

    const totals = rows.reduce((acc, r) => ({
      conversaram: acc.conversaram + r.conversaram,
      novos: acc.novos + r.novos,
      agendamentosCriados: acc.agendamentosCriados + r.agendamentosCriados,
      agendamentosDoDia: acc.agendamentosDoDia + r.agendamentosDoDia,
      contratosDoDia: acc.contratosDoDia + r.contratosDoDia,
    }), { conversaram: 0, novos: 0, agendamentosCriados: 0, agendamentosDoDia: 0, contratosDoDia: 0 });

    return { rows, totals };
  }, [range, messageActivity, cohort, apptsCriadosPeriodo, apptsPeriodo]);

  // ============= TEMPO ATÉ CONTRATAÇÃO (coorte) =============
  // Em DIAS CORRIDOS, comparando dia local (America/Bahia) da entrada do lead
  // com a data marcada da consulta contratada. Aceita dur = 0 (fechou no mesmo
  // dia) — parse de 'YYYY-MM-DD' como UTC derrubava esses casos.
  const tempoContratacao = useMemo(() => {
    const contratIds = new Set<string>();
    apptsPeriodo.forEach(a => { if (a.status === "contracted") contratIds.add(a.lead_id); });

    const durations: number[] = []; // em dias
    cohort.forEach(l => {
      if (!contratIds.has(l.id)) return;
      // Pega o primeiro appointment contratado deste lead
      const aps = apptsPeriodo.filter(a => a.lead_id === l.id && a.status === "contracted");
      const firstDay = aps.map(a => a.scheduled_date).sort()[0];
      if (!firstDay) return;
      const createdDay = dayKeyBahia(l.created_at);
      // Ambos 'YYYY-MM-DD' → diferença exata em dias via UTC.
      const dur = (Date.parse(firstDay) - Date.parse(createdDay)) / 86400000;
      if (Number.isFinite(dur) && dur >= 0) durations.push(dur);
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

  // ============= POR CIDADE =============
  const porCidade = useMemo(() => {
    const map = new Map<string, { agendamentos: number; comparecimentos: number; contratacoes: number; faltas: number }>();
    const ensure = (c: string) => {
      if (!map.has(c)) map.set(c, { agendamentos: 0, comparecimentos: 0, contratacoes: 0, faltas: 0 });
      return map.get(c)!;
    };
    // normalizeCidade unifica grafias ('VCA' → 'Vitória da Conquista') e
    // null/vazio → 'Sem cidade' (linha visível, não descartada).
    const cidadeByLead = new Map(leads.map(l => [l.id, normalizeCidade(l.cidade)]));

    apptsPeriodo.forEach(a => {
      const direta = normalizeCidade(a.lead_cidade ?? null);
      const c = direta !== "Sem cidade" ? direta : (cidadeByLead.get(a.lead_id) || "Sem cidade");
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
  // Estoque da BASE INTEIRA via RPC rpt_leads_inativos (não depende do período
  // selecionado). O memo antigo iterava só os leads carregados do período e
  // mostrava 4/0/0 quando havia ~3.500 leads parados há 30+ dias.

  // ============= TEMPO DE RESPOSTA =============
  const tempoResposta = useMemo(() => {
    return { lead: responseTimes.leadMs, crc: responseTimes.crcMs, nLead: responseTimes.nLead, nCRC: responseTimes.nCrc };
  }, [responseTimes]);

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
          <TabsTrigger value="funil">Funil</TabsTrigger>
          <TabsTrigger value="acoes-dia">Ações por Dia</TabsTrigger>
          <TabsTrigger value="metricas-uso">Métricas de Uso</TabsTrigger>
        </TabsList>

        <TabsContent value="origem-conversao" className="mt-4">
          <OrigemConversaoTab pipelineId={pipelineId} pipelines={pipelines} setPipelineId={setPipelineId} />
        </TabsContent>

        <TabsContent value="funil" className="mt-4">
          <FunilTab pipelines={pipelines} pipelineId={pipelineId} />
        </TabsContent>

        <TabsContent value="metricas-uso" className="mt-4">
          <CrmMetricas />
        </TabsContent>

        <TabsContent value="overview" className="space-y-6 mt-4">

          {/* Filtros */}
          <Card className="p-4 sticky top-0 z-20 backdrop-blur bg-card/95 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase">Funil</span>
              <span className="text-sm font-medium px-3 py-1 rounded bg-muted">Todos os funis</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase">Período</span>
              <DateRangeFilter value={period} onChange={setPeriod} excludePresets={["all", "multi"]} />
            </div>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            <div className="ml-auto text-xs text-muted-foreground">
              {calendario.total} agendamentos · {cohort.length} novos leads
            </div>
          </Card>

          <p className="text-[11px] text-muted-foreground">
            Os KPIs de agendamento, as Contratações e os Leads Inativos vêm do servidor e são iguais para qualquer
            usuário autorizado do tenant. Os demais painéis (Panorama, Atividade Diária, Tempos, Por Cidade,
            Tempo de Resposta e Fantasmas) refletem os funis visíveis ao seu usuário — perfis com permissões
            diferentes podem ver totais diferentes.
          </p>

          {/* Erro de carregamento dos painéis client-side — nunca parcial silencioso */}
          {loadError && (
            <Card className="p-4 border-destructive/50 bg-destructive/5 flex flex-wrap items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
              <div className="flex-1 min-w-[200px]">
                <p className="text-sm font-medium text-destructive">Falha ao carregar os dados do período</p>
                <p className="text-xs text-muted-foreground mt-0.5">{loadError} — os números abaixo podem estar desatualizados.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setReloadKey(k => k + 1)}>Tentar novamente</Button>
            </Card>
          )}

          {/* KPIs do período — RPC canônica (mesmo número para qualquer usuário do tenant) */}
          {kpisState.status === "loading" ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : kpisState.status === "error" ? (
            <RpcErrorCard
              title="KPIs de agendamento indisponíveis"
              message={kpisState.message}
              onRetry={() => setReloadKey(k => k + 1)}
            />
          ) : (() => {
            const k = kpisState.data;
            const compareceram = k.contracted + k.not_contracted + k.rescheduled;
            const desfecho = compareceram + k.no_show;
            const taxaComparecimento = desfecho > 0 ? (compareceram / desfecho) * 100 : 0;
            const taxaContratacao = compareceram > 0 ? (k.contracted / compareceram) * 100 : 0;
            return (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                <KpiCard icon={Calendar} label="Agendamentos" value={k.total} accent="blue"
                  hint="Com data marcada no período (= calendário)" />
                <KpiCard icon={CheckCircle2} label="Compareceram" value={compareceram} accent="green"
                  hint={`${taxaComparecimento.toFixed(0)}% de ${desfecho} com desfecho`} />
                <KpiCard icon={Target} label="Contratos na consulta" value={k.contracted} accent="emerald"
                  hint={`${taxaContratacao.toFixed(0)}% dos que compareceram`} />
                <KpiCard icon={XCircle} label="Não contrataram" value={k.not_contracted} accent="amber" />
                <KpiCard icon={CalendarIcon} label="Reagendaram" value={k.rescheduled} accent="indigo"
                  hint="Compareceram e saíram com novo agendamento" />
                <KpiCard icon={Ghost} label="Faltas" value={k.no_show} accent="red"
                  hint="Status: no_show" />
                <KpiCard icon={Clock} label="Pendentes" value={k.pending} accent="indigo"
                  hint={k.pending_vencidos > 0 ? `⚠ ${k.pending_vencidos} com data já vencida` : "Sem desfecho ainda"} />
                <KpiCard icon={XCircle} label="Cancelados" value={k.cancelled} accent="red"
                  hint="Status: cancelled" />
              </div>
            );
          })()}

          {/* Contratações: desfecho da consulta × caixa (fontes diferentes, lado a lado) */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Contratações do Período</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Duas fontes distintas, lado a lado: o <strong>desfecho marcado na consulta</strong> (status do agendamento)
              e o <strong>caixa</strong> (pacientes cujo primeiro pagamento caiu no período). O número oficial de
              contratados é o do caixa.
            </p>
            {contratadosState.status === "loading" ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
              </div>
            ) : contratadosState.status === "error" ? (
              <RpcErrorCard
                title="Contratados por pagamento indisponíveis"
                message={contratadosState.message}
                onRetry={() => setReloadKey(k => k + 1)}
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <StatBox
                  label="Contratos na consulta"
                  value={kpisState.status === "ok" ? kpisState.data.contracted : "—"}
                  color="text-emerald-600"
                  hint="Agendamentos com status 'contratado' no período (pode ficar desatualizado)"
                />
                <StatBox
                  label="Pacientes com 1º pagamento"
                  value={contratadosState.data.length}
                  color="text-primary"
                  hint="Primeiro pagamento do paciente dentro do período (fonte: caixa)"
                />
                <StatBox
                  label="Recebido desses pacientes"
                  value={brl.format(contratadosState.data.reduce((s, c) => s + c.valor_total_periodo, 0))}
                  color="text-emerald-600"
                  hint="Soma dos pagamentos desses pacientes no período"
                />
              </div>
            )}
          </Card>

          {/* Funil do período */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Panorama do Período</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              <strong>Não é um funil de coorte:</strong> cada linha tem definição própria e as etapas não são
              subconjuntos umas das outras (ex.: um agendamento do período pode ser de lead criado antes dele).
              Leia cada número isoladamente — não calcule "taxas" entre as linhas.
            </p>

            <div className="space-y-2">
              <FunnelRow label="Leads que conversaram" hint="Distintos, com mensagem inbound no período" value={leadsQueConversaram} color="#6366f1" />
              <FunnelRow label="Agendamentos criados" hint="Ação da equipe — appts criados no período" value={atividadePeriodo.agendamentosCriados} color="#f59e0b" />
              <FunnelRow label="Agendamentos do período" hint="Data marcada para o período (= calendário)" value={calendario.total} color="#3b82f6" />
              <FunnelRow label="Compareceram" hint="Contratados + Não contratados + Reagendaram" value={calendario.compareceram} color="#10b981" />
              <FunnelRow label="Contratos na consulta" hint="Status final: contracted" value={calendario.contrataram} color="#059669" />
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
              Inclui os dias futuros do período. Este painel reflete os funis visíveis ao seu usuário — o total de "Agend. do dia" pode diferir do KPI de Agendamentos para perfis com acesso restrito.
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

          {/* Painel "Resultado dos Agendados" removido: duplicava 1:1 os KPIs acima. */}

          {/* Tempos */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold">Tempo até Contratação</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-4">Da entrada do lead até a data da consulta contratada, em dias corridos (inclui fechamentos no mesmo dia).</p>
              {tempoContratacao.count > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  <StatBox label="Média" value={fmtDias(tempoContratacao.media)} />
                  <StatBox label="Mediana" value={fmtDias(tempoContratacao.mediana)} />
                  <StatBox label="Mais rápido" value={fmtDias(tempoContratacao.min)} color="text-green-600" />
                  <StatBox label="Mais lento" value={fmtDias(tempoContratacao.max)} color="text-orange-500" />
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

          {/* Inativos — estoque da base inteira (RPC), independe do período selecionado */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <Bell className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Leads Inativos</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Estoque atual da <strong>base inteira</strong> (não muda com o período selecionado): leads sem responder há X dias.
              <strong> Exclui</strong> Contratados, Agendados e Reagendados. Buckets cumulativos (+30 está contido em +15 e +7).
            </p>
            {inativosState.status === "loading" ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
              </div>
            ) : inativosState.status === "error" ? (
              <RpcErrorCard
                title="Estoque de leads inativos indisponível"
                message={inativosState.message}
                onRetry={() => setReloadKey(k => k + 1)}
              />
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <button onClick={() => navigate("/crm/conversas")} className="text-left">
                    <StatBox label="Sem resposta há +7 dias" value={inativosState.data.mais_7_dias} color="text-yellow-600" hover />
                  </button>
                  <button onClick={() => navigate("/crm/conversas")} className="text-left">
                    <StatBox label="Sem resposta há +15 dias" value={inativosState.data.mais_15_dias} color="text-orange-500" hover />
                  </button>
                  <button onClick={() => navigate("/crm/conversas")} className="text-left">
                    <StatBox label="Sem resposta há +30 dias" value={inativosState.data.mais_30_dias} color="text-red-500" hover />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-3 text-center">
                  Base considerada: {inativosState.data.base_total} lead(s) fora de etapas protegidas
                  (Agendado/Reagendado/Contratado), não bloqueados e com ao menos uma mensagem recebida.
                  "Não contratado" e "Não agendado" contam como inativos.
                </p>
              </>
            )}
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

// Erro de RPC canônica: sempre visível (nunca vira zero silencioso).
function RpcErrorCard({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 flex flex-wrap items-center gap-3">
      <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
      <div className="flex-1 min-w-[200px]">
        <p className="text-sm font-medium text-destructive">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 break-words">{message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>Tentar novamente</Button>
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

// Feriados nacionais fixos (fallback). Os feriados do tenant (ex.: Independência
// da Bahia, São João) vêm da tabela dashboard_holidays e são unidos a estes.
const HOLIDAYS_FIXED: string[] = [
  "01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25",
];
function isWorkingDay(d: Date, holidaySet: Set<string>): boolean {
  if (d.getDay() === 0) return false;
  const md = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (HOLIDAYS_FIXED.includes(md)) return false;
  return !holidaySet.has(dayKeyFromDate(d));
}

function AcoesPorDiaTab({
  pipelineId, pipelines, setPipelineId,
}: {
  pipelineId: string;
  pipelines: { id: string; name: string }[];
  setPipelineId: (id: string) => void;
}) {
  type RangeMode = "day" | "last7" | "last14" | "this_month" | "last_month";
  const [rangeMode, setRangeMode] = useState<RangeMode>("day");
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Intervalo efetivo (dias YYYY-MM-DD locais) e limites de fetch.
  const { fetchStart, fetchEnd, rangeStartKey, rangeEndKey, rangeLabel, isAggregated } = useMemo(() => {
    const today = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    let s: Date, e: Date;
    let label = "";
    let agg = true;
    switch (rangeMode) {
      case "last7": {
        e = endOfDay(today);
        s = startOfDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6));
        label = `Últimos 7 dias (${format(s, "dd/MM", { locale: ptBR })} – ${format(e, "dd/MM/yyyy", { locale: ptBR })})`;
        break;
      }
      case "last14": {
        e = endOfDay(today);
        s = startOfDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 13));
        label = `Últimos 14 dias (${format(s, "dd/MM", { locale: ptBR })} – ${format(e, "dd/MM/yyyy", { locale: ptBR })})`;
        break;
      }
      case "this_month": {
        s = startOfDay(new Date(today.getFullYear(), today.getMonth(), 1));
        e = endOfDay(today);
        label = format(s, "'Este mês —' MMMM/yyyy", { locale: ptBR });
        break;
      }
      case "last_month": {
        s = startOfDay(new Date(today.getFullYear(), today.getMonth() - 1, 1));
        e = endOfDay(new Date(today.getFullYear(), today.getMonth(), 0));
        label = format(s, "'Mês passado —' MMMM/yyyy", { locale: ptBR });
        break;
      }
      case "day":
      default: {
        s = startOfDay(selectedDate);
        e = endOfDay(selectedDate);
        agg = false;
        label = format(selectedDate, "dd/MM/yyyy", { locale: ptBR });
        break;
      }
    }
    // Para "day", carregamos o mês inteiro (preserva o card "Média Diária — mês").
    let fs = s, fe = e;
    if (!agg) {
      fs = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
      fe = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0, 23, 59, 59, 999);
    }
    return {
      fetchStart: fs,
      fetchEnd: fe,
      rangeStartKey: dayKeyFromDate(s),
      rangeEndKey: dayKeyFromDate(e),
      rangeLabel: label,
      isAggregated: agg,
    };
  }, [rangeMode, selectedDate]);

  const monthStart = useMemo(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1), [selectedDate]);
  const monthEnd = useMemo(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0, 23, 59, 59, 999), [selectedDate]);


  const [inboundDays, setInboundDays] = useState<{ lead_id: string; created_at: string }[]>([]);
  // Substituímos stage history por appointments (= calendário) para "agendados"
  const [apptsMonth, setApptsMonth] = useState<{ lead_id: string; created_at: string; scheduled_date: string; is_rescheduled: boolean | null }[]>([]);
  // Feriados do tenant (dashboard_holidays) — dias YYYY-MM-DD
  const [holidaySet, setHolidaySet] = useState<Set<string>>(() => new Set());

  // Feriados cadastrados pelo tenant (todas as clínicas: dia sem operação do CRC)
  useEffect(() => {
    (supabase as any)
      .from("dashboard_holidays")
      .select("data")
      .then(({ data, error }: { data: { data: string }[] | null; error: { message: string } | null }) => {
        if (error || !data) return; // fallback: só os feriados nacionais fixos
        setHolidaySet(new Set(data.map(h => h.data)));
      });
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    // Fronteiras do intervalo de fetch em America/Bahia
    const { gteIso: startISO, lteIso: endISO } = rangeBahia(fetchStart, fetchEnd);


    (async () => {
      try {
        // Mensagens inbound do mês — todos os pipelines
        const msgsAll = await fetchAllPaged<{ lead_id: string; created_at: string; id?: string }>(() =>
          supabase
            .from("messages")
            .select("id, lead_id, created_at")
            .eq("direction", "inbound")
            .gte("created_at", startISO)
            .lte("created_at", endISO),
          "id"
        );

        // Appointments criados no mês — TODOS, sem filtro de pipeline
        const apptsCreated = await fetchAllPaged<any>(() =>
          supabase
            .from("crm_appointments")
            .select("id, lead_id, created_at, scheduled_date, is_rescheduled")
            .gte("created_at", startISO)
            .lte("created_at", endISO),
          "id"
        );

        if (!alive) return;
        setInboundDays(msgsAll);
        setApptsMonth(apptsCreated);
      } catch (e: any) {
        if (!alive) return;
        setLoadError(e?.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [fetchStart, fetchEnd, reloadKey]);

  const inRange = (iso: string) => {
    const k = dayKeyBahia(iso);
    return k >= rangeStartKey && k <= rangeEndKey;
  };

  const falaramDia = useMemo(() => {
    const set = new Set<string>();
    inboundDays.forEach(m => { if (inRange(m.created_at)) set.add(m.lead_id); });
    return set;
  }, [inboundDays, rangeStartKey, rangeEndKey]);

  // Agendamentos criados no intervalo (não reagendados)
  const agendadosDia = useMemo(() => {
    return apptsMonth.filter(a => inRange(a.created_at) && a.is_rescheduled !== true).length;
  }, [apptsMonth, rangeStartKey, rangeEndKey]);

  // Reagendamentos criados no intervalo
  const reagendadosDia = useMemo(() => {
    return apptsMonth.filter(a => inRange(a.created_at) && a.is_rescheduled === true).length;
  }, [apptsMonth, rangeStartKey, rangeEndKey]);

  // Dos que falaram, quantos agendaram (interseção por lead_id) no intervalo
  const agendadosDosQueFalaram = useMemo(() => {
    const leadsAgendDia = new Set(
      apptsMonth
        .filter(a => inRange(a.created_at) && a.is_rescheduled !== true)
        .map(a => a.lead_id)
    );
    let cnt = 0;
    falaramDia.forEach(id => { if (leadsAgendDia.has(id)) cnt++; });
    return cnt;
  }, [apptsMonth, falaramDia, rangeStartKey, rangeEndKey]);



  const mediasMes = useMemo(() => {
    const today = new Date(); today.setHours(23, 59, 59, 999);
    const endRef = monthEnd.getTime() < today.getTime() ? monthEnd : today;
    const workingDays: string[] = [];
    const cur = new Date(monthStart);
    while (cur.getTime() <= endRef.getTime()) {
      if (isWorkingDay(cur, holidaySet)) workingDays.push(dayKeyFromDate(cur));
      cur.setDate(cur.getDate() + 1);
    }
    if (workingDays.length === 0) {
      return { avgFalaram: 0, avgAgendados: 0, avgReagendados: 0, totalDias: 0, falaramTotal: 0, taxaMensal: 0 };
    }
    const workingSet = new Set(workingDays);

    const falaramByDay = new Map<string, Set<string>>();
    inboundDays.forEach(m => {
      const k = dayKeyBahia(m.created_at);
      if (!workingSet.has(k)) return;
      if (!falaramByDay.has(k)) falaramByDay.set(k, new Set());
      falaramByDay.get(k)!.add(m.lead_id);
    });
    let falaramTotal = 0;
    falaramByDay.forEach(s => { falaramTotal += s.size; });

    // Leads que criaram agendamento (não reagendado) por dia útil — para a taxa
    // mensal usar a MESMA lógica do card diário: interseção falou ∩ agendou no dia.
    const agendLeadsByDay = new Map<string, Set<string>>();
    let agendTotal = 0, reagTotal = 0;
    apptsMonth.forEach(a => {
      const k = dayKeyBahia(a.created_at);
      if (!workingSet.has(k)) return;
      if (a.is_rescheduled === true) { reagTotal++; return; }
      agendTotal++;
      if (!agendLeadsByDay.has(k)) agendLeadsByDay.set(k, new Set());
      agendLeadsByDay.get(k)!.add(a.lead_id);
    });

    let falaramEAgendaramTotal = 0;
    falaramByDay.forEach((leadsSet, k) => {
      const ag = agendLeadsByDay.get(k);
      if (!ag) return;
      leadsSet.forEach(id => { if (ag.has(id)) falaramEAgendaramTotal++; });
    });

    return {
      avgFalaram: falaramTotal / workingDays.length,
      avgAgendados: agendTotal / workingDays.length,
      avgReagendados: reagTotal / workingDays.length,
      totalDias: workingDays.length,
      falaramTotal,
      // Mesmo numerador/denominador do card diário (leads distintos, interseção por dia)
      taxaMensal: falaramTotal > 0 ? (falaramEAgendaramTotal / falaramTotal) * 100 : 0,
    };
  }, [apptsMonth, inboundDays, monthStart, monthEnd, holidaySet]);

  return (
    <div className="space-y-6">
      <Card className="p-4 sticky top-0 z-20 backdrop-blur bg-card/95 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase">Funil</span>
          <span className="text-sm font-medium px-3 py-1 rounded bg-muted">Todos os funis</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase">Período</span>
          <Select value={rangeMode} onValueChange={(v) => setRangeMode(v as RangeMode)}>
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Dia específico</SelectItem>
              <SelectItem value="last7">Últimos 7 dias</SelectItem>
              <SelectItem value="last14">Últimos 14 dias</SelectItem>
              <SelectItem value="this_month">Este mês</SelectItem>
              <SelectItem value="last_month">Mês passado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase">Dia</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                disabled={isAggregated}
                className={cn("h-9 w-[220px] justify-start text-left font-normal", isAggregated && "opacity-60")}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {isAggregated ? rangeLabel : format(selectedDate, "dd 'de' MMMM yyyy", { locale: ptBR })}
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
        {!isAggregated && (
          <div className="ml-auto text-xs text-muted-foreground">
            Média baseada em {mediasMes.totalDias} dia(s) útil(eis) de {format(monthStart, "MMMM/yyyy", { locale: ptBR })}
          </div>
        )}

      </Card>

      {loadError && (
        <Card className="p-4 border-destructive/50 bg-destructive/5 flex flex-wrap items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-medium text-destructive">Falha ao carregar os dados do mês</p>
            <p className="text-xs text-muted-foreground mt-0.5">{loadError} — os números abaixo podem estar desatualizados.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setReloadKey(k => k + 1)}>Tentar novamente</Button>
        </Card>
      )}

      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="w-5 h-5 text-orange-500" />
          <h2 className="text-lg font-semibold">Ações {isAggregated ? "—" : "de"} {rangeLabel}</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Pessoas que falaram, agendamentos criados e reagendamentos criados <strong>{isAggregated ? "neste período" : "neste dia"}</strong>.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="rounded-lg border border-border p-4 flex flex-col gap-2" style={{ borderLeftWidth: 4, borderLeftColor: "#3b82f6" }}>
            <span className="text-sm text-muted-foreground">Pessoas que falaram comigo</span>
            <span className="text-4xl font-bold text-primary">{falaramDia.size}</span>
            <span className="text-xs text-muted-foreground">Leads distintos com mensagem inbound {isAggregated ? "no período" : "no dia"}</span>
          </div>
          <div className="rounded-lg border border-border p-4 flex flex-col gap-2" style={{ borderLeftWidth: 4, borderLeftColor: "#10b981" }}>
            <span className="text-sm text-muted-foreground">Agendamentos criados</span>
            <span className="text-4xl font-bold text-green-600">{agendadosDia}</span>
            <span className="text-xs text-muted-foreground">Novos agendamentos (não reagendados) criados {isAggregated ? "no período" : "no dia"}</span>
          </div>
          <div className="rounded-lg border border-border p-4 flex flex-col gap-2" style={{ borderLeftWidth: 4, borderLeftColor: "#f59e0b" }}>
            <span className="text-sm text-muted-foreground">Reagendamentos</span>
            <span className="text-4xl font-bold text-amber-600">{reagendadosDia}</span>
            <span className="text-xs text-muted-foreground">Appts marcados como reagendados {isAggregated ? "no período" : "no dia"}</span>
          </div>
        </div>

        {falaramDia.size > 0 && (
          <div className="rounded-lg bg-secondary/40 p-4 text-center">
            <span className="text-sm text-muted-foreground">Taxa de conversão (falaram → agendaram {isAggregated ? "no período" : "no mesmo dia"})</span>
            <p className="text-3xl font-bold text-primary mt-1">{((agendadosDosQueFalaram / falaramDia.size) * 100).toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground mt-1">{agendadosDosQueFalaram} de {falaramDia.size} lead(s) que falaram {isAggregated ? "no período" : "no dia"}</p>
          </div>
        )}
      </Card>


      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Média Diária — {format(monthStart, "MMMM/yyyy", { locale: ptBR })}</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Média por dia útil (excluindo domingos, feriados nacionais e feriados cadastrados no painel) considerando os {mediasMes.totalDias} dia(s) úteis do mês.
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

        {mediasMes.falaramTotal > 0 && (
          <div className="rounded-lg bg-secondary/40 p-4 text-center">
            <span className="text-sm text-muted-foreground">Taxa média de conversão mensal (falaram → agendaram no mesmo dia)</span>
            <p className="text-3xl font-bold text-primary mt-1">{mediasMes.taxaMensal.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground mt-1">Mesma regra do card diário: leads distintos que falaram e criaram agendamento no mesmo dia útil</p>
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
