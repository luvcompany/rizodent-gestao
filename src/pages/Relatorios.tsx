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
import { FileBarChart, Download, Share2, MessageCircle, Mail, Calendar, TrendingUp, Filter, DollarSign, Users, Stethoscope, Megaphone, Eye, ArrowLeft, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import * as XLSX from "xlsx";
import type { Tables } from "@/integrations/supabase/types";

const tooltipStyle = {
  background: "hsl(0,0%,8%)",
  border: "1px solid hsl(0,0%,18%)",
  borderRadius: "10px",
  color: "#fff",
  padding: "10px 14px",
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
};

const tooltipLabelStyle = { color: "hsl(0,0%,70%)", fontSize: 12, marginBottom: 4 };
const tooltipItemStyle = { color: "hsl(25,100%,50%)" };
const COLORS = ["hsl(25,100%,50%)", "hsl(35,100%,55%)", "hsl(180,60%,50%)", "hsl(280,60%,60%)", "hsl(120,50%,50%)", "hsl(0,70%,55%)", "hsl(210,70%,55%)", "hsl(50,90%,55%)"];

const activeBarStyle = { style: { filter: "brightness(1.3) drop-shadow(0 0 8px rgba(255,140,0,0.4))", transition: "filter 0.2s ease" } };

const formatCurrency = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

const Relatorios = () => {
  const navigate = useNavigate();
  const [clinicas, setClinicas] = useState<Tables<"clinicas">[]>([]);
  const [clinicaFiltro, setClinicaFiltro] = useState("todas");
  const [pagamentos, setPagamentos] = useState<any[]>([]);
  const [tratamentos, setTratamentos] = useState<any[]>([]);
  const [pacientes, setPacientes] = useState<any[]>([]);
  const [orcamentos, setOrcamentos] = useState<any[]>([]);
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
      const [{ data: cl }, { data: pg }, { data: tr }, { data: pc }, { data: ld }, { data: orcs }] = await Promise.all([
        supabase.from("clinicas").select("*").eq("ativa", true),
        supabase.from("pagamentos").select("*, clinicas(nome), pacientes(nome)"),
        supabase.from("tratamentos").select("*, clinicas(nome), pacientes(nome)"),
        supabase.from("pacientes").select("*"),
        supabase.from("leads_diarios").select("*, clinicas(nome)"),
        supabase.from("orcamentos").select("*"),
      ]);
      setClinicas(cl || []); setPagamentos(pg || []); setTratamentos(tr || []);
      setPacientes(pc || []); setLeadsData(ld || []); setOrcamentos(orcs || []);
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

  // ========== ORÇADO VS CONTRATADO ==========
  const contratadoVsPago = useMemo(() => {
    const contratadoPorPaciente = new Map<string, number>();
    filteredPagamentos.forEach((p) => {
      contratadoPorPaciente.set(p.paciente_id, (contratadoPorPaciente.get(p.paciente_id) || 0) + Number(p.valor));
    });
    const orcadoPorPaciente = new Map<string, number>();
    orcamentos.forEach((o) => {
      orcadoPorPaciente.set(o.paciente_id, (orcadoPorPaciente.get(o.paciente_id) || 0) + Number(o.valor_orcado || 0));
    });
    const totalOrcado = Array.from(orcadoPorPaciente.values()).reduce((s, v) => s + v, 0);
    const totalContratado = filteredPagamentos.reduce((s, p) => s + Number(p.valor), 0);
    const pacienteMap = new Map<string, { id: string; nome: string; orcado: number; contratado: number; tratamentos: any[] }>();
    pacientes.forEach((pac) => {
      const orcado = orcadoPorPaciente.get(pac.id) || 0;
      if (orcado <= 0) return;
      const entry = { id: pac.id, nome: pac.nome, orcado, contratado: contratadoPorPaciente.get(pac.id) || 0, tratamentos: [] as any[] };
      filteredTratamentos.filter(t => t.paciente_id === pac.id).forEach(t => {
        entry.tratamentos.push({ procedimento: t.procedimento, clinica: t.clinicas?.nome || "—" });
      });
      pacienteMap.set(pac.id, entry);
    });
    const lista = Array.from(pacienteMap.values());
    const emAberto = lista.filter(p => p.contratado < p.orcado).sort((a, b) => (b.orcado - b.contratado) - (a.orcado - a.contratado));
    const concluidos = lista.filter(p => p.contratado >= p.orcado);
    return { totalOrcado, totalContratado, emAberto, concluidos };
  }, [pacientes, orcamentos, filteredTratamentos, filteredPagamentos]);

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

  const predictability = useMemo(() => {
    const totalOrcado = orcamentos.reduce((s, o) => s + Number(o.valor_orcado || 0), 0);
    const totalContratado = filteredPagamentos.reduce((s, p) => s + Number(p.valor), 0);
    const aReceber = Math.max(0, totalOrcado - totalContratado);
    const leadsTotals = filteredLeads.reduce((acc, l) => ({
      leads: acc.leads + l.leads_novos, agendaram: acc.agendaram + l.agendaram,
      compareceram: acc.compareceram + (l.agendaram - l.faltaram), faltaram: acc.faltaram + l.faltaram,
      contrataram: acc.contrataram + l.contrataram, naoContrataram: acc.naoContrataram + l.nao_contrataram,
    }), { leads: 0, agendaram: 0, compareceram: 0, faltaram: 0, contrataram: 0, naoContrataram: 0 });
    const taxaConversao = leadsTotals.leads > 0 ? (leadsTotals.contrataram / leadsTotals.leads) * 100 : 0;
    const ticketMedioPgto = filteredPagamentos.length > 0 ? totalContratado / filteredPagamentos.length : 0;
    const ticketMedioDiario = totalContratado / diasUteisPassados;
    const projecaoMensal = ticketMedioDiario * diasUteisMes;
    const txAgendamento = leadsTotals.leads > 0 ? leadsTotals.agendaram / leadsTotals.leads : 0;
    const txComparecimento = leadsTotals.agendaram > 0 ? leadsTotals.compareceram / leadsTotals.agendaram : 0;
    const txContratacao = leadsTotals.leads > 0 ? leadsTotals.contrataram / leadsTotals.leads : 0;
    const txNaoContratacao = leadsTotals.leads > 0 ? leadsTotals.naoContrataram / leadsTotals.leads : 0;
    const mediaDiariaLeads = leadsTotals.leads / diasUteisPassados;
    const mediaDiariaAgendaram = leadsTotals.agendaram / diasUteisPassados;
    const mediaDiariaCompareceram = leadsTotals.compareceram / diasUteisPassados;
    const mediaDiariaContrataram = leadsTotals.contrataram / diasUteisPassados;
    const mediaDiariaNaoContrataram = leadsTotals.naoContrataram / diasUteisPassados;
    return {
      totalOrcado, totalContratado, aReceber, taxaConversao, ticketMedioPgto, ticketMedioDiario, projecaoMensal,
      leads: leadsTotals.leads, contrataram: leadsTotals.contrataram,
      txAgendamento, txComparecimento, txContratacao, txNaoContratacao,
      mediaDiariaLeads, mediaDiariaAgendaram, mediaDiariaCompareceram, mediaDiariaContrataram, mediaDiariaNaoContrataram,
      projMensalLeads: mediaDiariaLeads * diasUteisMes, projMensalAgendaram: mediaDiariaAgendaram * diasUteisMes,
      projMensalCompareceram: mediaDiariaCompareceram * diasUteisMes, projMensalContrataram: mediaDiariaContrataram * diasUteisMes,
      projMensalNaoContrataram: mediaDiariaNaoContrataram * diasUteisMes,
    };
  }, [orcamentos, filteredPagamentos, filteredLeads, diasUteisMes, diasUteisPassados]);

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

  // ========== POR PROCEDIMENTO (VOLUME) ==========
  const procedimentoReport = useMemo(() => {
    const map = new Map<string, { procedimento: string; qtd: number }>();
    filteredTratamentos.forEach((t) => {
      const key = t.procedimento;
      const entry = map.get(key) || { procedimento: key, qtd: 0 };
      entry.qtd += 1;
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.qtd - a.qtd);
  }, [filteredTratamentos]);

  // ========== RANKING PACIENTES ==========
  const rankingPacientes = useMemo(() => {
    const contratadoPorPaciente = new Map<string, number>();
    filteredPagamentos.forEach((p) => {
      contratadoPorPaciente.set(p.paciente_id, (contratadoPorPaciente.get(p.paciente_id) || 0) + Number(p.valor));
    });
    const orcadoPorPaciente = new Map<string, number>();
    orcamentos.forEach((o) => {
      orcadoPorPaciente.set(o.paciente_id, (orcadoPorPaciente.get(o.paciente_id) || 0) + Number(o.valor_orcado || 0));
    });
    const qtdTratPorPaciente = new Map<string, number>();
    filteredTratamentos.forEach((t) => {
      qtdTratPorPaciente.set(t.paciente_id, (qtdTratPorPaciente.get(t.paciente_id) || 0) + 1);
    });
    return pacientes
      .map(p => ({
        id: p.id,
        nome: p.nome,
        orcado: orcadoPorPaciente.get(p.id) || 0,
        contratado: contratadoPorPaciente.get(p.id) || 0,
        qtdTratamentos: qtdTratPorPaciente.get(p.id) || 0,
      }))
      .filter(p => p.contratado > 0 || p.orcado > 0)
      .sort((a, b) => b.contratado - a.contratado);
  }, [pacientes, orcamentos, filteredTratamentos, filteredPagamentos]);

  // ========== POR ESPECIALIDADE (ONLY QUANTITY) ==========
  const especialidadeReport = useMemo(() => {
    const map = new Map<string, { especialidade: string; qtd: number }>();
    filteredTratamentos.forEach((t) => {
      const key = t.especialidade || "Não informada";
      const entry = map.get(key) || { especialidade: key, qtd: 0 };
      entry.qtd += 1;
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.qtd - a.qtd);
  }, [filteredTratamentos]);

  // ========== POR ORIGEM / ANÚNCIO ==========
  const origemReport = useMemo(() => {
    const contratadoPorPaciente = new Map<string, number>();
    filteredPagamentos.forEach((p) => {
      contratadoPorPaciente.set(p.paciente_id, (contratadoPorPaciente.get(p.paciente_id) || 0) + Number(p.valor));
    });
    const orcadoPorPaciente = new Map<string, number>();
    orcamentos.forEach((o) => {
      orcadoPorPaciente.set(o.paciente_id, (orcadoPorPaciente.get(o.paciente_id) || 0) + Number(o.valor_orcado || 0));
    });
    const origemMap = new Map<string, { label: string; tipo: string; qtdPacientes: number; orcado: number; contratado: number }>();
    pacientes.forEach((p) => {
      const key = p.origem || "Não informada";
      const entry = origemMap.get(key) || { label: key, tipo: "Origem", qtdPacientes: 0, orcado: 0, contratado: 0 };
      entry.qtdPacientes += 1;
      entry.orcado += orcadoPorPaciente.get(p.id) || 0;
      entry.contratado += contratadoPorPaciente.get(p.id) || 0;
      origemMap.set(key, entry);
    });
    const anuncioMap = new Map<string, { label: string; tipo: string; qtdPacientes: number; orcado: number; contratado: number }>();
    pacientes.filter((p) => p.nome_anuncio && p.nome_anuncio.trim() !== "").forEach((p) => {
      const key = p.nome_anuncio!;
      const entry = anuncioMap.get(key) || { label: key, tipo: "Anúncio", qtdPacientes: 0, orcado: 0, contratado: 0 };
      entry.qtdPacientes += 1;
      entry.orcado += orcadoPorPaciente.get(p.id) || 0;
      entry.contratado += contratadoPorPaciente.get(p.id) || 0;
      anuncioMap.set(key, entry);
    });
    return {
      origens: Array.from(origemMap.values()).sort((a, b) => b.contratado - a.contratado),
      anuncios: Array.from(anuncioMap.values()).sort((a, b) => b.contratado - a.contratado),
    };
  }, [pacientes, orcamentos, filteredPagamentos]);

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
    { key: "contratado", label: "Orçado vs Contratado", desc: "Valores orçados versus contratados com lista de pacientes", icon: DollarSign },
    { key: "diario", label: "Relatório Diário", desc: "Faturamento e pagamentos por dia", icon: Calendar },
    { key: "semanal", label: "Relatório Semanal", desc: "Faturamento agrupado por semana", icon: Calendar },
    { key: "funil", label: "Funil de Leads", desc: "Conversão de leads por etapa do funil", icon: Filter },
    { key: "previsibilidade", label: "Previsibilidade", desc: "Projeções de faturamento e leads", icon: TrendingUp },
    { key: "procedimento", label: "Por Procedimento", desc: "Procedimentos mais contratados por volume", icon: Stethoscope },
    { key: "ranking", label: "Ranking Pacientes", desc: "Top pacientes por valor contratado", icon: Users },
    { key: "especialidade", label: "Por Especialidade", desc: "Quantidade de tratamentos por especialidade", icon: Stethoscope },
    { key: "origem", label: "Origem / Anúncio", desc: "Performance por canal de origem e anúncio", icon: Megaphone },
  ];

  const renderReportContent = () => {
    switch (selectedReport) {
      case "contratado": return (<>
        <Card className="gradient-card border-border shadow-card">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2"><DollarSign size={18} className="text-primary" /> Orçado vs Contratado</CardTitle>
            <ShareButtons title="Orçado vs Contratado" data={[{ orcado: contratadoVsPago.totalOrcado, contratado: contratadoVsPago.totalContratado }]} getSummary={() =>
              `Total Orçado: ${formatCurrency(contratadoVsPago.totalOrcado)}\nTotal Contratado: ${formatCurrency(contratadoVsPago.totalContratado)}\nA Receber: ${formatCurrency(contratadoVsPago.totalOrcado - contratadoVsPago.totalContratado)}\nEm aberto: ${contratadoVsPago.emAberto.length} pacientes\nConcluídos: ${contratadoVsPago.concluidos.length} pacientes`
            } />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg bg-secondary p-4">
                <p className="text-xs text-muted-foreground">Total Orçado</p>
                <p className="text-xl font-bold text-primary">{formatCurrency(contratadoVsPago.totalOrcado)}</p>
              </div>
              <div className="rounded-lg bg-secondary p-4">
                <p className="text-xs text-muted-foreground">Total Contratado</p>
                <p className="text-xl font-bold text-accent-foreground">{formatCurrency(contratadoVsPago.totalContratado)}</p>
              </div>
              <div className="rounded-lg bg-secondary p-4">
                <p className="text-xs text-muted-foreground">A Receber</p>
                <p className="text-xl font-bold text-primary">{formatCurrency(contratadoVsPago.totalOrcado - contratadoVsPago.totalContratado)}</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={[{ name: "Resumo", orcado: contratadoVsPago.totalOrcado, contratado: contratadoVsPago.totalContratado }]} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                <XAxis dataKey="name" stroke="hsl(0,0%,64%)" />
                <YAxis stroke="hsl(0,0%,64%)" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(v: number) => formatCurrency(v)} />
                <Bar dataKey="orcado" fill="hsl(25,100%,50%)" name="Orçado" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
                <Bar dataKey="contratado" fill="hsl(120,50%,50%)" name="Contratado" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
                <Legend />
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

        <Dialog open={showEmAbertoDialog} onOpenChange={setShowEmAbertoDialog}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>🔴 Pacientes em Aberto ({contratadoVsPago.emAberto.length})</DialogTitle></DialogHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Paciente</TableHead><TableHead>Orçado</TableHead><TableHead>Contratado</TableHead><TableHead>Restante</TableHead><TableHead>%</TableHead></TableRow></TableHeader>
                <TableBody>
                  {contratadoVsPago.emAberto.map((p, i) => (
                    <TableRow key={i} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/pacientes/${p.id}`)}>
                      <TableCell className="font-medium text-primary underline-offset-2 hover:underline">{p.nome}</TableCell>
                      <TableCell>{formatCurrency(p.orcado)}</TableCell>
                      <TableCell>{formatCurrency(p.contratado)}</TableCell>
                      <TableCell className="text-destructive font-medium">{formatCurrency(p.orcado - p.contratado)}</TableCell>
                      <TableCell><Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">{p.orcado > 0 ? ((p.contratado / p.orcado) * 100).toFixed(0) : 0}%</Badge></TableCell>
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
              <p className="text-lg font-bold text-destructive">{formatCurrency(contratadoVsPago.emAberto.reduce((s, p) => s + (p.orcado - p.contratado), 0))}</p>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showConcluidosDialog} onOpenChange={setShowConcluidosDialog}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>🟢 Pacientes Concluídos ({contratadoVsPago.concluidos.length})</DialogTitle></DialogHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Paciente</TableHead><TableHead>Orçado</TableHead><TableHead>Contratado</TableHead></TableRow></TableHeader>
                <TableBody>
                  {contratadoVsPago.concluidos.map((p, i) => (
                    <TableRow key={i} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/pacientes/${p.id}`)}>
                      <TableCell className="font-medium text-primary underline-offset-2 hover:underline">{p.nome}</TableCell>
                      <TableCell>{formatCurrency(p.orcado)}</TableCell>
                      <TableCell className="text-green-400">{formatCurrency(p.contratado)}</TableCell>
                    </TableRow>
                  ))}
                  {contratadoVsPago.concluidos.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">Nenhum paciente com pagamento concluído</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="rounded-lg bg-secondary p-3 mt-2">
              <p className="text-xs text-muted-foreground">Total contratado (concluídos)</p>
              <p className="text-lg font-bold text-green-400">{formatCurrency(contratadoVsPago.concluidos.reduce((s, p) => s + p.contratado, 0))}</p>
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
              <BarChart data={dailyReport.slice(0, 14).reverse()} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                <XAxis dataKey="date" stroke="hsl(0,0%,64%)" fontSize={10} />
                <YAxis stroke="hsl(0,0%,64%)" fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(v: number) => [formatCurrency(v), "Faturamento"]} />
                <Bar dataKey="faturamento" fill="hsl(25,100%,50%)" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
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
              <BarChart data={weeklyReport.slice(0, 8).reverse()} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                <XAxis dataKey="week" stroke="hsl(0,0%,64%)" fontSize={10} />
                <YAxis stroke="hsl(0,0%,64%)" fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(v: number) => [formatCurrency(v), "Faturamento"]} />
                <Bar dataKey="faturamento" fill="hsl(35,100%,55%)" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
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
          <CardContent className="space-y-4">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={(() => {
                const totals = funnelReport.reduce((a, r) => ({ leads: a.leads + r.leads, agendaram: a.agendaram + r.agendaram, compareceram: a.compareceram + (r.agendaram - r.faltaram), contrataram: a.contrataram + r.contrataram, naoContrataram: a.naoContrataram + r.nao_contrataram }), { leads: 0, agendaram: 0, compareceram: 0, contrataram: 0, naoContrataram: 0 });
                return [
                  { name: "Leads", value: totals.leads },
                  { name: "Agendaram", value: totals.agendaram },
                  { name: "Compareceram", value: totals.compareceram },
                  { name: "Contrataram", value: totals.contrataram },
                  { name: "Não Contrataram", value: totals.naoContrataram },
                ];
              })()} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                <XAxis dataKey="name" stroke="hsl(0,0%,64%)" fontSize={11} />
                <YAxis stroke="hsl(0,0%,64%)" allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} />
                <Bar dataKey="value" fill="hsl(25,100%,50%)" name="Quantidade" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
              </BarChart>
            </ResponsiveContainer>
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
              `Total Orçado: ${formatCurrency(predictability.totalOrcado)}\nTotal Contratado: ${formatCurrency(predictability.totalContratado)}\nA Receber: ${formatCurrency(predictability.aReceber)}\nTicket Médio Diário: ${formatCurrency(predictability.ticketMedioDiario)}\nProjeção Mensal (${diasUteisMes} dias): ${formatCurrency(predictability.projecaoMensal)}`
            } />
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">💰 Faturamento</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg bg-secondary p-4"><p className="text-xs text-muted-foreground">Total Orçado</p><p className="text-xl font-bold text-primary">{formatCurrency(predictability.totalOrcado)}</p></div>
                <div className="rounded-lg bg-secondary p-4"><p className="text-xs text-muted-foreground">Total Contratado</p><p className="text-xl font-bold text-accent-foreground">{formatCurrency(predictability.totalContratado)}</p></div>
                <div className="rounded-lg bg-secondary p-4"><p className="text-xs text-muted-foreground">A Receber</p><p className="text-xl font-bold text-primary">{formatCurrency(predictability.aReceber)}</p></div>
                <div className="rounded-lg bg-secondary p-4"><p className="text-xs text-muted-foreground">Ticket Médio por Pagamento</p><p className="text-xl font-bold">{formatCurrency(predictability.ticketMedioPgto)}</p></div>
                <div className="rounded-lg bg-secondary p-4"><p className="text-xs text-muted-foreground">Ticket Médio Diário</p><p className="text-xl font-bold">{formatCurrency(predictability.ticketMedioDiario)}</p></div>
                <div className="rounded-lg bg-secondary p-4"><p className="text-xs text-muted-foreground">Projeção Mensal ({diasUteisMes} dias úteis)</p><p className="text-xl font-bold text-primary">{formatCurrency(predictability.projecaoMensal)}</p></div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={[
                { name: "Orçado", value: predictability.totalOrcado },
                { name: "Contratado", value: predictability.totalContratado },
                { name: "A Receber", value: predictability.aReceber },
                { name: "Projeção", value: predictability.projecaoMensal },
              ]} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                <XAxis dataKey="name" stroke="hsl(0,0%,64%)" fontSize={11} />
                <YAxis stroke="hsl(0,0%,64%)" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(v: number) => formatCurrency(v)} />
                <Bar dataKey="value" fill="hsl(25,100%,50%)" name="Valor" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
              </BarChart>
            </ResponsiveContainer>
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
            <CardTitle className="text-base flex items-center gap-2"><Stethoscope size={18} className="text-primary" /> Procedimentos Mais Contratados</CardTitle>
            <ShareButtons title="Procedimentos Mais Contratados" data={procedimentoReport} getSummary={() =>
              procedimentoReport.slice(0, 10).map((r) => `${r.procedimento}: ${r.qtd} contratações`).join("\n")
            } />
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={procedimentoReport.slice(0, 10)} layout="vertical" margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                <XAxis type="number" stroke="hsl(0,0%,64%)" allowDecimals={false} />
                <YAxis type="category" dataKey="procedimento" stroke="hsl(0,0%,64%)" fontSize={10} width={120} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(v: number) => [v, "Contratações"]} />
                <Bar dataKey="qtd" fill="hsl(25,100%,50%)" name="Contratações" radius={[0, 6, 6, 0]} activeBar={activeBarStyle} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 overflow-x-auto max-h-64 overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Procedimento</TableHead><TableHead className="text-center">Contratações</TableHead></TableRow></TableHeader>
                <TableBody>
                  {procedimentoReport.map((r) => (
                    <TableRow key={r.procedimento}>
                      <TableCell className="font-medium">{r.procedimento}</TableCell>
                      <TableCell className="text-center font-semibold">{r.qtd}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      );

      case "ranking": return (
        <Card className="gradient-card border-border shadow-card">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Users size={18} className="text-primary" /> Ranking de Pacientes ({rankingPacientes.length})</CardTitle>
            <ShareButtons title="Ranking Pacientes" data={rankingPacientes} getSummary={() =>
              rankingPacientes.slice(0, 10).map((r, i) => `${i + 1}. ${r.nome}: ${formatCurrency(r.contratado)} contratado`).join("\n")
            } />
          </CardHeader>
          <CardContent className="space-y-4">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={rankingPacientes.slice(0, 10)} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                <XAxis dataKey="nome" stroke="hsl(0,0%,64%)" fontSize={9} angle={-20} textAnchor="end" height={50} />
                <YAxis stroke="hsl(0,0%,64%)" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(v: number) => formatCurrency(v)} />
                <Bar dataKey="orcado" fill="hsl(25,100%,50%)" name="Orçado" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
                <Bar dataKey="contratado" fill="hsl(120,50%,50%)" name="Contratado" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
                <Legend />
              </BarChart>
            </ResponsiveContainer>
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Paciente</TableHead><TableHead>Tratamentos</TableHead><TableHead>Orçado</TableHead><TableHead>Contratado</TableHead><TableHead>Restante</TableHead></TableRow></TableHeader>
                <TableBody>
                  {rankingPacientes.map((r, i) => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/pacientes/${r.id}`)}>
                      <TableCell className="font-bold text-primary">{i + 1}</TableCell>
                      <TableCell className="font-medium text-primary underline-offset-2 hover:underline">{r.nome}</TableCell>
                      <TableCell>{r.qtdTratamentos}</TableCell>
                      <TableCell>{formatCurrency(r.orcado)}</TableCell>
                      <TableCell>{formatCurrency(r.contratado)}</TableCell>
                      <TableCell className={r.orcado - r.contratado > 0 ? "text-destructive" : "text-green-400"}>{formatCurrency(r.orcado - r.contratado)}</TableCell>
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
            <CardTitle className="text-base flex items-center gap-2"><Stethoscope size={18} className="text-primary" /> Tratamentos por Especialidade</CardTitle>
            <ShareButtons title="Relatório por Especialidade" data={especialidadeReport} getSummary={() =>
              especialidadeReport.map((r) => `${r.especialidade}: ${r.qtd} tratamentos`).join("\n")
            } />
          </CardHeader>
          <CardContent className="space-y-4">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={especialidadeReport} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                <XAxis dataKey="especialidade" stroke="hsl(0,0%,64%)" fontSize={11} />
                <YAxis stroke="hsl(0,0%,64%)" allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(v: number) => [v, "Tratamentos"]} />
                <Bar dataKey="qtd" fill="hsl(25,100%,50%)" name="Tratamentos" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
              </BarChart>
            </ResponsiveContainer>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Especialidade</TableHead><TableHead className="text-center">Tratamentos</TableHead><TableHead className="text-center">%</TableHead></TableRow></TableHeader>
                <TableBody>
                  {especialidadeReport.map((r) => {
                    const total = especialidadeReport.reduce((s, x) => s + x.qtd, 0);
                    return (
                      <TableRow key={r.especialidade}>
                        <TableCell className="font-medium">{r.especialidade}</TableCell>
                        <TableCell className="text-center font-semibold">{r.qtd}</TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">{total > 0 ? ((r.qtd / total) * 100).toFixed(1) : 0}%</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      );

      case "origem": return (
        <Card className="gradient-card border-border shadow-card">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Megaphone size={18} className="text-primary" /> Por Origem / Anúncio</CardTitle>
            <ShareButtons title="Relatório por Origem" data={[...origemReport.origens, ...origemReport.anuncios]} getSummary={() =>
              `ORIGENS:\n${origemReport.origens.slice(0, 5).map(r => `${r.label}: ${r.qtdPacientes} pac, Orçado ${formatCurrency(r.orcado)}, Contratado ${formatCurrency(r.contratado)}`).join("\n")}\n\nANÚNCIOS:\n${origemReport.anuncios.slice(0, 5).map(r => `${r.label}: ${r.qtdPacientes} pac, Orçado ${formatCurrency(r.orcado)}, Contratado ${formatCurrency(r.contratado)}`).join("\n")}`
            } />
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">📍 Por Origem</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={origemReport.origens} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                  <XAxis dataKey="label" stroke="hsl(0,0%,64%)" fontSize={11} />
                  <YAxis stroke="hsl(0,0%,64%)" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="orcado" fill="hsl(25,100%,50%)" name="Orçado" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
                  <Bar dataKey="contratado" fill="hsl(120,50%,50%)" name="Contratado" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
                  <Legend />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4 overflow-x-auto max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Origem</TableHead><TableHead>Pacientes</TableHead><TableHead>Orçado</TableHead><TableHead>Contratado</TableHead><TableHead>Taxa</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {origemReport.origens.map((r) => (
                      <TableRow key={r.label}>
                        <TableCell className="font-medium">{r.label}</TableCell>
                        <TableCell>{r.qtdPacientes}</TableCell>
                        <TableCell>{formatCurrency(r.orcado)}</TableCell>
                        <TableCell>{formatCurrency(r.contratado)}</TableCell>
                        <TableCell><Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">{r.orcado > 0 ? ((r.contratado / r.orcado) * 100).toFixed(1) : 0}%</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            {origemReport.anuncios.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3">📢 Por Anúncio</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={origemReport.anuncios} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,20%)" />
                    <XAxis dataKey="label" stroke="hsl(0,0%,64%)" fontSize={11} />
                    <YAxis stroke="hsl(0,0%,64%)" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="orcado" fill="hsl(25,100%,50%)" name="Orçado" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
                    <Bar dataKey="contratado" fill="hsl(120,50%,50%)" name="Contratado" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
                    <Legend />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 overflow-x-auto max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Anúncio</TableHead><TableHead>Pacientes</TableHead><TableHead>Orçado</TableHead><TableHead>Contratado</TableHead><TableHead>Taxa</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {origemReport.anuncios.map((r) => (
                        <TableRow key={r.label}>
                          <TableCell className="font-medium">{r.label}</TableCell>
                          <TableCell>{r.qtdPacientes}</TableCell>
                          <TableCell>{formatCurrency(r.orcado)}</TableCell>
                          <TableCell>{formatCurrency(r.contratado)}</TableCell>
                          <TableCell><Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">{r.orcado > 0 ? ((r.contratado / r.orcado) * 100).toFixed(1) : 0}%</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
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
          <Button variant="outline" size="sm" onClick={() => setSelectedReport(null)}>
            <ArrowLeft size={14} className="mr-1" /> Voltar
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Clínica</span>
          <Select value={clinicaFiltro} onValueChange={setClinicaFiltro}>
            <SelectTrigger className="w-full sm:w-[200px] bg-secondary border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {clinicas.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">De</span>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-secondary border-border w-full sm:w-[160px]" />
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Até</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-secondary border-border w-full sm:w-[160px]" />
        </div>
      </div>

      {/* Report selection or content */}
      {!selectedReport ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {reportTypes.map((rt) => (
            <Card key={rt.key} className="gradient-card border-border shadow-card cursor-pointer hover:border-primary/30 transition-colors" onClick={() => setSelectedReport(rt.key)}>
              <CardContent className="p-4 flex items-start gap-3">
                <rt.icon size={20} className="text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-sm">{rt.label}</p>
                  <p className="text-xs text-muted-foreground">{rt.desc}</p>
                </div>
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
