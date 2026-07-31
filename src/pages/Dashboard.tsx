import { lazy, Suspense, useState, useEffect, useMemo } from "react";
import {
  DollarSign, Users, TrendingUp, Building2, Megaphone } from
"lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { type DateRangeFilterValue, getDateRangeFromFilter, getDateRangesFromFilter } from "@/lib/dateRangeFilter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useChartTheme } from "@/hooks/useChartTheme";
import { HolidaysManager, type Holiday } from "@/components/HolidaysManager";
import { businessDaysBetween } from "@/lib/businessDays";
import {
  dayKeyBahia,
  rangeBahia,
  normalizeCidade,
  classifyOrigemCanonica,
  rptContratados,
  rptFaturamentoOrigem,
  rptFaturamentoCriativo,
  type FaturamentoOrigemRow,
  type FaturamentoCriativoRow,
} from "@/lib/reportKit";

const DateRangeFilter = lazy(() =>
  import("@/components/ui/date-range-filter").then((m) => ({ default: m.DateRangeFilter }))
);

const COLORS = ["hsl(25, 100%, 50%)", "hsl(35, 100%, 55%)", "hsl(15, 90%, 45%)", "hsl(40, 95%, 60%)", "hsl(200, 70%, 50%)", "hsl(280, 60%, 55%)"];

const formatAxisValue = (v: number) => {
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return String(v);
};

const formatCurrency = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Formata Date para "YYYY-MM-DD" em HORÁRIO LOCAL (evita o bug de fuso de toISOString,
// que em BRT/UTC-3 desloca o fim do dia para o dia seguinte e contamina filtros e gráficos).
const toLocalDateStr = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Dia LOCAL (America/Bahia) de um valor vindo do banco:
// timestamptz (serializado em UTC) é convertido com dayKeyBahia;
// colunas DATE ("YYYY-MM-DD") passam direto.
const dbDay = (v: string | null | undefined): string | null => {
  if (!v) return null;
  return v.length > 10 ? dayKeyBahia(v) : v;
};

const CRM_LEADS_PAGE_SIZE = 1000;
const CRM_LEADS_SELECT = "id, name, cidade, source, created_at, first_inbound_at, ad_id, ad_account_name, paciente_id, pipeline_id";
const DASHBOARD_BG_REFRESH_AFTER = 5 * 60_000;
const CLINICAS_SELECT = "id, nome, cidade, ativa";
const PAGAMENTOS_SELECT = "id, valor, tipo, paciente_id, tratamento_id, clinica_id, data_pagamento, especialidade, recorrencia_orto, nao_marketing";
const TRATAMENTOS_SELECT = "id, paciente_id, clinica_id, created_at";
const PACIENTES_SELECT = "id, origem, nome_anuncio";

type DashboardPayload = {
  clinicas: any[];
  pagamentos: any[];
  tratamentos: any[];
  pacientes: any[];
  crmLeads: any[];
  crmAppointments: any[];
  adIdMapping: any[];
  holidays: Holiday[];
};

let dashboardMemoryCache: { key: string; ts: number; data: DashboardPayload } | null = null;

const getCurrentMonthBounds = () => {
  const now = new Date();
  return {
    from: toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toLocalDateStr(now),
  };
};

const dashboardCacheKey = (from: string, to: string, allPeriod: boolean) =>
  allPeriod ? "all" : `${from}:${to}`;

const readDashboardCache = () => {
  return dashboardMemoryCache;
};

const isDashboardCacheFresh = (cache: typeof dashboardMemoryCache) =>
  !!cache && Date.now() - cache.ts < DASHBOARD_BG_REFRESH_AFTER;

const writeDashboardCache = (key: string, data: DashboardPayload) => {
  dashboardMemoryCache = { key, ts: Date.now(), data };
};

const fetchAllCrmLeads = async (dateFrom?: string, dateTo?: string) => {
  const rows: any[] = [];

  for (let from = 0; ; from += CRM_LEADS_PAGE_SIZE) {
    let query = supabase
      .from("crm_leads")
      .select(CRM_LEADS_SELECT)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + CRM_LEADS_PAGE_SIZE - 1);

    if (dateFrom && dateTo) {
      // Fronteiras do período em America/Bahia (created_at é timestamptz em UTC).
      const { gteIso, lteIso } = rangeBahia(dateFrom, dateTo);
      query = query.or(`and(created_at.gte.${gteIso},created_at.lte.${lteIso}),and(first_inbound_at.gte.${gteIso},first_inbound_at.lte.${lteIso})`);
    }

    const { data, error } = await query;

    if (error) throw error;
    if (!data?.length) break;

    rows.push(...data);
    if (data.length < CRM_LEADS_PAGE_SIZE) break;
  }

  return rows;
};

/** Pré-carrega todos os dados do Dashboard e popula o cache em memória.
 *  Idempotente: se o cache estiver fresco, retorna imediatamente. */
export const prefetchDashboardData = async (): Promise<void> => {
  const { from, to } = getCurrentMonthBounds();
  const key = dashboardCacheKey(from, to, false);
  const cached = dashboardMemoryCache;
  if (cached?.key === key && Date.now() - cached.ts < DASHBOARD_BG_REFRESH_AFTER) return;
  try {
    const bahia = rangeBahia(from, to);
    const [{ data: cl }, { data: pg }, { data: tr }, { data: pc }, { data: hd }, cLeads, { data: cAppts }, { data: adMap }] = await Promise.all([
      supabase.from("clinicas").select(CLINICAS_SELECT).eq("ativa", true),
      supabase.from("pagamentos").select(PAGAMENTOS_SELECT).gte("data_pagamento", from).lte("data_pagamento", to).limit(50000),
      supabase.from("tratamentos").select(TRATAMENTOS_SELECT).gte("created_at", bahia.gteIso).lte("created_at", bahia.lteIso).limit(20000),
      supabase.from("pacientes").select(PACIENTES_SELECT).limit(20000),
      (supabase as any).from("dashboard_holidays").select("id, data, descricao, clinica_id"),
      fetchAllCrmLeads(from, to),
      supabase.from("crm_appointments").select("id, lead_id, scheduled_date, status, is_rescheduled, created_at, crm_leads(cidade)").gte("scheduled_date", from).lte("scheduled_date", to).limit(10000),
      (supabase as any).from("ad_id_mapping").select("ad_id, ad_account_name, cidade").limit(5000),
    ]);
    writeDashboardCache(key, {
      clinicas: cl || [],
      pagamentos: pg || [],
      tratamentos: tr || [],
      pacientes: pc || [],
      holidays: (hd || []) as Holiday[],
      crmLeads: cLeads || [],
      crmAppointments: cAppts || [],
      adIdMapping: adMap || [],
    });
  } catch (e) {
    console.warn("[prefetchDashboardData] falhou:", e);
  }
};

const activeBarStyle = { style: { filter: "brightness(1.3) drop-shadow(0 0 8px rgba(255,140,0,0.4))", transition: "filter 0.2s ease" } };


const Dashboard = () => {
  const ct = useChartTheme();

  const renderBarLabel = (props: any) => {
    const { x, y, width, value } = props;
    if (!value) return null;
    const label = typeof value === "number" && value >= 1000 ? formatCurrency(value) : String(value);
    return (
      <text x={x + width / 2} y={y - 6} fill={ct.labelColor} textAnchor="middle" fontSize={10} fontWeight={600}>
        {label}
      </text>);
  };

  const ChartCard = ({ title, subtitle, children }: {title: string; subtitle?: string; children: React.ReactNode}) => (
    <Card className="gradient-card border-border shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent className="pt-0">
        {children}
      </CardContent>
    </Card>
  );

  const tooltipStyle = ct.tooltipStyle;
  const tooltipLabelStyle = ct.tooltipLabelStyle;
  const tooltipItemStyle = ct.tooltipItemStyle;
  const [clinicas, setClinicas] = useState<Tables<"clinicas">[]>([]);
  const [clinicaFiltro, setClinicaFiltro] = useState("todas");
  const [canalFiltro, setCanalFiltro] = useState("todos");
  const [pagamentos, setPagamentos] = useState<any[]>([]);
  const [tratamentos, setTratamentos] = useState<any[]>([]);
  const [pacientes, setPacientes] = useState<any[]>([]);
  const [crmLeads, setCrmLeads] = useState<any[]>([]);
  const [crmAppointments, setCrmAppointments] = useState<any[]>([]);
  const [adIdMapping, setAdIdMapping] = useState<any[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<DateRangeFilterValue>({ preset: "this_month" });
  const dateRange = useMemo(() => {
    const r = getDateRangeFromFilter(dateFilter);
    // O preset "Últimos 7 dias" da lib cobre 8 dias-calendário (hoje + 7 anteriores).
    // Aqui corrigimos para exatamente 7 dias: hoje + 6 anteriores.
    if (r && dateFilter.preset === "7days") {
      const start = new Date(r.end.getFullYear(), r.end.getMonth(), r.end.getDate() - 6, 0, 0, 0, 0);
      return { start, end: r.end };
    }
    return r;
  }, [dateFilter]);
  const allRanges = useMemo(() => {
    if (dateFilter.preset === "7days") return dateRange ? [dateRange] : null;
    return getDateRangesFromFilter(dateFilter);
  }, [dateFilter, dateRange]);
  const isAllPeriod = dateFilter.preset === "all";
  // Período está COMPLETO? Custom/multi emitem estados intermediários (seleção de
  // "Personalizado" sem datas, 1º clique do calendário) que NÃO devem disparar o
  // fetch pesado — senão a página "recarrega" antes de o usuário terminar de
  // escolher o período. Só busca quando o range está fechado.
  const rangeReady = useMemo(() => {
    if (dateFilter.preset === "custom") return !!(dateFilter.customFrom && dateFilter.customTo);
    if (dateFilter.preset === "multi") return (dateFilter.customRanges || []).some((r) => r.from && r.to);
    return true;
  }, [dateFilter]);
  const todayStr = useMemo(() => toLocalDateStr(new Date()), []);
  const dateFrom = useMemo(() => dateRange ? toLocalDateStr(dateRange.start) : "2020-01-01", [dateRange]);
  const dateTo = useMemo(() => {
    if (!dateRange) return todayStr;
    const end = toLocalDateStr(dateRange.end);
    return dateFilter.preset === "this_month" && end > todayStr ? todayStr : end;
  }, [dateRange, dateFilter.preset, todayStr]);
  // Pre-compute interval bounds as YYYY-MM-DD strings for fast date comparison
  const rangeBounds = useMemo(
    () => allRanges?.map((r) => {
      const from = toLocalDateStr(r.start);
      const rawTo = toLocalDateStr(r.end);
      return { from, to: dateFilter.preset === "this_month" && rawTo > todayStr ? todayStr : rawTo };
    }) ?? null,
    [allRanges, dateFilter.preset, todayStr]
  );
  const isInSelectedRanges = (dateStr: string | undefined | null) => {
    const v = dbDay(dateStr); // timestamptz vira dia local (America/Bahia)
    if (!v) return false;
    if (!rangeBounds) return v >= dateFrom && v <= dateTo; // "all"
    return rangeBounds.some((r) => v >= r.from && v <= r.to);
  };
  // Determine if charts should aggregate by month (when total span > 60 days)
  const useMonthlyChart = useMemo(() => {
    const d1 = new Date(dateFrom);
    const d2 = new Date(dateTo);
    return (d2.getTime() - d1.getTime()) / 86400000 > 60;
  }, [dateFrom, dateTo]);

  const fetchHolidays = async () => {
    const { data: hd } = await (supabase as any)
      .from("dashboard_holidays")
      .select("id, data, descricao, clinica_id");
    setHolidays((hd || []) as Holiday[]);
  };

  const applyDashboardData = (payload: DashboardPayload) => {
    setClinicas(payload.clinicas || []);
    setPagamentos(payload.pagamentos || []);
    setTratamentos(payload.tratamentos || []);
    setPacientes(payload.pacientes || []);
    setHolidays((payload.holidays || []) as Holiday[]);
    setCrmLeads(payload.crmLeads || []);
    setCrmAppointments(payload.crmAppointments || []);
    setAdIdMapping(payload.adIdMapping || []);
  };

  const fetchAll = async (showLoading = true, force = false) => {
    const key = dashboardCacheKey(dateFrom, dateTo, isAllPeriod);
    const cached = readDashboardCache();
    if (cached?.key === key && !force) {
      applyDashboardData(cached.data);
      setLoading(false);
      if (isDashboardCacheFresh(cached)) return;
      showLoading = false;
    }
    if (showLoading) setLoading(true);
    const bounded = !isAllPeriod;
    const bahia = rangeBahia(dateFrom, dateTo);
    const [{ data: cl }, { data: pg }, { data: tr }, { data: pc }, { data: hd }] = await Promise.all([
    supabase.from("clinicas").select(CLINICAS_SELECT).eq("ativa", true),
    (bounded ? supabase.from("pagamentos").select(PAGAMENTOS_SELECT).gte("data_pagamento", dateFrom).lte("data_pagamento", dateTo) : supabase.from("pagamentos").select(PAGAMENTOS_SELECT)).limit(50000),
    (bounded ? supabase.from("tratamentos").select(TRATAMENTOS_SELECT).gte("created_at", bahia.gteIso).lte("created_at", bahia.lteIso) : supabase.from("tratamentos").select(TRATAMENTOS_SELECT)).limit(20000),
    supabase.from("pacientes").select(PACIENTES_SELECT).limit(20000),
    (supabase as any).from("dashboard_holidays").select("id, data, descricao, clinica_id")]
    );
    const payload: DashboardPayload = {
      clinicas: cl || [],
      pagamentos: pg || [],
      tratamentos: tr || [],
      pacientes: pc || [],
      holidays: (hd || []) as Holiday[],
    };

    writeDashboardCache(key, payload);
    applyDashboardData(payload);
    if (showLoading) setLoading(false);
  };

  useEffect(() => {
    if (!rangeReady) return;
    fetchAll();

    // Realtime: refetch on changes to relevant tables
    let debounceTimer: any = null;
    const scheduleRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchAll(false, true), 800);
    };

    const channel = supabase
      .channel("dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_lead_stage_history" }, scheduleRefetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "pagamentos" }, scheduleRefetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "dashboard_holidays" }, scheduleRefetch)

      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [dateFrom, dateTo, isAllPeriod, rangeReady]);

  // ===== RPCs canônicas (rpt_*) — mesmo número para qualquer usuário do tenant =====
  // Elas só cobrem período contíguo e não conhecem o filtro de canal; fora disso
  // (ou se a migração ainda não criou as funções) caímos no cálculo local, com
  // rótulo honesto na UI.
  const rpcFiltersOk = canalFiltro === "todos" && dateFilter.preset !== "multi";
  // Faturamento por origem canônica (mesma fonte da aba Origem & Conversão) —
  // caixa do período por origem do lead do paciente. Reconcilia com o total.
  const [rpcCanalOrigem, setRpcCanalOrigem] = useState<FaturamentoOrigemRow[] | null>(null);
  const [rpcCriativo, setRpcCriativo] = useState<FaturamentoCriativoRow[] | null>(null);
  const [criativoErro, setCriativoErro] = useState<string | null>(null);



  useEffect(() => {
    let cancelled = false;
    setRpcCanalOrigem(null);
    if (dateFilter.preset === "multi" || !rangeReady) return; // período contíguo só / completo
    rptFaturamentoOrigem(dateFrom, dateTo, clinicaFiltro === "todas" ? null : clinicaFiltro)
      .then((rows) => { if (!cancelled) setRpcCanalOrigem(rows); })
      .catch((e) => console.warn("[Dashboard] rpt_faturamento_origem indisponível; usando cálculo local:", e));
    return () => { cancelled = true; };
  }, [dateFilter.preset, dateFrom, dateTo, clinicaFiltro, rangeReady]);

  useEffect(() => {
    let cancelled = false;
    setRpcCriativo(null);
    setCriativoErro(null);
    if (dateFilter.preset === "multi" || !rangeReady) return;
    rptFaturamentoCriativo(dateFrom, dateTo, clinicaFiltro === "todas" ? null : clinicaFiltro)
      .then((rows) => { if (!cancelled) setRpcCriativo(rows); })
      .catch((e) => {
        console.warn("[Dashboard] rpt_faturamento_criativo falhou:", e);
        if (!cancelled) setCriativoErro(e?.message || "erro desconhecido");
      });
    return () => { cancelled = true; };
  }, [dateFilter.preset, dateFrom, dateTo, clinicaFiltro, rangeReady]);




  // Unique values for filter dropdowns


  const canaisUnicos = useMemo(() => {
    const set = new Set(pacientes.map((p) => p.origem).filter(Boolean));
    return Array.from(set).sort();
  }, [pacientes]);

  const filtered = useMemo(() => {
    const filterByClinica = (items: any[]) =>
    clinicaFiltro === "todas" ? items : items.filter((i) => i.clinica_id === clinicaFiltro);
    const filterByDate = (items: any[], dateField: string) =>
    items.filter((i) => isInSelectedRanges(dbDay(i[dateField])));

    let filteredTratamentos = filterByDate(filterByClinica(tratamentos), "created_at");
    let filteredPagamentos = filterByDate(filterByClinica(pagamentos), "data_pagamento");

    // Filtro de canal: o vínculo confiável é pagamento -> paciente -> origem
    // (paciente_id existe em 100% dos pagamentos; tratamento_id não — filtrar
    // por tratamento zerava o faturamento).
    let filteredPacientes = pacientes;
    if (canalFiltro !== "todos") {
      filteredPacientes = pacientes.filter((p) => (p.origem || "Outros") === canalFiltro);
      const canalPacienteIds = new Set(filteredPacientes.map((p) => p.id));
      filteredTratamentos = filteredTratamentos.filter((t) => canalPacienteIds.has(t.paciente_id));
      filteredPagamentos = filteredPagamentos.filter((p) => canalPacienteIds.has(p.paciente_id));
    }

    return {
      pagamentos: filteredPagamentos,
      tratamentos: filteredTratamentos,
      pacientes: filteredPacientes
    };
  }, [clinicaFiltro, canalFiltro, pagamentos, tratamentos, pacientes, dateFrom, dateTo, rangeBounds]);

  // Mensalidade de ortodontia (recorrencia_orto=true) NÃO entra no faturamento:
  // é receita recorrente de paciente antigo, não venda nova. Quem começa
  // tratamento (sem orto anterior no Dontus) entra normalmente.
  // Além da recorrência de orto, exclui pagamentos com a marca gravada
  // nao_marketing (definida só na entrada do pagamento, nunca retroativa).
  const pagamentosFat = filtered.pagamentos.filter(
    (p) => p.recorrencia_orto !== true && p.nao_marketing !== true,
  );

  const fatTotal = pagamentosFat.reduce((s, p) => s + Number(p.valor), 0);
  const fatNovos = pagamentosFat.filter((p) => p.tipo === "primeiro").reduce((s, p) => s + Number(p.valor), 0);
  const fatRecorrentes = pagamentosFat.filter((p) => p.tipo === "recorrente").reduce((s, p) => s + Number(p.valor), 0);
  const totalPacientes = new Set(filtered.pagamentos.map((p) => p.paciente_id)).size;

  // Conjunto de feriados (YYYY-MM-DD) aplicáveis à clínica filtrada.
  // Feriado global (sem clinica_id) vale sempre; feriado de UMA clínica só
  // zera o dia útil quando ELA está selecionada (não derruba a rede inteira).
  const holidaySet = useMemo(() => {
    const set = new Set<string>();
    holidays.forEach((h) => {
      const applies = !h.clinica_id || h.clinica_id === clinicaFiltro;
      if (applies) set.add(h.data);
    });
    return set;
  }, [holidays, clinicaFiltro]);

  const isWorkingDay = (d: Date, dateStr: string) =>
    d.getDay() !== 0 && !holidaySet.has(dateStr);

  // O período selecionado é EXATAMENTE o mês corrente COMPLETO? (para exibir previsão)
  const isCurrentMonthSelected = useMemo(() => {
    if (dateFilter.preset === "this_month") return true;
    if (!dateRange) return false;
    const now = new Date();
    const s = dateRange.start;
    const e = dateRange.end;
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return (
      s.getFullYear() === now.getFullYear() &&
      s.getMonth() === now.getMonth() &&
      s.getDate() === 1 &&
      e.getFullYear() === now.getFullYear() &&
      e.getMonth() === now.getMonth() &&
      e.getDate() >= lastDayOfMonth
    );
  }, [dateRange, dateFilter.preset]);

  // "Ontem" em horário local (lançamentos têm ~1 dia de atraso)
  const yesterdayLocal = useMemo(() => {
    const t = new Date();
    t.setHours(12, 0, 0, 0);
    t.setDate(t.getDate() - 1);
    return t;
  }, []);
  const yesterdayStr = useMemo(() => toLocalDateStr(yesterdayLocal), [yesterdayLocal]);

  // Primeiro dia com pagamento carregado (usado como início quando o filtro é "Todo período")
  const minPagamentoStr = useMemo(() => {
    let min: string | null = null;
    pagamentos.forEach((p) => {
      const d = p.data_pagamento;
      if (d && (!min || d < min)) min = d;
    });
    return min;
  }, [pagamentos]);

  // Último dia COM LANÇAMENTO (max data_pagamento). Os pagamentos são digitados
  // com atraso (a clínica lança no dia seguinte), então "ontem" quase sempre ainda
  // não tem dado. Ancorar aqui — e não em "ontem" — evita diluir média/projeção com
  // dias ainda não lançados. Mesma regra de src/pages/Relatorios.tsx (predictability).
  const ultimoDiaLancado = useMemo(
    () => pagamentosFat.reduce((mx, p) => ((p.data_pagamento || "") > mx ? (p.data_pagamento as string) : mx), ""),
    [pagamentosFat]
  );

  // Dias úteis DECORRIDOS até o ÚLTIMO DIA COM LANÇAMENTO
  // (Seg-Sex=1, Sáb=0.5, Dom=0, feriados=0) — mesma janela do numerador (faturamento total).
  const diasUteisPassados = useMemo(() => {
    if (!ultimoDiaLancado) return 0.5;
    const bounds = rangeBounds ?? (minPagamentoStr ? [{ from: minPagamentoStr, to: dateTo }] : []);
    let total = 0;
    bounds.forEach((b) => {
      const toStr = b.to < ultimoDiaLancado ? b.to : ultimoDiaLancado;
      if (toStr < b.from) return;
      total += businessDaysBetween(new Date(b.from + "T12:00:00"), new Date(toStr + "T12:00:00"), holidaySet);
    });
    return Math.max(total, 0.5);
  }, [rangeBounds, minPagamentoStr, dateTo, ultimoDiaLancado, holidaySet]);

  // Total de dias úteis do MÊS CORRENTE (para a projeção, exibida só com o mês corrente completo)
  const diasUteisMes = useMemo(() => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return Math.max(businessDaysBetween(firstDay, lastDay, holidaySet), 1);
  }, [holidaySet]);

  // Ticket médio diário: faturamento TOTAL do período ÷ dias úteis até o último dia
  // com lançamento (numerador e divisor cobrem a MESMA janela de dados reais).
  const ticketMedio = diasUteisPassados > 0 ? fatTotal / diasUteisPassados : 0;
  const projecaoMensal = ticketMedio * diasUteisMes;




  const kpis = [
  { title: "Faturamento no Período", value: formatCurrency(fatTotal), icon: TrendingUp, subtitle: canalFiltro !== "todos" ? "Pagamentos do período de pacientes do canal selecionado" : "Pagamentos recebidos no período" },
  { title: "Fat. Novos Leads", value: formatCurrency(fatNovos), icon: Users, subtitle: "Primeiro pagamento" },
  { title: "Fat. Recorrentes", value: formatCurrency(fatRecorrentes), icon: DollarSign, subtitle: "Pagamentos recorrentes" },
  { title: "Ticket Médio Diário", value: formatCurrency(ticketMedio), icon: DollarSign, subtitle: "Faturamento (exclui mensalidade de orto) ÷ dias úteis" },
  ...(isCurrentMonthSelected
    ? [{ title: "Previsão Mensal", value: formatCurrency(projecaoMensal), icon: TrendingUp, subtitle: `${diasUteisMes} dias úteis no mês` }]
    : []),
  { title: "Pacientes", value: String(totalPacientes), icon: Users, subtitle: "Pacientes com pagamento no período" }];


  // Chart: Venda Diária (todos os dias úteis do período)
  const vendaDiaria = useMemo(() => {
    if (useMonthlyChart) {
      // Aggregate by month
      const monthMap = new Map<string, number>();
      pagamentosFat.forEach((p) => {
        const key = p.data_pagamento.substring(0, 7); // "YYYY-MM"
        monthMap.set(key, (monthMap.get(key) || 0) + Number(p.valor));
      });
      const sorted = Array.from(monthMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      return sorted.map(([key, valor]) => {
        const [y, m] = key.split("-");
        return { dia: `${m}/${y.slice(2)}`, valor };
      });
    }
    const start = new Date(dateFrom + "T12:00:00");
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const endRaw = new Date(dateTo + "T12:00:00");
    const end = endRaw > today ? today : endRaw;
    const pgMap = new Map<string, number>();
    pagamentosFat.forEach((p) => {
      pgMap.set(p.data_pagamento, (pgMap.get(p.data_pagamento) || 0) + Number(p.valor));
    });
    const days: { dia: string; valor: number }[] = [];
    const current = new Date(start);
    while (current <= end) {
      const dateStr = toLocalDateStr(current);
      // Dia útil sempre aparece; domingo/feriado aparece se houver pagamento lançado
      // (senão a soma do gráfico não bateria com o KPI de faturamento).
      if ((isWorkingDay(current, dateStr) || pgMap.has(dateStr)) && isInSelectedRanges(dateStr)) {
        const label = current.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
        days.push({ dia: label, valor: pgMap.get(dateStr) || 0 });
      }
      current.setDate(current.getDate() + 1);
    }
    return days;
  }, [dateFrom, dateTo, pagamentosFat, useMonthlyChart, rangeBounds, holidaySet]);




  // Chart: Faturamento por Clínica (agrupando VCA 01 + VCA 02 como "VCA")
  const fatClinicaRaw = clinicas.map((c) => {
    let name = c.nome.replace("Clínica ", "").replace("Rizodent ", "");
    if (name.includes("VCA")) name = "VCA";
    return {
      name,
      value: pagamentosFat.filter((p) => p.clinica_id === c.id).reduce((s, p) => s + Number(p.valor), 0)
    };
  });
  const fatClinicaGrouped = new Map<string, number>();
  fatClinicaRaw.forEach(({ name, value }) => {
    fatClinicaGrouped.set(name, (fatClinicaGrouped.get(name) || 0) + value);
  });
  const fatClinica = Array.from(fatClinicaGrouped.entries()).map(([name, value]) => ({ name, value })).filter((d) => d.value > 0);

  // Chart: Faturamento por Especialidade (soma dos pagamentos)
  const espFatMap = new Map<string, number>();
  pagamentosFat.forEach((p) => {
    const esp = p.especialidade || "Sem Especialidade";
    espFatMap.set(esp, (espFatMap.get(esp) || 0) + Number(p.valor || 0));
  });
  const espFaturamento = Array.from(espFatMap.entries())
    .map(([name, value]) => ({ name, value }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  // Chart: Quantidade de pagamentos por Especialidade
  const espQtdMap = new Map<string, number>();
  filtered.pagamentos.forEach((p) => {
    const esp = p.especialidade || "Sem Especialidade";
    espQtdMap.set(esp, (espQtdMap.get(esp) || 0) + 1);
  });
  const espVolume = Array.from(espQtdMap.entries())
    .map(([name, value]) => ({ name, value }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);


  // Pacientes/faturamento por canal: ambos derivados dos PAGAMENTOS do período
  // filtrado — os dois gráficos gêmeos usam o MESMO recorte (antes o de pacientes
  // mostrava a base histórica inteira, ignorando os filtros de período e clínica).
  const pacienteOrigemLookup = new Map<string, string>();
  pacientes.forEach((p) => pacienteOrigemLookup.set(p.id, p.origem || "Outros"));
  const origemMap = new Map<string, {pacs: Set<string>;fat: number;}>();
  pagamentosFat.forEach((pg) => {
    const o = pacienteOrigemLookup.get(pg.paciente_id) || "Outros";
    const entry = origemMap.get(o) || { pacs: new Set<string>(), fat: 0 };
    entry.pacs.add(pg.paciente_id);
    entry.fat += Number(pg.valor);
    origemMap.set(o, entry);
  });
  const origemDataLocal = Array.from(origemMap.entries()).map(([name, { pacs, fat }]) => ({ name, pacientes: pacs.size, faturamento: fat })).sort((a, b) => b.faturamento - a.faturamento);
  // Fonte preferida: RPC canônica (rpt_faturamento_origem) — origem do LEAD do
  // paciente (não o campo cru pacientes.origem), mesmos números da aba Origem &
  // Conversão e mesmo total do dashboard. Fallback: cálculo local por origem crua.
  const origemData = rpcCanalOrigem
    ? rpcCanalOrigem.map((r) => ({ name: r.origem, pacientes: r.pacientes, faturamento: r.faturamento })).sort((a, b) => b.faturamento - a.faturamento)
    : origemDataLocal;

  // Chart: Faturamento por Criativo — agrupa o mesmo criativo rodando entre unidades.
  // Fonte única: RPC canônica (rpt_faturamento_criativo). Sem fallback local (nome_anuncio
  // é texto digitado à mão e produz rótulos-lixo tipo "NÃO IDENTIFICADO"/"SEM ANÚNCIO").
  const criativoMultiPeriod = dateFilter.preset === "multi";
  const criativoTotalBruto = (rpcCriativo ?? []).reduce((s, r) => s + Number(r.faturamento || 0), 0);
  const criativoTotalRastreado = (rpcCriativo ?? [])
    .filter((r) => r.atribuido === true)
    .reduce((s, r) => s + Number(r.faturamento || 0), 0);
  const criativoPct = criativoTotalBruto > 0 ? Math.round((criativoTotalRastreado / criativoTotalBruto) * 100) : 0;
  const fmtBRL0 = (v: number) => `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
  const criativoSubtitle = rpcCriativo && criativoTotalBruto > 0
    ? `${fmtBRL0(criativoTotalRastreado)} de ${fmtBRL0(criativoTotalBruto)} rastreados por criativo (${criativoPct}%)`
    : undefined;
  // Top 6 atribuídos + "Outros (N criativos)" na 7ª barra; não-atribuídos ficam fora do gráfico
  // (eles já estão contados no subtítulo). "Sem anúncio vinculado" / "fora da janela" não viram barra.
  const atribuidosOrdenados = (rpcCriativo ?? [])
    .filter((r) => r.atribuido === true && Number(r.faturamento || 0) > 0)
    .sort((a, b) => Number(b.faturamento) - Number(a.faturamento));
  const criativoTop = atribuidosOrdenados.slice(0, 6).map((r) => ({
    name: r.criativo,
    value: Number(r.faturamento),
    pacientes: Number(r.pacientes || 0),
    contas: r.contas ?? 1,
    variantes: r.variantes ?? 1,
    cidades: r.cidades ?? [],
    isOutros: false,
    isDeclarada: false,
  }));
  const restoAtribuido = atribuidosOrdenados.slice(6);
  if (restoAtribuido.length > 0) {
    const somaResto = restoAtribuido.reduce((s, r) => s + Number(r.faturamento || 0), 0);
    criativoTop.push({
      name: `Outros (${restoAtribuido.length} criativos)`,
      value: somaResto,
      pacientes: restoAtribuido.reduce((s, r) => s + Number(r.pacientes || 0), 0),
      contas: 0,
      variantes: 0,
      cidades: [],
      isOutros: true,
      isDeclarada: false,
    });
  }
  // Barras "declaradas" (informadas pela recepção via creative_key_declarado).
  // Aparecem depois das medidas, com cor acinzentada e sufixo " (informado)".
  // NÃO entram no percentual "X de Y rastreados" — esse continua contando só medida.
  const declaradasOrdenadas = (rpcCriativo ?? [])
    .filter((r) => r.origem_atribuicao === "declarada" && Number(r.faturamento || 0) > 0)
    .sort((a, b) => Number(b.faturamento) - Number(a.faturamento));
  for (const r of declaradasOrdenadas) {
    criativoTop.push({
      name: `${r.criativo} (informado)`,
      value: Number(r.faturamento),
      pacientes: Number(r.pacientes || 0),
      contas: 0,
      variantes: 0,
      cidades: [],
      isOutros: false,
      isDeclarada: true,
    });
  }


  const showClinicaChart = clinicaFiltro === "todas";
  const showCanalChart = canalFiltro === "todos";

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando dados...</div>;
  }


  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Visão geral do desempenho</p>
        </div>
        <div className="flex items-center gap-2">
          <HolidaysManager clinicas={clinicas} onChange={fetchHolidays} />
          <Suspense fallback={<div className="h-8 w-[140px] rounded-md bg-secondary" />}>
            <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
          </Suspense>
        </div>
      </div>

      {/* Filters */}
      <Card className="gradient-card border-border shadow-card">
        <CardContent className="pt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Clínica</Label>
              <Select value={clinicaFiltro} onValueChange={setClinicaFiltro}>
                <SelectTrigger className="bg-secondary border-border">
                  <Building2 size={16} className="mr-2 text-primary" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as Clínicas</SelectItem>
                  {clinicas.map((c) =>
                  <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Canal de Origem</Label>
              <Select value={canalFiltro} onValueChange={setCanalFiltro}>
                <SelectTrigger className="bg-secondary border-border">
                  <Megaphone size={16} className="mr-2 text-primary" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os Canais</SelectItem>
                  {canaisUnicos.map((c) =>
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>



      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi: any) =>
        <Card key={kpi.title} className="gradient-card border-border shadow-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
              <div className="rounded-lg bg-primary/10 p-2">
                <kpi.icon size={18} className="text-primary" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpi.value}</div>
              {kpi.subtitle && <p className="text-xs text-muted-foreground mt-0.5">{kpi.subtitle}</p>}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Gráfico Venda Diária */}
      <Card className="gradient-card border-border shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Venda Diária</CardTitle>
          <p className="text-xs text-muted-foreground">Pagamentos recebidos por dia útil no período (domingos/feriados aparecem quando há pagamento lançado)</p>
        </CardHeader>
        <CardContent className="pt-0">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={vendaDiaria} margin={{ top: 20, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
              <XAxis dataKey="dia" stroke={ct.axisColor} fontSize={10} interval={0} angle={-45} textAnchor="end" height={50} tick={{ fill: ct.axisColor }} />
              <YAxis stroke={ct.axisColor} fontSize={11} tickFormatter={formatAxisValue} width={50} tick={{ fill: ct.axisColor }} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(value: number) => [formatCurrency(value), "Faturamento"]} />
              <Bar dataKey="valor" fill="hsl(25,100%,50%)" radius={[4, 4, 0, 0]} activeBar={activeBarStyle} label={renderBarLabel} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>




      {/* Funil de Atendimentos removido a pedido do usuário */}

      {/* Charts - dynamically shown based on active filters */}
      <div className="grid gap-4 lg:grid-cols-2">
        {showClinicaChart &&
        <ChartCard title="Faturamento por Clínica">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={fatClinica} margin={{ top: 30, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                <XAxis dataKey="name" stroke={ct.axisColor} fontSize={11} tick={{ fill: ct.axisColor }} />
                <YAxis stroke={ct.axisColor} fontSize={11} tickFormatter={formatAxisValue} width={50} tick={{ fill: ct.axisColor }} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(value: number) => [formatCurrency(value), "Faturamento"]} />
                <Bar dataKey="value" fill="hsl(25,100%,50%)" radius={[6, 6, 0, 0]} label={renderBarLabel} activeBar={activeBarStyle} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        }

        <ChartCard title="Faturamento por Especialidade">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={espFaturamento} margin={{ top: 30, right: 10, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
              <XAxis dataKey="name" stroke={ct.axisColor} fontSize={10} interval={0} angle={-20} textAnchor="end" height={60} tick={{ fill: ct.axisColor }} />
              <YAxis stroke={ct.axisColor} fontSize={11} tickFormatter={formatAxisValue} width={50} tick={{ fill: ct.axisColor }} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(value: number) => [formatCurrency(value), "Faturamento"]} />
              <Bar dataKey="value" fill="hsl(35,100%,55%)" radius={[6, 6, 0, 0]} label={renderBarLabel} activeBar={activeBarStyle}>
                {espFaturamento.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Pagamentos por Especialidade">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={espVolume} margin={{ top: 30, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
              <XAxis dataKey="name" stroke={ct.axisColor} fontSize={10} interval={0} tick={{ fill: ct.axisColor }} />
              <YAxis stroke={ct.axisColor} fontSize={11} allowDecimals={false} width={40} tick={{ fill: ct.axisColor }} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(value: number) => [value, "Quantidade"]} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} label={{ position: "top", fill: ct.labelColor, fontSize: 11, fontWeight: 600 }} activeBar={activeBarStyle}>
                {espVolume.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Faturamento por Criativo" subtitle={criativoSubtitle}>
          {criativoMultiPeriod ? (
            <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground text-center px-4">
              Selecione um período contínuo para ver o faturamento por criativo
            </div>
          ) : criativoErro ? (
            <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground text-center px-4">
              Não foi possível carregar o faturamento por criativo
            </div>
          ) : !rpcCriativo ? (
            <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : criativoTop.length === 0 ? (
            <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground text-center px-4">
              Nenhum faturamento atribuído a criativo no período
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={criativoTop} margin={{ top: 30, right: 10, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                <XAxis dataKey="name" stroke={ct.axisColor} fontSize={10} interval={0} angle={-20} textAnchor="end" height={60} tick={{ fill: ct.axisColor }} />
                <YAxis stroke={ct.axisColor} fontSize={11} tickFormatter={formatAxisValue} width={50} tick={{ fill: ct.axisColor }} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  cursor={false}
                  formatter={(value: number, _n: string, entry: any) => {
                    const p = entry?.payload ?? {};
                    if (p.isOutros) return [formatCurrency(value), "Faturamento"];
                    if (p.isDeclarada) {
                      return [
                        [formatCurrency(value), `${p.pacientes ?? 0} pacientes · informado pela recepção`].join("\n"),
                        "Faturamento",
                      ];
                    }
                    const partes: string[] = [];
                    partes.push(`${p.pacientes ?? 0} pacientes`);
                    if (p.contas != null) partes.push(`${p.contas} contas`);
                    if (p.variantes != null) partes.push(`${p.variantes} variantes`);
                    const linhas = [formatCurrency(value), partes.join(" · ")];
                    if (Array.isArray(p.cidades) && p.cidades.length > 0 && (p.contas ?? 0) > 1) {
                      linhas.push(`Rodou em: ${p.cidades.join(", ")}`);
                    }
                    return [linhas.join("\n"), "Faturamento"];
                  }}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} label={renderBarLabel} activeBar={activeBarStyle}>
                  {criativoTop.map((d, i) => (
                    <Cell
                      key={i}
                      fill={
                        d.isDeclarada
                          ? "hsl(220, 8%, 72%)"
                          : d.isOutros
                            ? "hsl(220, 10%, 55%)"
                            : COLORS[i % COLORS.length]
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          {!criativoMultiPeriod && !criativoErro && rpcCriativo && criativoTop.some((d) => d.isDeclarada) && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              Barras claras = informado pela recepção, não medido pelo clique.
            </p>
          )}
          {!criativoMultiPeriod && !criativoErro && rpcCriativo && criativoTop.some((d) => !d.isOutros && !d.isDeclarada && (d.variantes ?? 0) > 1) && (
            <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
              {criativoTop
                .filter((d) => !d.isOutros && !d.isDeclarada && (d.variantes ?? 0) > 1)
                .map((d) => (
                  <span key={d.name} className="rounded bg-muted px-1.5 py-0.5">
                    {d.name}: {d.variantes} vídeos
                  </span>
                ))}
            </div>
          )}
        </ChartCard>


        {showCanalChart &&
        <ChartCard title="Pacientes por Canal de Origem" subtitle="Pacientes com pagamento no período filtrado, por origem">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={origemData} margin={{ top: 30, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                <XAxis dataKey="name" stroke={ct.axisColor} fontSize={11} tick={{ fill: ct.axisColor }} />
                <YAxis stroke={ct.axisColor} fontSize={11} allowDecimals={false} width={40} tick={{ fill: ct.axisColor }} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} />
                <Bar dataKey="pacientes" radius={[6, 6, 0, 0]} label={{ position: "top", fill: ct.labelColor, fontSize: 11, fontWeight: 600 }} activeBar={activeBarStyle}>
                  {origemData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        }

        {showCanalChart &&
        <ChartCard title="Faturamento por Canal de Origem" subtitle="Pagamentos recebidos no período filtrado, por origem do paciente">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={origemData} margin={{ top: 30, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                <XAxis dataKey="name" stroke={ct.axisColor} fontSize={11} tick={{ fill: ct.axisColor }} />
                <YAxis stroke={ct.axisColor} fontSize={11} tickFormatter={formatAxisValue} width={50} tick={{ fill: ct.axisColor }} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(value: number) => [formatCurrency(value), "Faturamento"]} />
                <Bar dataKey="faturamento" radius={[6, 6, 0, 0]} label={renderBarLabel} activeBar={activeBarStyle}>
                  {origemData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        }
      </div>
    </div>);

};

export default Dashboard;