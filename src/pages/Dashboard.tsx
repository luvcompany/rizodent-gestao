import { useState, useMemo } from "react";
import {
  DollarSign,
  Users,
  TrendingUp,
  Building2,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const COLORS = ["hsl(25, 100%, 50%)", "hsl(35, 100%, 55%)", "hsl(15, 90%, 45%)", "hsl(40, 95%, 60%)", "hsl(0, 0%, 50%)"];

const clinicas = ["Todas", "Clínica SP", "Clínica RJ", "Clínica BH", "Clínica Curitiba", "Clínica Porto Alegre"];

const faturamentoClinica = [
  { name: "SP", value: 42500 },
  { name: "RJ", value: 38200 },
  { name: "BH", value: 29800 },
  { name: "Curitiba", value: 25100 },
  { name: "POA", value: 21400 },
];

const faturamentoProcedimento = [
  { name: "Implante", value: 58000 },
  { name: "Ortodontia", value: 34000 },
  { name: "Clareamento", value: 18500 },
  { name: "Prótese", value: 22000 },
  { name: "Limpeza", value: 8500 },
];

const origemPacientes = [
  { name: "Instagram", value: 35 },
  { name: "Google Ads", value: 28 },
  { name: "Indicação", value: 20 },
  { name: "Facebook", value: 12 },
  { name: "Outros", value: 5 },
];

const faturamentoAnuncio = [
  { name: "Campanha Implante Jan", value: 32000 },
  { name: "Promo Clareamento", value: 15000 },
  { name: "Campanha Geral", value: 22000 },
  { name: "Remarketing", value: 12500 },
];

const Dashboard = () => {
  const [clinicaFiltro, setClinicaFiltro] = useState("Todas");

  const kpis = useMemo(() => [
    {
      title: "Faturamento do Dia",
      value: "R$ 12.450",
      change: "+8.2%",
      up: true,
      icon: DollarSign,
    },
    {
      title: "Faturamento do Mês",
      value: "R$ 157.000",
      change: "+12.5%",
      up: true,
      icon: TrendingUp,
    },
    {
      title: "Ticket Médio",
      value: "R$ 2.340",
      change: "-3.1%",
      up: false,
      icon: DollarSign,
    },
    {
      title: "Pacientes Atendidos",
      value: "67",
      change: "+15%",
      up: true,
      icon: Users,
    },
  ], []);

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
            {clinicas.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
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
              <div className={`mt-1 flex items-center text-xs ${kpi.up ? "text-green-400" : "text-red-400"}`}>
                {kpi.up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {kpi.change} vs. mês anterior
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Row 1 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gradient-card border-border shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Faturamento por Clínica</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={faturamentoClinica}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                <XAxis dataKey="name" stroke="hsl(0,0%,64%)" fontSize={12} />
                <YAxis stroke="hsl(0,0%,64%)" fontSize={12} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "hsl(0,0%,11%)", border: "1px solid hsl(0,0%,20%)", borderRadius: "8px", color: "#fff" }}
                  formatter={(value: number) => [`R$ ${value.toLocaleString("pt-BR")}`, "Faturamento"]}
                />
                <Bar dataKey="value" fill="hsl(25,100%,50%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="gradient-card border-border shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Faturamento por Procedimento</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={faturamentoProcedimento} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                <XAxis type="number" stroke="hsl(0,0%,64%)" fontSize={12} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" stroke="hsl(0,0%,64%)" fontSize={12} width={90} />
                <Tooltip
                  contentStyle={{ background: "hsl(0,0%,11%)", border: "1px solid hsl(0,0%,20%)", borderRadius: "8px", color: "#fff" }}
                  formatter={(value: number) => [`R$ ${value.toLocaleString("pt-BR")}`, "Faturamento"]}
                />
                <Bar dataKey="value" fill="hsl(35,100%,55%)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gradient-card border-border shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Origem dos Pacientes</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={origemPacientes} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {origemPacientes.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "hsl(0,0%,11%)", border: "1px solid hsl(0,0%,20%)", borderRadius: "8px", color: "#fff" }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="gradient-card border-border shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Faturamento por Anúncio</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={faturamentoAnuncio}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                <XAxis dataKey="name" stroke="hsl(0,0%,64%)" fontSize={11} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis stroke="hsl(0,0%,64%)" fontSize={12} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "hsl(0,0%,11%)", border: "1px solid hsl(0,0%,20%)", borderRadius: "8px", color: "#fff" }}
                  formatter={(value: number) => [`R$ ${value.toLocaleString("pt-BR")}`, "Faturamento"]}
                />
                <Bar dataKey="value" fill="hsl(15,90%,45%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
