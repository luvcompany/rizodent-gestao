import { useState, useEffect, useMemo } from "react";
import {
  DollarSign, Users, TrendingUp, Building2, ArrowUpRight, ArrowDownRight, Filter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, FunnelChart, Funnel, LabelList } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

const COLORS = ["hsl(25, 100%, 50%)", "hsl(35, 100%, 55%)", "hsl(15, 90%, 45%)", "hsl(40, 95%, 60%)", "hsl(0, 0%, 50%)"];
const FUNNEL_COLORS = ["hsl(25, 100%, 50%)", "hsl(35, 100%, 55%)", "hsl(45, 90%, 50%)", "hsl(120, 60%, 45%)", "hsl(0, 70%, 50%)"];

const tooltipStyle = { background: "hsl(0,0%,11%)", border: "1px solid hsl(0,0%,20%)", borderRadius: "8px", color: "#fff" };

const Dashboard = () => {
  const [clinicas, setClinicas] = useState<Tables<"clinicas">[]>([]);
  const [clinicaFiltro, setClinicaFiltro] = useState("todas");
  const [pagamentos, setPagamentos] = useState<any[]>([]);
  const [tratamentos, setTratamentos] = useState<any[]>([]);
  const [pacientes, setPacientes] = useState<any[]>([]);
  const [leadsData, setLeadsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      const [{ data: cl }, { data: pg }, { data: tr }, { data: pc }, { data: ld }] = await Promise.all([
        supabase.from("clinicas").select("*").eq("ativa", true),
        supabase.from("pagamentos").select("*, clinicas(nome)"),
        supabase.from("tratamentos").select("*, clinicas(nome)"),
        supabase.from("pacientes").select("*"),
        supabase.from("leads_diarios").select("*, clinicas(nome)"),
      ]);
      setClinicas(cl || []);
      setPagamentos(pg || []);
      setTratamentos(tr || []);
      setPacientes(pc || []);
      setLeadsData(ld || []);
      setLoading(false);
    };
    fetchAll();
  }, []);

  const filtered = useMemo(() => {
    const filterByClinica = (items: any[]) =>
      clinicaFiltro === "todas" ? items : items.filter((i) => i.clinica_id === clinicaFiltro);
    return {
      pagamentos: filterByClinica(pagamentos),
      tratamentos: filterByClinica(tratamentos),
      leads: filterByClinica(leadsData),
    };
  }, [clinicaFiltro, pagamentos, tratamentos, leadsData]);

  const today = new Date().toISOString().split("T")[0];
  const thisMonth = new Date().toISOString().slice(0, 7);

  const fatDia = filtered.pagamentos.filter((p) => p.data_pagamento === today).reduce((s, p) => s + Number(p.valor), 0);
  const fatMes = filtered.pagamentos.filter((p) => p.data_pagamento?.startsWith(thisMonth)).reduce((s, p) => s + Number(p.valor), 0);
  const totalPacientes = clinicaFiltro === "todas" ? pacientes.length : filtered.tratamentos.reduce((s, t) => { s.add(t.paciente_id); return s; }, new Set()).size;
  const ticketMedio = filtered.pagamentos.length > 0 ? fatMes / filtered.pagamentos.filter((p) => p.data_pagamento?.startsWith(thisMonth)).length : 0;

  const kpis = [
    { title: "Faturamento do Dia", value: `R$ ${fatDia.toLocaleString("pt-BR")}`, icon: DollarSign },
    { title: "Faturamento do Mês", value: `R$ ${fatMes.toLocaleString("pt-BR")}`, icon: TrendingUp },
    { title: "Ticket Médio", value: `R$ ${ticketMedio.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`, icon: DollarSign },
    { title: "Pacientes", value: String(totalPacientes), icon: Users },
  ];

  // Chart: Faturamento por Clínica
  const fatClinica = clinicas.map((c) => ({
    name: c.nome.replace("Clínica ", ""),
    value: pagamentos.filter((p) => p.clinica_id === c.id && p.data_pagamento?.startsWith(thisMonth)).reduce((s, p) => s + Number(p.valor), 0),
  }));

  // Chart: Faturamento por Procedimento
  const procMap = new Map<string, number>();
  filtered.tratamentos.forEach((t) => {
    const paid = pagamentos.filter((p) => p.tratamento_id === t.id && p.data_pagamento?.startsWith(thisMonth)).reduce((s, p) => s + Number(p.valor), 0);
    procMap.set(t.procedimento, (procMap.get(t.procedimento) || 0) + paid);
  });
  const fatProcedimento = Array.from(procMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);

  // Chart: Origem pacientes
  const origemMap = new Map<string, number>();
  pacientes.forEach((p) => { const o = p.origem || "Outros"; origemMap.set(o, (origemMap.get(o) || 0) + 1); });
  const origemData = Array.from(origemMap.entries()).map(([name, value]) => ({ name, value }));

  // Funnel: Leads
  const funnelTotals = filtered.leads.reduce(
    (acc, l) => ({
      leads: acc.leads + l.leads_novos,
      agendaram: acc.agendaram + l.agendaram,
      compareceram: acc.compareceram + (l.agendaram - l.faltaram),
      contrataram: acc.contrataram + l.contrataram,
      naoContrataram: acc.naoContrataram + l.nao_contrataram,
    }),
    { leads: 0, agendaram: 0, compareceram: 0, contrataram: 0, naoContrataram: 0 }
  );
  const funnelData = [
    { name: "Leads", value: funnelTotals.leads, fill: FUNNEL_COLORS[0] },
    { name: "Agendaram", value: funnelTotals.agendaram, fill: FUNNEL_COLORS[1] },
    { name: "Compareceram", value: funnelTotals.compareceram, fill: FUNNEL_COLORS[2] },
    { name: "Contrataram", value: funnelTotals.contrataram, fill: FUNNEL_COLORS[3] },
    { name: "Não Contrataram", value: funnelTotals.naoContrataram, fill: FUNNEL_COLORS[4] },
  ];

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
        <Select value={clinicaFiltro} onValueChange={setClinicaFiltro}>
          <SelectTrigger className="w-48 bg-secondary border-border">
            <Building2 size={16} className="mr-2 text-primary" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as Clínicas</SelectItem>
            {clinicas.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.title} className="gradient-card border-border shadow-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
              <div className="rounded-lg bg-primary/10 p-2">
                <kpi.icon size={18} className="text-primary" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpi.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Funnel */}
      <Card className="gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Filter size={18} className="text-primary" />
            Funil de Vendas (Mês Atual)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-5">
            {funnelData.map((item, i) => (
              <div key={item.name} className="text-center">
                <div className="text-3xl font-bold" style={{ color: item.fill }}>{item.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{item.name}</div>
                {i > 0 && funnelData[0].value > 0 && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {((item.value / funnelData[0].value) * 100).toFixed(1)}%
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex h-8 overflow-hidden rounded-lg">
            {funnelData.filter(d => d.value > 0).map((item) => {
              const total = funnelData.reduce((s, d) => s + d.value, 0) || 1;
              return (
                <div key={item.name} style={{ width: `${(item.value / total) * 100}%`, backgroundColor: item.fill }} className="transition-all" title={`${item.name}: ${item.value}`} />
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gradient-card border-border shadow-card">
          <CardHeader><CardTitle className="text-base">Faturamento por Clínica</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={fatClinica}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                <XAxis dataKey="name" stroke="hsl(0,0%,64%)" fontSize={12} />
                <YAxis stroke="hsl(0,0%,64%)" fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`R$ ${value.toLocaleString("pt-BR")}`, "Faturamento"]} />
                <Bar dataKey="value" fill="hsl(25,100%,50%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="gradient-card border-border shadow-card">
          <CardHeader><CardTitle className="text-base">Faturamento por Procedimento</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={fatProcedimento} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                <XAxis type="number" stroke="hsl(0,0%,64%)" fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" stroke="hsl(0,0%,64%)" fontSize={12} width={90} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`R$ ${value.toLocaleString("pt-BR")}`, "Faturamento"]} />
                <Bar dataKey="value" fill="hsl(35,100%,55%)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gradient-card border-border shadow-card">
          <CardHeader><CardTitle className="text-base">Origem dos Pacientes</CardTitle></CardHeader>
          <CardContent className="flex items-center justify-center">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={origemData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {origemData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="gradient-card border-border shadow-card">
          <CardHeader><CardTitle className="text-base">Faturamento por Anúncio</CardTitle></CardHeader>
          <CardContent>
            {(() => {
              const anuncioMap = new Map<string, number>();
              pacientes.forEach((p) => {
                if (!p.nome_anuncio) return;
                const paid = pagamentos.filter((pg) => pg.paciente_id === p.id && pg.data_pagamento?.startsWith(thisMonth)).reduce((s, pg) => s + Number(pg.valor), 0);
                anuncioMap.set(p.nome_anuncio, (anuncioMap.get(p.nome_anuncio) || 0) + paid);
              });
              const anuncioData = Array.from(anuncioMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);
              return (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={anuncioData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                    <XAxis dataKey="name" stroke="hsl(0,0%,64%)" fontSize={11} interval={0} angle={-15} textAnchor="end" height={50} />
                    <YAxis stroke="hsl(0,0%,64%)" fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`R$ ${value.toLocaleString("pt-BR")}`, "Faturamento"]} />
                    <Bar dataKey="value" fill="hsl(15,90%,45%)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
