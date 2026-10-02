import { lazy, Suspense, useState, useEffect, useMemo } from "react";
import {
  Users, TrendingUp, Building2, Megaphone, UserPlus, Repeat, Receipt, Target, BarChart3 } from
"lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { type DateRangeFilterValue, getDateRangeFromFilter, getDateRangesFromFilter } from "@/lib/dateRangeFilter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useChartTheme } from "@/hooks/useChartTheme";
import { HolidaysManager, type Holiday } from "@/components/HolidaysManager";
import { businessDaysBetween, diasAbertosParaRelatorio, ehDiaUtil, formatarDiasUteis } from "@/lib/businessDays";
import { useTenantConfig } from "@/hooks/useTenantConfig";
import { RpcErrorCard } from "@/components/RpcErrorCard";
import { aoInvalidarPaineis } from "@/lib/paineis";
import { toast } from "sonner";
import { formatarReais } from "@/lib/moeda";
import { useVocab } from "@/hooks/useVocab";
import {
  dayKeyNoFuso,
  contaComoFaturamento,

  rangeNoFuso,
  classifyOrigemCanonica,
  ORIGENS_CANONICAS,
  rptFaturamentoOrigem,
  rptFaturamentoCriativo,
  fetchAllPaged,
  motivoDaFalhaDeLeitura,
  type FaturamentoOrigemRow,
  type FaturamentoCriativoRow,
} from "@/lib/reportKit";


const DateRangeFilter = lazy(() =>
  import("@/components/ui/date-range-filter").then((m) => ({ default: m.DateRangeFilter }))
);

// Mesma série de useChartTheme().brandSeries: tons da marca + cores de estado.
const COLORS = ["hsl(var(--brand-500))", "hsl(var(--brand-300))", "hsl(var(--brand-700))", "hsl(var(--info))", "hsl(var(--success))", "hsl(var(--warning))"];

const formatAxisValue = (v: number) => {
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return String(v);
};


// Formata Date para "YYYY-MM-DD" em HORÁRIO LOCAL (evita o bug de fuso de toISOString,
// que em BRT/UTC-3 desloca o fim do dia para o dia seguinte e contamina filtros e gráficos).
const toLocalDateStr = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Dia LOCAL (fuso do tenant) de um valor vindo do banco:
// timestamptz (serializado em UTC) é convertido com dayKeyNoFuso;
// colunas DATE ("YYYY-MM-DD") passam direto.
const dbDay = (v: string | null | undefined): string | null => {
  if (!v) return null;
  return v.length > 10 ? dayKeyNoFuso(v) : v;
};

const DASHBOARD_BG_REFRESH_AFTER = 5 * 60_000;
const CLINICAS_SELECT = "id, nome, cidade, ativa";
const PAGAMENTOS_SELECT = "id, valor, tipo, paciente_id, tratamento_id, clinica_id, data_pagamento, especialidade, recorrencia_orto, nao_marketing";
const TRATAMENTOS_SELECT = "id, paciente_id, clinica_id, procedimento, especialidade, created_at";
const PACIENTES_SELECT = "id, origem, nome_anuncio";

type DashboardPayload = {
  clinicas: any[];
  pagamentos: any[];
  tratamentos: any[];
  pacientes: any[];
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


const writeDashboardCache = (key: string, data: DashboardPayload) => {
  dashboardMemoryCache = { key, ts: Date.now(), data };
};

// O cache é por sessão: login/logout/troca de usuário descarta o que foi
// buscado antes (inclusive respostas vazias de antes da sessão ficar pronta).
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
    dashboardMemoryCache = null;
  }
});


/** Leitura única do Dashboard (tela e pré-carga). Pagina tudo em blocos
 *  (sem o corte de 1.000 linhas do servidor) e LANÇA em qualquer erro —
 *  nunca devolve lista vazia no lugar de falha.
 *  Tratamentos continuam: o "Faturamento por procedimento" herda o
 *  procedimento do tratamento vinculado a cada pagamento. */
const carregarDadosDoDashboard = async (from: string, to: string, todoPeriodo: boolean): Promise<DashboardPayload> => {
  const [cl, pg, tr, pc, hd] = await Promise.all([
    supabase.from("clinicas").select(CLINICAS_SELECT),
    fetchAllPaged<any>(
      () => (todoPeriodo
        ? supabase.from("pagamentos").select(PAGAMENTOS_SELECT)
        : supabase.from("pagamentos").select(PAGAMENTOS_SELECT).gte("data_pagamento", from).lte("data_pagamento", to)) as any,
      "id",
    ),
    fetchAllPaged<any>(() => supabase.from("tratamentos").select(TRATAMENTOS_SELECT) as any, "id"),
    fetchAllPaged<any>(() => supabase.from("pacientes").select(PACIENTES_SELECT) as any, "id"),
    (supabase as any).from("dashboard_holidays").select("id, data, descricao, clinica_id"),
  ]);
  for (const r of [cl, hd]) {
    if (r.error) {
      const erro = new Error(`Dashboard: ${r.error.message}`);
      (erro as { cause?: unknown }).cause = r.error;
      throw erro;
    }
  }
  return {
    clinicas: cl.data || [],
    pagamentos: pg,
    tratamentos: tr,
    pacientes: pc,
    holidays: (hd.data || []) as Holiday[],
  };
};

/** Pré-carrega os dados do Dashboard (mês atual) e popula o cache em memória.
 *  Idempotente: se o cache estiver fresco, retorna imediatamente. */
export const prefetchDashboardData = async (): Promise<void> => {
  const { from, to } = getCurrentMonthBounds();
  const key = dashboardCacheKey(from, to, false);
  const cached = dashboardMemoryCache;
  if (cached?.key === key && Date.now() - cached.ts < DASHBOARD_BG_REFRESH_AFTER) return;
  try {
    writeDashboardCache(key, await carregarDadosDoDashboard(from, to, false));
  } catch (e) {
    console.warn("[prefetchDashboardData] falhou:", e); // não guarda resposta com erro
  }
};

const activeBarStyle = { style: { filter: "brightness(1.3) drop-shadow(0 0 8px rgba(255,140,0,0.4))", transition: "filter 0.2s ease" } };


const canalDoPaciente = (p: any): string => classifyOrigemCanonica({ source: p?.origem, nome_anuncio: p?.nome_anuncio } as any);

const Dashboard = () => {
  const { config: __tenantCfg } = useTenantConfig();
  const { dias: diasAbertos, padrao: horarioPadrao } = diasAbertosParaRelatorio(__tenantCfg?.businessHours);
  const { receitaRecorrenteLabel, unidade, pessoaPlural } = useVocab();
  const ct = useChartTheme();

  const renderBarLabel = (props: any) => {
    const { x, y, width, value } = props;
    if (!value) return null;
    const label = typeof value === "number" && value >= 1000 ? formatarReais(value) : String(value);
    return (
      <text x={x + width / 2} y={y - 6} fill={ct.labelColor} textAnchor="middle" fontSize={10} fontWeight={600}>
        {label}
      </text>);
  };

  const ChartCard = ({ title, subtitle, children }: {title: string; subtitle?: string; children: React.ReactNode}) => (
    <Card className="flex min-w-0 flex-col rounded-card border-border/60 bg-card shadow-card">
      <CardHeader className="flex flex-row items-start gap-3 space-y-0 p-5 pb-3 sm:p-6 sm:pb-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><BarChart3 size={18} /></span>
        <div className="min-w-0 space-y-1">
        <CardTitle className="text-base font-semibold leading-snug tracking-tight">{title}</CardTitle>
        {subtitle && <p className="text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p>}
        </div>
      </CardHeader>
      <CardContent className="mt-auto px-3 pb-5 pt-0 sm:px-5">
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
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [especialidadeProcedimento, setEspecialidadeProcedimento] = useState("");
  const [loading, setLoading] = useState(true);
  const [erroDeCarga, setErroDeCarga] = useState<string | null>(null);
  const [temDados, setTemDados] = useState(false);
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
    const v = dbDay(dateStr); // timestamptz vira dia local (fuso do tenant)
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
    setTemDados(true);
  };


  const fetchAll = async (showLoading = true, force = false) => {
    const key = dashboardCacheKey(dateFrom, dateTo, isAllPeriod);
    const cached = readDashboardCache();
    // Cache da mesma chave aparece na hora; a busca SEMPRE roda em segundo plano.
    if (cached?.key === key && !force) {
      applyDashboardData(cached.data);
      setLoading(false);
      showLoading = false;
    }
    if (showLoading) setLoading(true);
    try {
      const payload = await carregarDadosDoDashboard(dateFrom, dateTo, isAllPeriod);
      writeDashboardCache(key, payload);
      applyDashboardData(payload);
      setErroDeCarga(null);
    } catch (e) {
      // Erro NÃO grava cache nem troca os números que já estão na tela.
      const motivo = motivoDaFalhaDeLeitura(e);
      setErroDeCarga(motivo);
      toast.error(motivo);
    } finally {
      setLoading(false);
    }
  };

  // Gravação em outra tela (pagamento, atendimento…) → atualiza na hora.
  useEffect(() => aoInvalidarPaineis(() => fetchAll(false, true)), [dateFrom, dateTo, isAllPeriod]);

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

  // Se a tela abriu antes de a sessão ficar pronta, busca de novo quando o login conclui.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        setTimeout(() => fetchAll(false, true), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [dateFrom, dateTo, isAllPeriod]);

  // ===== RPCs canônicas (rpt_*) — mesmo número para qualquer usuário do tenant =====
  // Elas só cobrem período contíguo e não conhecem o filtro de canal; fora disso
  // (ou se a migração ainda não criou as funções) caímos no cálculo local, com
  // rótulo honesto na UI.
  
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
    const set = new Set(pacientes.map(canalDoPaciente));
    return ORIGENS_CANONICAS.filter((o) => set.has(o));
  }, [pacientes]);

  const filtered = useMemo(() => {
    const filterByClinica = (items: any[]) =>
    clinicaFiltro === "todas" ? items : items.filter((i) => i.clinica_id === clinicaFiltro);
    const filterByDate = (items: any[], dateField: string) =>
    items.filter((i) => isInSelectedRanges(dbDay(i[dateField])));

    let filteredPagamentos = filterByDate(filterByClinica(pagamentos), "data_pagamento");

    // Filtro de canal: o vínculo confiável é pagamento -> paciente -> origem
    // (paciente_id existe em 100% dos pagamentos; tratamento_id não — filtrar
    // por tratamento zerava o faturamento).
    let filteredPacientes = pacientes;
    if (canalFiltro !== "todos") {
      filteredPacientes = pacientes.filter((p) => canalDoPaciente(p) === canalFiltro);
      const canalPacienteIds = new Set(filteredPacientes.map((p) => p.id));
      filteredPagamentos = filteredPagamentos.filter((p) => canalPacienteIds.has(p.paciente_id));
    }

    return {
      pagamentos: filteredPagamentos,
      pacientes: filteredPacientes
    };
  }, [clinicaFiltro, canalFiltro, pagamentos, pacientes, dateFrom, dateTo, rangeBounds]);

  // Mensalidade de ortodontia (recorrencia_orto=true) NÃO entra no faturamento:
  // é receita recorrente de paciente antigo, não venda nova. Quem começa
  // tratamento (sem orto anterior no Dontus) entra normalmente.
  // Além da recorrência de orto, exclui pagamentos com a marca gravada
  // nao_marketing (definida só na entrada do pagamento, nunca retroativa).
  const pagamentosFat = filtered.pagamentos.filter(contaComoFaturamento);



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

  const isWorkingDay = (d: Date, _dateStr: string) => ehDiaUtil(d, holidaySet, diasAbertos);

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
  // (dia fora do horário comercial=0, feriado do cliente/nacional=0, demais=1) — mesma janela do numerador (faturamento total).
  const diasUteisPassados = useMemo(() => {
    if (!ultimoDiaLancado) return 0.5;
    const bounds = rangeBounds ?? (minPagamentoStr ? [{ from: minPagamentoStr, to: dateTo }] : []);
    let total = 0;
    bounds.forEach((b) => {
      const toStr = b.to < ultimoDiaLancado ? b.to : ultimoDiaLancado;
      if (toStr < b.from) return;
      total += businessDaysBetween(new Date(b.from + "T12:00:00"), new Date(toStr + "T12:00:00"), holidaySet, diasAbertos);
    });
    return Math.max(total, 0.5);
  }, [rangeBounds, minPagamentoStr, dateTo, ultimoDiaLancado, holidaySet, diasAbertos]);

  // Total de dias úteis do MÊS CORRENTE (para a projeção, exibida só com o mês corrente completo)
  const diasUteisMes = useMemo(() => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return Math.max(businessDaysBetween(firstDay, lastDay, holidaySet, diasAbertos), 1);
  }, [holidaySet, diasAbertos]);

  // Ticket médio diário: faturamento TOTAL do período ÷ dias úteis até o último dia
  // com lançamento (numerador e divisor cobrem a MESMA janela de dados reais).
  const ticketMedio = diasUteisPassados > 0 ? fatTotal / diasUteisPassados : 0;
  const projecaoMensal = ticketMedio * diasUteisMes;




  const kpis = [
  { title: "Fat. Novos Leads", value: formatarReais(fatNovos), icon: UserPlus, subtitle: "Primeiro pagamento" },
  { title: "Fat. Recorrentes", value: formatarReais(fatRecorrentes), icon: Repeat, subtitle: "Pagamentos recorrentes" },
  { title: "Ticket Médio Diário", value: formatarReais(ticketMedio), icon: Receipt, subtitle: receitaRecorrenteLabel ? `Faturamento (exclui ${receitaRecorrenteLabel}) ÷ dias úteis` : "Faturamento ÷ dias úteis" },
  ...(isCurrentMonthSelected
    ? [{ title: "Previsão Mensal", value: formatarReais(projecaoMensal), icon: Target, subtitle: `${formatarDiasUteis(diasUteisMes)} dias úteis no mês${horarioPadrao ? " · Horário comercial não configurado — contando segunda a sexta" : ""}` }]
    : []),
  { title: pessoaPlural.charAt(0).toUpperCase() + pessoaPlural.slice(1), value: String(totalPacientes), icon: Users, subtitle: `${pessoaPlural} com pagamento no período` }];


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




  // Chart: Faturamento por Clínica (nome como cadastrado; unidades com o mesmo
  // nome somam juntas)
  const fatClinica = useMemo(() => {
    const porId = new Map(clinicas.map((c) => [c.id, c]));
    const somaPorId = new Map<string, number>();
    pagamentosFat.forEach((p) => {
      const k = p.clinica_id ?? "";
      somaPorId.set(k, (somaPorId.get(k) || 0) + Number(p.valor));
    });
    const fatClinicaRaw = Array.from(somaPorId.entries()).map(([id, value]) => {
      const c = porId.get(id);
      return { name: c ? c.nome + (c.ativa ? "" : " (inativa)") : `${unidade} removida`, value };
    });
    const fatClinicaGrouped = new Map<string, number>();
    fatClinicaRaw.forEach(({ name, value }) => {
      fatClinicaGrouped.set(name, (fatClinicaGrouped.get(name) || 0) + value);
    });
    return Array.from(fatClinicaGrouped.entries()).map(([name, value]) => ({ name, value })).filter((d) => d.value > 0);
  }, [clinicas, pagamentosFat, unidade]);

  // Chart: Faturamento por Especialidade (soma dos pagamentos)
  const espFaturamento = useMemo(() => {
    const espFatMap = new Map<string, number>();
    pagamentosFat.forEach((p) => {
      const esp = p.especialidade || "Sem Especialidade";
      espFatMap.set(esp, (espFatMap.get(esp) || 0) + Number(p.valor || 0));
    });
    return Array.from(espFatMap.entries())
      .map(([name, value]) => ({ name, value }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [pagamentosFat]);

  // Chart: Quantidade de pagamentos por Especialidade
  const espVolume = useMemo(() => {
    const espQtdMap = new Map<string, number>();
    filtered.pagamentos.forEach((p) => {
      const esp = p.especialidade || "Sem Especialidade";
      espQtdMap.set(esp, (espQtdMap.get(esp) || 0) + 1);
    });
    return Array.from(espQtdMap.entries())
      .map(([name, value]) => ({ name, value }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  // Faturamento por procedimento: o pagamento herda o procedimento do
  // tratamento vinculado e permanece separado pela especialidade registrada.
  const procedimentoFatMap = useMemo(() => {
    const tratamentoPorId = new Map(
      tratamentos.map((tratamento) => [tratamento.id, tratamento])
    );
    const map = new Map<string, Map<string, number>>();
    pagamentosFat.forEach((pagamento) => {
      const tratamento = pagamento.tratamento_id
        ? tratamentoPorId.get(pagamento.tratamento_id)
        : null;
      const especialidade = pagamento.especialidade || tratamento?.especialidade || "Sem Especialidade";
      const procedimento = tratamento?.procedimento || "Sem procedimento informado";
      const procedimentos = map.get(especialidade) ?? new Map<string, number>();
      procedimentos.set(procedimento, (procedimentos.get(procedimento) || 0) + Number(pagamento.valor || 0));
      map.set(especialidade, procedimentos);
    });
    return map;
  }, [tratamentos, pagamentosFat]);
  const especialidadesProcedimento = useMemo(() => Array.from(procedimentoFatMap.keys()).sort((a, b) =>
    a.localeCompare(b, "pt-BR")
  ), [procedimentoFatMap]);
  const especialidadeProcedimentoAtiva = especialidadesProcedimento.includes(especialidadeProcedimento)
    ? especialidadeProcedimento
    : especialidadesProcedimento[0] || "";
  const faturamentoProcedimentos = useMemo(() => Array.from(
    procedimentoFatMap.get(especialidadeProcedimentoAtiva)?.entries() ?? []
  )
    .map(([name, value]) => ({ name, value }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value), [procedimentoFatMap, especialidadeProcedimentoAtiva]);


  // Pacientes/faturamento por canal: ambos derivados dos PAGAMENTOS do período
  // filtrado — os dois gráficos gêmeos usam o MESMO recorte (antes o de pacientes
  // mostrava a base histórica inteira, ignorando os filtros de período e clínica).
  const origemDataLocal = useMemo(() => {
    const pacienteOrigemLookup = new Map<string, string>();
    pacientes.forEach((p) => pacienteOrigemLookup.set(p.id, canalDoPaciente(p)));
    const origemMap = new Map<string, {pacs: Set<string>;fat: number;}>();
    pagamentosFat.forEach((pg) => {
      const o = pacienteOrigemLookup.get(pg.paciente_id) || "Outros";
      const entry = origemMap.get(o) || { pacs: new Set<string>(), fat: 0 };
      entry.pacs.add(pg.paciente_id);
      entry.fat += Number(pg.valor);
      origemMap.set(o, entry);
    });
    return Array.from(origemMap.entries()).map(([name, { pacs, fat }]) => ({ name, pacientes: pacs.size, faturamento: fat })).sort((a, b) => b.faturamento - a.faturamento);
  }, [pacientes, pagamentosFat]);
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
  const clinicasAtivas = clinicas.filter((c) => c.ativa);

  const cartaoDeErro = erroDeCarga ? (
    <RpcErrorCard title="Não foi possível atualizar o painel" message={erroDeCarga} onRetry={() => fetchAll(true, true)} />
  ) : null;
  if (!temDados && erroDeCarga) return cartaoDeErro;
  if (loading) {
    return <div className="flex h-64 items-center justify-center rounded-card border border-border/60 bg-card text-sm text-muted-foreground shadow-card">Carregando dados...</div>;
  }


  return (
    <div className="animate-fade-in space-y-5 lg:space-y-6 [&_.recharts-surface]:overflow-visible [&_.recharts-cartesian-grid-horizontal_line]:stroke-border [&_.recharts-cartesian-grid-vertical_line]:stroke-transparent [&_.recharts-cartesian-axis-line]:stroke-transparent [&_.recharts-cartesian-axis-tick-line]:stroke-transparent [&_.recharts-cartesian-axis-tick_text]:fill-tertiary [&_.recharts-label-list_text]:fill-muted-foreground [&_.recharts-bar-rectangle_path]:![filter:none] [&_.recharts-bar-rectangle:hover_path]:opacity-80 [&_.recharts-default-tooltip]:!rounded-lg [&_.recharts-default-tooltip]:!border-0 [&_.recharts-default-tooltip]:!bg-sidebar [&_.recharts-default-tooltip]:!px-3 [&_.recharts-default-tooltip]:!py-2 [&_.recharts-default-tooltip]:!shadow-float [&_.recharts-tooltip-label]:!text-sidebar-active-foreground/60 [&_.recharts-tooltip-label]:!text-[11px] [&_.recharts-tooltip-item]:!text-sidebar-active-foreground [&_.recharts-tooltip-item]:!text-xs [&_.recharts-tooltip-item]:!font-semibold [&_.recharts-tooltip-item]:!whitespace-pre-line [&_.recharts-legend-item-text]:!text-muted-foreground [&_.recharts-legend-item-text]:text-[13px] [&_.recharts-legend-item-text]:font-medium [&_path[fill='hsl(220,_8%,_72%)']]:fill-chart-5 [&_path[fill='hsl(220,_10%,_55%)']]:fill-slate">
      {cartaoDeErro}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-foreground sm:text-[32px]">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Visão geral do desempenho</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 [&_button]:h-10 [&_button]:rounded-xl [&_button]:bg-card [&_button]:px-3.5 [&_button]:text-[13px] [&_button]:font-medium [&_button]:shadow-xs">
          <HolidaysManager clinicas={clinicasAtivas} onChange={fetchHolidays} />
          <Suspense fallback={<div className="h-10 w-[140px] rounded-xl bg-muted" />}>
            <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
          </Suspense>
        </div>
      </div>

      {/* Filters */}
      <Card className="rounded-card border-border/60 bg-card shadow-card">
        <CardContent className="p-3 sm:p-4">
          <div className="grid gap-3 md:grid-cols-2 md:gap-4">
            <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <Label className="shrink-0 text-[13px] font-semibold text-muted-foreground">{unidade}</Label>
              <Select value={clinicaFiltro} onValueChange={setClinicaFiltro}>
                <SelectTrigger className="h-10 min-w-0 flex-1 rounded-xl border-transparent bg-surface-sunken font-medium">
                  <div className="flex min-w-0 items-center gap-2 truncate">
                  <Building2 size={16} className="shrink-0 text-primary" />
                  <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {clinicasAtivas.map((c) =>
                  <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <Label className="shrink-0 text-[13px] font-semibold text-muted-foreground">Canal de Origem</Label>
              <Select value={canalFiltro} onValueChange={setCanalFiltro}>
                <SelectTrigger className="h-10 min-w-0 flex-1 rounded-xl border-transparent bg-surface-sunken font-medium">
                  <div className="flex min-w-0 items-center gap-2 truncate">
                  <Megaphone size={16} className="shrink-0 text-primary" />
                  <SelectValue />
                  </div>
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



      {/* KPIs — mesma composição hierárquica do Dashboard CRM */}
      <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
        <Card className="relative flex min-h-[210px] flex-col overflow-hidden rounded-card border-0 bg-sidebar p-5 text-sidebar-active-foreground shadow-card sm:p-6 lg:col-span-5 lg:min-h-full lg:p-7">
          <TrendingUp size={190} strokeWidth={1.15} className="pointer-events-none absolute -bottom-12 -right-8 text-sidebar-active-foreground/[0.06]" />
          <div className="relative flex h-full min-w-0 flex-col">
            <div className="flex items-center gap-3.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-brand">
                <TrendingUp size={22} />
              </span>
              <p className="text-[15px] font-semibold leading-snug text-sidebar-foreground">Faturamento no Período</p>
            </div>
            <p className="mt-auto break-words pt-10 text-[38px] font-bold leading-none tracking-tight tabular-nums text-sidebar-active-foreground sm:text-[48px] xl:text-[54px]">
              {formatarReais(fatTotal)}
            </p>
            <p className="mt-3 text-xs leading-snug text-sidebar-foreground">
              {canalFiltro !== "todos" ? `Pagamentos do período de ${pessoaPlural} do canal selecionado` : "Pagamentos recebidos no período"}
            </p>
          </div>
        </Card>

        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:col-span-7 lg:grid-cols-6 lg:gap-4 [&>*:nth-last-child(-n+2)]:lg:col-span-3 [&>*]:lg:col-span-2 [&>*:has(svg.lucide-user-plus)_.crm-chip]:bg-success-soft [&>*:has(svg.lucide-user-plus)_.crm-chip]:text-success [&>*:has(svg.lucide-repeat)_.crm-chip]:bg-purple-soft [&>*:has(svg.lucide-repeat)_.crm-chip]:text-purple [&>*:has(svg.lucide-receipt)_.crm-chip]:bg-warning-soft [&>*:has(svg.lucide-receipt)_.crm-chip]:text-warning [&>*:has(svg.lucide-target)_.crm-chip]:bg-info-soft [&>*:has(svg.lucide-target)_.crm-chip]:text-info [&>*:has(svg.lucide-users)_.crm-chip]:bg-teal-soft [&>*:has(svg.lucide-users)_.crm-chip]:text-teal">
          {kpis.map((kpi: any) =>
          <Card key={kpi.title} className="flex min-h-[124px] min-w-0 flex-col rounded-card border-border/60 bg-card p-4 shadow-card transition-shadow hover:shadow-md sm:p-5">
              <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1fr_auto] items-start gap-x-3 gap-y-2.5">
                <p className="col-start-1 row-start-1 pt-0.5 text-xs font-semibold leading-snug text-muted-foreground sm:text-[13px]">{kpi.title}</p>
                <div className="crm-chip col-start-2 row-start-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary sm:h-11 sm:w-11">
                  <kpi.icon size={20} className="text-current" />
                </div>
                <p className="col-span-2 row-start-2 self-end break-words text-[28px] font-bold leading-none tracking-tight tabular-nums text-foreground sm:text-[32px]">{kpi.value}</p>
                {kpi.subtitle && <p className="col-span-2 row-start-3 text-[11px] leading-snug text-tertiary">{kpi.subtitle}</p>}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Gráfico Venda Diária */}
      <Card className="rounded-card border-border/60 bg-card shadow-card">
        <CardHeader className="flex flex-row items-start gap-3 space-y-0 p-5 pb-3 sm:p-6 sm:pb-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><BarChart3 size={18} /></span>
          <div className="min-w-0 space-y-1">
          <CardTitle className="text-base font-semibold leading-snug tracking-tight">Venda Diária</CardTitle>
          <p className="text-[13px] leading-relaxed text-muted-foreground">Pagamentos recebidos por dia útil no período (domingos/feriados aparecem quando há pagamento lançado)</p>
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-5 pt-0 sm:px-5">
          {vendaDiaria.length === 0 ? <div className="flex h-[260px] items-center justify-center rounded-xl bg-surface-sunken/60 px-4 text-center text-sm text-muted-foreground">Sem dados no período/filtro</div> : (<ResponsiveContainer width="100%" height={260}>
            <BarChart data={vendaDiaria} margin={{ top: 20, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
              <XAxis dataKey="dia" stroke={ct.axisColor} fontSize={10} interval={0} angle={-45} textAnchor="end" height={50} tick={{ fill: ct.axisColor }} />
              <YAxis stroke={ct.axisColor} fontSize={11} tickFormatter={formatAxisValue} width={50} tick={{ fill: ct.axisColor }} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(value: number) => [formatarReais(value), "Faturamento"]} />
              <Bar dataKey="valor" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} activeBar={activeBarStyle} label={renderBarLabel} />
            </BarChart>
          </ResponsiveContainer>)}
        </CardContent>
      </Card>




      {/* Funil de Atendimentos removido a pedido do usuário */}

      {/* Charts - dynamically shown based on active filters */}
      <div className="grid gap-4 lg:gap-5 xl:grid-cols-2">
        {showClinicaChart &&
        <ChartCard title={`Faturamento por ${unidade}`}>
            {fatClinica.length === 0 ? <div className="flex h-[280px] items-center justify-center rounded-xl bg-surface-sunken/60 px-4 text-center text-sm text-muted-foreground">Sem dados no período/filtro</div> : (<ResponsiveContainer width="100%" height={280}>
              <BarChart data={fatClinica} margin={{ top: 30, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                <XAxis dataKey="name" stroke={ct.axisColor} fontSize={11} tick={{ fill: ct.axisColor }} />
                <YAxis stroke={ct.axisColor} fontSize={11} tickFormatter={formatAxisValue} width={50} tick={{ fill: ct.axisColor }} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(value: number) => [formatarReais(value), "Faturamento"]} />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} label={renderBarLabel} activeBar={activeBarStyle} />
              </BarChart>
            </ResponsiveContainer>)}
          </ChartCard>
        }

        <ChartCard title="Faturamento por Especialidade">
          {espFaturamento.length === 0 ? <div className="flex h-[280px] items-center justify-center rounded-xl bg-surface-sunken/60 px-4 text-center text-sm text-muted-foreground">Sem dados no período/filtro</div> : (<ResponsiveContainer width="100%" height={280}>
            <BarChart data={espFaturamento} margin={{ top: 30, right: 10, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
              <XAxis dataKey="name" stroke={ct.axisColor} fontSize={10} interval={0} angle={-20} textAnchor="end" height={60} tick={{ fill: ct.axisColor }} />
              <YAxis stroke={ct.axisColor} fontSize={11} tickFormatter={formatAxisValue} width={50} tick={{ fill: ct.axisColor }} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(value: number) => [formatarReais(value), "Faturamento"]} />
              <Bar dataKey="value" fill="hsl(var(--brand-300))" radius={[6, 6, 0, 0]} label={renderBarLabel} activeBar={activeBarStyle}>
                {espFaturamento.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>)}
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

        <ChartCard
          title="Faturamento por Procedimento"
          subtitle="Selecione uma especialidade para comparar os procedimentos"
        >
          {especialidadesProcedimento.length === 0 ? (
            <div className="flex h-[280px] items-center justify-center rounded-xl bg-surface-sunken/60 px-4 text-center text-sm text-muted-foreground">
              Nenhum faturamento por procedimento no período
            </div>
          ) : (
            <>
              <Tabs value={especialidadeProcedimentoAtiva} onValueChange={setEspecialidadeProcedimento}>
                <div className="mb-4 overflow-x-auto pb-1">
                  <TabsList variant="pill" className="w-max justify-start">
                    {especialidadesProcedimento.map((especialidade) => (
                      <TabsTrigger key={especialidade} value={especialidade} className="whitespace-nowrap">
                        {especialidade}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
              </Tabs>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={faturamentoProcedimentos} margin={{ top: 30, right: 10, left: 10, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                  <XAxis dataKey="name" stroke={ct.axisColor} fontSize={10} interval={0} angle={-15} textAnchor="end" height={70} tick={{ fill: ct.axisColor }} />
                  <YAxis stroke={ct.axisColor} fontSize={11} tickFormatter={formatAxisValue} width={50} tick={{ fill: ct.axisColor }} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(value: number) => [formatarReais(value), "Faturamento"]} />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} label={renderBarLabel} activeBar={activeBarStyle} />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </ChartCard>

        <ChartCard title="Faturamento por Criativo" subtitle={criativoSubtitle}>
          {canalFiltro !== "todos" ? (
            <div className="flex h-[280px] items-center justify-center rounded-xl bg-surface-sunken/60 px-4 text-center text-sm text-muted-foreground">
              Este gráfico não considera o filtro de canal — escolha 'Todos os Canais' para ver o faturamento por criativo
            </div>
          ) : criativoMultiPeriod ? (
            <div className="flex h-[280px] items-center justify-center rounded-xl bg-surface-sunken/60 px-4 text-center text-sm text-muted-foreground">
              Selecione um período contínuo para ver o faturamento por criativo
            </div>
          ) : criativoErro ? (
            <div className="flex h-[280px] items-center justify-center rounded-xl bg-surface-sunken/60 px-4 text-center text-sm text-muted-foreground">
              Não foi possível carregar o faturamento por criativo
            </div>
          ) : !rpcCriativo ? (
            <div className="flex h-[280px] items-center justify-center rounded-xl bg-surface-sunken/60 text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : criativoTop.length === 0 ? (
            <div className="flex h-[280px] items-center justify-center rounded-xl bg-surface-sunken/60 px-4 text-center text-sm text-muted-foreground">
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
                    if (p.isOutros) return [formatarReais(value), "Faturamento"];
                    if (p.isDeclarada) {
                      return [
                        [formatarReais(value), `${p.pacientes ?? 0} ${pessoaPlural} · informado pela recepção`].join("\n"),
                        "Faturamento",
                      ];
                    }
                    const partes: string[] = [];
                    partes.push(`${p.pacientes ?? 0} ${pessoaPlural}`);
                    if (p.contas != null) partes.push(`${p.contas} contas`);
                    if (p.variantes != null) partes.push(`${p.variantes} variantes`);
                    const linhas = [formatarReais(value), partes.join(" · ")];
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
          {canalFiltro === "todos" && !criativoMultiPeriod && !criativoErro && rpcCriativo && criativoTop.some((d) => d.isDeclarada) && (
            <p className="mt-3 px-2 text-[11px] text-tertiary">
              Barras claras = informado pela recepção, não medido pelo clique.
            </p>
          )}
          {canalFiltro === "todos" && !criativoMultiPeriod && !criativoErro && rpcCriativo && criativoTop.some((d) => !d.isOutros && !d.isDeclarada && (d.variantes ?? 0) > 1) && (
            <div className="mt-3 flex flex-wrap gap-1.5 px-2 text-[11px] text-muted-foreground">
              {criativoTop
                .filter((d) => !d.isOutros && !d.isDeclarada && (d.variantes ?? 0) > 1)
                .map((d) => (
                  <span key={d.name} className="inline-flex h-6 max-w-full items-center truncate rounded-full bg-muted px-2.5 font-medium">
                    {d.name}: {d.variantes} vídeos
                  </span>
                ))}
            </div>
          )}
        </ChartCard>


        {showCanalChart &&
        <ChartCard title={`${pessoaPlural.charAt(0).toUpperCase()}${pessoaPlural.slice(1)} por Canal de Origem`} subtitle={`${pessoaPlural.charAt(0).toUpperCase()}${pessoaPlural.slice(1)} com pagamento no período filtrado, por origem`}>
            {origemData.length === 0 ? <div className="flex h-[280px] items-center justify-center rounded-xl bg-surface-sunken/60 px-4 text-center text-sm text-muted-foreground">Sem dados no período/filtro</div> : (<ResponsiveContainer width="100%" height={280}>
              <BarChart data={origemData} margin={{ top: 30, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                <XAxis dataKey="name" stroke={ct.axisColor} fontSize={11} tick={{ fill: ct.axisColor }} />
                <YAxis stroke={ct.axisColor} fontSize={11} allowDecimals={false} width={40} tick={{ fill: ct.axisColor }} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} />
                <Bar dataKey="pacientes" radius={[6, 6, 0, 0]} label={{ position: "top", fill: ct.labelColor, fontSize: 11, fontWeight: 600 }} activeBar={activeBarStyle}>
                  {origemData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>)}
          </ChartCard>
        }

        {showCanalChart &&
        <ChartCard title="Faturamento por Canal de Origem" subtitle="Pagamentos recebidos no período filtrado, por origem do paciente">
            {origemData.length === 0 ? <div className="flex h-[280px] items-center justify-center rounded-xl bg-surface-sunken/60 px-4 text-center text-sm text-muted-foreground">Sem dados no período/filtro</div> : (<ResponsiveContainer width="100%" height={280}>
              <BarChart data={origemData} margin={{ top: 30, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                <XAxis dataKey="name" stroke={ct.axisColor} fontSize={11} tick={{ fill: ct.axisColor }} />
                <YAxis stroke={ct.axisColor} fontSize={11} tickFormatter={formatAxisValue} width={50} tick={{ fill: ct.axisColor }} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(value: number) => [formatarReais(value), "Faturamento"]} />
                <Bar dataKey="faturamento" radius={[6, 6, 0, 0]} label={renderBarLabel} activeBar={activeBarStyle}>
                  {origemData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>)}
          </ChartCard>
        }
      </div>
    </div>);

};

export default Dashboard;