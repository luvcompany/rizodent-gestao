import { useState, useEffect, useRef, useMemo } from "react";
import { toLocalDateISO } from "@/lib/utils";
import { businessDaysBetween } from "@/lib/businessDays";
import { fetchAllPaged, dayKeyBahia, classifyOrigemCanonica, rptContratados, type ContratadoRow } from "@/lib/reportKit";
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
import { FileBarChart, Download, Share2, MessageCircle, Mail, Calendar, TrendingUp, DollarSign, Users, Stethoscope, Megaphone, Eye, ArrowLeft, CreditCard, Activity, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import * as XLSX from "xlsx";
import type { Tables } from "@/integrations/supabase/types";
import { useChartTheme } from "@/hooks/useChartTheme";

const COLORS = ["hsl(25,100%,50%)", "hsl(35,100%,55%)", "hsl(180,60%,50%)", "hsl(280,60%,60%)", "hsl(120,50%,50%)", "hsl(0,70%,55%)", "hsl(210,70%,55%)", "hsl(50,90%,55%)"];

const activeBarStyle = { style: { filter: "brightness(1.3) drop-shadow(0 0 8px rgba(255,140,0,0.4))", transition: "filter 0.2s ease" } };

const formatCurrency = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

const Relatorios = () => {
  const navigate = useNavigate();
  const ct = useChartTheme();
  const tooltipStyle = ct.tooltipStyle;
  const tooltipLabelStyle = ct.tooltipLabelStyle;
  const tooltipItemStyle = ct.tooltipItemStyle;
  const [clinicas, setClinicas] = useState<Tables<"clinicas">[]>([]);
  const [clinicaFiltro, setClinicaFiltro] = useState("todas");
  const [pagamentos, setPagamentos] = useState<any[]>([]);
  const [tratamentos, setTratamentos] = useState<any[]>([]);
  const [pacientes, setPacientes] = useState<any[]>([]);
  // orçamentos removido; leads_diarios removido (tabela sem lançamentos desde 18/04/2026)
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [holidays, setHolidays] = useState<{ data: string; clinica_id: string | null }[]>([]);
  // Pacientes contratados (RPC canônica rpt_contratados: 1º pagamento no período)
  const [contratados, setContratados] = useState<ContratadoRow[]>([]);
  const [contratadosLoading, setContratadosLoading] = useState(true);
  const [contratadosError, setContratadosError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return toLocalDateISO(d);
  });
  const [dateTo, setDateTo] = useState(() => toLocalDateISO());
  const [showContratadoDialog, setShowContratadoDialog] = useState(false);
  const [showEmAbertoDialog, setShowEmAbertoDialog] = useState(false);
  const [showConcluidosDialog, setShowConcluidosDialog] = useState(false);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      setFetchError(null);
      try {
        // fetchAllPaged: busca TODAS as linhas (PostgREST corta em 1000 sem aviso)
        const [cl, pg, tr, pc, hd] = await Promise.all([
          fetchAllPaged<Tables<"clinicas">>(() => supabase.from("clinicas").select("*").eq("ativa", true), "id"),
          fetchAllPaged<any>(() => supabase.from("pagamentos").select("*, clinicas(nome), pacientes(nome)"), "id"),
          fetchAllPaged<any>(() => supabase.from("tratamentos").select("*, clinicas(nome), pacientes(nome)"), "id"),
          fetchAllPaged<any>(() => supabase.from("pacientes").select("*"), "id"),
          fetchAllPaged<{ data: string; clinica_id: string | null }>(() => (supabase as any).from("dashboard_holidays").select("data, clinica_id"), "id"),
        ]);
        setClinicas(cl); setPagamentos(pg); setTratamentos(tr);
        setPacientes(pc); setHolidays(hd);
      } catch (e: any) {
        setFetchError(e?.message || "Erro desconhecido ao carregar os dados");
        toast.error("Erro ao carregar os dados dos relatórios");
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  // Pacientes contratados via RPC canônica (mesmo número para qualquer usuário do tenant)
  useEffect(() => {
    // evita chamar a RPC com data parcial enquanto o usuário digita no input
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) return;
    let cancelled = false;
    (async () => {
      setContratadosLoading(true);
      setContratadosError(null);
      try {
        const rows = await rptContratados(dateFrom, dateTo, clinicaFiltro === "todas" ? null : clinicaFiltro);
        if (!cancelled) setContratados(rows);
      } catch (e: any) {
        if (!cancelled) {
          setContratados([]);
          setContratadosError(e?.message || "Erro desconhecido");
        }
      } finally {
        if (!cancelled) setContratadosLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dateFrom, dateTo, clinicaFiltro]);

  const filteredPagamentos = useMemo(() => {
    return pagamentos.filter((p) => {
      const inClinica = clinicaFiltro === "todas" || p.clinica_id === clinicaFiltro;
      const inDate = p.data_pagamento >= dateFrom && p.data_pagamento <= dateTo;
      return inClinica && inDate;
    });
  }, [pagamentos, clinicaFiltro, dateFrom, dateTo]);

  const filteredTratamentos = useMemo(() => {
    return tratamentos.filter((t) => {
      const inClinica = clinicaFiltro === "todas" || t.clinica_id === clinicaFiltro;
      // dia local em America/Bahia (created_at é timestamptz UTC)
      const createdDate = t.created_at ? dayKeyBahia(t.created_at) : "";
      const inDate = createdDate >= dateFrom && createdDate <= dateTo;
      return inClinica && inDate;
    });
  }, [tratamentos, clinicaFiltro, dateFrom, dateTo]);

  // ========== CONTRATADO POR PACIENTE ==========
  const contratadoVsPago = useMemo(() => {
    const contratadoPorPaciente = new Map<string, number>();
    filteredPagamentos.forEach((p) => {
      contratadoPorPaciente.set(p.paciente_id, (contratadoPorPaciente.get(p.paciente_id) || 0) + (Number(p.valor) || 0));
    });
    const totalContratado = filteredPagamentos.reduce((s, p) => s + (Number(p.valor) || 0), 0);
    const lista = pacientes
      .map(pac => ({ id: pac.id, nome: pac.nome, contratado: contratadoPorPaciente.get(pac.id) || 0 }))
      .filter(p => p.contratado > 0)
      .sort((a, b) => b.contratado - a.contratado);
    return { totalContratado, lista };
  }, [pacientes, filteredPagamentos]);

  // ========== PACIENTES CONTRATADOS POR MÊS (rpt_contratados) ==========
  // Contratado = paciente cujo PRIMEIRO pagamento (histórico completo) cai no período.
  // Parcelas recorrentes não contam como novo contrato (antes inflavam ~15-25%).
  const contratadosResumo = useMemo(() => {
    const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    const porMes = new Map<string, { mes: string; pacientes: number; valor: number; ordem: string }>();
    contratados.forEach((c) => {
      const [y, m] = String(c.primeiro_pagamento || "").split("-");
      if (!y || !m) return;
      const key = `${y}-${m}`;
      const label = `${MESES[parseInt(m, 10) - 1]}/${y.slice(2)}`;
      const cur = porMes.get(key) || { mes: label, pacientes: 0, valor: 0, ordem: key };
      cur.pacientes += 1;
      cur.valor += c.valor_total_periodo;
      porMes.set(key, cur);
    });
    const chart = Array.from(porMes.values()).sort((a, b) => a.ordem.localeCompare(b.ordem));
    const totalValor = contratados.reduce((s, c) => s + c.valor_total_periodo, 0);
    return { chart, totalPacientes: contratados.length, totalValor };
  }, [contratados]);

  // ========== PAGAMENTOS DETALHADOS (lista do período) ==========
  const pagamentosDetalhados = useMemo(() => {
    const lista = [...filteredPagamentos]
      .sort((a, b) => String(b.data_pagamento).localeCompare(String(a.data_pagamento)))
      .map((p) => ({
        id: p.id,
        paciente_id: p.paciente_id,
        paciente: p.pacientes?.nome || "—",
        data: p.data_pagamento,
        valor: Number(p.valor) || 0,
        clinica: p.clinicas?.nome || "—",
      }));

    const totalPacientes = new Set(lista.map((l) => l.paciente_id).filter(Boolean)).size;
    const totalValor = lista.reduce((s, l) => s + l.valor, 0);

    return { lista, totalPacientes, totalValor };
  }, [filteredPagamentos]);

  // ========== DAILY REPORT ==========
  const dailyReport = useMemo(() => {

    const map = new Map<string, { date: string; faturamento: number; pagamentos: number }>();
    filteredPagamentos.forEach((p) => {
      const d = p.data_pagamento;
      const entry = map.get(d) || { date: d, faturamento: 0, pagamentos: 0 };
      entry.faturamento += (Number(p.valor) || 0);
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
      return toLocalDateISO(start);
    };
    const map = new Map<string, { week: string; faturamento: number; pagamentos: number }>();
    filteredPagamentos.forEach((p) => {
      const w = getWeek(p.data_pagamento);
      const entry = map.get(w) || { week: w, faturamento: 0, pagamentos: 0 };
      entry.faturamento += (Number(p.valor) || 0);
      entry.pagamentos += 1;
      map.set(w, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.week.localeCompare(a.week));
  }, [filteredPagamentos]);

  // ========== PREDICTABILITY ==========
  // Conjunto de feriados aplicáveis à clínica filtrada (YYYY-MM-DD local)
  const holidaySet = useMemo(() => {
    const set = new Set<string>();
    holidays.forEach((h) => {
      // Feriado global (sem clinica_id) vale sempre; feriado de uma clínica só vale
      // quando ELA está filtrada (na visão "todas" não zera o dia da rede inteira).
      const applies = !h.clinica_id || h.clinica_id === clinicaFiltro;
      if (applies) set.add(h.data);
    });
    return set;
  }, [holidays, clinicaFiltro]);

  // Mês/ano de referência = mês do início do período filtrado
  const refMonth = useMemo(() => {
    const d = new Date(dateFrom + "T12:00:00");
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }, [dateFrom]);

  // O período selecionado é EXATAMENTE o mês corrente? (previsão só faz sentido nele)
  const isCurrentMonthSelected = useMemo(() => {
    const now = new Date();
    const start = new Date(dateFrom + "T12:00:00");
    const end = new Date(dateTo + "T12:00:00");
    return (
      start.getFullYear() === now.getFullYear() &&
      start.getMonth() === now.getMonth() &&
      start.getDate() === 1 &&
      end.getFullYear() === now.getFullYear() &&
      end.getMonth() === now.getMonth()
    );
  }, [dateFrom, dateTo]);

  // Dias úteis do MÊS INTEIRO (Seg-Sex=1, Sáb=0.5, Dom=0, feriados=0)
  const diasUteisMes = useMemo(() => {
    const firstDay = new Date(refMonth.getFullYear(), refMonth.getMonth(), 1);
    const lastDay = new Date(refMonth.getFullYear(), refMonth.getMonth() + 1, 0);
    return Math.max(businessDaysBetween(firstDay, lastDay, holidaySet), 1);
  }, [refMonth, holidaySet]);

  const predictability = useMemo(() => {
    const totalContratado = filteredPagamentos.reduce((s, p) => s + (Number(p.valor) || 0), 0);
    // Lançamentos atrasam (às vezes mais de 1 dia): a média diária usa somente
    // os dias úteis até o ÚLTIMO DIA COM LANÇAMENTO, para não diluir a projeção
    // com dias ainda não lançados.
    const ultimoDiaLancado = filteredPagamentos.reduce(
      (max, p) => ((p.data_pagamento || "") > max ? p.data_pagamento : max), ""
    );
    const diasUteisLancados = ultimoDiaLancado
      ? Math.max(businessDaysBetween(new Date(dateFrom + "T12:00:00"), new Date(ultimoDiaLancado + "T12:00:00"), holidaySet), 0.5)
      : 0;
    const ticketMedioPgto = filteredPagamentos.length > 0 ? totalContratado / filteredPagamentos.length : 0;
    const ticketMedioDiario = diasUteisLancados > 0 ? totalContratado / diasUteisLancados : 0;
    const projecaoMensal = ticketMedioDiario * diasUteisMes;
    return { totalContratado, ticketMedioPgto, ticketMedioDiario, projecaoMensal, ultimoDiaLancado, diasUteisLancados };
  }, [filteredPagamentos, diasUteisMes, dateFrom, holidaySet]);

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

  // ========== RANKING PACIENTES (por contratado) ==========
  const rankingPacientes = useMemo(() => {
    const contratadoPorPaciente = new Map<string, number>();
    const qtdPgtoPorPaciente = new Map<string, number>();
    filteredPagamentos.forEach((p) => {
      contratadoPorPaciente.set(p.paciente_id, (contratadoPorPaciente.get(p.paciente_id) || 0) + (Number(p.valor) || 0));
      qtdPgtoPorPaciente.set(p.paciente_id, (qtdPgtoPorPaciente.get(p.paciente_id) || 0) + 1);
    });
    return pacientes
      .map(p => ({
        id: p.id, nome: p.nome,
        contratado: contratadoPorPaciente.get(p.id) || 0,
        qtdPagamentos: qtdPgtoPorPaciente.get(p.id) || 0,
      }))
      .filter(p => p.contratado > 0)
      .sort((a, b) => b.contratado - a.contratado);
  }, [pacientes, filteredPagamentos]);

  // ========== POR ESPECIALIDADE (faturamento + qtd) ==========
  const especialidadeReport = useMemo(() => {
    const map = new Map<string, { especialidade: string; qtd: number; total: number }>();
    filteredPagamentos.forEach((p) => {
      const key = p.especialidade || "Não informada";
      const entry = map.get(key) || { especialidade: key, qtd: 0, total: 0 };
      entry.qtd += 1;
      entry.total += Number(p.valor || 0);
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredPagamentos]);

  // ========== POR ORIGEM / ANÚNCIO (pacientes e pagamentos DO MESMO período) ==========
  const origemReport = useMemo(() => {
    const contratadoPorPaciente = new Map<string, number>();
    filteredPagamentos.forEach((p) => {
      contratadoPorPaciente.set(p.paciente_id, (contratadoPorPaciente.get(p.paciente_id) || 0) + (Number(p.valor) || 0));
    });
    const origemMap = new Map<string, { label: string; tipo: string; qtdPacientes: number; contratado: number }>();
    const anuncioMap = new Map<string, { label: string; tipo: string; qtdPacientes: number; contratado: number }>();
    // Só entram pacientes COM pagamento no período filtrado — antes o denominador
    // "Pacientes" era o histórico inteiro, tornando as razões sem sentido.
    pacientes.forEach((p) => {
      const pago = contratadoPorPaciente.get(p.id) || 0;
      if (pago <= 0) return;
      const key = classifyOrigemCanonica({ source: p.origem, nome_anuncio: p.nome_anuncio });
      const entry = origemMap.get(key) || { label: key, tipo: "Origem", qtdPacientes: 0, contratado: 0 };
      entry.qtdPacientes += 1;
      entry.contratado += pago;
      origemMap.set(key, entry);
      if (p.nome_anuncio && p.nome_anuncio.trim() !== "") {
        const aKey = p.nome_anuncio;
        const aEntry = anuncioMap.get(aKey) || { label: aKey, tipo: "Anúncio", qtdPacientes: 0, contratado: 0 };
        aEntry.qtdPacientes += 1;
        aEntry.contratado += pago;
        anuncioMap.set(aKey, aEntry);
      }
    });
    return {
      origens: Array.from(origemMap.values()).sort((a, b) => b.contratado - a.contratado),
      anuncios: Array.from(anuncioMap.values()).sort((a, b) => b.contratado - a.contratado),
    };
  }, [pacientes, filteredPagamentos]);

  // ========== ATIVIDADE RECENTE (Pagamentos + Atualizações) ==========
  const recentActivity = useMemo(() => {
    const items: Array<{
      id: string;
      tipo: "pagamento" | "orcamento_novo" | "orcamento_atualizado" | "tratamento_novo" | "tratamento_atualizado" | "paciente_novo" | "paciente_atualizado";
      timestamp: string;
      titulo: string;
      descricao: string;
      pacienteId?: string;
      pacienteNome?: string;
      valor?: number;
    }> = [];

    pagamentos.forEach((p) => {
      items.push({
        id: `pg-${p.id}`,
        tipo: "pagamento",
        timestamp: p.created_at,
        titulo: "Pagamento registrado",
        descricao: `${p.forma_pagamento || "—"} • ${p.tipo === "primeiro" ? "Novo" : "Recorrente"}`,
        pacienteId: p.paciente_id,
        pacienteNome: p.pacientes?.nome,
        valor: (Number(p.valor) || 0),
      });
    });

    // orçamentos removidos do sistema

    tratamentos.forEach((t) => {
      items.push({
        id: `tr-${t.id}-c`,
        tipo: "tratamento_novo",
        timestamp: t.created_at,
        titulo: "Tratamento criado",
        descricao: `${t.procedimento}${t.especialidade ? ` • ${t.especialidade}` : ""}`,
        pacienteId: t.paciente_id,
        pacienteNome: t.pacientes?.nome,
      });
      if (t.updated_at && t.updated_at !== t.created_at) {
        items.push({
          id: `tr-${t.id}-u`,
          tipo: "tratamento_atualizado",
          timestamp: t.updated_at,
          titulo: "Tratamento atualizado",
          descricao: `${t.procedimento} • Status: ${t.status}`,
          pacienteId: t.paciente_id,
          pacienteNome: t.pacientes?.nome,
        });
      }
    });

    pacientes.forEach((p) => {
      items.push({
        id: `pc-${p.id}-c`,
        tipo: "paciente_novo",
        timestamp: p.created_at,
        titulo: "Paciente cadastrado",
        descricao: p.origem || "Origem não informada",
        pacienteId: p.id,
        pacienteNome: p.nome,
      });
      if (p.updated_at && p.updated_at !== p.created_at) {
        items.push({
          id: `pc-${p.id}-u`,
          tipo: "paciente_atualizado",
          timestamp: p.updated_at,
          titulo: "Paciente atualizado",
          descricao: p.cidade || "—",
          pacienteId: p.id,
          pacienteNome: p.nome,
        });
      }
    });

    return items
      .filter((i) => !!i.timestamp)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 100);
  }, [pagamentos, tratamentos, pacientes]);

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

  if (fetchError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-center">
        <p className="text-destructive font-medium">Erro ao carregar os dados dos relatórios</p>
        <p className="text-sm text-muted-foreground max-w-md">{fetchError}</p>
      </div>
    );
  }

  const reportTypes = [
    { key: "atividade", label: "Atividade Recente", desc: "Últimos pagamentos e atualizações com data e horário exatos", icon: Activity },
    { key: "completo", label: "Relatório Completo", desc: "Visão consolidada com todos os dados e métricas", icon: FileBarChart },
    { key: "contratado", label: "Faturamento por Paciente", desc: "Total de pagamentos recebidos no período, detalhado por paciente", icon: DollarSign },
    { key: "diario", label: "Relatório Diário", desc: "Faturamento e pagamentos por dia", icon: Calendar },
    { key: "semanal", label: "Relatório Semanal", desc: "Faturamento agrupado por semana", icon: Calendar },
    { key: "previsibilidade", label: "Previsibilidade", desc: "Projeção de faturamento do mês corrente", icon: TrendingUp },
    { key: "procedimento", label: "Por Procedimento", desc: "Procedimentos mais registrados por volume", icon: Stethoscope },
    { key: "ranking", label: "Ranking Pacientes", desc: "Top pacientes por valor pago no período", icon: Users },
    { key: "especialidade", label: "Por Especialidade", desc: "Quantidade e valor de pagamentos por especialidade", icon: Stethoscope },
    { key: "origem", label: "Origem / Anúncio", desc: "Pagamentos do período por canal de origem e anúncio", icon: Megaphone },
    { key: "pagamentos", label: "Pagamentos", desc: "Detalhamento de todos os pagamentos realizados", icon: CreditCard },
    { key: "pacientes_mes", label: "Pacientes Contratados/Mês", desc: "Novos pacientes (1º pagamento no período) por mês", icon: Users },
    { key: "pagamentos_lista", label: "Pagamentos Detalhados", desc: "Nome do paciente, data do pagamento e valor pago", icon: CreditCard },
  ];

  const renderReportContent = () => {
    if (selectedReport === "completo") {
      return (
        <div className="space-y-6">
          {["previsibilidade", "contratado", "diario", "semanal", "procedimento", "ranking", "especialidade", "origem", "pagamentos"].map((key) => (
            <div key={key}>{renderSingleReportByKey(key)}</div>
          ))}
        </div>
      );
    }
    return renderSingleReportByKey(selectedReport);
  };

  const renderSingleReportByKey = (reportKey: string | null) => {
    switch (reportKey) {
      case "contratado": return (
        <Card className="gradient-card border-border shadow-card">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2"><DollarSign size={18} className="text-primary" /> Faturamento por Paciente</CardTitle>
            <ShareButtons title="Faturamento por Paciente" data={[{ faturamento: contratadoVsPago.totalContratado }]} getSummary={() =>
              `Faturamento (pagamentos recebidos): ${formatCurrency(contratadoVsPago.totalContratado)}\nPacientes com pagamento: ${contratadoVsPago.lista.length}`
            } />
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-xs text-muted-foreground">Soma de todos os pagamentos recebidos no período (novos e recorrentes), por data de pagamento.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg bg-secondary p-4">
                <p className="text-xs text-muted-foreground">Faturamento (pagamentos recebidos)</p>
                <p className="text-xl font-bold text-accent-foreground">{formatCurrency(contratadoVsPago.totalContratado)}</p>
              </div>
              <div className="rounded-lg bg-secondary p-4">
                <p className="text-xs text-muted-foreground">Pacientes com pagamento</p>
                <p className="text-xl font-bold text-primary">{contratadoVsPago.lista.length}</p>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Paciente</TableHead><TableHead>Pago no período</TableHead></TableRow></TableHeader>
                <TableBody>
                  {contratadoVsPago.lista.map((p) => (
                    <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/pacientes/${p.id}`)}>
                      <TableCell className="font-medium text-primary underline-offset-2 hover:underline">{p.nome}</TableCell>
                      <TableCell className="text-green-400">{formatCurrency(p.contratado)}</TableCell>
                    </TableRow>
                  ))}
                  {contratadoVsPago.lista.length === 0 && (
                    <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-8">Nenhum pagamento no período</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      );

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
                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                <XAxis dataKey="date" stroke={ct.axisColor} fontSize={10} />
                <YAxis stroke={ct.axisColor} fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
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
                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                <XAxis dataKey="week" stroke={ct.axisColor} fontSize={10} />
                <YAxis stroke={ct.axisColor} fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
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

      case "previsibilidade": return (
        <Card className="gradient-card border-border shadow-card">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp size={18} className="text-primary" /> Previsibilidade</CardTitle>
            <ShareButtons title="Relatório Previsibilidade" data={[predictability]} getSummary={() =>
              `Faturamento no Período: ${formatCurrency(predictability.totalContratado)}\nTicket Médio Diário: ${formatCurrency(predictability.ticketMedioDiario)}\nProjeção Mensal (${diasUteisMes} dias): ${isCurrentMonthSelected ? formatCurrency(predictability.projecaoMensal) : "— (apenas no mês corrente)"}${predictability.ultimoDiaLancado ? `\nLançamentos até ${new Date(predictability.ultimoDiaLancado + "T12:00:00").toLocaleDateString("pt-BR")}` : ""}`
            } />
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">💰 Faturamento</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg bg-secondary p-4"><p className="text-xs text-muted-foreground">Faturamento no Período</p><p className="text-xl font-bold text-accent-foreground">{formatCurrency(predictability.totalContratado)}</p></div>
                <div className="rounded-lg bg-secondary p-4"><p className="text-xs text-muted-foreground">Ticket Médio por Pagamento</p><p className="text-xl font-bold">{formatCurrency(predictability.ticketMedioPgto)}</p></div>
                <div className="rounded-lg bg-secondary p-4"><p className="text-xs text-muted-foreground">Ticket Médio Diário</p><p className="text-xl font-bold">{formatCurrency(predictability.ticketMedioDiario)}</p></div>
                <div className="rounded-lg bg-secondary p-4"><p className="text-xs text-muted-foreground">Projeção Mensal ({diasUteisMes} dias úteis)</p><p className="text-xl font-bold text-primary">{isCurrentMonthSelected ? formatCurrency(predictability.projecaoMensal) : "—"}</p>{!isCurrentMonthSelected && <p className="text-[10px] text-muted-foreground mt-1">Disponível apenas para o mês corrente</p>}</div>
              </div>
              {predictability.ultimoDiaLancado ? (
                <p className="text-xs text-muted-foreground mt-3">
                  Média diária calculada com os dias úteis até o último dia com lançamento
                  ({new Date(predictability.ultimoDiaLancado + "T12:00:00").toLocaleDateString("pt-BR")} — {predictability.diasUteisLancados.toFixed(1)} dias úteis).
                  Dias ainda não lançados não diluem a projeção.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-3">Nenhum pagamento lançado no período — sem base para projeção.</p>
              )}
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={[
                { name: "Faturamento", value: predictability.totalContratado },
                { name: "Projeção", value: isCurrentMonthSelected ? predictability.projecaoMensal : 0 },
              ]} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                <XAxis dataKey="name" stroke={ct.axisColor} fontSize={11} />
                <YAxis stroke={ct.axisColor} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(v: number) => formatCurrency(v)} />
                <Bar dataKey="value" fill="hsl(120,50%,50%)" name="Valor" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
              </BarChart>
            </ResponsiveContainer>
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
                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                <XAxis type="number" stroke={ct.axisColor} allowDecimals={false} />
                <YAxis type="category" dataKey="procedimento" stroke={ct.axisColor} fontSize={10} width={120} />
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
                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                <XAxis dataKey="nome" stroke={ct.axisColor} fontSize={9} angle={-20} textAnchor="end" height={50} />
                <YAxis stroke={ct.axisColor} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(v: number) => formatCurrency(v)} />
                <Bar dataKey="contratado" fill="hsl(120,50%,50%)" name="Contratado" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
                <Legend />
              </BarChart>
            </ResponsiveContainer>
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Paciente</TableHead><TableHead>Pagamentos</TableHead><TableHead>Contratado</TableHead></TableRow></TableHeader>
                <TableBody>
                  {rankingPacientes.map((r, i) => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/pacientes/${r.id}`)}>
                      <TableCell className="font-bold text-primary">{i + 1}</TableCell>
                      <TableCell className="font-medium text-primary underline-offset-2 hover:underline">{r.nome}</TableCell>
                      <TableCell>{r.qtdPagamentos}</TableCell>
                      <TableCell className="text-green-400">{formatCurrency(r.contratado)}</TableCell>
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
            <CardTitle className="text-base flex items-center gap-2"><Stethoscope size={18} className="text-primary" /> Pagamentos por Especialidade</CardTitle>
            <ShareButtons title="Pagamentos por Especialidade" data={especialidadeReport} getSummary={() =>
              especialidadeReport.map((r) => `${r.especialidade}: ${r.qtd} pagamentos - ${formatCurrency(r.total)}`).join("\n")
            } />
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">Conta pagamentos recebidos (cada parcela é um pagamento), não tratamentos realizados.</p>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={especialidadeReport} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                <XAxis dataKey="especialidade" stroke={ct.axisColor} fontSize={11} />
                <YAxis stroke={ct.axisColor} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(v: number) => [v, "Pagamentos"]} />
                <Bar dataKey="qtd" fill="hsl(25,100%,50%)" name="Pagamentos" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
              </BarChart>
            </ResponsiveContainer>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Especialidade</TableHead><TableHead className="text-center">Pagamentos</TableHead><TableHead className="text-center">Faturamento</TableHead><TableHead className="text-center">%</TableHead></TableRow></TableHeader>
                <TableBody>
                  {especialidadeReport.map((r) => {
                    const total = especialidadeReport.reduce((s, x) => s + x.qtd, 0);
                    return (
                      <TableRow key={r.especialidade}>
                        <TableCell className="font-medium">{r.especialidade}</TableCell>
                        <TableCell className="text-center font-semibold">{r.qtd}</TableCell>
                        <TableCell className="text-center">{formatCurrency(r.total)}</TableCell>
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
              `ORIGENS:\n${origemReport.origens.slice(0, 5).map(r => `${r.label}: ${r.qtdPacientes} pac. pagantes, Pago ${formatCurrency(r.contratado)}`).join("\n")}\n\nANÚNCIOS:\n${origemReport.anuncios.slice(0, 5).map(r => `${r.label}: ${r.qtdPacientes} pac. pagantes, Pago ${formatCurrency(r.contratado)}`).join("\n")}`
            } />
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-xs text-muted-foreground">Somente pacientes com pagamento dentro do período filtrado; valores somam os pagamentos do período.</p>
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">📍 Por Origem</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={origemReport.origens} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                  <XAxis dataKey="label" stroke={ct.axisColor} fontSize={11} />
                  <YAxis stroke={ct.axisColor} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="contratado" fill="hsl(120,50%,50%)" name="Contratado" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
                  <Legend />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4 overflow-x-auto max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Origem</TableHead><TableHead>Pacientes pagantes</TableHead><TableHead>Pago no período</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {origemReport.origens.map((r) => (
                      <TableRow key={r.label}>
                        <TableCell className="font-medium">{r.label}</TableCell>
                        <TableCell>{r.qtdPacientes}</TableCell>
                        <TableCell className="text-green-400">{formatCurrency(r.contratado)}</TableCell>
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
                    <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                    <XAxis dataKey="label" stroke={ct.axisColor} fontSize={11} />
                    <YAxis stroke={ct.axisColor} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="contratado" fill="hsl(120,50%,50%)" name="Contratado" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
                    <Legend />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 overflow-x-auto max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Anúncio</TableHead><TableHead>Pacientes pagantes</TableHead><TableHead>Pago no período</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {origemReport.anuncios.map((r) => (
                        <TableRow key={r.label}>
                          <TableCell className="font-medium">{r.label}</TableCell>
                          <TableCell>{r.qtdPacientes}</TableCell>
                          <TableCell className="text-green-400">{formatCurrency(r.contratado)}</TableCell>
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

      case "pagamentos": {
        const pgByClinica = new Map<string, { clinica: string; qtd: number; total: number }>();
        filteredPagamentos.forEach((p) => {
          const clinicaNome = p.clinicas?.nome || "Sem clínica";
          const entry = pgByClinica.get(clinicaNome) || { clinica: clinicaNome, qtd: 0, total: 0 };
          entry.qtd += 1;
          entry.total += (Number(p.valor) || 0);
          pgByClinica.set(clinicaNome, entry);
        });
        const pgClinicaData = Array.from(pgByClinica.values()).sort((a, b) => b.total - a.total);
        const pgByForma = new Map<string, { forma: string; qtd: number; total: number }>();
        filteredPagamentos.forEach((p) => {
          const forma = p.forma_pagamento || "Não informado";
          const entry = pgByForma.get(forma) || { forma, qtd: 0, total: 0 };
          entry.qtd += 1;
          entry.total += (Number(p.valor) || 0);
          pgByForma.set(forma, entry);
        });
        const pgFormaData = Array.from(pgByForma.values()).sort((a, b) => b.total - a.total);
        const totalPagamentos = filteredPagamentos.reduce((s, p) => s + (Number(p.valor) || 0), 0);

        return (
          <Card className="gradient-card border-border shadow-card">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base flex items-center gap-2"><CreditCard size={18} className="text-primary" /> Relatório de Pagamentos</CardTitle>
              <ShareButtons title="Relatório de Pagamentos" data={filteredPagamentos.map(p => ({ data: p.data_pagamento, paciente: p.pacientes?.nome, valor: p.valor, forma: p.forma_pagamento, tipo: p.tipo }))} getSummary={() =>
                `Total: ${formatCurrency(totalPagamentos)}\nQuantidade: ${filteredPagamentos.length} pagamentos\n\nPor forma:\n${pgFormaData.map(f => `${f.forma}: ${f.qtd}x - ${formatCurrency(f.total)}`).join("\n")}`
              } />
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg bg-secondary p-4">
                  <p className="text-xs text-muted-foreground">Total de Pagamentos</p>
                  <p className="text-xl font-bold text-primary">{filteredPagamentos.length}</p>
                </div>
                <div className="rounded-lg bg-secondary p-4">
                  <p className="text-xs text-muted-foreground">Valor Total</p>
                  <p className="text-xl font-bold text-accent-foreground">{formatCurrency(totalPagamentos)}</p>
                </div>
                <div className="rounded-lg bg-secondary p-4">
                  <p className="text-xs text-muted-foreground">Ticket Médio</p>
                  <p className="text-xl font-bold text-primary">{formatCurrency(filteredPagamentos.length > 0 ? totalPagamentos / filteredPagamentos.length : 0)}</p>
                </div>
              </div>

              <Tabs defaultValue="clinica" className="space-y-4">
                <TabsList className="bg-secondary">
                  <TabsTrigger value="clinica">Por Clínica</TabsTrigger>
                  <TabsTrigger value="forma">Por Forma de Pgto</TabsTrigger>
                  <TabsTrigger value="lista">Lista Completa</TabsTrigger>
                </TabsList>

                <TabsContent value="clinica">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={pgClinicaData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                      <XAxis dataKey="clinica" stroke={ct.axisColor} fontSize={11} />
                      <YAxis stroke={ct.axisColor} fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(v: number, name: string) => [name === "total" ? formatCurrency(v) : v, name === "total" ? "Valor" : "Quantidade"]} />
                      <Bar dataKey="total" fill="hsl(25,100%,50%)" name="Valor" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-4 overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow><TableHead>Clínica</TableHead><TableHead>Qtd</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {pgClinicaData.map((r) => (
                          <TableRow key={r.clinica}>
                            <TableCell className="font-medium">{r.clinica}</TableCell>
                            <TableCell>{r.qtd}</TableCell>
                            <TableCell>{formatCurrency(r.total)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="forma">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={pgFormaData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                      <XAxis dataKey="forma" stroke={ct.axisColor} fontSize={11} />
                      <YAxis stroke={ct.axisColor} fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={false} formatter={(v: number, name: string) => [name === "total" ? formatCurrency(v) : v, name === "total" ? "Valor" : "Quantidade"]} />
                      <Bar dataKey="total" fill="hsl(35,100%,55%)" name="Valor" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-4 overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow><TableHead>Forma</TableHead><TableHead>Qtd</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {pgFormaData.map((r) => (
                          <TableRow key={r.forma}>
                            <TableCell className="font-medium">{r.forma}</TableCell>
                            <TableCell>{r.qtd}</TableCell>
                            <TableCell>{formatCurrency(r.total)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="lista">
                  <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <Table>
                      <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Paciente</TableHead><TableHead>Valor</TableHead><TableHead>Forma</TableHead><TableHead>Tipo</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {filteredPagamentos.sort((a, b) => b.data_pagamento.localeCompare(a.data_pagamento)).map((p) => (
                          <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/pacientes/${p.paciente_id}`)}>
                            <TableCell>{new Date(p.data_pagamento + "T12:00:00").toLocaleDateString("pt-BR")}</TableCell>
                            <TableCell className="font-medium text-primary hover:underline">{p.pacientes?.nome || "—"}</TableCell>
                            <TableCell>{formatCurrency(Number(p.valor) || 0)}</TableCell>
                            <TableCell>{p.forma_pagamento}</TableCell>
                            <TableCell><Badge variant="outline" className={p.tipo === "primeiro" ? "bg-primary/10 text-primary border-primary/30" : "bg-secondary"}>{p.tipo === "primeiro" ? "Novo" : "Recorrente"}</Badge></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        );
      }

      case "atividade": {
        const tipoLabel: Record<string, { label: string; className: string }> = {
          pagamento: { label: "Pagamento", className: "bg-primary/10 text-primary border-primary/30" },
          orcamento_novo: { label: "Orçamento novo", className: "bg-secondary" },
          orcamento_atualizado: { label: "Orçamento atualizado", className: "bg-secondary" },
          tratamento_novo: { label: "Tratamento novo", className: "bg-secondary" },
          tratamento_atualizado: { label: "Tratamento atualizado", className: "bg-secondary" },
          paciente_novo: { label: "Paciente novo", className: "bg-secondary" },
          paciente_atualizado: { label: "Paciente atualizado", className: "bg-secondary" },
        };
        return (
          <Card className="gradient-card border-border shadow-card">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity size={18} className="text-primary" /> Atividade Recente
              </CardTitle>
              <ShareButtons
                title="Atividade Recente"
                data={recentActivity.map((i) => ({
                  data_hora: new Date(i.timestamp).toLocaleString("pt-BR"),
                  tipo: tipoLabel[i.tipo]?.label || i.tipo,
                  paciente: i.pacienteNome || "—",
                  detalhe: i.descricao,
                  valor: i.valor ? formatCurrency(i.valor) : "",
                }))}
                getSummary={() =>
                  recentActivity.slice(0, 10).map((i) =>
                    `${new Date(i.timestamp).toLocaleString("pt-BR")} • ${tipoLabel[i.tipo]?.label} • ${i.pacienteNome || "—"}${i.valor ? ` • ${formatCurrency(i.valor)}` : ""}`
                  ).join("\n")
                }
              />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                <Clock size={12} /> Mostrando os 100 eventos mais recentes (todos os períodos)
              </p>
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data e hora</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Paciente</TableHead>
                      <TableHead>Detalhe</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentActivity.map((i) => {
                      const dt = new Date(i.timestamp);
                      const data = dt.toLocaleDateString("pt-BR");
                      const hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                      return (
                        <TableRow
                          key={i.id}
                          className={i.pacienteId ? "cursor-pointer hover:bg-muted/50" : ""}
                          onClick={() => i.pacienteId && navigate(`/pacientes/${i.pacienteId}`)}
                        >
                          <TableCell className="whitespace-nowrap">
                            <div className="font-medium">{data}</div>
                            <div className="text-xs text-muted-foreground">{hora}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={tipoLabel[i.tipo]?.className}>
                              {tipoLabel[i.tipo]?.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium text-primary hover:underline">
                            {i.pacienteNome || "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{i.descricao}</TableCell>
                          <TableCell className="text-right font-medium">
                            {i.valor ? formatCurrency(i.valor) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {recentActivity.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          Nenhuma atividade recente
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );
      }

      case "pacientes_mes": {
        const { chart, totalPacientes, totalValor } = contratadosResumo;
        return (
          <Card className="gradient-card border-border shadow-card">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base flex items-center gap-2"><Users size={18} className="text-primary" /> Pacientes Contratados por Mês</CardTitle>
              <ShareButtons
                title="Pacientes Contratados por Mês"
                data={chart}
                getSummary={() =>
                  `Pacientes contratados (1º pagamento no período): ${totalPacientes}\nValor pago no período por esses pacientes: ${formatCurrency(totalValor)}\n\nPor mês:\n${chart.map((c) => `${c.mes}: ${c.pacientes} pacientes - ${formatCurrency(c.valor)}`).join("\n")}`
                }
              />
            </CardHeader>
            <CardContent className="space-y-6">
              {contratadosError ? (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                  <p className="text-sm font-medium text-destructive">Não foi possível carregar os pacientes contratados</p>
                  <p className="text-xs text-muted-foreground mt-1">{contratadosError}</p>
                </div>
              ) : contratadosLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Carregando pacientes contratados...</div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Contratado = paciente cujo PRIMEIRO pagamento (considerando todo o histórico) cai no período filtrado.
                    Parcelas recorrentes de pacientes antigos não contam como novo contrato.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-lg bg-secondary p-4">
                      <p className="text-xs text-muted-foreground">Pacientes contratados no período</p>
                      <p className="text-xl font-bold text-primary">{totalPacientes}</p>
                    </div>
                    <div className="rounded-lg bg-secondary p-4">
                      <p className="text-xs text-muted-foreground">Valor pago no período (por esses pacientes)</p>
                      <p className="text-xl font-bold text-accent-foreground">{formatCurrency(totalValor)}</p>
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={chart} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={ct.gridColor} />
                      <XAxis dataKey="mes" stroke={ct.axisColor} fontSize={12} />
                      <YAxis stroke={ct.axisColor} fontSize={12} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} formatter={(v: any, name) => name === "valor" ? formatCurrency(Number(v)) : `${v} pacientes`} />
                      <Legend />
                      <Bar dataKey="pacientes" name="Pacientes" fill="hsl(25,100%,50%)" radius={[6, 6, 0, 0]} activeBar={activeBarStyle} />
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
            </CardContent>
          </Card>
        );
      }

      case "pagamentos_lista": {
        const { lista, totalPacientes, totalValor } = pagamentosDetalhados;
        return (
          <Card className="gradient-card border-border shadow-card">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base flex items-center gap-2"><CreditCard size={18} className="text-primary" /> Pagamentos Detalhados</CardTitle>
              <ShareButtons
                title="Pagamentos Detalhados"
                data={lista.map((l) => ({ paciente: l.paciente, data_pagamento: l.data, valor: l.valor, clinica: l.clinica }))}
                getSummary={() =>
                  `Pacientes únicos: ${totalPacientes}\nPagamentos: ${lista.length}\nValor total: ${formatCurrency(totalValor)}`
                }
              />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg bg-secondary p-4">
                  <p className="text-xs text-muted-foreground">Pacientes únicos</p>
                  <p className="text-xl font-bold text-primary">{totalPacientes}</p>
                </div>
                <div className="rounded-lg bg-secondary p-4">
                  <p className="text-xs text-muted-foreground">Pagamentos</p>
                  <p className="text-xl font-bold text-primary">{lista.length}</p>
                </div>
                <div className="rounded-lg bg-secondary p-4">
                  <p className="text-xs text-muted-foreground">Valor total</p>
                  <p className="text-xl font-bold text-accent-foreground">{formatCurrency(totalValor)}</p>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Paciente</TableHead>
                      <TableHead>Data do Pagamento</TableHead>
                      <TableHead>Valor Pago</TableHead>
                      <TableHead>Clínica</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lista.map((l) => (
                      <TableRow key={l.id} className="cursor-pointer hover:bg-muted/50" onClick={() => l.paciente_id && navigate(`/pacientes/${l.paciente_id}`)}>
                        <TableCell className="font-medium text-primary underline-offset-2 hover:underline">{l.paciente}</TableCell>
                        <TableCell>{l.data ? new Date(l.data + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</TableCell>
                        <TableCell className="text-green-400">{formatCurrency(l.valor)}</TableCell>
                        <TableCell className="text-muted-foreground">{l.clinica}</TableCell>
                      </TableRow>
                    ))}
                    {lista.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nenhum pagamento no período</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );
      }

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
