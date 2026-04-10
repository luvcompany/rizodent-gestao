import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { Clock, Timer, Users, TrendingUp, AlertTriangle, Zap, RefreshCw, Filter, Ghost, Calendar, UserCheck, ArrowRight, Bot, Send, MapPin, ChevronLeft, ChevronRight } from "lucide-react";
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
  paciente_id?: string | null; link_anuncio?: string | null; imagem_origem?: string | null;
  descricao_anuncio?: string | null; ad_account_id?: string | null; ad_account_name?: string | null;
  ad_id?: string | null;
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
        supabase.from("crm_leads").select("id, name, phone, stage_id, pipeline_id, created_at, score, last_message_at, assigned_to, first_inbound_at, source, nome_anuncio, paciente_id, link_anuncio, imagem_origem, descricao_anuncio, ad_account_id, ad_account_name, ad_id" as any),
        supabase.from("messages").select("id, lead_id, direction, created_at, status, sender_id, ad_source_id, ad_image_url, ad_headline, ad_body, ad_source_url, ad_account_id, ad_account_name"),
        supabase.from("crm_appointments").select("id, lead_id, status, scheduled_date"),
      ]);
      setPipelines((pipelinesRes.data as Pipeline[]) || []);
      setStages((stagesRes.data as Stage[]) || []);
      setHistory((historyRes.data as unknown as StageHistory[]) || []);

      // Enrich leads missing ad data from their messages
      const rawLeads = (leadsRes.data as unknown as Lead[]) || [];
      const rawMessages = (messagesRes.data as any[]) || [];
      const adMsgByLead = new Map<string, any>();
      for (const m of rawMessages) {
        if (m.ad_source_id && !adMsgByLead.has(m.lead_id)) {
          adMsgByLead.set(m.lead_id, m);
        }
      }
      const enrichedLeads = rawLeads.map(l => {
        if (!l.imagem_origem && !l.descricao_anuncio) {
          const adMsg = adMsgByLead.get(l.id);
          if (adMsg) {
            return {
              ...l,
              imagem_origem: adMsg.ad_image_url || l.imagem_origem,
              nome_anuncio: adMsg.ad_headline || l.nome_anuncio,
              descricao_anuncio: adMsg.ad_body || l.descricao_anuncio,
              link_anuncio: adMsg.ad_source_url || l.link_anuncio,
              ad_account_id: adMsg.ad_account_id || l.ad_account_id,
              ad_account_name: adMsg.ad_account_name || l.ad_account_name,
            };
          }
        }
        return l;
      });

      setLeads(enrichedLeads);
      setMessages(rawMessages as Message[]);
      setAppointments((appointmentsRes.data as Appointment[]) || []);
      setLoading(false);
    };
    fetchAll();
  }, []);

  const periodRange = useMemo(() => getPeriodRange(period, customFrom, customTo), [period, customFrom, customTo]);

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

  // ═══ FUNNEL ═══
  const funnelData = useMemo(() => {
    const totalEnteredLead = filteredLeads.length;
    const respondedLeadIds = new Set(
      filteredMessages.filter(m => m.direction === "inbound" && m.status !== "system").map(m => m.lead_id)
    );
    const respondedCount = filteredLeads.filter(l => respondedLeadIds.has(l.id)).length;

    const appointedLeadIds = new Set(filteredAppointments.map(a => a.lead_id));
    const agendStageIds = new Set(filteredStages.filter(s => s.name.toLowerCase().includes("agend")).map(s => s.id));
    const agendHistoryLeadIds = new Set(filteredHistory.filter(h => agendStageIds.has(h.stage_id)).map(h => h.lead_id));
    const scheduledLeadIds = new Set([...appointedLeadIds, ...agendHistoryLeadIds]);
    const scheduledCount = filteredLeads.filter(l => scheduledLeadIds.has(l.id)).length;

    const attendedStatuses = ["completed", "contratou", "nao_contratou"];
    const attendedLeadIds = new Set(filteredAppointments.filter(a => attendedStatuses.includes(a.status)).map(a => a.lead_id));
    const attendedCount = attendedLeadIds.size;

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
  }, [filteredLeads, filteredMessages, filteredAppointments, filteredStages, filteredHistory, selectedPipelineId]);

  // ═══ GHOST LEADS ═══
  const ghostLeadsData = useMemo(() => {
    const inboundLeadIds = new Set(
      filteredMessages.filter(m => m.direction === "inbound" && m.status !== "system").map(m => m.lead_id)
    );
    const ghosts = filteredLeads.filter(l => !inboundLeadIds.has(l.id));
    const bySource = new Map<string, number>();
    ghosts.forEach(l => {
      const raw = l.nome_anuncio || l.source || "Desconhecida";
      const src = ["facebook_ad", "instagram_ad"].includes(raw.toLowerCase()) ? "Anúncio" : raw;
      bySource.set(src, (bySource.get(src) || 0) + 1);
    });
    const sorted = Array.from(bySource.entries()).sort((a, b) => b[1] - a[1]);
    return { total: ghosts.length, bySource: sorted, totalLeads: filteredLeads.length };
  }, [filteredLeads, filteredMessages]);

  // ═══ APPOINTMENTS ═══
  const appointmentReport = useMemo(() => {
    const total = filteredAppointments.length;
    const attended = filteredAppointments.filter(a => ["completed", "contratou", "nao_contratou"].includes(a.status)).length;
    const rescheduled = filteredAppointments.filter(a => a.status === "rescheduled").length;
    const missed = filteredAppointments.filter(a => ["missed", "faltou"].includes(a.status)).length;
    const confirmed = filteredAppointments.filter(a => a.status === "confirmed").length;
    const presenceRate = total > 0 ? Math.round((attended / total) * 100) : 0;
    return { total, attended, rescheduled, missed, confirmed, presenceRate };
  }, [filteredAppointments]);

  // ═══ TOTAL FUNNEL TIME ═══
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

  // ═══ STAGE TIME (with pipeline prefix fix) ═══
  const stageTimeData = useMemo(() => {
    return filteredStages.map((stage) => {
      const entries = filteredHistory.filter((h) => h.stage_id === stage.id);
      const durations = entries.map((h) => {
        const end = h.exited_at ? new Date(h.exited_at).getTime() : Date.now();
        return end - new Date(h.entered_at).getTime();
      });
      const avg = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
      const leadsInStage = allLeadsForPipeline.filter((l) => l.stage_id === stage.id).length;
      const pipeline = pipelines.find(p => p.id === stage.pipeline_id);
      const label = selectedPipelineId === "all" && pipeline
        ? `${pipeline.name} > ${stage.name}`
        : stage.name;
      return {
        name: label, stageId: stage.id, color: stage.color, avgMs: avg,
        avgFormatted: formatDuration(avg),
        avgHours: Math.round(avg / 3600000 * 10) / 10,
        count: leadsInStage, totalEntries: entries.length,
      };
    });
  }, [filteredStages, filteredHistory, allLeadsForPipeline, pipelines, selectedPipelineId]);

  // ═══ RESPONSE TIMES ═══
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

  // ═══ INACTIVE LEADS ═══
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
      return { ...lead, lastMessageAt: new Date(lastMsgTime).toISOString(), inactiveSince: now - lastMsgTime, stageName, pipelineName };
    }).sort((a, b) => b.inactiveSince - a.inactiveSince);
  }, [allLeadsForPipeline, messages, stages, pipelines, inactiveThresholdMs]);

  // ═══ STAGE DISTRIBUTION ═══
  const stageDistribution = useMemo(() => {
    return filteredStages.map(stage => {
      const pipeline = pipelines.find(p => p.id === stage.pipeline_id);
      const label = selectedPipelineId === "all" && pipeline
        ? `${pipeline.name} > ${stage.name}`
        : stage.name;
      return {
        name: label, stageId: stage.id,
        value: allLeadsForPipeline.filter(l => l.stage_id === stage.id).length,
        color: stage.color,
      };
    }).filter(s => s.value > 0);
  }, [filteredStages, allLeadsForPipeline, pipelines, selectedPipelineId]);

  // ═══ PIPELINE SUMMARY ═══
  const pipelineSummary = useMemo(() => {
    if (selectedPipelineId !== "all") return [];
    return pipelines.map(p => {
      const pLeads = leads.filter(l => l.pipeline_id === p.id);
      const pStages = stages.filter(s => s.pipeline_id === p.id);
      return { id: p.id, name: p.name, color: p.color || "hsl(var(--primary))", totalLeads: pLeads.length, totalStages: pStages.length };
    });
  }, [selectedPipelineId, pipelines, leads, stages]);

  // ═══ CROSS FUNNEL FLOW ═══
  const crossFunnelFlow = useMemo(() => {
    if (pipelines.length < 2) return null;
    const flows: { from: Pipeline; to: Pipeline; count: number; leadIds: string[] }[] = [];
    const stageToPlMap = new Map(stages.map(s => [s.id, s.pipeline_id]));
    for (const fromPl of pipelines) {
      for (const toPl of pipelines) {
        if (fromPl.id === toPl.id) continue;
        const movedLeadIds = new Set<string>();
        history.forEach(h => {
          if (!h.from_stage_id) return;
          const fromPlId = stageToPlMap.get(h.from_stage_id);
          const toPlId = stageToPlMap.get(h.stage_id);
          if (fromPlId === fromPl.id && toPlId === toPl.id) movedLeadIds.add(h.lead_id);
        });
        if (movedLeadIds.size > 0) flows.push({ from: fromPl, to: toPl, count: movedLeadIds.size, leadIds: Array.from(movedLeadIds) });
      }
    }
    return flows.length > 0 ? flows : null;
  }, [pipelines, stages, history]);

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
            <SelectTrigger className="w-40"><SelectValue placeholder="Período" /></SelectTrigger>
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
            <SelectTrigger className="w-48"><SelectValue placeholder="Filtrar por funil" /></SelectTrigger>
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

      {/* TABS */}
      <Tabs defaultValue="operacao" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="operacao" className="flex items-center gap-1.5"><TrendingUp size={14} /> Operação</TabsTrigger>
          <TabsTrigger value="bots" className="flex items-center gap-1.5"><Bot size={14} /> Bots</TabsTrigger>
          <TabsTrigger value="followups" className="flex items-center gap-1.5"><Send size={14} /> Follow-ups & Templates</TabsTrigger>
          <TabsTrigger value="origens" className="flex items-center gap-1.5"><MapPin size={14} /> Origens & Cidades</TabsTrigger>
        </TabsList>

        {/* ══════════════════════════════════════════
            ABA OPERAÇÃO
            ══════════════════════════════════════════ */}
        <TabsContent value="operacao" className="space-y-6 mt-4">
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

          {/* Funnel */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TrendingUp size={16} /> Funil de Conversão</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-1 overflow-x-auto pb-2">
                {funnelData.map((step, i) => (
                  <div key={step.name} className="flex items-center gap-1">
                    <div className="flex flex-col items-center min-w-[110px] cursor-pointer hover:bg-muted/50 rounded-lg p-2 transition-colors" onClick={() => step.value > 0 && drillDown(step.drillParams)}>
                      <p className="text-2xl font-bold text-foreground">{step.value}</p>
                      <p className="text-xs text-muted-foreground text-center whitespace-nowrap">{step.name}</p>
                      {i > 0 && (
                        <Badge variant={step.rate >= 70 ? "default" : step.rate >= 40 ? "secondary" : "destructive"} className="mt-1 text-[10px]">{step.rate}%</Badge>
                      )}
                    </div>
                    {i < funnelData.length - 1 && <ArrowRight size={16} className="text-muted-foreground flex-shrink-0" />}
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                {funnelData.map((step) => (
                  <div key={step.name} className="flex items-center gap-3 cursor-pointer hover:bg-muted/30 rounded p-1 transition-colors" onClick={() => step.value > 0 && drillDown(step.drillParams)}>
                    <span className="text-xs text-muted-foreground w-28 text-right truncate">{step.name}</span>
                    <div className="flex-1 bg-muted rounded-full h-6 overflow-hidden">
                      <div className="h-full rounded-full flex items-center px-2 transition-all" style={{ width: `${step.totalRate}%`, backgroundColor: step.color, minWidth: step.value > 0 ? "2rem" : "0" }}>
                        <span className="text-xs font-medium text-white whitespace-nowrap">{step.value}</span>
                      </div>
                    </div>
                    <span className="text-xs font-medium text-foreground w-12">{step.totalRate}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => drillDown(selectedPipelineId !== "all" ? { pipeline: selectedPipelineId } : {})}>
              <CardContent className="pt-5 pb-4"><Users size={18} className="text-primary mb-1" /><p className="text-2xl font-bold text-foreground">{filteredLeads.length}</p><p className="text-xs text-muted-foreground">Leads no Período</p></CardContent>
            </Card>
            <Card><CardContent className="pt-5 pb-4"><Timer size={18} className="text-blue-500 mb-1" /><p className="text-2xl font-bold text-foreground">{formatDuration(responseTimeData.avgUserResponse)}</p><p className="text-xs text-muted-foreground">Resp. Atendente</p></CardContent></Card>
            <Card><CardContent className="pt-5 pb-4"><Timer size={18} className="text-green-500 mb-1" /><p className="text-2xl font-bold text-foreground">{formatDuration(responseTimeData.avgLeadResponse)}</p><p className="text-xs text-muted-foreground">Resp. Lead</p></CardContent></Card>
            <Card className="cursor-pointer hover:border-destructive/50 transition-colors" onClick={() => drillDown({ ghost: "true", ...(selectedPipelineId !== "all" ? { pipeline: selectedPipelineId } : {}) })}>
              <CardContent className="pt-5 pb-4"><Ghost size={18} className="text-red-500 mb-1" /><p className="text-2xl font-bold text-foreground">{ghostLeadsData.total}</p><p className="text-xs text-muted-foreground">Leads Fantasma</p></CardContent>
            </Card>
            <Card><CardContent className="pt-5 pb-4"><Clock size={18} className="text-orange-500 mb-1" /><p className="text-2xl font-bold text-foreground">{formatDays(totalFunnelTime.avgMs)}</p><p className="text-xs text-muted-foreground">Lead → Contrato</p></CardContent></Card>
            <Card className="cursor-pointer hover:border-yellow-500/50 transition-colors" onClick={() => drillDown({ inactive_days: String(parseInt(inactiveDays) || 3), ...(selectedPipelineId !== "all" ? { pipeline: selectedPipelineId } : {}) })}>
              <CardContent className="pt-5 pb-4"><AlertTriangle size={18} className="text-yellow-500 mb-1" /><p className="text-2xl font-bold text-foreground">{inactiveLeads.length}</p><p className="text-xs text-muted-foreground">Inativos ({inactiveThresholdLabel}+)</p></CardContent>
            </Card>
          </div>

          {/* Appointments */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Calendar size={16} /> Agendamentos do Período</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="text-center p-3 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted transition-colors" onClick={() => drillDown({ appointment_status: "confirmed" })}><p className="text-2xl font-bold text-foreground">{appointmentReport.total}</p><p className="text-xs text-muted-foreground">Total Agendados</p></div>
                <div className="text-center p-3 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted transition-colors" onClick={() => drillDown({ appointment_status: "attended" })}><p className="text-2xl font-bold text-green-600">{appointmentReport.attended}</p><p className="text-xs text-muted-foreground">Compareceram</p></div>
                <div className="text-center p-3 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted transition-colors" onClick={() => drillDown({ appointment_status: "rescheduled" })}><p className="text-2xl font-bold text-orange-500">{appointmentReport.rescheduled}</p><p className="text-xs text-muted-foreground">Remarcaram</p></div>
                <div className="text-center p-3 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted transition-colors" onClick={() => drillDown({ appointment_status: "missed" })}><p className="text-2xl font-bold text-red-500">{appointmentReport.missed}</p><p className="text-xs text-muted-foreground">Faltaram</p></div>
                <div className="text-center p-3 bg-muted/50 rounded-lg"><p className="text-2xl font-bold text-foreground">{appointmentReport.presenceRate}%</p><p className="text-xs text-muted-foreground">Taxa de Presença</p></div>
              </div>
              {appointmentReport.confirmed > 0 && <p className="text-xs text-muted-foreground mt-3">{appointmentReport.confirmed} agendamento(s) ainda confirmado(s) — aguardando resultado.</p>}
            </CardContent>
          </Card>

          {/* Ghost Leads */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Ghost size={16} className="text-red-500" /> Leads Fantasma (nunca responderam)</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 mb-4">
                <div><p className="text-3xl font-bold text-foreground">{ghostLeadsData.total}</p><p className="text-xs text-muted-foreground">de {ghostLeadsData.totalLeads} leads</p></div>
                {ghostLeadsData.totalLeads > 0 && (
                  <Badge variant={ghostLeadsData.total / ghostLeadsData.totalLeads > 0.4 ? "destructive" : "secondary"} className="text-sm">{Math.round((ghostLeadsData.total / ghostLeadsData.totalLeads) * 100)}% fantasma</Badge>
                )}
              </div>
              {ghostLeadsData.bySource.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">Por Origem / Anúncio:</p>
                  <Table>
                    <TableHeader><TableRow><TableHead>Origem</TableHead><TableHead className="text-right">Leads Fantasma</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {ghostLeadsData.bySource.slice(0, 15).map(([source, count]) => (
                        <TableRow key={source}><TableCell className="text-foreground">{source}</TableCell><TableCell className="text-right font-medium text-destructive">{count}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Clock size={16} /> Tempo Médio por Etapa</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={stageTimeData} layout="vertical">
                    <XAxis type="number" tickFormatter={(v) => `${v}h`} tick={{ fill: chartTheme.axisColor, fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={selectedPipelineId === "all" ? 180 : 120} tick={{ fill: chartTheme.axisColor, fontSize: 11 }} />
                    <Tooltip contentStyle={chartTheme.tooltipStyle} labelStyle={chartTheme.tooltipLabelStyle} formatter={(v: number) => `${v}h`} />
                    <Bar dataKey="avgHours" radius={[0, 4, 4, 0]}>
                      {stageTimeData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 space-y-1">
                  {stageTimeData.map((s) => (
                    <div key={s.name} className="flex items-center justify-between text-xs cursor-pointer hover:bg-muted/50 rounded p-1 transition-colors" onClick={() => drillDown({ stage_id: s.stageId })}>
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

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users size={16} /> Distribuição por Etapa</CardTitle></CardHeader>
              <CardContent>
                {stageDistribution.length > 0 ? (
                  <div className="flex flex-col lg:flex-row items-center gap-6">
                    <ResponsiveContainer width="100%" height={260} className="max-w-[300px]">
                      <PieChart>
                        <Pie data={stageDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                          {stageDistribution.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                        </Pie>
                        <Tooltip contentStyle={chartTheme.tooltipStyle} labelStyle={chartTheme.tooltipLabelStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-2 w-full">
                      {stageDistribution.map(s => (
                        <div key={s.name} className="flex items-center justify-between text-sm cursor-pointer hover:bg-muted/50 rounded p-1 transition-colors" onClick={() => drillDown({ stage_id: s.stageId })}>
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

          {/* Attendant Metrics */}
          <AttendantMetricsSection messages={filteredMessages} leads={filteredLeads} allLeads={allLeadsForPipeline} appointments={filteredAppointments} stages={filteredStages} history={filteredHistory} onDrillDown={drillDown} />

          {/* Cross-Funnel Flow */}
          {crossFunnelFlow && crossFunnelFlow.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ArrowRight size={16} /> Fluxo entre Funis</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {crossFunnelFlow.map((flow, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg cursor-pointer hover:bg-muted/60 transition-colors" onClick={() => drillDown({ pipeline: flow.to.id })}>
                      <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: flow.from.color || "hsl(var(--primary))" }} /><span className="text-sm font-medium text-foreground">{flow.from.name}</span></div>
                      <ArrowRight size={16} className="text-muted-foreground" />
                      <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: flow.to.color || "hsl(var(--primary))" }} /><span className="text-sm font-medium text-foreground">{flow.to.name}</span></div>
                      <Badge variant="secondary" className="ml-auto">{flow.count} leads</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Inactive Leads */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle size={16} className="text-yellow-500" /> Leads sem Interação</CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Mais de</span>
                  <Select value={inactiveDays} onValueChange={setInactiveDays}><SelectTrigger className="w-20"><SelectValue /></SelectTrigger><SelectContent>{["1","2","3","5","7","14","30"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select>
                  <Select value={inactiveUnit} onValueChange={(v) => setInactiveUnit(v as any)}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="days">Dias</SelectItem><SelectItem value="weeks">Semanas</SelectItem><SelectItem value="months">Meses</SelectItem></SelectContent></Select>
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
                      <TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Telefone</TableHead><TableHead>Funil</TableHead><TableHead>Etapa</TableHead><TableHead>Última Atividade</TableHead><TableHead>Tempo Inativo</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {inactiveLeads.slice(0, 100).map((lead) => (
                          <TableRow key={lead.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/crm/conversas?lead_id=${lead.id}`)}>
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
                  {inactiveLeads.length > 100 && <p className="text-xs text-muted-foreground mt-2 text-center">Mostrando 100 de {inactiveLeads.length}</p>}
                </>
              )}
            </CardContent>
          </Card>

          {/* Score de Leads (moved to end, with pagination) */}
          <LeadScoreSection leads={filteredLeads} stages={filteredStages} pipelines={pipelines} navigate={navigate} />
        </TabsContent>

        {/* ══════════════════════════════════════════
            ABA BOTS
            ══════════════════════════════════════════ */}
        <TabsContent value="bots" className="space-y-6 mt-4">
          <BotsReportTab periodRange={periodRange} navigate={navigate} />
        </TabsContent>

        {/* ══════════════════════════════════════════
            ABA FOLLOW-UPS & TEMPLATES
            ══════════════════════════════════════════ */}
        <TabsContent value="followups" className="space-y-6 mt-4">
          <FollowupsReportTab periodRange={periodRange} drillDown={drillDown} />
        </TabsContent>

        {/* ══════════════════════════════════════════
            ABA ORIGENS & CIDADES
            ══════════════════════════════════════════ */}
        <TabsContent value="origens" className="space-y-6 mt-4">
          <OrigensReportTab leads={filteredLeads} stages={filteredStages} history={filteredHistory} appointments={filteredAppointments} messages={filteredMessages} pipelines={pipelines} drillDown={drillDown} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Lead Score Section (with pagination + clickable)
   ═══════════════════════════════════════════════════ */
function LeadScoreSection({ leads, stages, pipelines, navigate }: { leads: Lead[]; stages: Stage[]; pipelines: Pipeline[]; navigate: any }) {
  const [scoreLeads, setScoreLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async () => {
    const { data } = await supabase.from("crm_leads").select("id, name, phone, score, stage_id, pipeline_id, last_message_at" as any).order("score", { ascending: false });
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

  const avgScore = scoreLeads.length > 0 ? Math.round(scoreLeads.reduce((a: number, b: any) => a + (b.score || 0), 0) / scoreLeads.length) : 0;
  const totalPages = Math.ceil(scoreLeads.length / pageSize);
  const paginatedLeads = scoreLeads.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => { setPage(1); }, [pageSize]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2 text-base"><Zap size={16} /> Score de Leads</CardTitle>
          <div className="flex items-center gap-3">
            <div className="text-right"><p className="text-2xl font-bold text-foreground">{avgScore}</p><p className="text-xs text-muted-foreground">Score Médio</p></div>
            <Button size="sm" onClick={recalcAll} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Recalcular</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">+10 por resposta recebida, +15 por mudança de etapa, +5 por tarefa concluída, -1 por dia inativo.</p>
        <Table>
          <TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Telefone</TableHead><TableHead>Funil</TableHead><TableHead>Etapa</TableHead><TableHead>Score</TableHead><TableHead>Última Msg</TableHead></TableRow></TableHeader>
          <TableBody>
            {paginatedLeads.map((l: any) => {
              const pipelineName = pipelines.find(p => p.id === l.pipeline_id)?.name;
              return (
                <TableRow key={l.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/crm/conversas?lead_id=${l.id}`)}>
                  <TableCell className="font-medium text-foreground">{l.name}</TableCell>
                  <TableCell className="text-muted-foreground">{l.phone || "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{pipelineName || "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{stages.find(s => s.id === l.stage_id)?.name || "—"}</TableCell>
                  <TableCell><Badge variant={l.score > 50 ? "default" : l.score > 20 ? "secondary" : "outline"}>{l.score}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-sm">{l.last_message_at ? format(new Date(l.last_message_at), "dd/MM HH:mm") : "—"}</TableCell>
                </TableRow>
              );
            })}
            {paginatedLeads.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Nenhum lead</TableCell></TableRow>}
          </TableBody>
        </Table>
        {/* Pagination */}
        <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Exibir</span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[10, 30, 50, 100].map(v => <SelectItem key={v} value={String(v)}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">por página</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={16} /></Button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i + 1;
              } else if (page <= 4) {
                pageNum = i + 1;
              } else if (page >= totalPages - 3) {
                pageNum = totalPages - 6 + i;
              } else {
                pageNum = page - 3 + i;
              }
              return (
                <Button key={pageNum} variant={page === pageNum ? "default" : "outline"} size="icon" className="w-8 h-8 text-xs" onClick={() => setPage(pageNum)}>{pageNum}</Button>
              );
            })}
            <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight size={16} /></Button>
          </div>
          <span className="text-xs text-muted-foreground">{scoreLeads.length} leads total</span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════
   Attendant Metrics Section
   ═══════════════════════════════════════════════════ */
function AttendantMetricsSection({ messages, leads, allLeads, appointments, stages, history, onDrillDown }: {
  messages: Message[]; leads: Lead[]; allLeads: Lead[];
  appointments: Appointment[]; stages: Stage[]; history: StageHistory[];
  onDrillDown?: (params: Record<string, string>) => void;
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
      for (const l of allLeads) { if (l.assigned_to) assignedCounts.set(l.assigned_to, (assignedCounts.get(l.assigned_to) || 0) + 1); }
      const appointmentCounts = new Map<string, number>();
      const leadAssignMap = new Map(allLeads.map(l => [l.id, l.assigned_to]));
      for (const apt of appointments) { const a = leadAssignMap.get(apt.lead_id); if (a) appointmentCounts.set(a, (appointmentCounts.get(a) || 0) + 1); }
      const firstResponseTimes = new Map<string, number[]>();
      const leadCreatedMap = new Map(allLeads.map(l => [l.id, new Date(l.created_at).getTime()]));
      const msgByLead = new Map<string, Message[]>();
      for (const m of messages) { if (m.status === "system") continue; const arr = msgByLead.get(m.lead_id) || []; arr.push(m); msgByLead.set(m.lead_id, arr); }
      msgByLead.forEach((msgs, lid) => {
        const sorted = msgs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        const firstOutbound = sorted.find(m => m.direction === "outbound" && m.sender_id);
        if (firstOutbound?.sender_id) {
          const leadCreated = leadCreatedMap.get(lid);
          if (leadCreated) { const delta = new Date(firstOutbound.created_at).getTime() - leadCreated; if (delta > 0) { const arr = firstResponseTimes.get(firstOutbound.sender_id) || []; arr.push(delta); firstResponseTimes.set(firstOutbound.sender_id, arr); } }
        }
      });
      const contratadoStageIds = new Set(stages.filter(s => s.name.toLowerCase().includes("contratad") && !s.name.toLowerCase().includes("não")).map(s => s.id));
      const convertedByUser = new Map<string, number>();
      const contractedLeadIds = new Set(history.filter(h => contratadoStageIds.has(h.stage_id)).map(h => h.lead_id));
      allLeads.filter(l => contratadoStageIds.has(l.stage_id)).forEach(l => contractedLeadIds.add(l.id));
      for (const lid of contractedLeadIds) { const lead = allLeads.find(l => l.id === lid); if (lead?.assigned_to) convertedByUser.set(lead.assigned_to, (convertedByUser.get(lead.assigned_to) || 0) + 1); }
      const allUsers = new Set<string>();
      grouped.forEach((_, uid) => allUsers.add(uid));
      assignedCounts.forEach((_, uid) => allUsers.add(uid));
      const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      const result = Array.from(allUsers).map((uid) => {
        const assigned = assignedCounts.get(uid) || 0;
        const converted = convertedByUser.get(uid) || 0;
        const convRate = assigned > 0 ? Math.round((converted / assigned) * 100) : 0;
        const frtArr = firstResponseTimes.get(uid) || [];
        return { userId: uid, name: profileMap.get(uid) || uid.slice(0, 8), totalMsgs: grouped.get(uid)?.msgs || 0, leadsAtendidos: grouped.get(uid)?.leads.size || 0, assignedLeads: assigned, agendados: appointmentCounts.get(uid) || 0, converted, convRate, avgFirstResponse: avg(frtArr) };
      }).sort((a, b) => b.totalMsgs - a.totalMsgs);
      setMetrics(result);
    };
    run();
  }, [messages, leads, allLeads, appointments, stages, history]);

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><UserCheck size={16} /> Performance por Atendente</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Atendente</TableHead><TableHead>Msgs Enviadas</TableHead><TableHead>Leads Atendidos</TableHead><TableHead>Leads Atribuídos</TableHead><TableHead>Agendados</TableHead><TableHead>Contratados</TableHead><TableHead>Taxa Conversão</TableHead><TableHead>1ª Resposta (média)</TableHead></TableRow></TableHeader>
            <TableBody>
              {metrics.map((m, i) => (
                <TableRow key={i} className="cursor-pointer hover:bg-muted/50" onClick={() => onDrillDown?.({ assigned_to: m.userId })}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>{m.totalMsgs}</TableCell>
                  <TableCell>{m.leadsAtendidos}</TableCell>
                  <TableCell>{m.assignedLeads}</TableCell>
                  <TableCell>{m.agendados}</TableCell>
                  <TableCell className="font-semibold text-green-600">{m.converted}</TableCell>
                  <TableCell><Badge variant={m.convRate >= 30 ? "default" : m.convRate >= 15 ? "secondary" : "outline"}>{m.convRate}%</Badge></TableCell>
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

/* ═══════════════════════════════════════════════════
   Bots Report Tab
   ═══════════════════════════════════════════════════ */
function BotsReportTab({ periodRange, navigate }: { periodRange: { start: Date; end: Date } | null; navigate: any }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const [botsRes, execsRes, logsRes] = await Promise.all([
        supabase.from("bots").select("id, name, status"),
        supabase.from("bot_executions").select("id, bot_id, status, started_at, completed_at"),
        supabase.from("bot_execution_logs").select("execution_id, node_id, action, created_at"),
      ]);
      const bots = botsRes.data || [];
      let execs = (execsRes.data || []) as any[];
      const logs = (logsRes.data || []) as any[];

      if (periodRange) {
        execs = execs.filter((e: any) => {
          const d = new Date(e.started_at);
          return isWithinInterval(d, { start: periodRange.start, end: periodRange.end });
        });
      }

      const totalExecs = execs.length;
      const completed = execs.filter((e: any) => e.status === "completed").length;
      const cancelled = execs.filter((e: any) => e.status === "cancelled" || e.status === "error").length;
      const active = execs.filter((e: any) => e.status === "active").length;

      // Per bot stats
      const botStats = bots.map((bot: any) => {
        const botExecs = execs.filter((e: any) => e.bot_id === bot.id);
        const botCompleted = botExecs.filter((e: any) => e.status === "completed").length;
        const completionRate = botExecs.length > 0 ? Math.round((botCompleted / botExecs.length) * 100) : 0;

        // Avg nodes per exec
        const execIds = new Set(botExecs.map((e: any) => e.id));
        const botLogs = logs.filter((l: any) => execIds.has(l.execution_id));
        const nodesPerExec = new Map<string, Set<string>>();
        botLogs.forEach((l: any) => {
          if (!nodesPerExec.has(l.execution_id)) nodesPerExec.set(l.execution_id, new Set());
          nodesPerExec.get(l.execution_id)!.add(l.node_id);
        });
        const avgNodes = nodesPerExec.size > 0
          ? Math.round(Array.from(nodesPerExec.values()).reduce((a, s) => a + s.size, 0) / nodesPerExec.size * 10) / 10
          : 0;

        // Last node (drop-off) for incomplete
        const incompleteExecIds = botExecs.filter((e: any) => e.status !== "completed").map((e: any) => e.id);
        const dropOffNodes = new Map<string, number>();
        incompleteExecIds.forEach((eid: string) => {
          const eLogs = logs.filter((l: any) => l.execution_id === eid).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          if (eLogs.length > 0) {
            const lastNode = eLogs[0].node_id;
            dropOffNodes.set(lastNode, (dropOffNodes.get(lastNode) || 0) + 1);
          }
        });
        const topDropOff = Array.from(dropOffNodes.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);

        return { id: bot.id, name: bot.name, status: bot.status, totalExecs: botExecs.length, completed: botCompleted, completionRate, avgNodes, topDropOff };
      }).sort((a: any, b: any) => b.totalExecs - a.totalExecs);

      setData({ totalExecs, completed, cancelled, active, botStats });
      setLoading(false);
    };
    fetch();
  }, [periodRange]);

  if (loading) return <div className="flex items-center justify-center h-32 text-muted-foreground">Carregando dados de bots...</div>;
  if (!data) return null;

  return (
    <>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-5 pb-4"><Bot size={18} className="text-primary mb-1" /><p className="text-2xl font-bold text-foreground">{data.totalExecs}</p><p className="text-xs text-muted-foreground">Total Execuções</p></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><p className="text-2xl font-bold text-green-600">{data.completed}</p><p className="text-xs text-muted-foreground">Completadas</p></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><p className="text-2xl font-bold text-red-500">{data.cancelled}</p><p className="text-xs text-muted-foreground">Canceladas / Erro</p></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><p className="text-2xl font-bold text-blue-500">{data.active}</p><p className="text-xs text-muted-foreground">Em Andamento</p></CardContent></Card>
      </div>

      {/* Bot ranking */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Bot size={16} /> Performance por Bot</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Bot</TableHead><TableHead>Status</TableHead><TableHead>Execuções</TableHead><TableHead>Completadas</TableHead><TableHead>Taxa Conclusão</TableHead><TableHead>Média Nós</TableHead><TableHead>Top Drop-off</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.botStats.map((bot: any) => (
                <TableRow key={bot.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/crm/bots/${bot.id}`)}>
                  <TableCell className="font-medium text-foreground">{bot.name}</TableCell>
                  <TableCell><Badge variant={bot.status === "active" ? "default" : "secondary"}>{bot.status === "active" ? "Ativo" : "Rascunho"}</Badge></TableCell>
                  <TableCell>{bot.totalExecs}</TableCell>
                  <TableCell className="text-green-600 font-medium">{bot.completed}</TableCell>
                  <TableCell><Badge variant={bot.completionRate >= 60 ? "default" : bot.completionRate >= 30 ? "secondary" : "destructive"}>{bot.completionRate}%</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{bot.avgNodes}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{bot.topDropOff.length > 0 ? bot.topDropOff.map((d: any) => `${d[0].slice(0, 12)}… (${d[1]})`).join(", ") : "—"}</TableCell>
                </TableRow>
              ))}
              {data.botStats.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Nenhum bot encontrado</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Follow-ups & Templates Report Tab
   ═══════════════════════════════════════════════════ */
function FollowupsReportTab({ periodRange, drillDown }: { periodRange: { start: Date; end: Date } | null; drillDown: (p: Record<string, string>) => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const [queueRes, configsRes, templatesRes, messagesRes, stagesRes] = await Promise.all([
        supabase.from("crm_followup_queue").select("id, lead_id, status, attempt_count, config_id, stage_id, created_at"),
        supabase.from("crm_followup_configs").select("id, stage_id, is_active, max_attempts, disparos"),
        supabase.from("crm_whatsapp_templates").select("id, name, status, category, body_text"),
        supabase.from("messages").select("id, lead_id, direction, created_at, type"),
        supabase.from("crm_stages").select("id, name, pipeline_id"),
      ]);

      let queue = (queueRes.data || []) as any[];
      const configs = (configsRes.data || []) as any[];
      const templates = (templatesRes.data || []) as any[];
      const msgs = (messagesRes.data || []) as any[];
      const stgs = (stagesRes.data || []) as any[];

      if (periodRange) {
        queue = queue.filter((q: any) => {
          const d = new Date(q.created_at);
          return isWithinInterval(d, { start: periodRange.start, end: periodRange.end });
        });
      }

      const stageMap = new Map(stgs.map((s: any) => [s.id, s.name]));

      // Follow-up stats
      const totalQueued = queue.length;
      const responded = queue.filter((q: any) => q.status === "responded").length;
      const completed = queue.filter((q: any) => q.status === "completed" || q.status === "responded").length;
      const pending = queue.filter((q: any) => q.status !== "completed" && q.status !== "responded" && q.status !== "cancelled").length;
      const responseRate = totalQueued > 0 ? Math.round((responded / totalQueued) * 100) : 0;

      // By stage
      const byStage = new Map<string, { total: number; responded: number }>();
      queue.forEach((q: any) => {
        const sn = stageMap.get(q.stage_id) || q.stage_id;
        if (!byStage.has(sn)) byStage.set(sn, { total: 0, responded: 0 });
        const s = byStage.get(sn)!;
        s.total++;
        if (q.status === "responded") s.responded++;
      });
      const byStageArr = Array.from(byStage.entries()).map(([name, v]) => ({
        name, total: v.total, responded: v.responded,
        rate: v.total > 0 ? Math.round((v.responded / v.total) * 100) : 0,
      })).sort((a, b) => b.total - a.total);

      // Template usage (count outbound messages by type=template)
      const templateMsgs = msgs.filter((m: any) => m.direction === "outbound" && m.type === "template");
      const templateUsage = new Map<string, { sent: number; leadIds: Set<string> }>();
      // We can't directly map msg→template, so we count by template type messages
      // For now, show overall template stats
      const templateStats = templates.map((t: any) => {
        return { id: t.id, name: t.name, status: t.status, category: t.category };
      });

      setData({ totalQueued, responded, completed, pending, responseRate, byStageArr, templateStats, templateMsgsCount: templateMsgs.length });
      setLoading(false);
    };
    fetch();
  }, [periodRange]);

  if (loading) return <div className="flex items-center justify-center h-32 text-muted-foreground">Carregando dados de follow-ups...</div>;
  if (!data) return null;

  return (
    <>
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-5 pb-4"><Send size={18} className="text-primary mb-1" /><p className="text-2xl font-bold text-foreground">{data.totalQueued}</p><p className="text-xs text-muted-foreground">Follow-ups Enviados</p></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><p className="text-2xl font-bold text-green-600">{data.responded}</p><p className="text-xs text-muted-foreground">Responderam</p></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><p className="text-2xl font-bold text-blue-500">{data.pending}</p><p className="text-xs text-muted-foreground">Pendentes</p></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><Badge variant={data.responseRate >= 30 ? "default" : "secondary"} className="text-lg">{data.responseRate}%</Badge><p className="text-xs text-muted-foreground mt-1">Taxa de Resposta</p></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><p className="text-2xl font-bold text-foreground">{data.templateMsgsCount}</p><p className="text-xs text-muted-foreground">Templates Enviados</p></CardContent></Card>
      </div>

      {/* By stage */}
      <Card>
        <CardHeader><CardTitle className="text-base">Follow-ups por Etapa</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Etapa</TableHead><TableHead>Total Enviados</TableHead><TableHead>Responderam</TableHead><TableHead>Taxa Resposta</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.byStageArr.map((s: any) => (
                <TableRow key={s.name}>
                  <TableCell className="font-medium text-foreground">{s.name}</TableCell>
                  <TableCell>{s.total}</TableCell>
                  <TableCell className="text-green-600 font-medium">{s.responded}</TableCell>
                  <TableCell><Badge variant={s.rate >= 30 ? "default" : s.rate >= 15 ? "secondary" : "outline"}>{s.rate}%</Badge></TableCell>
                </TableRow>
              ))}
              {data.byStageArr.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Nenhum follow-up</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Templates */}
      <Card>
        <CardHeader><CardTitle className="text-base">Templates WhatsApp</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Categoria</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.templateStats.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium text-foreground">{t.name}</TableCell>
                  <TableCell className="text-muted-foreground">{t.category}</TableCell>
                  <TableCell><Badge variant={t.status === "APPROVED" ? "default" : t.status === "PENDING" ? "secondary" : "destructive"}>{t.status}</Badge></TableCell>
                </TableRow>
              ))}
              {data.templateStats.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">Nenhum template</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Origens & Cidades Report Tab
   ═══════════════════════════════════════════════════ */
function OrigensReportTab({ leads, stages, history, appointments, messages, pipelines, drillDown }: {
  leads: Lead[]; stages: Stage[]; history: StageHistory[];
  appointments: Appointment[]; messages: Message[]; pipelines: Pipeline[];
  drillDown: (p: Record<string, string>) => void;
}) {
  const [pacientes, setPacientes] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("pacientes").select("id, cidade").then(({ data }) => setPacientes(data || []));
  }, []);

  const agendStageIds = useMemo(() => new Set(stages.filter(s => s.name.toLowerCase().includes("agend")).map(s => s.id)), [stages]);
  const contratadoStageIds = useMemo(() => new Set(stages.filter(s => s.name.toLowerCase().includes("contratad") && !s.name.toLowerCase().includes("não")).map(s => s.id)), [stages]);

  const scheduledLeadIds = useMemo(() => {
    const fromAppt = new Set(appointments.map(a => a.lead_id));
    const fromHist = new Set(history.filter(h => agendStageIds.has(h.stage_id)).map(h => h.lead_id));
    return new Set([...fromAppt, ...fromHist]);
  }, [appointments, history, agendStageIds]);

  const contractedLeadIds = useMemo(() => {
    const fromHist = new Set(history.filter(h => contratadoStageIds.has(h.stage_id)).map(h => h.lead_id));
    leads.filter(l => contratadoStageIds.has(l.stage_id)).forEach(l => fromHist.add(l.id));
    return fromHist;
  }, [history, contratadoStageIds, leads]);

  // By source
  const bySource = useMemo(() => {
    const map = new Map<string, { total: number; scheduled: number; contracted: number }>();
    leads.forEach(l => {
      const raw = l.source || "Desconhecida";
      const src = ["facebook_ad", "instagram_ad"].includes(raw.toLowerCase()) ? "Anúncio" : raw;
      if (!map.has(src)) map.set(src, { total: 0, scheduled: 0, contracted: 0 });
      const s = map.get(src)!;
      s.total++;
      if (scheduledLeadIds.has(l.id)) s.scheduled++;
      if (contractedLeadIds.has(l.id)) s.contracted++;
    });
    return Array.from(map.entries()).map(([name, v]) => ({
      name, ...v, convRate: v.total > 0 ? Math.round((v.contracted / v.total) * 100) : 0,
    })).sort((a, b) => b.total - a.total);
  }, [leads, scheduledLeadIds, contractedLeadIds]);

  const normalizeImgUrl = (url: string | null) => {
    if (!url) return "no-img";
    try { return new URL(url).origin + new URL(url).pathname; } catch { return url; }
  };

  // By ad (grouped by visual + description + account to differentiate same creative across accounts)
  const byAd = useMemo(() => {
    const map = new Map<string, { total: number; scheduled: number; contracted: number; image: string | null; name: string | null; accountName: string | null; links: Set<string>; sources: Set<string> }>();
    leads.forEach(l => {
      const desc = l.descricao_anuncio;
      const adKey = `${normalizeImgUrl(l.imagem_origem || null)}::${desc || l.link_anuncio || l.nome_anuncio}::${l.ad_account_id || ""}`;
      if (adKey === "no-img::undefined::" || adKey === "no-img::null::") return;
      if (!map.has(adKey)) map.set(adKey, { total: 0, scheduled: 0, contracted: 0, image: null, name: null, accountName: null, links: new Set(), sources: new Set() });
      const s = map.get(adKey)!;
      s.total++;
      if (!s.image && l.imagem_origem) s.image = l.imagem_origem;
      if (!s.name && l.nome_anuncio) s.name = l.nome_anuncio;
      if (!s.accountName && l.ad_account_name) s.accountName = l.ad_account_name;
      if (l.link_anuncio) s.links.add(l.link_anuncio);
      if (l.source) s.sources.add(l.source);
      if (scheduledLeadIds.has(l.id)) s.scheduled++;
      if (contractedLeadIds.has(l.id)) s.contracted++;
    });
    return Array.from(map.entries()).map(([key, v]) => ({
      key, ...v,
      linksArr: Array.from(v.links),
      sourcesArr: Array.from(v.sources),
      convRate: v.total > 0 ? Math.round((v.contracted / v.total) * 100) : 0,
    })).sort((a, b) => b.total - a.total);
  }, [leads, scheduledLeadIds, contractedLeadIds]);

  // By ad account (city-level grouping)
  const byAccount = useMemo(() => {
    const map = new Map<string, { total: number; scheduled: number; contracted: number }>();
    leads.forEach(l => {
      const accountName = l.ad_account_name || null;
      if (!accountName) return;
      if (!map.has(accountName)) map.set(accountName, { total: 0, scheduled: 0, contracted: 0 });
      const s = map.get(accountName)!;
      s.total++;
      if (scheduledLeadIds.has(l.id)) s.scheduled++;
      if (contractedLeadIds.has(l.id)) s.contracted++;
    });
    return Array.from(map.entries()).map(([name, v]) => ({
      name, ...v, convRate: v.total > 0 ? Math.round((v.contracted / v.total) * 100) : 0,
    })).sort((a, b) => b.total - a.total);
  }, [leads, scheduledLeadIds, contractedLeadIds]);

  // By city (from pacientes)
  const byCidade = useMemo(() => {
    const pacienteMap = new Map(pacientes.map(p => [p.id, p.cidade]));
    const map = new Map<string, { total: number; scheduled: number; contracted: number }>();
    leads.forEach(l => {
      const cidade = (l.paciente_id ? pacienteMap.get(l.paciente_id) : null) || "Não informada";
      if (!map.has(cidade)) map.set(cidade, { total: 0, scheduled: 0, contracted: 0 });
      const s = map.get(cidade)!;
      s.total++;
      if (scheduledLeadIds.has(l.id)) s.scheduled++;
      if (contractedLeadIds.has(l.id)) s.contracted++;
    });
    return Array.from(map.entries()).map(([name, v]) => ({
      name, ...v, convRate: v.total > 0 ? Math.round((v.contracted / v.total) * 100) : 0,
    })).sort((a, b) => b.total - a.total);
  }, [leads, pacientes, scheduledLeadIds, contractedLeadIds]);

  const renderTable = (data: any[], title: string, filterKey: string) => (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>{title.split(" ")[1] || title}</TableHead><TableHead>Leads</TableHead><TableHead>Agendaram</TableHead><TableHead>Contrataram</TableHead><TableHead>Taxa Conversão</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.slice(0, 30).map((row: any) => (
              <TableRow key={row.name} className="cursor-pointer hover:bg-muted/50" onClick={() => drillDown({ [filterKey]: row.name })}>
                <TableCell className="font-medium text-foreground max-w-[200px] truncate">{row.name}</TableCell>
                <TableCell>{row.total}</TableCell>
                <TableCell className="text-orange-500 font-medium">{row.scheduled}</TableCell>
                <TableCell className="text-green-600 font-medium">{row.contracted}</TableCell>
                <TableCell><Badge variant={row.convRate >= 30 ? "default" : row.convRate >= 15 ? "secondary" : "outline"}>{row.convRate}%</Badge></TableCell>
              </TableRow>
            ))}
            {data.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Sem dados</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  const renderAdTable = () => {
    if (byAd.length === 0) return null;
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Por Anúncio</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Anúncio</TableHead>
                <TableHead>Leads</TableHead>
                <TableHead>Agendaram</TableHead>
                <TableHead>Contrataram</TableHead>
                <TableHead>Taxa Conversão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byAd.slice(0, 30).map((row) => (
                <TableRow key={row.key} className="cursor-pointer hover:bg-muted/50" onClick={() => drillDown({ ad_name: row.name || row.key })}>
                  <TableCell className="font-medium text-foreground">
                    <div className="flex items-center gap-3">
                      {row.image ? (
                        <img
                          src={row.image}
                          alt="Ad"
                          className="w-12 h-12 rounded object-cover flex-shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-12 h-12 rounded bg-muted flex items-center justify-center flex-shrink-0">
                          <span className="text-xs text-muted-foreground">Vídeo</span>
                        </div>
                      )}
                      <div className="min-w-0">
                        {row.name && <p className="text-sm font-medium truncate">{row.name}</p>}
                        {row.accountName && (
                          <p className="text-xs text-primary/70">Conta: {row.accountName}</p>
                        )}
                        {row.linksArr.length > 0 && (
                          <div className="flex flex-col gap-0.5">
                            {row.linksArr.slice(0, 3).map((link, i) => (
                              <a
                                key={i}
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline truncate block max-w-[250px]"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {link}
                              </a>
                            ))}
                            {row.linksArr.length > 3 && <span className="text-xs text-muted-foreground">+{row.linksArr.length - 3} links</span>}
                          </div>
                        )}
                        {row.sourcesArr.length > 1 && (
                          <p className="text-xs text-muted-foreground">{row.sourcesArr.length} origens</p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{row.total}</TableCell>
                  <TableCell className="text-orange-500 font-medium">{row.scheduled}</TableCell>
                  <TableCell className="text-green-600 font-medium">{row.contracted}</TableCell>
                  <TableCell><Badge variant={row.convRate >= 30 ? "default" : row.convRate >= 15 ? "secondary" : "outline"}>{row.convRate}%</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  };

  return (
    <>
      {renderTable(bySource, "Por Origem", "source")}
      {byAccount.length > 0 && renderTable(byAccount, "Por Conta de Anúncio", "ad_account")}
      {renderAdTable()}
      {renderTable(byCidade, "Por Cidade", "city")}
    </>
  );
}
