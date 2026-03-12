import { useState, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FileBarChart, Download, Share2, MessageCircle, Mail, Calendar, TrendingUp, Filter } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import * as XLSX from "xlsx";
import type { Tables } from "@/integrations/supabase/types";

const tooltipStyle = { background: "hsl(0,0%,11%)", border: "1px solid hsl(0,0%,20%)", borderRadius: "8px", color: "#fff" };

const formatCurrency = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

const Relatorios = () => {
  const [clinicas, setClinicas] = useState<Tables<"clinicas">[]>([]);
  const [clinicaFiltro, setClinicaFiltro] = useState("todas");
  const [pagamentos, setPagamentos] = useState<any[]>([]);
  const [tratamentos, setTratamentos] = useState<any[]>([]);
  const [pacientes, setPacientes] = useState<any[]>([]);
  const [leadsData, setLeadsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      const [{ data: cl }, { data: pg }, { data: tr }, { data: pc }, { data: ld }] = await Promise.all([
        supabase.from("clinicas").select("*").eq("ativa", true),
        supabase.from("pagamentos").select("*, clinicas(nome), pacientes(nome)"),
        supabase.from("tratamentos").select("*, clinicas(nome), pacientes(nome)"),
        supabase.from("pacientes").select("*"),
        supabase.from("leads_diarios").select("*, clinicas(nome)"),
      ]);
      setClinicas(cl || []); setPagamentos(pg || []); setTratamentos(tr || []);
      setPacientes(pc || []); setLeadsData(ld || []);
      setLoading(false);
    };
    fetchAll();
  }, []);

  const filteredPagamentos = useMemo(() => {
    return pagamentos.filter((p) => {
      const inClinica = clinicaFiltro === "todas" || p.clinica_id === clinicaFiltro;
      const inDate = p.data_pagamento >= dateFrom && p.data_pagamento <= dateTo;
      return inClinica && inDate;
    });
  }, [pagamentos, clinicaFiltro, dateFrom, dateTo]);

  const filteredLeads = useMemo(() => {
    return leadsData.filter((l) => {
      const inClinica = clinicaFiltro === "todas" || l.clinica_id === clinicaFiltro;
      const inDate = l.data >= dateFrom && l.data <= dateTo;
      return inClinica && inDate;
    });
  }, [leadsData, clinicaFiltro, dateFrom, dateTo]);

  const filteredTratamentos = useMemo(() => {
    return tratamentos.filter((t) => {
      const inClinica = clinicaFiltro === "todas" || t.clinica_id === clinicaFiltro;
      return inClinica;
    });
  }, [tratamentos, clinicaFiltro]);

  // Daily report
  const dailyReport = useMemo(() => {
    const map = new Map<string, { date: string; faturamento: number; pagamentos: number }>();
    filteredPagamentos.forEach((p) => {
      const d = p.data_pagamento;
      const entry = map.get(d) || { date: d, faturamento: 0, pagamentos: 0 };
      entry.faturamento += Number(p.valor);
      entry.pagamentos += 1;
      map.set(d, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredPagamentos]);

  // Weekly report
  const weeklyReport = useMemo(() => {
    const getWeek = (dateStr: string) => {
      const d = new Date(dateStr + "T12:00:00");
      const start = new Date(d); start.setDate(d.getDate() - d.getDay());
      return start.toISOString().split("T")[0];
    };
    const map = new Map<string, { week: string; faturamento: number; pagamentos: number }>();
    filteredPagamentos.forEach((p) => {
      const w = getWeek(p.data_pagamento);
      const entry = map.get(w) || { week: w, faturamento: 0, pagamentos: 0 };
      entry.faturamento += Number(p.valor);
      entry.pagamentos += 1;
      map.set(w, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.week.localeCompare(a.week));
  }, [filteredPagamentos]);

  // Predictability
  // Calcula dias úteis reais (seg-sáb) no mês selecionado
  const diasUteisMes = useMemo(() => {
    const refDate = new Date(dateFrom + "T12:00:00");
    const year = refDate.getFullYear();
    const month = refDate.getMonth();
    const totalDays = new Date(year, month + 1, 0).getDate();
    let count = 0;
    for (let day = 1; day <= totalDays; day++) {
      const dow = new Date(year, month, day).getDay();
      if (dow !== 0) count++; // 0 = domingo
    }
    return count;
  }, [dateFrom]);

  const predictability = useMemo(() => {
    const totalContratado = filteredTratamentos.filter((t) => t.status === "ativo").reduce((s, t) => s + Number(t.valor_contratado || 0), 0);
    const totalRecebido = filteredPagamentos.reduce((s, p) => s + Number(p.valor), 0);
    const aReceber = totalContratado - totalRecebido;

    // Leads totals
    const leadsTotals = filteredLeads.reduce((acc, l) => ({
      leads: acc.leads + l.leads_novos,
      agendaram: acc.agendaram + l.agendaram,
      compareceram: acc.compareceram + (l.agendaram - l.faltaram),
      faltaram: acc.faltaram + l.faltaram,
      contrataram: acc.contrataram + l.contrataram,
      naoContrataram: acc.naoContrataram + l.nao_contrataram,
    }), { leads: 0, agendaram: 0, compareceram: 0, faltaram: 0, contrataram: 0, naoContrataram: 0 });

    const taxaConversao = leadsTotals.leads > 0 ? (leadsTotals.contrataram / leadsTotals.leads) * 100 : 0;

    // Ticket médio por pagamento
    const ticketMedioPgto = filteredPagamentos.length > 0 ? totalRecebido / filteredPagamentos.length : 0;

    // Dias distintos com faturamento
    const diasComFaturamento = new Set(filteredPagamentos.map((p) => p.data_pagamento)).size;
    const ticketMedioDiario = diasComFaturamento > 0 ? totalRecebido / diasComFaturamento : 0;
    const projecaoMensal = ticketMedioDiario * diasUteisMes;

    // Dias distintos com leads
    const diasComLeads = new Set(filteredLeads.map((l) => l.data)).size;

    // Taxas do funil
    const txAgendamento = leadsTotals.leads > 0 ? leadsTotals.agendaram / leadsTotals.leads : 0;
    const txComparecimento = leadsTotals.agendaram > 0 ? leadsTotals.compareceram / leadsTotals.agendaram : 0;
    const txContratacao = leadsTotals.leads > 0 ? leadsTotals.contrataram / leadsTotals.leads : 0;
    const txNaoContratacao = leadsTotals.leads > 0 ? leadsTotals.naoContrataram / leadsTotals.leads : 0;

    // Médias diárias de leads
    const mediaDiariaLeads = diasComLeads > 0 ? leadsTotals.leads / diasComLeads : 0;
    const mediaDiariaAgendaram = diasComLeads > 0 ? leadsTotals.agendaram / diasComLeads : 0;
    const mediaDiariaCompareceram = diasComLeads > 0 ? leadsTotals.compareceram / diasComLeads : 0;
    const mediaDiariaContrataram = diasComLeads > 0 ? leadsTotals.contrataram / diasComLeads : 0;
    const mediaDiariaNaoContrataram = diasComLeads > 0 ? leadsTotals.naoContrataram / diasComLeads : 0;

    return {
      totalContratado, totalRecebido, aReceber, taxaConversao,
      ticketMedioPgto, ticketMedioDiario, projecaoMensal,
      leads: leadsTotals.leads, contrataram: leadsTotals.contrataram,
      // Taxas
      txAgendamento, txComparecimento, txContratacao, txNaoContratacao,
      // Médias diárias
      mediaDiariaLeads, mediaDiariaAgendaram, mediaDiariaCompareceram,
      mediaDiariaContrataram, mediaDiariaNaoContrataram,
      // Projeções mensais de leads
      projMensalLeads: mediaDiariaLeads * DIAS_UTEIS_MES,
      projMensalAgendaram: mediaDiariaAgendaram * DIAS_UTEIS_MES,
      projMensalCompareceram: mediaDiariaCompareceram * DIAS_UTEIS_MES,
      projMensalContrataram: mediaDiariaContrataram * DIAS_UTEIS_MES,
      projMensalNaoContrataram: mediaDiariaNaoContrataram * DIAS_UTEIS_MES,
    };
  }, [filteredTratamentos, filteredPagamentos, filteredLeads]);

  // Funnel report
  const funnelReport = useMemo(() => {
    const map = new Map<string, any>();
    filteredLeads.forEach((l) => {
      const key = l.data;
      const entry = map.get(key) || { data: l.data, leads: 0, agendaram: 0, faltaram: 0, contrataram: 0, nao_contrataram: 0 };
      entry.leads += l.leads_novos;
      entry.agendaram += l.agendaram;
      entry.faltaram += l.faltaram;
      entry.contrataram += l.contrataram;
      entry.nao_contrataram += l.nao_contrataram;
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.data.localeCompare(a.data));
  }, [filteredLeads]);

  // Export functions
  const exportToExcel = (data: any[], filename: string) => {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Relatório");
    XLSX.writeFile(wb, `${filename}.xlsx`);
    toast.success("Planilha exportada!");
  };

  const exportToText = (data: any[], title: string) => {
    const text = `${title}\n${"=".repeat(40)}\n\n${data.map((row) => Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(" | ")).join("\n")}`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${title}.txt`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Arquivo texto exportado!");
  };

  const shareWhatsApp = (title: string, summary: string) => {
    const text = encodeURIComponent(`📊 *${title}*\n\n${summary}`);
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  const shareEmail = (title: string, summary: string) => {
    const subject = encodeURIComponent(title);
    const body = encodeURIComponent(summary);
    window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
  };

  const exportImage = async () => {
    if (!reportRef.current) return;
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(reportRef.current, { backgroundColor: "#1a1a1a" });
      const link = document.createElement("a"); link.download = "relatorio.png"; link.href = canvas.toDataURL(); link.click();
      toast.success("Imagem exportada!");
    } catch { toast.error("Erro ao exportar imagem"); }
  };

  const ShareButtons = ({ title, data, getSummary }: { title: string; data: any[]; getSummary: () => string }) => (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => exportToExcel(data, title)}>
        <Download size={14} className="mr-1" /> Excel
      </Button>
      <Button variant="outline" size="sm" onClick={() => exportToText(data, title)}>
        <Download size={14} className="mr-1" /> Texto
      </Button>
      <Button variant="outline" size="sm" onClick={exportImage}>
        <Download size={14} className="mr-1" /> Imagem
      </Button>
      <Button variant="outline" size="sm" onClick={() => shareWhatsApp(title, getSummary())}>
        <MessageCircle size={14} className="mr-1" /> WhatsApp
      </Button>
      <Button variant="outline" size="sm" onClick={() => shareEmail(title, getSummary())}>
        <Mail size={14} className="mr-1" /> E-mail
      </Button>
    </div>
  );

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando...</div>;

  return (
    <div className="animate-fade-in space-y-6" ref={reportRef}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Relatórios</h1>
          <p className="text-sm text-muted-foreground">Relatórios detalhados com exportação</p>
        </div>
      </div>

      {/* Filters */}
      <Card className="gradient-card border-border shadow-card">
        <CardContent className="pt-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Clínica</Label>
              <Select value={clinicaFiltro} onValueChange={setClinicaFiltro}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {clinicas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>De</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-secondary border-border" />
            </div>
            <div className="space-y-2">
              <Label>Até</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-secondary border-border" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="diario" className="space-y-4">
        <TabsList className="bg-secondary">
          <TabsTrigger value="diario">Diário</TabsTrigger>
          <TabsTrigger value="semanal">Semanal</TabsTrigger>
          <TabsTrigger value="funil">Funil</TabsTrigger>
          <TabsTrigger value="previsibilidade">Previsibilidade</TabsTrigger>
        </TabsList>

        {/* DIÁRIO */}
        <TabsContent value="diario">
          <Card className="gradient-card border-border shadow-card">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar size={18} className="text-primary" /> Relatório Diário
              </CardTitle>
              <ShareButtons title="Relatório Diário" data={dailyReport} getSummary={() =>
                dailyReport.slice(0, 5).map((r) => `${r.date}: ${formatCurrency(r.faturamento)} (${r.pagamentos} pgtos)`).join("\n")
              } />
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={dailyReport.slice(0, 14).reverse()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                  <XAxis dataKey="date" stroke="hsl(0,0%,64%)" fontSize={10} />
                  <YAxis stroke="hsl(0,0%,64%)" fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatCurrency(v), "Faturamento"]} />
                  <Bar dataKey="faturamento" fill="hsl(25,100%,50%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4 overflow-x-auto max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Data</TableHead><TableHead>Faturamento</TableHead><TableHead>Pagamentos</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {dailyReport.map((r) => (
                      <TableRow key={r.date}>
                        <TableCell>{new Date(r.date + "T12:00:00").toLocaleDateString("pt-BR")}</TableCell>
                        <TableCell className="font-medium">{formatCurrency(r.faturamento)}</TableCell>
                        <TableCell>{r.pagamentos}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SEMANAL */}
        <TabsContent value="semanal">
          <Card className="gradient-card border-border shadow-card">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar size={18} className="text-primary" /> Relatório Semanal
              </CardTitle>
              <ShareButtons title="Relatório Semanal" data={weeklyReport} getSummary={() =>
                weeklyReport.slice(0, 4).map((r) => `Semana ${r.week}: ${formatCurrency(r.faturamento)}`).join("\n")
              } />
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={weeklyReport.slice(0, 8).reverse()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                  <XAxis dataKey="week" stroke="hsl(0,0%,64%)" fontSize={10} />
                  <YAxis stroke="hsl(0,0%,64%)" fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatCurrency(v), "Faturamento"]} />
                  <Bar dataKey="faturamento" fill="hsl(35,100%,55%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4 overflow-x-auto max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Semana</TableHead><TableHead>Faturamento</TableHead><TableHead>Pagamentos</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeklyReport.map((r) => (
                      <TableRow key={r.week}>
                        <TableCell>{new Date(r.week + "T12:00:00").toLocaleDateString("pt-BR")}</TableCell>
                        <TableCell className="font-medium">{formatCurrency(r.faturamento)}</TableCell>
                        <TableCell>{r.pagamentos}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* FUNIL */}
        <TabsContent value="funil">
          <Card className="gradient-card border-border shadow-card">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Filter size={18} className="text-primary" /> Relatório do Funil
              </CardTitle>
              <ShareButtons title="Relatório Funil" data={funnelReport} getSummary={() => {
                const t = funnelReport.reduce((a, r) => ({
                  leads: a.leads + r.leads, agendaram: a.agendaram + r.agendaram, contrataram: a.contrataram + r.contrataram
                }), { leads: 0, agendaram: 0, contrataram: 0 });
                return `Leads: ${t.leads}\nAgendaram: ${t.agendaram}\nContrataram: ${t.contrataram}\nTaxa: ${t.leads > 0 ? ((t.contrataram / t.leads) * 100).toFixed(1) : 0}%`;
              }} />
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead><TableHead>Leads</TableHead><TableHead>Agendaram</TableHead>
                      <TableHead>Faltaram</TableHead><TableHead>Contrataram</TableHead><TableHead>Não Contrataram</TableHead><TableHead>Taxa</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {funnelReport.map((r) => (
                      <TableRow key={r.data}>
                        <TableCell>{new Date(r.data + "T12:00:00").toLocaleDateString("pt-BR")}</TableCell>
                        <TableCell>{r.leads}</TableCell>
                        <TableCell>{r.agendaram}</TableCell>
                        <TableCell>{r.faltaram}</TableCell>
                        <TableCell className="text-green-400">{r.contrataram}</TableCell>
                        <TableCell className="text-red-400">{r.nao_contrataram}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                            {r.leads > 0 ? ((r.contrataram / r.leads) * 100).toFixed(1) : 0}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* PREVISIBILIDADE */}
        <TabsContent value="previsibilidade">
          <Card className="gradient-card border-border shadow-card">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp size={18} className="text-primary" /> Relatório de Previsibilidade
              </CardTitle>
              <ShareButtons title="Relatório Previsibilidade" data={[predictability]} getSummary={() =>
                `Total Contratado: ${formatCurrency(predictability.totalContratado)}\nTotal Recebido: ${formatCurrency(predictability.totalRecebido)}\nA Receber: ${formatCurrency(predictability.aReceber)}\nTaxa de Conversão: ${predictability.taxaConversao.toFixed(1)}%\nTicket Médio Diário: ${formatCurrency(predictability.ticketMedioDiario)}\nProjeção Mensal (${DIAS_UTEIS_MES} dias): ${formatCurrency(predictability.projecaoMensal)}`
              } />
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Faturamento */}
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3">💰 Faturamento</h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-lg bg-secondary p-4">
                    <p className="text-xs text-muted-foreground">Total Contratado</p>
                    <p className="text-xl font-bold text-primary">{formatCurrency(predictability.totalContratado)}</p>
                  </div>
                  <div className="rounded-lg bg-secondary p-4">
                    <p className="text-xs text-muted-foreground">Total Recebido</p>
                    <p className="text-xl font-bold text-accent-foreground">{formatCurrency(predictability.totalRecebido)}</p>
                  </div>
                  <div className="rounded-lg bg-secondary p-4">
                    <p className="text-xs text-muted-foreground">A Receber</p>
                    <p className="text-xl font-bold text-primary">{formatCurrency(predictability.aReceber)}</p>
                  </div>
                  <div className="rounded-lg bg-secondary p-4">
                    <p className="text-xs text-muted-foreground">Ticket Médio por Pagamento</p>
                    <p className="text-xl font-bold">{formatCurrency(predictability.ticketMedioPgto)}</p>
                  </div>
                  <div className="rounded-lg bg-secondary p-4">
                    <p className="text-xs text-muted-foreground">Ticket Médio Diário</p>
                    <p className="text-xl font-bold">{formatCurrency(predictability.ticketMedioDiario)}</p>
                  </div>
                  <div className="rounded-lg bg-secondary p-4">
                    <p className="text-xs text-muted-foreground">Projeção Mensal ({DIAS_UTEIS_MES} dias úteis)</p>
                    <p className="text-xl font-bold text-primary">{formatCurrency(predictability.projecaoMensal)}</p>
                  </div>
                </div>
              </div>

              {/* Previsibilidade de Leads */}
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3">📊 Previsibilidade de Leads (taxas atuais)</h3>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Etapa</TableHead>
                        <TableHead className="text-center">Taxa</TableHead>
                        <TableHead className="text-center">Média/Dia</TableHead>
                        <TableHead className="text-center">Projeção Mensal ({DIAS_UTEIS_MES}d)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium">Leads Novos</TableCell>
                        <TableCell className="text-center">—</TableCell>
                        <TableCell className="text-center">{predictability.mediaDiariaLeads.toFixed(1)}</TableCell>
                        <TableCell className="text-center font-medium">{Math.round(predictability.projMensalLeads)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">Agendaram</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                            {(predictability.txAgendamento * 100).toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">{predictability.mediaDiariaAgendaram.toFixed(1)}</TableCell>
                        <TableCell className="text-center font-medium">{Math.round(predictability.projMensalAgendaram)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">Compareceram</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                            {(predictability.txComparecimento * 100).toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">{predictability.mediaDiariaCompareceram.toFixed(1)}</TableCell>
                        <TableCell className="text-center font-medium">{Math.round(predictability.projMensalCompareceram)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">Contrataram</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                            {(predictability.txContratacao * 100).toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">{predictability.mediaDiariaContrataram.toFixed(1)}</TableCell>
                        <TableCell className="text-center font-medium">{Math.round(predictability.projMensalContrataram)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">Não Contrataram</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                            {(predictability.txNaoContratacao * 100).toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">{predictability.mediaDiariaNaoContrataram.toFixed(1)}</TableCell>
                        <TableCell className="text-center font-medium">{Math.round(predictability.projMensalNaoContrataram)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Taxa de conversão resumo */}
              <div className="rounded-lg bg-secondary p-4">
                <p className="text-xs text-muted-foreground">Taxa de Conversão Geral (Leads → Contratação)</p>
                <p className="text-xl font-bold">{predictability.taxaConversao.toFixed(1)}%</p>
                <p className="text-xs text-muted-foreground mt-1">{predictability.contrataram} de {predictability.leads} leads</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Relatorios;
