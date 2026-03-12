import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileBarChart, Download, Share2, MessageCircle, Mail, Calendar, TrendingUp, Filter, DollarSign, Users, Stethoscope, CreditCard, Megaphone, Eye, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import * as XLSX from "xlsx";
import type { Tables } from "@/integrations/supabase/types";

const tooltipStyle = { background: "hsl(0,0%,11%)", border: "1px solid hsl(0,0%,20%)", borderRadius: "8px", color: "#fff" };
const COLORS = ["hsl(25,100%,50%)", "hsl(35,100%,55%)", "hsl(180,60%,50%)", "hsl(280,60%,60%)", "hsl(120,50%,50%)", "hsl(0,70%,55%)", "hsl(210,70%,55%)", "hsl(50,90%,55%)"];

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
  const [showContratadoDialog, setShowContratadoDialog] = useState(false);
  const [showEmAbertoDialog, setShowEmAbertoDialog] = useState(false);
  const [showConcluidosDialog, setShowConcluidosDialog] = useState(false);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
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

  // ========== CONTRATADO VS PAGO ==========
  const contratadoVsPago = useMemo(() => {
    // Group pagamentos by tratamento_id
    const pagosPorTratamento = new Map<string, number>();
    filteredPagamentos.forEach((p) => {
      pagosPorTratamento.set(p.tratamento_id, (pagosPorTratamento.get(p.tratamento_id) || 0) + Number(p.valor));
    });

    const totalContratado = filteredTratamentos.filter(t => t.status === "ativo").reduce((s, t) => s + Number(t.valor_contratado || 0), 0);
    const totalPago = filteredPagamentos.reduce((s, p) => s + Number(p.valor), 0);

    // Build per-patient summary
    const pacienteMap = new Map<string, { nome: string; contratado: number; pago: number; tratamentos: any[] }>();
    filteredTratamentos.filter(t => t.status === "ativo").forEach((t) => {
      const pid = t.paciente_id;
      const entry = pacienteMap.get(pid) || { nome: t.pacientes?.nome || "—", contratado: 0, pago: 0, tratamentos: [] };
      const contratado = Number(t.valor_contratado || 0);
      const pago = pagosPorTratamento.get(t.id) || 0;
      entry.contratado += contratado;
      entry.pago += pago;
      entry.tratamentos.push({ procedimento: t.procedimento, contratado, pago, clinica: t.clinicas?.nome || "—" });
      pacienteMap.set(pid, entry);
    });

    const lista = Array.from(pacienteMap.values());
    const emAberto = lista.filter(p => p.pago < p.contratado).sort((a, b) => (b.contratado - b.pago) - (a.contratado - a.pago));
    const concluidos = lista.filter(p => p.contratado > 0 && p.pago >= p.contratado);

    return { totalContratado, totalPago, emAberto, concluidos };
  }, [filteredTratamentos, filteredPagamentos]);

  // ========== DAILY REPORT ==========
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

  // ========== WEEKLY REPORT ==========
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

  // ========== PREDICTABILITY ==========
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

  const predictability = useMemo(() => {
    const totalContratado = filteredTratamentos.filter((t) => t.status === "ativo").reduce((s, t) => s + Number(t.valor_contratado || 0), 0);
    const totalRecebido = filteredPagamentos.reduce((s, p) => s + Number(p.valor), 0);
    const aReceber = totalContratado - totalRecebido;
    const leadsTotals = filteredLeads.reduce((acc, l) => ({
      leads: acc.leads + l.leads_novos, agendaram: acc.agendaram + l.agendaram,
      compareceram: acc.compareceram + (l.agendaram - l.faltaram), faltaram: acc.faltaram + l.faltaram,
      contrataram: acc.contrataram + l.contrataram, naoContrataram: acc.naoContrataram + l.nao_contrataram,
    }), { leads: 0, agendaram: 0, compareceram: 0, faltaram: 0, contrataram: 0, naoContrataram: 0 });
    const taxaConversao = leadsTotals.leads > 0 ? (leadsTotals.contrataram / leadsTotals.leads) * 100 : 0;
    const ticketMedioPgto = filteredPagamentos.length > 0 ? totalRecebido / filteredPagamentos.length : 0;
    const diasComFaturamento = new Set(filteredPagamentos.map((p) => p.data_pagamento)).size;
    const ticketMedioDiario = diasComFaturamento > 0 ? totalRecebido / diasComFaturamento : 0;
    const projecaoMensal = ticketMedioDiario * diasUteisMes;
    const diasComLeads = new Set(filteredLeads.map((l) => l.data)).size;
    const txAgendamento = leadsTotals.leads > 0 ? leadsTotals.agendaram / leadsTotals.leads : 0;
    const txComparecimento = leadsTotals.agendaram > 0 ? leadsTotals.compareceram / leadsTotals.agendaram : 0;
    const txContratacao = leadsTotals.leads > 0 ? leadsTotals.contrataram / leadsTotals.leads : 0;
    const txNaoContratacao = leadsTotals.leads > 0 ? leadsTotals.naoContrataram / leadsTotals.leads : 0;
    const mediaDiariaLeads = diasComLeads > 0 ? leadsTotals.leads / diasComLeads : 0;
    const mediaDiariaAgendaram = diasComLeads > 0 ? leadsTotals.agendaram / diasComLeads : 0;
    const mediaDiariaCompareceram = diasComLeads > 0 ? leadsTotals.compareceram / diasComLeads : 0;
    const mediaDiariaContrataram = diasComLeads > 0 ? leadsTotals.contrataram / diasComLeads : 0;
    const mediaDiariaNaoContrataram = diasComLeads > 0 ? leadsTotals.naoContrataram / diasComLeads : 0;
    return {
      totalContratado, totalRecebido, aReceber, taxaConversao, ticketMedioPgto, ticketMedioDiario, projecaoMensal,
      leads: leadsTotals.leads, contrataram: leadsTotals.contrataram,
      txAgendamento, txComparecimento, txContratacao, txNaoContratacao,
      mediaDiariaLeads, mediaDiariaAgendaram, mediaDiariaCompareceram, mediaDiariaContrataram, mediaDiariaNaoContrataram,
      projMensalLeads: mediaDiariaLeads * diasUteisMes, projMensalAgendaram: mediaDiariaAgendaram * diasUteisMes,
      projMensalCompareceram: mediaDiariaCompareceram * diasUteisMes, projMensalContrataram: mediaDiariaContrataram * diasUteisMes,
      projMensalNaoContrataram: mediaDiariaNaoContrataram * diasUteisMes,
    };
  }, [filteredTratamentos, filteredPagamentos, filteredLeads, diasUteisMes]);

  // ========== FUNNEL ==========
  const funnelReport = useMemo(() => {
    const map = new Map<string, any>();
    filteredLeads.forEach((l) => {
      const key = l.data;
      const entry = map.get(key) || { data: l.data, leads: 0, agendaram: 0, faltaram: 0, contrataram: 0, nao_contrataram: 0 };
      entry.leads += l.leads_novos; entry.agendaram += l.agendaram; entry.faltaram += l.faltaram;
      entry.contrataram += l.contrataram; entry.nao_contrataram += l.nao_contrataram;
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.data.localeCompare(a.data));
  }, [filteredLeads]);

  // ========== POR PROCEDIMENTO ==========
  const procedimentoReport = useMemo(() => {
    const map = new Map<string, { procedimento: string; contratado: number; pago: number; qtd: number }>();
    const pagosPorTratamento = new Map<string, number>();
    filteredPagamentos.forEach((p) => {
      pagosPorTratamento.set(p.tratamento_id, (pagosPorTratamento.get(p.tratamento_id) || 0) + Number(p.valor));
    });
    filteredTratamentos.forEach((t) => {
      const key = t.procedimento;
      const entry = map.get(key) || { procedimento: key, contratado: 0, pago: 0, qtd: 0 };
      entry.contratado += Number(t.valor_contratado || 0);
      entry.pago += pagosPorTratamento.get(t.id) || 0;
      entry.qtd += 1;
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.contratado - a.contratado);
  }, [filteredTratamentos, filteredPagamentos]);

  // ========== POR FORMA DE PAGAMENTO ==========
  const formaPagamentoReport = useMemo(() => {
    const map = new Map<string, { forma: string; valor: number; qtd: number }>();
    filteredPagamentos.forEach((p) => {
      const key = p.forma_pagamento || "Não informado";
      const entry = map.get(key) || { forma: key, valor: 0, qtd: 0 };
      entry.valor += Number(p.valor);
      entry.qtd += 1;
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.valor - a.valor);
  }, [filteredPagamentos]);

  // ========== RANKING PACIENTES ==========
  const rankingPacientes = useMemo(() => {
    const map = new Map<string, { nome: string; pago: number; contratado: number; qtdTratamentos: number }>();
    const pagosPorPaciente = new Map<string, number>();
    filteredPagamentos.forEach((p) => {
      pagosPorPaciente.set(p.paciente_id, (pagosPorPaciente.get(p.paciente_id) || 0) + Number(p.valor));
    });
    filteredTratamentos.forEach((t) => {
      const pid = t.paciente_id;
      const entry = map.get(pid) || { nome: t.pacientes?.nome || "—", pago: 0, contratado: 0, qtdTratamentos: 0 };
      entry.contratado += Number(t.valor_contratado || 0);
      entry.qtdTratamentos += 1;
      if (!map.has(pid)) entry.pago = pagosPorPaciente.get(pid) || 0;
      map.set(pid, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.pago - a.pago).slice(0, 50);
  }, [filteredTratamentos, filteredPagamentos]);

  // ========== POR ESPECIALIDADE ==========
  const especialidadeReport = useMemo(() => {
    const map = new Map<string, { especialidade: string; contratado: number; pago: number; qtd: number }>();
    const pagosPorTratamento = new Map<string, number>();
    filteredPagamentos.forEach((p) => {
      pagosPorTratamento.set(p.tratamento_id, (pagosPorTratamento.get(p.tratamento_id) || 0) + Number(p.valor));
    });
    filteredTratamentos.forEach((t) => {
      const key = t.especialidade || "Não informada";
      const entry = map.get(key) || { especialidade: key, contratado: 0, pago: 0, qtd: 0 };
      entry.contratado += Number(t.valor_contratado || 0);
      entry.pago += pagosPorTratamento.get(t.id) || 0;
      entry.qtd += 1;
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.contratado - a.contratado);
  }, [filteredTratamentos, filteredPagamentos]);

  // ========== POR ORIGEM / ANÚNCIO ==========
  const origemReport = useMemo(() => {
    const pagosPorPaciente = new Map<string, number>();
    filteredPagamentos.forEach((p) => {
      pagosPorPaciente.set(p.paciente_id, (pagosPorPaciente.get(p.paciente_id) || 0) + Number(p.valor));
    });
    const contratadoPorPaciente = new Map<string, number>();
    filteredTratamentos.forEach((t) => {
      contratadoPorPaciente.set(t.paciente_id, (contratadoPorPaciente.get(t.paciente_id) || 0) + Number(t.valor_contratado || 0));
    });

    // By origem
    const origemMap = new Map<string, { label: string; tipo: string; qtdPacientes: number; contratado: number; pago: number }>();
    pacientes.forEach((p) => {
      const key = p.origem || "Não informada";
      const entry = origemMap.get(key) || { label: key, tipo: "Origem", qtdPacientes: 0, contratado: 0, pago: 0 };
      entry.qtdPacientes += 1;
      entry.contratado += contratadoPorPaciente.get(p.id) || 0;
      entry.pago += pagosPorPaciente.get(p.id) || 0;
      origemMap.set(key, entry);
    });

    // By anúncio
    const anuncioMap = new Map<string, { label: string; tipo: string; qtdPacientes: number; contratado: number; pago: number }>();
    pacientes.forEach((p) => {
      const key = p.nome_anuncio || "Não informado";
      const entry = anuncioMap.get(key) || { label: key, tipo: "Anúncio", qtdPacientes: 0, contratado: 0, pago: 0 };
      entry.qtdPacientes += 1;
      entry.contratado += contratadoPorPaciente.get(p.id) || 0;
      entry.pago += pagosPorPaciente.get(p.id) || 0;
      anuncioMap.set(key, entry);
    });

    return {
      origens: Array.from(origemMap.values()).sort((a, b) => b.pago - a.pago),
      anuncios: Array.from(anuncioMap.values()).sort((a, b) => b.pago - a.pago),
    };
  }, [pacientes, filteredTratamentos, filteredPagamentos]);

  // ========== EXPORT HELPERS ==========
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
      <Button variant="outline" size="sm" onClick={() => exportToExcel(data, title)}><Download size={14} className="mr-1" /> Excel</Button>
      <Button variant="outline" size="sm" onClick={() => exportToText(data, title)}><Download size={14} className="mr-1" /> Texto</Button>
      <Button variant="outline" size="sm" onClick={exportImage}><Download size={14} className="mr-1" /> Imagem</Button>
      <Button variant="outline" size="sm" onClick={() => shareWhatsApp(title, getSummary())}><MessageCircle size={14} className="mr-1" /> WhatsApp</Button>
      <Button variant="outline" size="sm" onClick={() => shareEmail(title, getSummary())}><Mail size={14} className="mr-1" /> E-mail</Button>
    </div>
  );

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando...</div>;

  const reportTypes = [
    { key: "contratado", label: "Contratado vs Pago", desc: "Valores contratados versus pagos com lista de pacientes", icon: DollarSign },
    { key: "diario", label: "Relatório Diário", desc: "Faturamento e pagamentos por dia", icon: Calendar },
    { key: "semanal", label: "Relatório Semanal", desc: "Faturamento agrupado por semana", icon: Calendar },
    { key: "funil", label: "Funil de Leads", desc: "Conversão de leads por etapa do funil", icon: Filter },
    { key: "previsibilidade", label: "Previsibilidade", desc: "Projeções de faturamento e leads", icon: TrendingUp },
    { key: "procedimento", label: "Por Procedimento", desc: "Faturamento agrupado por tipo de procedimento", icon: Stethoscope },
    { key: "forma_pgto", label: "Forma de Pagamento", desc: "Distribuição por forma de pagamento", icon: CreditCard },
    { key: "ranking", label: "Ranking Pacientes", desc: "Top pacientes por valor pago e contratado", icon: Users },
    { key: "especialidade", label: "Por Especialidade", desc: "Faturamento agrupado por especialidade", icon: Stethoscope },
    { key: "origem", label: "Origem / Anúncio", desc: "Performance por canal de origem e anúncio", icon: Megaphone },
  ];

  const renderReportContent = () => {
    switch (selectedReport) {
      case "contratado": return (<>
        <Card className="gradient-card border-border shadow-card">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2"><DollarSign size={18} className="text-primary" /> Contratado vs Pago</CardTitle>
            <ShareButtons title="Contratado vs Pago" data={[{ contratado: contratadoVsPago.totalContratado, pago: contratadoVsPago.totalPago }]} getSummary={() =>
              `Total Contratado: ${formatCurrency(contratadoVsPago.totalContratado)}\nTotal Pago: ${formatCurrency(contratadoVsPago.totalPago)}\nA Receber: ${formatCurrency(contratadoVsPago.totalContratado - contratadoVsPago.totalPago)}\nEm aberto: ${contratadoVsPago.emAberto.length} pacientes\nConcluídos: ${contratadoVsPago.concluidos.length} pacientes`
            } />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg bg-secondary p-4">
                <p className="text-xs text-muted-foreground">Total Contratado</p>
                <p className="text-xl font-bold text-primary">{formatCurrency(contratadoVsPago.totalContratado)}</p>
              </div>
              <div className="rounded-lg bg-secondary p-4">
                <p className="text-xs text-muted-foreground">Total Pago</p>
                <p className="text-xl font-bold text-accent-foreground">{formatCurrency(contratadoVsPago.totalPago)}</p>
              </div>
              <div className="rounded-lg bg-secondary p-4">
                <p className="text-xs text-muted-foreground">A Receber</p>
                <p className="text-xl font-bold text-primary">{formatCurrency(contratadoVsPago.totalContratado - contratadoVsPago.totalPago)}</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={[{ name: "Resumo", contratado: contratadoVsPago.totalContratado, pago: contratadoVsPago.totalPago }]}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                <XAxis dataKey="name" stroke="hsl(0,0%,64%)" />
                <YAxis stroke="hsl(0,0%,64%)" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatCurrency(v)} />
                <Bar dataKey="contratado" fill="hsl(25,100%,50%)" name="Contratado" radius={[6, 6, 0, 0]} />
                <Bar dataKey="pago" fill="hsl(120,50%,50%)" name="Pago" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg bg-secondary p-3 cursor-pointer hover:bg-secondary/80 transition-colors" onClick={() => setShowEmAbertoDialog(true)}>
                <p className="text-sm font-semibold text-destructive mb-1">Em aberto ({contratadoVsPago.emAberto.length})</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1"><Eye size={12} /> Clique para ver pacientes</p>
              </div>
              <div className="rounded-lg bg-secondary p-3 cursor-pointer hover:bg-secondary/80 transition-colors" onClick={() => setShowConcluidosDialog(true)}>
                <p className="text-sm font-semibold text-green-400 mb-1">Concluídos ({contratadoVsPago.concluidos.length})</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1"><Eye size={12} /> Clique para ver pacientes</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Dialog Em Aberto */}
        <Dialog open={showEmAbertoDialog} onOpenChange={setShowEmAbertoDialog}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>🔴 Pacientes em Aberto ({contratadoVsPago.emAberto.length})</DialogTitle></DialogHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Paciente</TableHead><TableHead>Contratado</TableHead><TableHead>Pago</TableHead><TableHead>Restante</TableHead><TableHead>%</TableHead></TableRow></TableHeader>
                <TableBody>
                  {contratadoVsPago.emAberto.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{p.nome}</TableCell>
                      <TableCell>{formatCurrency(p.contratado)}</TableCell>
                      <TableCell>{formatCurrency(p.pago)}</TableCell>
                      <TableCell className="text-destructive font-medium">{formatCurrency(p.contratado - p.pago)}</TableCell>
                      <TableCell><Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">{p.contratado > 0 ? ((p.pago / p.contratado) * 100).toFixed(0) : 0}%</Badge></TableCell>
                    </TableRow>
                  ))}
                  {contratadoVsPago.emAberto.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nenhum paciente com pagamento em aberto</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="rounded-lg bg-secondary p-3 mt-2">
              <p className="text-xs text-muted-foreground">Total a receber</p>
              <p className="text-lg font-bold text-destructive">{formatCurrency(contratadoVsPago.emAberto.reduce((s, p) => s + (p.contratado - p.pago), 0))}</p>
            </div>
          </DialogContent>
        </Dialog>

        {/* Dialog Concluídos */}
        <Dialog open={showConcluidosDialog} onOpenChange={setShowConcluidosDialog}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>🟢 Pacientes Concluídos ({contratadoVsPago.concluidos.length})</DialogTitle></DialogHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Paciente</TableHead><TableHead>Contratado</TableHead><TableHead>Pago</TableHead></TableRow></TableHeader>
                <TableBody>
                  {contratadoVsPago.concluidos.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{p.nome}</TableCell>
                      <TableCell>{formatCurrency(p.contratado)}</TableCell>
                      <TableCell className="text-green-400">{formatCurrency(p.pago)}</TableCell>
                    </TableRow>
                  ))}
                  {contratadoVsPago.concluidos.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">Nenhum paciente com pagamento concluído</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="rounded-lg bg-secondary p-3 mt-2">
              <p className="text-xs text-muted-foreground">Total recebido (concluídos)</p>
              <p className="text-lg font-bold text-green-400">{formatCurrency(contratadoVsPago.concluidos.reduce((s, p) => s + p.pago, 0))}</p>
            </div>
          </DialogContent>
        </Dialog>
      </>);

      case "diario": return (
        <Card className="gradient-card border-border shadow-card">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Calendar size={18} className="text-primary" /> Relatório Diário</CardTitle>
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
                <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Faturamento</TableHead><TableHead>Pagamentos</TableHead></TableRow></TableHeader>
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
      );

      case "semanal": return (
        <Card className="gradient-card border-border shadow-card">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Calendar size={18} className="text-primary" /> Relatório Semanal</CardTitle>
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
                <TableHeader><TableRow><TableHead>Semana</TableHead><TableHead>Faturamento</TableHead><TableHead>Pagamentos</TableHead></TableRow></TableHeader>
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
      );

      case "funil": return (
        <Card className="gradient-card border-border shadow-card">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Filter size={18} className="text-primary" /> Relatório do Funil</CardTitle>
            <ShareButtons title="Relatório Funil" data={funnelReport} getSummary={() => {
              const t = funnelReport.reduce((a, r) => ({ leads: a.leads + r.leads, agendaram: a.agendaram + r.agendaram, contrataram: a.contrataram + r.contrataram }), { leads: 0, agendaram: 0, contrataram: 0 });
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
                      <TableCell><Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">{r.leads > 0 ? ((r.contrataram / r.leads) * 100).toFixed(1) : 0}%</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      );

      case "previsibilidade": return (
        <Card className="gradient-card border-border shadow-card">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp size={18} className="text-primary" /> Previsibilidade</CardTitle>
            <ShareButtons title="Relatório Previsibilidade" data={[predictability]} getSummary={() =>
              `Total Contratado: ${formatCurrency(predictability.totalContratado)}\nTotal Recebido: ${formatCurrency(predictability.totalRecebido)}\nA Receber: ${formatCurrency(predictability.aReceber)}\nTicket Médio Diário: ${formatCurrency(predictability.ticketMedioDiario)}\nProjeção Mensal (${diasUteisMes} dias): ${formatCurrency(predictability.projecaoMensal)}`
            } />
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">💰 Faturamento</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg bg-secondary p-4"><p className="text-xs text-muted-foreground">Total Contratado</p><p className="text-xl font-bold text-primary">{formatCurrency(predictability.totalContratado)}</p></div>
                <div className="rounded-lg bg-secondary p-4"><p className="text-xs text-muted-foreground">Total Recebido</p><p className="text-xl font-bold text-accent-foreground">{formatCurrency(predictability.totalRecebido)}</p></div>
                <div className="rounded-lg bg-secondary p-4"><p className="text-xs text-muted-foreground">A Receber</p><p className="text-xl font-bold text-primary">{formatCurrency(predictability.aReceber)}</p></div>
                <div className="rounded-lg bg-secondary p-4"><p className="text-xs text-muted-foreground">Ticket Médio por Pagamento</p><p className="text-xl font-bold">{formatCurrency(predictability.ticketMedioPgto)}</p></div>
                <div className="rounded-lg bg-secondary p-4"><p className="text-xs text-muted-foreground">Ticket Médio Diário</p><p className="text-xl font-bold">{formatCurrency(predictability.ticketMedioDiario)}</p></div>
                <div className="rounded-lg bg-secondary p-4"><p className="text-xs text-muted-foreground">Projeção Mensal ({diasUteisMes} dias úteis)</p><p className="text-xl font-bold text-primary">{formatCurrency(predictability.projecaoMensal)}</p></div>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">📊 Previsibilidade de Leads</h3>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Etapa</TableHead><TableHead className="text-center">Taxa</TableHead>
                      <TableHead className="text-center">Média/Dia</TableHead><TableHead className="text-center">Projeção ({diasUteisMes}d)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      { etapa: "Leads Novos", taxa: null, media: predictability.mediaDiariaLeads, proj: predictability.projMensalLeads },
                      { etapa: "Agendaram", taxa: predictability.txAgendamento, media: predictability.mediaDiariaAgendaram, proj: predictability.projMensalAgendaram },
                      { etapa: "Compareceram", taxa: predictability.txComparecimento, media: predictability.mediaDiariaCompareceram, proj: predictability.projMensalCompareceram },
                      { etapa: "Contrataram", taxa: predictability.txContratacao, media: predictability.mediaDiariaContrataram, proj: predictability.projMensalContrataram },
                      { etapa: "Não Contrataram", taxa: predictability.txNaoContratacao, media: predictability.mediaDiariaNaoContrataram, proj: predictability.projMensalNaoContrataram, isNeg: true },
                    ].map((r) => (
                      <TableRow key={r.etapa}>
                        <TableCell className="font-medium">{r.etapa}</TableCell>
                        <TableCell className="text-center">
                          {r.taxa !== null ? (
                            <Badge variant="outline" className={r.isNeg ? "bg-destructive/10 text-destructive border-destructive/30" : "bg-primary/10 text-primary border-primary/30"}>
                              {(r.taxa * 100).toFixed(1)}%
                            </Badge>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-center">{r.media.toFixed(1)}</TableCell>
                        <TableCell className="text-center font-medium">{Math.round(r.proj)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div className="rounded-lg bg-secondary p-4">
              <p className="text-xs text-muted-foreground">Taxa de Conversão Geral (Leads → Contratação)</p>
              <p className="text-xl font-bold">{predictability.taxaConversao.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground mt-1">{predictability.contrataram} de {predictability.leads} leads</p>
            </div>
          </CardContent>
        </Card>
      );

      case "procedimento": return (
        <Card className="gradient-card border-border shadow-card">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Stethoscope size={18} className="text-primary" /> Por Procedimento</CardTitle>
            <ShareButtons title="Relatório por Procedimento" data={procedimentoReport} getSummary={() =>
              procedimentoReport.slice(0, 10).map((r) => `${r.procedimento}: ${formatCurrency(r.contratado)} contratado, ${formatCurrency(r.pago)} pago (${r.qtd}x)`).join("\n")
            } />
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={procedimentoReport.slice(0, 10)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                <XAxis type="number" stroke="hsl(0,0%,64%)" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="procedimento" stroke="hsl(0,0%,64%)" fontSize={10} width={120} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatCurrency(v)} />
                <Bar dataKey="contratado" fill="hsl(25,100%,50%)" name="Contratado" radius={[0, 6, 6, 0]} />
                <Bar dataKey="pago" fill="hsl(120,50%,50%)" name="Pago" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 overflow-x-auto max-h-64 overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Procedimento</TableHead><TableHead>Qtd</TableHead><TableHead>Contratado</TableHead><TableHead>Pago</TableHead><TableHead>Restante</TableHead></TableRow></TableHeader>
                <TableBody>
                  {procedimentoReport.map((r) => (
                    <TableRow key={r.procedimento}>
                      <TableCell className="font-medium">{r.procedimento}</TableCell>
                      <TableCell>{r.qtd}</TableCell>
                      <TableCell>{formatCurrency(r.contratado)}</TableCell>
                      <TableCell>{formatCurrency(r.pago)}</TableCell>
                      <TableCell className="text-primary">{formatCurrency(r.contratado - r.pago)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      );

      case "forma_pgto": return (
        <Card className="gradient-card border-border shadow-card">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2"><CreditCard size={18} className="text-primary" /> Por Forma de Pagamento</CardTitle>
            <ShareButtons title="Relatório por Forma de Pagamento" data={formaPagamentoReport} getSummary={() =>
              formaPagamentoReport.map((r) => `${r.forma}: ${formatCurrency(r.valor)} (${r.qtd}x)`).join("\n")
            } />
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 lg:grid-cols-2">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={formaPagamentoReport} dataKey="valor" nameKey="forma" cx="50%" cy="50%" outerRadius={100} label={({ forma, percent }) => `${forma} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                    {formaPagamentoReport.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Forma</TableHead><TableHead>Qtd</TableHead><TableHead>Valor</TableHead><TableHead>%</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {formaPagamentoReport.map((r) => {
                      const total = formaPagamentoReport.reduce((s, x) => s + x.valor, 0);
                      return (
                        <TableRow key={r.forma}>
                          <TableCell className="font-medium">{r.forma}</TableCell>
                          <TableCell>{r.qtd}</TableCell>
                          <TableCell>{formatCurrency(r.valor)}</TableCell>
                          <TableCell><Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">{total > 0 ? ((r.valor / total) * 100).toFixed(1) : 0}%</Badge></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>
      );

      case "ranking": return (
        <Card className="gradient-card border-border shadow-card">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Users size={18} className="text-primary" /> Ranking de Pacientes (Top 50)</CardTitle>
            <ShareButtons title="Ranking Pacientes" data={rankingPacientes} getSummary={() =>
              rankingPacientes.slice(0, 10).map((r, i) => `${i + 1}. ${r.nome}: ${formatCurrency(r.pago)} pago`).join("\n")
            } />
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Paciente</TableHead><TableHead>Tratamentos</TableHead><TableHead>Contratado</TableHead><TableHead>Pago</TableHead><TableHead>Restante</TableHead></TableRow></TableHeader>
                <TableBody>
                  {rankingPacientes.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-bold text-primary">{i + 1}</TableCell>
                      <TableCell className="font-medium">{r.nome}</TableCell>
                      <TableCell>{r.qtdTratamentos}</TableCell>
                      <TableCell>{formatCurrency(r.contratado)}</TableCell>
                      <TableCell>{formatCurrency(r.pago)}</TableCell>
                      <TableCell className={r.contratado - r.pago > 0 ? "text-destructive" : "text-green-400"}>{formatCurrency(r.contratado - r.pago)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      );

      case "especialidade": return (
        <Card className="gradient-card border-border shadow-card">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Stethoscope size={18} className="text-primary" /> Por Especialidade</CardTitle>
            <ShareButtons title="Relatório por Especialidade" data={especialidadeReport} getSummary={() =>
              especialidadeReport.map((r) => `${r.especialidade}: ${formatCurrency(r.contratado)} contratado, ${formatCurrency(r.pago)} pago (${r.qtd}x)`).join("\n")
            } />
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 lg:grid-cols-2">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={especialidadeReport} dataKey="contratado" nameKey="especialidade" cx="50%" cy="50%" outerRadius={100} label={({ especialidade, percent }) => `${especialidade} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                    {especialidadeReport.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Especialidade</TableHead><TableHead>Qtd</TableHead><TableHead>Contratado</TableHead><TableHead>Pago</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {especialidadeReport.map((r) => (
                      <TableRow key={r.especialidade}>
                        <TableCell className="font-medium">{r.especialidade}</TableCell>
                        <TableCell>{r.qtd}</TableCell>
                        <TableCell>{formatCurrency(r.contratado)}</TableCell>
                        <TableCell>{formatCurrency(r.pago)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>
      );

      case "origem": return (
        <Card className="gradient-card border-border shadow-card">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Megaphone size={18} className="text-primary" /> Por Origem / Anúncio</CardTitle>
            <ShareButtons title="Relatório por Origem" data={[...origemReport.origens, ...origemReport.anuncios]} getSummary={() =>
              `ORIGENS:\n${origemReport.origens.slice(0, 5).map(r => `${r.label}: ${r.qtdPacientes} pac, ${formatCurrency(r.pago)} pago`).join("\n")}\n\nANÚNCIOS:\n${origemReport.anuncios.slice(0, 5).map(r => `${r.label}: ${r.qtdPacientes} pac, ${formatCurrency(r.pago)} pago`).join("\n")}`
            } />
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">📍 Por Origem</h3>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Origem</TableHead><TableHead>Pacientes</TableHead><TableHead>Contratado</TableHead><TableHead>Pago</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {origemReport.origens.map((r) => (
                      <TableRow key={r.label}>
                        <TableCell className="font-medium">{r.label}</TableCell>
                        <TableCell>{r.qtdPacientes}</TableCell>
                        <TableCell>{formatCurrency(r.contratado)}</TableCell>
                        <TableCell>{formatCurrency(r.pago)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">📢 Por Anúncio</h3>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Anúncio</TableHead><TableHead>Pacientes</TableHead><TableHead>Contratado</TableHead><TableHead>Pago</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {origemReport.anuncios.map((r) => (
                      <TableRow key={r.label}>
                        <TableCell className="font-medium">{r.label}</TableCell>
                        <TableCell>{r.qtdPacientes}</TableCell>
                        <TableCell>{formatCurrency(r.contratado)}</TableCell>
                        <TableCell>{formatCurrency(r.pago)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>
      );

      default: return null;
    }
  };

  return (
    <div className="animate-fade-in space-y-6" ref={reportRef}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Relatórios</h1>
          <p className="text-sm text-muted-foreground">Selecione o tipo de relatório que deseja visualizar</p>
        </div>
        {selectedReport && (
          <Button variant="outline" onClick={() => setSelectedReport(null)} className="gap-2">
            <ArrowLeft size={16} /> Voltar aos relatórios
          </Button>
        )}
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

      {/* Grid selector or report content */}
      {!selectedReport ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reportTypes.map((rt) => (
            <Card
              key={rt.key}
              className="gradient-card border-border shadow-card cursor-pointer hover:border-primary/30 transition-all hover:shadow-lg"
              onClick={() => setSelectedReport(rt.key)}
            >
              <CardHeader className="flex flex-row items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2.5">
                  <rt.icon size={22} className="text-primary" />
                </div>
                <div>
                  <CardTitle className="text-sm font-medium">{rt.label}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground">{rt.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        renderReportContent()
      )}
    </div>
  );
};

export default Relatorios;
