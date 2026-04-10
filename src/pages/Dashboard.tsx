import { useState, useEffect, useMemo } from "react";
import {
  DollarSign, Users, TrendingUp, Building2, Filter, CalendarIcon, Megaphone } from
"lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateRangeFilter, type DateRangeFilterValue, getDateRangeFromFilter } from "@/components/ui/date-range-filter";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import DashboardFunnel from "@/components/DashboardFunnel";
import { useChartTheme } from "@/hooks/useChartTheme";

const COLORS = ["hsl(25, 100%, 50%)", "hsl(35, 100%, 55%)", "hsl(15, 90%, 45%)", "hsl(40, 95%, 60%)", "hsl(200, 70%, 50%)", "hsl(280, 60%, 55%)"];

const formatAxisValue = (v: number) => {
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return String(v);
};

const formatCurrency = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

  const ChartCard = ({ title, children }: {title: string; children: React.ReactNode}) => (
    <Card className="gradient-card border-border shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
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
  const [leadsData, setLeadsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<DateRangeFilterValue>({ preset: "this_month" });
  const dateRange = useMemo(() => getDateRangeFromFilter(dateFilter), [dateFilter]);
  const isAllPeriod = dateFilter.preset === "all";
  const dateFrom = useMemo(() => dateRange ? dateRange.start.toISOString().split("T")[0] : "2020-01-01", [dateRange]);
  const dateTo = useMemo(() => dateRange ? dateRange.end.toISOString().split("T")[0] : new Date().toISOString().split("T")[0], [dateRange]);
  // Determine if charts should aggregate by month (when range > 60 days)
  const useMonthlyChart = useMemo(() => {
    const d1 = new Date(dateFrom);
    const d2 = new Date(dateTo);
    return (d2.getTime() - d1.getTime()) / 86400000 > 60;
  }, [dateFrom, dateTo]);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      const [{ data: cl }, { data: pg }, { data: tr }, { data: pc }, { data: ld }] = await Promise.all([
      supabase.from("clinicas").select("*").eq("ativa", true),
      supabase.from("pagamentos").select("*, clinicas(nome)"),
      supabase.from("tratamentos").select("*, clinicas(nome)"),
      supabase.from("pacientes").select("*"),
      supabase.from("leads_diarios").select("*, clinicas(nome)")]
      );
      setClinicas(cl || []);
      setPagamentos(pg || []);
      setTratamentos(tr || []);
      setPacientes(pc || []);
      setLeadsData(ld || []);
      setLoading(false);
    };
    fetchAll();
  }, []);

  // Unique values for filter dropdowns

  const canaisUnicos = useMemo(() => {
    const set = new Set(pacientes.map((p) => p.origem).filter(Boolean));
    return Array.from(set).sort();
  }, [pacientes]);

  const filtered = useMemo(() => {
    const filterByClinica = (items: any[]) =>
    clinicaFiltro === "todas" ? items : items.filter((i) => i.clinica_id === clinicaFiltro);
    const filterByDate = (items: any[], dateField: string) =>
    items.filter((i) => {
      const val = i[dateField]?.split("T")[0] || i[dateField];
      return val >= dateFrom && val <= dateTo;
    });

    let filteredTratamentos = filterByDate(filterByClinica(tratamentos), "created_at");

    const tratamentoIds = new Set(filteredTratamentos.map((t) => t.id));
    const pacienteIds = new Set(filteredTratamentos.map((t) => t.paciente_id));

    // Filter pacientes by canal
    let filteredPacientes = pacientes;
    if (canalFiltro !== "todos") {
      filteredPacientes = pacientes.filter((p) => (p.origem || "Outros") === canalFiltro);
      // Further restrict tratamentos/pagamentos to only these pacientes
      const canalPacienteIds = new Set(filteredPacientes.map((p) => p.id));
      filteredTratamentos = filteredTratamentos.filter((t) => canalPacienteIds.has(t.paciente_id));
    }

    const finalTratamentoIds = new Set(filteredTratamentos.map((t) => t.id));
    const finalPacienteIds = new Set(filteredTratamentos.map((t) => t.paciente_id));

    let filteredPagamentos = filterByDate(filterByClinica(pagamentos), "data_pagamento");
    // Only include pagamentos linked to filtered tratamentos
    if (canalFiltro !== "todos") {
      filteredPagamentos = filteredPagamentos.filter((p) => finalTratamentoIds.has(p.tratamento_id));
    }

    return {
      pagamentos: filteredPagamentos,
      tratamentos: filteredTratamentos,
      leads: filterByDate(filterByClinica(leadsData), "data"),
      pacientes: filteredPacientes
    };
  }, [clinicaFiltro, canalFiltro, pagamentos, tratamentos, pacientes, leadsData, dateFrom, dateTo]);

  const fatTotal = filtered.pagamentos.reduce((s, p) => s + Number(p.valor), 0);
  const fatNovos = filtered.pagamentos.filter((p) => p.tipo === "primeiro").reduce((s, p) => s + Number(p.valor), 0);
  const fatRecorrentes = filtered.pagamentos.filter((p) => p.tipo === "recorrente").reduce((s, p) => s + Number(p.valor), 0);
  const totalPacientes = new Set(filtered.pagamentos.map((p) => p.paciente_id)).size;

  // Dias úteis passados no período (seg-sáb, excluindo domingos)
  const diasUteisPassados = useMemo(() => {
    const start = new Date(dateFrom + "T12:00:00");
    const today = new Date();
    const endDate = new Date(dateTo + "T12:00:00");
    const limit = endDate < today ? endDate : today;
    let count = 0;
    const current = new Date(start);
    while (current <= limit) {
      if (current.getDay() !== 0) count++;
      current.setDate(current.getDate() + 1);
    }
    return Math.max(count, 1);
  }, [dateFrom, dateTo]);

  // Total de dias úteis do mês completo
  const diasUteisMes = useMemo(() => {
    const refDate = new Date(dateFrom + "T12:00:00");
    const year = refDate.getFullYear();
    const month = refDate.getMonth();
    const totalDays = new Date(year, month + 1, 0).getDate();
    let count = 0;
    for (let day = 1; day <= totalDays; day++) {
      const dow = new Date(year, month, day).getDay();
      if (dow !== 0) count++;
    }
    return count;
  }, [dateFrom]);

  // Ticket médio = faturamento / dias úteis passados
  const ticketMedio = fatTotal / diasUteisPassados;
  const projecaoMensal = ticketMedio * diasUteisMes;

  const kpis = [
  { title: "Faturamento no Período", value: formatCurrency(fatTotal), icon: TrendingUp },
  { title: "Fat. Novos Leads", value: formatCurrency(fatNovos), icon: Users, subtitle: "Primeiro pagamento" },
  { title: "Fat. Recorrentes", value: formatCurrency(fatRecorrentes), icon: DollarSign, subtitle: "Pagamentos recorrentes" },
  { title: "Ticket Médio Diário", value: formatCurrency(ticketMedio), icon: DollarSign },
  { title: "Previsão Mensal", value: formatCurrency(projecaoMensal), icon: TrendingUp, subtitle: `${diasUteisMes} dias úteis no mês` },
  { title: "Pacientes", value: String(totalPacientes), icon: Users }];


  // Chart: Venda Diária (todos os dias úteis do período)
  const vendaDiaria = useMemo(() => {
    if (useMonthlyChart) {
      // Aggregate by month
      const monthMap = new Map<string, number>();
      filtered.pagamentos.forEach((p) => {
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
    const end = new Date(dateTo + "T12:00:00");
    const pgMap = new Map<string, number>();
    filtered.pagamentos.forEach((p) => {
      pgMap.set(p.data_pagamento, (pgMap.get(p.data_pagamento) || 0) + Number(p.valor));
    });
    const days: { dia: string; valor: number }[] = [];
    const current = new Date(start);
    while (current <= end) {
      if (current.getDay() !== 0) {
        const dateStr = current.toISOString().split("T")[0];
        const label = current.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
        days.push({ dia: label, valor: pgMap.get(dateStr) || 0 });
      }
      current.setDate(current.getDate() + 1);
    }
    return days;
  }, [dateFrom, dateTo, filtered.pagamentos, useMonthlyChart]);

  // Chart: Leads Novos Diários (todos os dias úteis do período)
  const leadsDiario = useMemo(() => {
    if (useMonthlyChart) {
      const monthMap = new Map<string, number>();
      filtered.leads.forEach((l) => {
        const key = l.data.substring(0, 7);
        monthMap.set(key, (monthMap.get(key) || 0) + l.leads_novos);
      });
      const sorted = Array.from(monthMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      return sorted.map(([key, leads]) => {
        const [y, m] = key.split("-");
        return { dia: `${m}/${y.slice(2)}`, leads };
      });
    }
    const start = new Date(dateFrom + "T12:00:00");
    const end = new Date(dateTo + "T12:00:00");
    const leadsMap = new Map<string, number>();
    filtered.leads.forEach((l) => {
      leadsMap.set(l.data, (leadsMap.get(l.data) || 0) + l.leads_novos);
    });
    const days: { dia: string; leads: number }[] = [];
    const current = new Date(start);
    while (current <= end) {
      if (current.getDay() !== 0) {
        const dateStr = current.toISOString().split("T")[0];
        const label = current.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
        days.push({ dia: label, leads: leadsMap.get(dateStr) || 0 });
      }
      current.setDate(current.getDate() + 1);
    }
    return days;
  }, [dateFrom, dateTo, filtered.leads, useMonthlyChart]);

  // Chart: Faturamento por Clínica (agrupando VCA 01 + VCA 02 como "VCA")
  const fatClinicaRaw = clinicas.map((c) => {
    let name = c.nome.replace("Clínica ", "").replace("Rizodent ", "");
    if (name.includes("VCA")) name = "VCA";
    return {
      name,
      value: filtered.pagamentos.filter((p) => p.clinica_id === c.id).reduce((s, p) => s + Number(p.valor), 0)
    };
  });
  const fatClinicaGrouped = new Map<string, number>();
  fatClinicaRaw.forEach(({ name, value }) => {
    fatClinicaGrouped.set(name, (fatClinicaGrouped.get(name) || 0) + value);
  });
  const fatClinica = Array.from(fatClinicaGrouped.entries()).map(([name, value]) => ({ name, value })).filter((d) => d.value > 0);

  // Chart: Procedimentos mais contratados (volume)
  const procMap = new Map<string, number>();
  filtered.tratamentos.forEach((t) => {
    procMap.set(t.procedimento, (procMap.get(t.procedimento) || 0) + 1);
  });
  const procVolume = Array.from(procMap.entries()).map(([name, value]) => ({ name, value })).filter((d) => d.value > 0).sort((a, b) => b.value - a.value).slice(0, 8);

  // Chart: Volume por Especialidade (quantidade de tratamentos, não faturamento)
  const espMap = new Map<string, number>();
  filtered.tratamentos.forEach((t) => {
    const esp = t.especialidade || "Sem Especialidade";
    espMap.set(esp, (espMap.get(esp) || 0) + 1);
  });
  const espVolume = Array.from(espMap.entries()).map(([name, value]) => ({ name, value })).filter((d) => d.value > 0).sort((a, b) => b.value - a.value);


  const origemMap = new Map<string, {qtd: number;fat: number;}>();
  filtered.pacientes.forEach((p) => {
    const o = p.origem || "Outros";
    const entry = origemMap.get(o) || { qtd: 0, fat: 0 };
    entry.qtd += 1;
    const fat = filtered.pagamentos.filter((pg) => pg.paciente_id === p.id).reduce((s, pg) => s + Number(pg.valor), 0);
    entry.fat += fat;
    origemMap.set(o, entry);
  });
  const origemData = Array.from(origemMap.entries()).map(([name, { qtd, fat }]) => ({ name, pacientes: qtd, faturamento: fat })).sort((a, b) => b.faturamento - a.faturamento);

  // Chart: Faturamento por Anúncio
  const anuncioMap = new Map<string, number>();
  filtered.pacientes.forEach((p) => {
    if (!p.nome_anuncio) return;
    const key = p.nome_anuncio.trim().toLowerCase();
    const paid = filtered.pagamentos.filter((pg) => pg.paciente_id === p.id).reduce((s, pg) => s + Number(pg.valor), 0);
    anuncioMap.set(key, (anuncioMap.get(key) || 0) + paid);
  });
  // Keep original casing for display: use first occurrence
  const anuncioDisplayNames = new Map<string, string>();
  filtered.pacientes.forEach((p) => {
    if (!p.nome_anuncio) return;
    const key = p.nome_anuncio.trim().toLowerCase();
    if (!anuncioDisplayNames.has(key)) anuncioDisplayNames.set(key, p.nome_anuncio.trim());
  });
  const anuncioData = Array.from(anuncioMap.entries()).map(([key, value]) => ({ name: anuncioDisplayNames.get(key) || key, value })).filter((d) => d.value > 0).sort((a, b) => b.value - a.value).slice(0, 6);

  // Funnel data - Leads Novos is separate from Atendimentos do Dia
  const funnelTotals = filtered.leads.reduce(
    (acc, l) => ({
      leads: acc.leads + l.leads_novos,
      agendaram: acc.agendaram + l.agendaram,
      compareceram: acc.compareceram + l.compareceram,
      contrataram: acc.contrataram + l.contrataram,
      faltaram: acc.faltaram + l.faltaram,
      naoContrataram: acc.naoContrataram + l.nao_contrataram,
      remarcados: acc.remarcados + l.remarcados,
      reagendadosCompareceram: acc.reagendadosCompareceram + ((l as any).reagendados_compareceram || 0),
      reagendadosContrataram: acc.reagendadosContrataram + ((l as any).reagendados_contrataram || 0),
    }),
    { leads: 0, agendaram: 0, compareceram: 0, contrataram: 0, faltaram: 0, naoContrataram: 0, remarcados: 0, reagendadosCompareceram: 0, reagendadosContrataram: 0 }
  );

  // Faltas líquidas: brutas - reagendados + faltas no reagendamento
  const faltasLiquidas = Math.max(funnelTotals.faltaram - funnelTotals.remarcados + (funnelTotals.remarcados - funnelTotals.reagendadosCompareceram), 0);
  const totalCompareceram = funnelTotals.compareceram + funnelTotals.reagendadosCompareceram;
  const totalContrataram = funnelTotals.contrataram + funnelTotals.reagendadosContrataram;
  const totalNaoContrataram = totalCompareceram - totalContrataram;

  const FUNNEL_COLORS = ["hsl(25, 100%, 50%)", "hsl(35, 100%, 55%)", "hsl(0, 60%, 50%)", "hsl(200, 70%, 50%)", "hsl(45, 90%, 50%)", "hsl(120, 60%, 45%)", "hsl(0, 70%, 50%)"];

  const [funnelView, setFunnelView] = useState<"agendamentos" | "conversao" | "reagendados">("agendamentos");

  const funnelDataAgendamentos = [
    { name: "Agendados", value: funnelTotals.agendaram, fill: FUNNEL_COLORS[1], refValue: funnelTotals.agendaram },
    { name: "Compareceram", value: funnelTotals.compareceram, fill: FUNNEL_COLORS[4], refValue: funnelTotals.agendaram },
    { name: "Contrataram", value: funnelTotals.contrataram, fill: FUNNEL_COLORS[5], refValue: funnelTotals.compareceram },
    { name: "Não Contrataram", value: Math.max(funnelTotals.compareceram - funnelTotals.contrataram, 0), fill: FUNNEL_COLORS[6], refValue: funnelTotals.compareceram },
    { name: "Faltaram", value: funnelTotals.faltaram, fill: FUNNEL_COLORS[2], refValue: funnelTotals.agendaram },
  ];

  const reagFaltaram = Math.max(funnelTotals.remarcados - funnelTotals.reagendadosCompareceram, 0);
  const reagNaoContrataram = Math.max(funnelTotals.reagendadosCompareceram - funnelTotals.reagendadosContrataram, 0);

  const funnelDataReagendados = [
    { name: "Reagendados", value: funnelTotals.remarcados, fill: FUNNEL_COLORS[3], refValue: funnelTotals.remarcados },
    { name: "Compareceram", value: funnelTotals.reagendadosCompareceram, fill: FUNNEL_COLORS[4], refValue: funnelTotals.remarcados },
    { name: "Contrataram", value: funnelTotals.reagendadosContrataram, fill: FUNNEL_COLORS[5], refValue: funnelTotals.reagendadosCompareceram },
    { name: "Não Contrataram", value: reagNaoContrataram, fill: FUNNEL_COLORS[6], refValue: funnelTotals.reagendadosCompareceram },
    { name: "Faltaram", value: reagFaltaram, fill: FUNNEL_COLORS[2], refValue: funnelTotals.remarcados },
  ];

  const funnelDataConversao = [
    { name: "Total Compareceram", value: totalCompareceram, fill: FUNNEL_COLORS[1], refValue: totalCompareceram },
    { name: "Total Contrataram", value: totalContrataram, fill: FUNNEL_COLORS[5], refValue: totalCompareceram },
    { name: "Total Não Contrat.", value: Math.max(totalNaoContrataram, 0), fill: FUNNEL_COLORS[6], refValue: totalCompareceram },
    { name: "Faltas Líquidas", value: faltasLiquidas, fill: FUNNEL_COLORS[2], refValue: funnelTotals.agendaram + funnelTotals.remarcados },
  ];

  const funnelData = funnelView === "agendamentos" ? funnelDataAgendamentos : funnelView === "conversao" ? funnelDataConversao : funnelDataReagendados;


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
        <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
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
          <p className="text-xs text-muted-foreground">Valor contratado por dia útil no período</p>
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

      {/* Leads Novos KPI */}
      <Card className="gradient-card border-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Leads Novos no Período</CardTitle>
          <div className="rounded-lg bg-primary/10 p-2">
            <Users size={18} className="text-primary" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{funnelTotals.leads}</div>
          <p className="text-xs text-muted-foreground mt-0.5">Total de novos leads que entraram</p>
        </CardContent>
      </Card>

      {/* Gráfico Leads Novos Diário */}
      <Card className="gradient-card border-border shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Leads Novos por Dia</CardTitle>
          <p className="text-xs text-muted-foreground">Quantidade de leads novos por dia útil no período</p>
        </CardHeader>
        <CardContent className="pt-0">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={leadsDiario} margin={{ top: 20, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
              <XAxis dataKey="dia" stroke={ct.axisColor} fontSize={10} interval={0} angle={-45} textAnchor="end" height={50} tick={{ fill: ct.axisColor }} />
              <YAxis stroke={ct.axisColor} fontSize={11} allowDecimals={false} width={40} tick={{ fill: ct.axisColor }} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(value: number) => [value, "Leads"]} />
              <Bar dataKey="leads" fill="hsl(200,70%,50%)" radius={[4, 4, 0, 0]} activeBar={activeBarStyle} label={renderBarLabel} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Funnel - Atendimentos do Dia */}
      <Card className="gradient-card border-border shadow-card">
        <CardHeader>
           <CardTitle className="text-base flex items-center gap-2">
             <Filter size={18} className="text-primary" />
             Funil de Atendimentos (Período Selecionado)
           </CardTitle>
           <div className="flex items-center gap-2 mt-2">
             <Button
               variant={funnelView === "agendamentos" ? "default" : "outline"}
               size="sm"
               onClick={() => setFunnelView("agendamentos")}
               className="text-xs"
             >
               Agendamentos
             </Button>
             <Button
               variant={funnelView === "reagendados" ? "default" : "outline"}
               size="sm"
               onClick={() => setFunnelView("reagendados")}
               className="text-xs"
             >
               Reagendados
             </Button>
             <Button
               variant={funnelView === "conversao" ? "default" : "outline"}
               size="sm"
               onClick={() => setFunnelView("conversao")}
               className="text-xs"
             >
               Conversão Total
             </Button>
           </div>
           <p className="text-xs text-muted-foreground mt-1">
             {funnelView === "agendamentos"
               ? "Agendados → Compareceram → Contrataram → Não Contrataram → Faltaram"
               : funnelView === "reagendados"
               ? "Reagendados → Compareceram → Contrataram → Não Contrataram → Faltaram"
               : "Total Compareceram → Contrataram → Não Contrataram → Faltas Líquidas"}
           </p>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="numeros" className="space-y-4">
            <TabsList className="bg-secondary">
              <TabsTrigger value="numeros">Números</TabsTrigger>
              <TabsTrigger value="funil">Funil Visual</TabsTrigger>
            </TabsList>
            <TabsContent value="numeros">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {funnelData.map((item, i) => {
                  const pct = i > 0 && item.refValue > 0 ? (item.value / item.refValue * 100).toFixed(1) : null;
                  return (
                    <div key={item.name} className="text-center">
                      <div className="text-3xl font-bold" style={{ color: item.fill }}>{item.value}</div>
                      <div className="text-xs text-muted-foreground mt-1">{item.name}</div>
                      {pct && <div className="text-xs text-muted-foreground mt-0.5">{pct}%</div>}
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex h-8 overflow-hidden rounded-lg">
                {funnelData.filter((d) => d.value > 0).map((item) => {
                  const total = funnelData.reduce((s, d) => s + d.value, 0) || 1;
                  return (
                    <div key={item.name} style={{ width: `${item.value / total * 100}%`, backgroundColor: item.fill }} className="transition-all" title={`${item.name}: ${item.value}`} />);

                })}
              </div>
            </TabsContent>
            <TabsContent value="funil">
              <DashboardFunnel data={funnelData} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

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

        <ChartCard title="Procedimentos Mais Contratados">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={procVolume} margin={{ top: 30, right: 10, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
              <XAxis dataKey="name" stroke={ct.axisColor} fontSize={10} interval={0} angle={-20} textAnchor="end" height={60} tick={{ fill: ct.axisColor }} />
              <YAxis stroke={ct.axisColor} fontSize={11} allowDecimals={false} width={40} tick={{ fill: ct.axisColor }} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(value: number) => [value, "Quantidade"]} />
              <Bar dataKey="value" fill="hsl(35,100%,55%)" radius={[6, 6, 0, 0]} label={{ position: "top", fill: ct.labelColor, fontSize: 11, fontWeight: 600 }} activeBar={activeBarStyle} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Tratamentos por Especialidade">
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

        <ChartCard title="Faturamento por Anúncio">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={anuncioData} margin={{ top: 30, right: 10, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
              <XAxis dataKey="name" stroke={ct.axisColor} fontSize={10} interval={0} angle={-20} textAnchor="end" height={60} tick={{ fill: ct.axisColor }} />
              <YAxis stroke={ct.axisColor} fontSize={11} tickFormatter={formatAxisValue} width={50} tick={{ fill: ct.axisColor }} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(value: number) => [formatCurrency(value), "Faturamento"]} />
              <Bar dataKey="value" fill="hsl(15,90%,45%)" radius={[6, 6, 0, 0]} label={renderBarLabel} activeBar={activeBarStyle} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {showCanalChart &&
        <ChartCard title="Pacientes por Canal de Origem">
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
        <ChartCard title="Faturamento por Canal de Origem">
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