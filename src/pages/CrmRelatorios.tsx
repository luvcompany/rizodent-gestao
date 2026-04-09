import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, FunnelChart, Funnel, LabelList,
} from "recharts";
import { Clock, Timer, Users, TrendingUp, AlertTriangle, Zap, RefreshCw, Filter, Ghost, Calendar, UserCheck, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek, subWeeks, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useChartTheme } from "@/hooks/useChartTheme";

type Pipeline = { id: string; name: string; color: string | null };
type Stage = { id: string; name: string; color: string; position: number; pipeline_id: string };
type StageHistory = { lead_id: string; stage_id: string; entered_at: string; exited_at: string | null; from_stage_id?: string | null };
type Lead = {
  id: string; name: string; phone: string | null; stage_id: string; pipeline_id: string;
  created_at: string; score?: number; last_message_at?: string | null; assigned_to?: string | null;
  first_inbound_at?: string | null; source?: string | null; nome_anuncio?: string | null;
};
type Message = { id: string; lead_id: string; direction: string; created_at: string; status: string; sender_id?: string | null };
type Appointment = { id: string; lead_id: string; status: string; scheduled_date: string };

function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}min`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatDays(ms: number): string {
  const days = Math.round(ms / 86400000 * 10) / 10;
  if (days < 1) return formatDuration(ms);
  return `${days} dias`;
}

type PeriodFilter = "all" | "this_month" | "last_month" | "this_week" | "last_week" | "custom";

function getPeriodRange(period: PeriodFilter, customFrom?: string, customTo?: string): { start: Date; end: Date } | null {
  const now = new Date();
  switch (period) {
    case "this_month": return { start: startOfMonth(now), end: endOfMonth(now) };
    case "last_month": return { start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)) };
    case "this_week": return { start: startOfWeek(now, { locale: ptBR }), end: endOfWeek(now, { locale: ptBR }) };
    case "last_week": return { start: startOfWeek(subWeeks(now, 1), { locale: ptBR }), end: endOfWeek(subWeeks(now, 1), { locale: ptBR }) };
    case "custom":
      if (customFrom && customTo) return { start: new Date(customFrom), end: new Date(customTo + "T23:59:59") };
      if (customFrom) return { start: new Date(customFrom), end: now };
      return null;
    default: return null;
  }
}

export default function CrmRelatorios() {
  const navigate = useNavigate();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("all");
  const [period, setPeriod] = useState<PeriodFilter>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [stages, setStages] = useState<Stage[]>([]);
  const [history, setHistory] = useState<StageHistory[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [inactiveDays, setInactiveDays] = useState("3");
  const [inactiveUnit, setInactiveUnit] = useState<"days" | "weeks" | "months">("days");
  const chartTheme = useChartTheme();

  // Navigation helper for drill-down
  const drillDown = useCallback((params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    navigate(`/crm/conversas?${qs}`);
  }, [navigate]);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      const [pipelinesRes, stagesRes, historyRes, leadsRes, messagesRes, appointmentsRes] = await Promise.all([
        supabase.from("crm_pipelines").select("id, name, color").order("created_at"),
        supabase.from("crm_stages").select("id, name, color, position, pipeline_id").order("position"),
        supabase.from("crm_lead_stage_history").select("lead_id, stage_id, entered_at, exited_at, from_stage_id" as any),
        supabase.from("crm_leads").select("id, name, phone, stage_id, pipeline_id, created_at, score, last_message_at, assigned_to, first_inbound_at, source, nome_anuncio" as any),
        supabase.from("messages").select("id, lead_id, direction, created_at, status, sender_id"),
        supabase.from("crm_appointments").select("id, lead_id, status, scheduled_date"),
      ]);
      setPipelines((pipelinesRes.data as Pipeline[]) || []);
      setStages((stagesRes.data as Stage[]) || []);
      setHistory((historyRes.data as unknown as StageHistory[]) || []);
      setLeads((leadsRes.data as unknown as Lead[]) || []);
      setMessages((messagesRes.data as Message[]) || []);
      setAppointments((appointmentsRes.data as Appointment[]) || []);
      setLoading(false);
    };
    fetchAll();
  }, []);

  const periodRange = useMemo(() => getPeriodRange(period, customFrom, customTo), [period, customFrom, customTo]);

  // Filtered data by pipeline
  const filteredStages = useMemo(() => {
    if (selectedPipelineId === "all") return stages;
    return stages.filter(s => s.pipeline_id === selectedPipelineId);
  }, [stages, selectedPipelineId]);

  const filteredStageIds = useMemo(() => new Set(filteredStages.map(s => s.id)), [filteredStages]);

  const filteredLeads = useMemo(() => {
    let list = selectedPipelineId === "all" ? leads : leads.filter(l => l.pipeline_id === selectedPipelineId);
    if (periodRange) {
      list = list.filter(l => {
        const d = new Date(l.created_at);
        return isWithinInterval(d, { start: periodRange.start, end: periodRange.end });
      });
    }
    return list;
  }, [leads, selectedPipelineId, periodRange]);

  const allLeadsForPipeline = useMemo(() => {
    if (selectedPipelineId === "all") return leads;
    return leads.filter(l => l.pipeline_id === selectedPipelineId);
  }, [leads, selectedPipelineId]);

  const filteredLeadIds = useMemo(() => new Set(filteredLeads.map(l => l.id)), [filteredLeads]);

  const filteredHistory = useMemo(() => {
    let list = selectedPipelineId === "all" ? history : history.filter(h => filteredStageIds.has(h.stage_id));
    if (periodRange) {
      list = list.filter(h => {
        const d = new Date(h.entered_at);
        return isWithinInterval(d, { start: periodRange.start, end: periodRange.end });
      });
    }
    return list;
  }, [history, selectedPipelineId, filteredStageIds, periodRange]);

  const filteredMessages = useMemo(() => {
    const allPipelineLeadIds = new Set(allLeadsForPipeline.map(l => l.id));
    let list = selectedPipelineId === "all" ? messages : messages.filter(m => allPipelineLeadIds.has(m.lead_id));
    if (periodRange) {
      list = list.filter(m => {
        const d = new Date(m.created_at);
        return isWithinInterval(d, { start: periodRange.start, end: periodRange.end });
      });
    }
    return list;
  }, [messages, selectedPipelineId, allLeadsForPipeline, periodRange]);

  const filteredAppointments = useMemo(() => {
    const allPipelineLeadIds = new Set(allLeadsForPipeline.map(l => l.id));
    let list = selectedPipelineId === "all" ? appointments : appointments.filter(a => allPipelineLeadIds.has(a.lead_id));
    if (periodRange) {
      list = list.filter(a => {
        const d = new Date(a.scheduled_date);
        return isWithinInterval(d, { start: periodRange.start, end: periodRange.end });
      });
    }
    return list;
  }, [appointments, selectedPipelineId, allLeadsForPipeline, periodRange]);

  // Inactivity threshold in ms
  const inactiveThresholdMs = useMemo(() => {
    const val = parseInt(inactiveDays) || 3;
    switch (inactiveUnit) {
      case "weeks": return val * 7 * 86400000;
      case "months": return val * 30 * 86400000;
      default: return val * 86400000;
    }
  }, [inactiveDays, inactiveUnit]);

  const inactiveThresholdLabel = useMemo(() => {
    const val = inactiveDays;
    switch (inactiveUnit) {
      case "weeks": return `${val} sem.`;
      case "months": return `${val} mês(es)`;
      default: return `${val}d`;
    }
  }, [inactiveDays, inactiveUnit]);

  // ═══════════════════════════════════════
  // FUNNEL CONVERSION (cascade with absolute numbers + rates)
  // ═══════════════════════════════════════
  const funnelData = useMemo(() => {
    const totalEnteredLead = filteredLeads.length;
    // Leads that responded (have at least 1 inbound message)
    const respondedLeadIds = new Set(
      filteredMessages.filter(m => m.direction === "inbound" && m.status !== "system").map(m => m.lead_id)
    );
    const respondedCount = filteredLeads.filter(l => respondedLeadIds.has(l.id)).length;

    // Leads that scheduled (have appointment or reached stage with "agend" in name)
    const appointedLeadIds = new Set(filteredAppointments.map(a => a.lead_id));
    const agendStageIds = new Set(filteredStages.filter(s => s.name.toLowerCase().includes("agend")).map(s => s.id));
    const agendHistoryLeadIds = new Set(filteredHistory.filter(h => agendStageIds.has(h.stage_id)).map(h => h.lead_id));
    const scheduledLeadIds = new Set([...appointedLeadIds, ...agendHistoryLeadIds]);
    const scheduledCount = filteredLeads.filter(l => scheduledLeadIds.has(l.id)).length;

    // Leads that attended (appointment completed / contratou / nao_contratou)
    const attendedStatuses = ["completed", "contratou", "nao_contratou"];
    const attendedLeadIds = new Set(filteredAppointments.filter(a => attendedStatuses.includes(a.status)).map(a => a.lead_id));
    const attendedCount = attendedLeadIds.size;

    // Leads that contracted (reached stage with "contratad" in name, excluding "não")
    const contratadoStageIds = new Set(filteredStages.filter(s => s.name.toLowerCase().includes("contratad") && !s.name.toLowerCase().includes("não")).map(s => s.id));
    const contractedHistoryLeadIds = new Set(filteredHistory.filter(h => contratadoStageIds.has(h.stage_id)).map(h => h.lead_id));
    const contractedCurrentLeadIds = new Set(filteredLeads.filter(l => contratadoStageIds.has(l.stage_id)).map(l => l.id));
    const contractedLeadIds = new Set([...contractedHistoryLeadIds, ...contractedCurrentLeadIds]);
    const contractedCount = contractedLeadIds.size;

    const agendStageId = filteredStages.find(s => s.name.toLowerCase().includes("agend"))?.id || "";
    const contratadoStageId = filteredStages.find(s => s.name.toLowerCase().includes("contratad") && !s.name.toLowerCase().includes("não"))?.id || "";
    const pipelineParam = selectedPipelineId !== "all" ? selectedPipelineId : "";

    const steps = [
      { name: "Leads Entraram", value: totalEnteredLead, color: "hsl(var(--primary))", drillParams: { ...(pipelineParam ? { pipeline: pipelineParam } : {}) } },
      { name: "Responderam", value: respondedCount, color: "#3b82f6", drillParams: { ...(pipelineParam ? { pipeline: pipelineParam } : {}) } },
      { name: "Agendaram", value: scheduledCount, color: "#f59e0b", drillParams: { ...(agendStageId ? { stage_id: agendStageId } : {}), ...(pipelineParam ? { pipeline: pipelineParam } : {}) } },
      { name: "Compareceram", value: attendedCount, color: "#10b981", drillParams: { appointment_status: "attended", ...(pipelineParam ? { pipeline: pipelineParam } : {}) } },
      { name: "Contrataram", value: contractedCount, color: "#22c55e", drillParams: { ...(contratadoStageId ? { stage_id: contratadoStageId } : {}), ...(pipelineParam ? { pipeline: pipelineParam } : {}) } },
    ];

    return steps.map((step, i) => ({
      ...step,
      rate: i > 0 && steps[i - 1].value > 0 ? Math.round((step.value / steps[i - 1].value) * 100) : 100,
      totalRate: totalEnteredLead > 0 ? Math.round((step.value / totalEnteredLead) * 100) : 0,
    }));
  }, [filteredLeads, filteredMessages, filteredAppointments, filteredStages, filteredHistory]);

  // ═══════════════════════════════════════
  // GHOST LEADS (never responded)
  // ═══════════════════════════════════════
  const ghostLeadsData = useMemo(() => {
    const inboundLeadIds = new Set(
      filteredMessages.filter(m => m.direction === "inbound" && m.status !== "system").map(m => m.lead_id)
    );
    const ghosts = filteredLeads.filter(l => !inboundLeadIds.has(l.id));
    // Group by source
    const bySource = new Map<string, number>();
    ghosts.forEach(l => {
      const src = l.nome_anuncio || l.source || "Desconhecida";
      bySource.set(src, (bySource.get(src) || 0) + 1);
    });
    const sorted = Array.from(bySource.entries()).sort((a, b) => b[1] - a[1]);
    return { total: ghosts.length, bySource: sorted, totalLeads: filteredLeads.length };
  }, [filteredLeads, filteredMessages]);

  // ═══════════════════════════════════════
  // APPOINTMENT REPORT
  // ═══════════════════════════════════════
  const appointmentReport = useMemo(() => {
    const total = filteredAppointments.length;
    const attended = filteredAppointments.filter(a => ["completed", "contratou", "nao_contratou"].includes(a.status)).length;
    const rescheduled = filteredAppointments.filter(a => a.status === "rescheduled").length;
    const missed = filteredAppointments.filter(a => ["missed", "faltou"].includes(a.status)).length;
    const confirmed = filteredAppointments.filter(a => a.status === "confirmed").length;
    const presenceRate = total > 0 ? Math.round((attended / total) * 100) : 0;
    return { total, attended, rescheduled, missed, confirmed, presenceRate };
  }, [filteredAppointments]);

  // ═══════════════════════════════════════
  // TOTAL FUNNEL TIME (Lead → Contract)
  // ═══════════════════════════════════════
  const totalFunnelTime = useMemo(() => {
    const contratadoStageIds = new Set(filteredStages.filter(s => s.name.toLowerCase().includes("contratad") && !s.name.toLowerCase().includes("não")).map(s => s.id));
    const times: number[] = [];

    filteredHistory.filter(h => contratadoStageIds.has(h.stage_id)).forEach(h => {
      const lead = filteredLeads.find(l => l.id === h.lead_id);
      if (lead) {
        const duration = new Date(h.entered_at).getTime() - new Date(lead.created_at).getTime();
        if (duration > 0) times.push(duration);
      }
    });

    const avg = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
    return { avgMs: avg, count: times.length };
  }, [filteredStages, filteredHistory, filteredLeads]);

  // Average time per stage
  const stageTimeData = useMemo(() => {
    return filteredStages.map((stage) => {
      const entries = filteredHistory.filter((h) => h.stage_id === stage.id);
      const durations = entries.map((h) => {
        const end = h.exited_at ? new Date(h.exited_at).getTime() : Date.now();
        return end - new Date(h.entered_at).getTime();
      });
      const avg = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
      const leadsInStage = allLeadsForPipeline.filter((l) => l.stage_id === stage.id).length;
      return {
        name: stage.name, color: stage.color, avgMs: avg,
        avgFormatted: formatDuration(avg),
        avgHours: Math.round(avg / 3600000 * 10) / 10,
        count: leadsInStage, totalEntries: entries.length,
      };
    });
  }, [filteredStages, filteredHistory, allLeadsForPipeline]);

  // Response times
  const responseTimeData = useMemo(() => {
    const msgByLead = new Map<string, Message[]>();
    filteredMessages.forEach((m) => {
      if (m.status === "system") return;
      const arr = msgByLead.get(m.lead_id) || [];
      arr.push(m);
      msgByLead.set(m.lead_id, arr);
    });
    const allLeadDeltas: number[] = [];
    const allUserDeltas: number[] = [];
    msgByLead.forEach((msgs) => {
      const sorted = msgs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        const delta = new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
        if (prev.direction === "outbound" && curr.direction === "inbound") allLeadDeltas.push(delta);
        if (prev.direction === "inbound" && curr.direction === "outbound") allUserDeltas.push(delta);
      }
    });
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    return { avgLeadResponse: avg(allLeadDeltas), avgUserResponse: avg(allUserDeltas), totalConversations: msgByLead.size };
  }, [filteredMessages]);

  // Inactive leads
  const inactiveLeads = useMemo(() => {
    const now = Date.now();
    return allLeadsForPipeline.filter((lead) => {
      const allMsgs = messages.filter(m => m.lead_id === lead.id && m.status !== "system");
      if (allMsgs.length === 0) return now - new Date(lead.created_at).getTime() > inactiveThresholdMs;
      const lastMsgTime = Math.max(...allMsgs.map(m => new Date(m.created_at).getTime()));
      return now - lastMsgTime > inactiveThresholdMs;
    }).map((lead) => {
      const allMsgs = messages.filter(m => m.lead_id === lead.id && m.status !== "system");
      const lastMsgTime = allMsgs.length > 0 ? Math.max(...allMsgs.map(m => new Date(m.created_at).getTime())) : new Date(lead.created_at).getTime();
      const stageName = stages.find((s) => s.id === lead.stage_id)?.name || "?";
      const pipelineName = pipelines.find(p => p.id === lead.pipeline_id)?.name || "?";
      return {
        ...lead, lastMessageAt: new Date(lastMsgTime).toISOString(),
        inactiveSince: now - lastMsgTime, stageName, pipelineName,
      };
    }).sort((a, b) => b.inactiveSince - a.inactiveSince);
  }, [allLeadsForPipeline, messages, stages, pipelines, inactiveThresholdMs]);

  // Distribution by stage (pie chart)
  const stageDistribution = useMemo(() => {
    return filteredStages.map(stage => ({
      name: stage.name,
      value: allLeadsForPipeline.filter(l => l.stage_id === stage.id).length,
      color: stage.color,
    })).filter(s => s.value > 0);
  }, [filteredStages, allLeadsForPipeline]);

  // Pipeline summary
  const pipelineSummary = useMemo(() => {
    if (selectedPipelineId !== "all") return [];
    return pipelines.map(p => {
      const pLeads = leads.filter(l => l.pipeline_id === p.id);
      const pStages = stages.filter(s => s.pipeline_id === p.id);
      return {
        id: p.id, name: p.name, color: p.color || "hsl(var(--primary))",
        totalLeads: pLeads.length, totalStages: pStages.length,
      };
    });
  }, [selectedPipelineId, pipelines, leads, stages]);

  // Period label
  const periodLabel = useMemo(() => {
    switch (period) {
      case "this_month": return format(new Date(), "MMMM yyyy", { locale: ptBR });
      case "last_month": return format(subMonths(new Date(), 1), "MMMM yyyy", { locale: ptBR });
      case "this_week": return "Esta semana";
      case "last_week": return "Semana passada";
      case "custom": return customFrom && customTo ? `${customFrom} a ${customTo}` : "Período personalizado";
      default: return "Todo o período";
    }
  }, [period, customFrom, customTo]);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando relatórios...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header with filters */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Relatórios CRM</h1>
          <p className="text-sm text-muted-foreground">Operação completa — {periodLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodFilter)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo período</SelectItem>
              <SelectItem value="this_month">Este mês</SelectItem>
              <SelectItem value="last_month">Mês passado</SelectItem>
              <SelectItem value="this_week">Esta semana</SelectItem>
              <SelectItem value="last_week">Semana passada</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
          {period === "custom" && (
            <>
              <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="w-36" />
              <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="w-36" />
            </>
          )}
          <Filter size={16} className="text-muted-foreground" />
          <Select value={selectedPipelineId} onValueChange={setSelectedPipelineId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filtrar por funil" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Funis</SelectItem>
              {pipelines.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color || "hsl(var(--primary))" }} />
                    {p.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Pipeline Overview */}
      {selectedPipelineId === "all" && pipelineSummary.length > 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pipelineSummary.map(p => (
            <Card key={p.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelectedPipelineId(p.id)}>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                  <h3 className="font-semibold text-foreground">{p.name}</h3>
                </div>
                <p className="text-2xl font-bold text-foreground">{p.totalLeads} <span className="text-sm font-normal text-muted-foreground">leads</span></p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ═══════════════════════════════════════
          FUNNEL DE CONVERSÃO (cascata)
          ═══════════════════════════════════════ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp size={16} /> Funil de Conversão
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {funnelData.map((step, i) => (
              <div key={step.name} className="flex items-center gap-1">
                <div className="flex flex-col items-center min-w-[110px]">
                  <p className="text-2xl font-bold text-foreground">{step.value}</p>
                  <p className="text-xs text-muted-foreground text-center whitespace-nowrap">{step.name}</p>
                  {i > 0 && (
                    <Badge variant={step.rate >= 70 ? "default" : step.rate >= 40 ? "secondary" : "destructive"} className="mt-1 text-[10px]">
                      {step.rate}%
                    </Badge>
                  )}
                </div>
                {i < funnelData.length - 1 && (
                  <ArrowRight size={16} className="text-muted-foreground flex-shrink-0" />
                )}
              </div>
            ))}
          </div>
          {/* Visual bar representation */}
          <div className="mt-4 space-y-2">
            {funnelData.map((step) => (
              <div key={step.name} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-28 text-right truncate">{step.name}</span>
                <div className="flex-1 bg-muted rounded-full h-6 overflow-hidden">
                  <div
                    className="h-full rounded-full flex items-center px-2 transition-all"
                    style={{
                      width: `${step.totalRate}%`,
                      backgroundColor: step.color,
                      minWidth: step.value > 0 ? "2rem" : "0",
                    }}
                  >
                    <span className="text-xs font-medium text-white whitespace-nowrap">{step.value}</span>
                  </div>
                </div>
                <span className="text-xs font-medium text-foreground w-12">{step.totalRate}%</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <Users size={18} className="text-primary mb-1" />
            <p className="text-2xl font-bold text-foreground">{filteredLeads.length}</p>
            <p className="text-xs text-muted-foreground">Leads no Período</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <Timer size={18} className="text-blue-500 mb-1" />
            <p className="text-2xl font-bold text-foreground">{formatDuration(responseTimeData.avgUserResponse)}</p>
            <p className="text-xs text-muted-foreground">Resp. Atendente</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <Timer size={18} className="text-green-500 mb-1" />
            <p className="text-2xl font-bold text-foreground">{formatDuration(responseTimeData.avgLeadResponse)}</p>
            <p className="text-xs text-muted-foreground">Resp. Lead</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <Ghost size={18} className="text-red-500 mb-1" />
            <p className="text-2xl font-bold text-foreground">{ghostLeadsData.total}</p>
            <p className="text-xs text-muted-foreground">Leads Fantasma</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <Clock size={18} className="text-orange-500 mb-1" />
            <p className="text-2xl font-bold text-foreground">{formatDays(totalFunnelTime.avgMs)}</p>
            <p className="text-xs text-muted-foreground">Lead → Contrato</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <AlertTriangle size={18} className="text-yellow-500 mb-1" />
            <p className="text-2xl font-bold text-foreground">{inactiveLeads.length}</p>
            <p className="text-xs text-muted-foreground">Inativos ({inactiveThresholdLabel}+)</p>
          </CardContent>
        </Card>
      </div>

      {/* ═══════════════════════════════════════
          AGENDAMENTOS DO PERÍODO
          ═══════════════════════════════════════ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar size={16} /> Agendamentos do Período
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold text-foreground">{appointmentReport.total}</p>
              <p className="text-xs text-muted-foreground">Total Agendados</p>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold text-green-600">{appointmentReport.attended}</p>
              <p className="text-xs text-muted-foreground">Compareceram</p>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold text-orange-500">{appointmentReport.rescheduled}</p>
              <p className="text-xs text-muted-foreground">Remarcaram</p>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold text-red-500">{appointmentReport.missed}</p>
              <p className="text-xs text-muted-foreground">Faltaram</p>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold text-foreground">{appointmentReport.presenceRate}%</p>
              <p className="text-xs text-muted-foreground">Taxa de Presença</p>
            </div>
          </div>
          {appointmentReport.confirmed > 0 && (
            <p className="text-xs text-muted-foreground mt-3">{appointmentReport.confirmed} agendamento(s) ainda confirmado(s) — aguardando resultado.</p>
          )}
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════
          LEADS FANTASMA
          ═══════════════════════════════════════ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Ghost size={16} className="text-red-500" /> Leads Fantasma (nunca responderam)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-4">
            <div>
              <p className="text-3xl font-bold text-foreground">{ghostLeadsData.total}</p>
              <p className="text-xs text-muted-foreground">de {ghostLeadsData.totalLeads} leads</p>
            </div>
            {ghostLeadsData.totalLeads > 0 && (
              <Badge variant={ghostLeadsData.total / ghostLeadsData.totalLeads > 0.4 ? "destructive" : "secondary"} className="text-sm">
                {Math.round((ghostLeadsData.total / ghostLeadsData.totalLeads) * 100)}% fantasma
              </Badge>
            )}
          </div>
          {ghostLeadsData.bySource.length > 0 && (
            <div>
              <p className="text-sm font-medium text-foreground mb-2">Por Origem / Anúncio:</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Origem</TableHead>
                    <TableHead className="text-right">Leads Fantasma</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ghostLeadsData.bySource.slice(0, 15).map(([source, count]) => (
                    <TableRow key={source}>
                      <TableCell className="text-foreground">{source}</TableCell>
                      <TableCell className="text-right font-medium text-destructive">{count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Average Time per Stage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock size={16} /> Tempo Médio por Etapa
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={stageTimeData} layout="vertical">
                <XAxis type="number" tickFormatter={(v) => `${v}h`} tick={{ fill: chartTheme.axisColor, fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fill: chartTheme.axisColor, fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number) => [formatDuration(value * 3600000), "Tempo Médio"]}
                  labelFormatter={(label) => `Etapa: ${label}`}
                  contentStyle={chartTheme.tooltipStyle}
                  labelStyle={chartTheme.tooltipLabelStyle}
                  itemStyle={chartTheme.tooltipItemStyle}
                />
                <Bar dataKey="avgHours" radius={[0, 4, 4, 0]}>
                  {stageTimeData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 space-y-1">
              {stageTimeData.map((s) => (
                <div key={s.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-foreground">{s.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">{s.count} leads</span>
                    <span className="font-medium text-foreground">{s.avgFormatted}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Stage Distribution Pie */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users size={16} /> Distribuição por Etapa
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stageDistribution.length > 0 ? (
              <div className="flex flex-col lg:flex-row items-center gap-6">
                <ResponsiveContainer width="100%" height={260} className="max-w-[300px]">
                  <PieChart>
                    <Pie data={stageDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                      {stageDistribution.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={chartTheme.tooltipStyle} labelStyle={chartTheme.tooltipLabelStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2 w-full">
                  {stageDistribution.map(s => (
                    <div key={s.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                        <span className="text-foreground">{s.name}</span>
                      </div>
                      <span className="font-semibold text-foreground">{s.value} leads</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">Sem dados</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Lead Score Section */}
      <LeadScoreSection leads={filteredLeads} stages={filteredStages} />

      {/* Attendant Metrics Section */}
      <AttendantMetricsSection messages={filteredMessages} leads={filteredLeads} allLeads={allLeadsForPipeline} appointments={filteredAppointments} stages={filteredStages} history={filteredHistory} />

      {/* Inactive Leads */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle size={16} className="text-yellow-500" /> Leads sem Interação
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Mais de</span>
              <Select value={inactiveDays} onValueChange={setInactiveDays}>
                <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["1","2","3","5","7","14","30"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={inactiveUnit} onValueChange={(v) => setInactiveUnit(v as any)}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="days">Dias</SelectItem>
                  <SelectItem value="weeks">Semanas</SelectItem>
                  <SelectItem value="months">Meses</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {inactiveLeads.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum lead inativo no período selecionado 🎉</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-3">{inactiveLeads.length} leads sem interação</p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lead</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead>Funil</TableHead>
                      <TableHead>Etapa</TableHead>
                      <TableHead>Última Atividade</TableHead>
                      <TableHead>Tempo Inativo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inactiveLeads.slice(0, 100).map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell className="font-medium text-foreground">{lead.name}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{lead.phone || "—"}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{lead.pipelineName}</Badge></TableCell>
                        <TableCell><Badge variant="secondary" className="text-[10px]">{lead.stageName}</Badge></TableCell>
                        <TableCell className="text-muted-foreground text-sm">{format(new Date(lead.lastMessageAt), "dd/MM/yy HH:mm")}</TableCell>
                        <TableCell className="text-destructive font-medium text-sm">{formatDuration(lead.inactiveSince)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {inactiveLeads.length > 100 && (
                <p className="text-xs text-muted-foreground mt-2 text-center">Mostrando 100 de {inactiveLeads.length}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Lead Score Section
   ═══════════════════════════════════════════════════ */
function LeadScoreSection({ leads, stages }: { leads: Lead[]; stages: Stage[] }) {
  const [scoreLeads, setScoreLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("crm_leads").select("id, name, phone, score, stage_id, last_message_at").order("score", { ascending: false }).limit(50);
    setScoreLeads(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const recalcAll = async () => {
    setLoading(true);
    await supabase.rpc("recalculate_all_lead_scores");
    await load();
    setLoading(false);
    toast.success("Scores recalculados");
  };

  const avgScore = scoreLeads.length > 0 ? Math.round(scoreLeads.reduce((a, b) => a + (b.score || 0), 0) / scoreLeads.length) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap size={16} /> Score de Leads
          </CardTitle>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-2xl font-bold text-foreground">{avgScore}</p>
              <p className="text-xs text-muted-foreground">Score Médio</p>
            </div>
            <Button size="sm" onClick={recalcAll} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Recalcular</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">+10 por resposta recebida, +15 por mudança de etapa, +5 por tarefa concluída, -1 por dia inativo.</p>
        <Table>
          <TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Telefone</TableHead><TableHead>Etapa</TableHead><TableHead>Score</TableHead><TableHead>Última Msg</TableHead></TableRow></TableHeader>
          <TableBody>
            {scoreLeads.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">{l.name}</TableCell>
                <TableCell className="text-muted-foreground">{l.phone || "—"}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{stages.find(s => s.id === l.stage_id)?.name || "—"}</TableCell>
                <TableCell><Badge variant={l.score > 50 ? "default" : l.score > 20 ? "secondary" : "outline"}>{l.score}</Badge></TableCell>
                <TableCell className="text-muted-foreground text-sm">{l.last_message_at ? format(new Date(l.last_message_at), "dd/MM HH:mm") : "—"}</TableCell>
              </TableRow>
            ))}
            {scoreLeads.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Nenhum lead</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════
   Métricas por Atendente Section (EXPANDED)
   ═══════════════════════════════════════════════════ */
function AttendantMetricsSection({ messages, leads, allLeads, appointments, stages, history }: {
  messages: Message[]; leads: Lead[]; allLeads: Lead[];
  appointments: Appointment[]; stages: Stage[]; history: StageHistory[];
}) {
  const [metrics, setMetrics] = useState<any[]>([]);

  useEffect(() => {
    const run = async () => {
      const { data: profiles } = await supabase.from("profiles").select("id, nome");
      if (!profiles) return;

      const profileMap = new Map(profiles.map(p => [p.id, p.nome]));
      const grouped = new Map<string, { msgs: number; leads: Set<string> }>();

      for (const m of messages) {
        if (m.direction !== "outbound" || !m.sender_id || m.status === "system") continue;
        if (!grouped.has(m.sender_id)) grouped.set(m.sender_id, { msgs: 0, leads: new Set() });
        const g = grouped.get(m.sender_id)!;
        g.msgs++;
        g.leads.add(m.lead_id);
      }

      const assignedCounts = new Map<string, number>();
      for (const l of allLeads) {
        if (l.assigned_to) assignedCounts.set(l.assigned_to, (assignedCounts.get(l.assigned_to) || 0) + 1);
      }

      const appointmentCounts = new Map<string, number>();
      const leadAssignMap = new Map(allLeads.map(l => [l.id, l.assigned_to]));
      for (const apt of appointments) {
        const assignedTo = leadAssignMap.get(apt.lead_id);
        if (assignedTo) appointmentCounts.set(assignedTo, (appointmentCounts.get(assignedTo) || 0) + 1);
      }

      // First response time per attendant
      const firstResponseTimes = new Map<string, number[]>();
      const leadCreatedMap = new Map(allLeads.map(l => [l.id, new Date(l.created_at).getTime()]));
      // Group messages by lead
      const msgByLead = new Map<string, Message[]>();
      for (const m of messages) {
        if (m.status === "system") continue;
        const arr = msgByLead.get(m.lead_id) || [];
        arr.push(m);
        msgByLead.set(m.lead_id, arr);
      }
      msgByLead.forEach((msgs, lid) => {
        const sorted = msgs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        const firstOutbound = sorted.find(m => m.direction === "outbound" && m.sender_id);
        if (firstOutbound && firstOutbound.sender_id) {
          const leadCreated = leadCreatedMap.get(lid);
          if (leadCreated) {
            const delta = new Date(firstOutbound.created_at).getTime() - leadCreated;
            if (delta > 0) {
              const arr = firstResponseTimes.get(firstOutbound.sender_id) || [];
              arr.push(delta);
              firstResponseTimes.set(firstOutbound.sender_id, arr);
            }
          }
        }
      });

      // Conversion rate per attendant
      const contratadoStageIds = new Set(stages.filter(s => s.name.toLowerCase().includes("contratad") && !s.name.toLowerCase().includes("não")).map(s => s.id));
      const convertedByUser = new Map<string, number>();
      // Leads that reached contracted stage
      const contractedLeadIds = new Set(history.filter(h => contratadoStageIds.has(h.stage_id)).map(h => h.lead_id));
      // Also include leads currently in contracted stage
      allLeads.filter(l => contratadoStageIds.has(l.stage_id)).forEach(l => contractedLeadIds.add(l.id));
      for (const lid of contractedLeadIds) {
        const lead = allLeads.find(l => l.id === lid);
        if (lead?.assigned_to) {
          convertedByUser.set(lead.assigned_to, (convertedByUser.get(lead.assigned_to) || 0) + 1);
        }
      }

      const allUsers = new Set<string>();
      grouped.forEach((_, uid) => allUsers.add(uid));
      assignedCounts.forEach((_, uid) => allUsers.add(uid));

      const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

      const result = Array.from(allUsers).map((uid) => {
        const assigned = assignedCounts.get(uid) || 0;
        const converted = convertedByUser.get(uid) || 0;
        const convRate = assigned > 0 ? Math.round((converted / assigned) * 100) : 0;
        const frtArr = firstResponseTimes.get(uid) || [];
        return {
          name: profileMap.get(uid) || uid.slice(0, 8),
          totalMsgs: grouped.get(uid)?.msgs || 0,
          leadsAtendidos: grouped.get(uid)?.leads.size || 0,
          assignedLeads: assigned,
          agendados: appointmentCounts.get(uid) || 0,
          converted,
          convRate,
          avgFirstResponse: avg(frtArr),
        };
      }).sort((a, b) => b.totalMsgs - a.totalMsgs);

      setMetrics(result);
    };
    run();
  }, [messages, leads, allLeads, appointments, stages, history]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCheck size={16} /> Performance por Atendente
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Atendente</TableHead>
                <TableHead>Msgs Enviadas</TableHead>
                <TableHead>Leads Atendidos</TableHead>
                <TableHead>Leads Atribuídos</TableHead>
                <TableHead>Agendados</TableHead>
                <TableHead>Contratados</TableHead>
                <TableHead>Taxa Conversão</TableHead>
                <TableHead>1ª Resposta (média)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.map((m, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>{m.totalMsgs}</TableCell>
                  <TableCell>{m.leadsAtendidos}</TableCell>
                  <TableCell>{m.assignedLeads}</TableCell>
                  <TableCell>{m.agendados}</TableCell>
                  <TableCell className="font-semibold text-green-600">{m.converted}</TableCell>
                  <TableCell>
                    <Badge variant={m.convRate >= 30 ? "default" : m.convRate >= 15 ? "secondary" : "outline"}>
                      {m.convRate}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.avgFirstResponse > 0 ? formatDuration(m.avgFirstResponse) : "—"}</TableCell>
                </TableRow>
              ))}
              {metrics.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Nenhuma métrica disponível</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
