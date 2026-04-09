import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { Clock, Timer, Users, TrendingUp, AlertTriangle, Zap, RefreshCw, Filter } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useChartTheme } from "@/hooks/useChartTheme";

type Pipeline = { id: string; name: string; color: string | null };
type Stage = { id: string; name: string; color: string; position: number; pipeline_id: string };
type StageHistory = { lead_id: string; stage_id: string; entered_at: string; exited_at: string | null };
type Lead = { id: string; name: string; phone: string | null; stage_id: string; pipeline_id: string; created_at: string; score?: number; last_message_at?: string | null; assigned_to?: string | null };
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

export default function CrmRelatorios() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("all");
  const [stages, setStages] = useState<Stage[]>([]);
  const [history, setHistory] = useState<StageHistory[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [inactiveDays, setInactiveDays] = useState("3");
  const [inactiveUnit, setInactiveUnit] = useState<"days" | "weeks" | "months">("days");
  const chartTheme = useChartTheme();

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const [pipelinesRes, stagesRes, historyRes, leadsRes, messagesRes, appointmentsRes] = await Promise.all([
        supabase.from("crm_pipelines").select("id, name, color").order("created_at"),
        supabase.from("crm_stages").select("id, name, color, position, pipeline_id").order("position"),
        supabase.from("crm_lead_stage_history").select("lead_id, stage_id, entered_at, exited_at"),
        supabase.from("crm_leads").select("id, name, phone, stage_id, pipeline_id, created_at, last_inbound_at, last_outbound_at, score, last_message_at, assigned_to"),
        supabase.from("messages").select("id, lead_id, direction, created_at, status, sender_id").gte("created_at", ninetyDaysAgo),
        supabase.from("crm_appointments").select("id, lead_id, status, scheduled_date"),
      ]);
      setPipelines((pipelinesRes.data as Pipeline[]) || []);
      setStages((stagesRes.data as Stage[]) || []);
      setHistory((historyRes.data as StageHistory[]) || []);
      setLeads((leadsRes.data as Lead[]) || []);
      setMessages((messagesRes.data as Message[]) || []);
      setAppointments((appointmentsRes.data as Appointment[]) || []);
      setLoading(false);
    };
    fetchAll();
  }, []);

  // Filtered data by pipeline
  const filteredStages = useMemo(() => {
    if (selectedPipelineId === "all") return stages;
    return stages.filter(s => s.pipeline_id === selectedPipelineId);
  }, [stages, selectedPipelineId]);

  const filteredStageIds = useMemo(() => new Set(filteredStages.map(s => s.id)), [filteredStages]);

  const filteredLeads = useMemo(() => {
    if (selectedPipelineId === "all") return leads;
    return leads.filter(l => l.pipeline_id === selectedPipelineId);
  }, [leads, selectedPipelineId]);

  const filteredLeadIds = useMemo(() => new Set(filteredLeads.map(l => l.id)), [filteredLeads]);

  const filteredHistory = useMemo(() => {
    if (selectedPipelineId === "all") return history;
    return history.filter(h => filteredStageIds.has(h.stage_id));
  }, [history, selectedPipelineId, filteredStageIds]);

  const filteredMessages = useMemo(() => {
    if (selectedPipelineId === "all") return messages;
    return messages.filter(m => filteredLeadIds.has(m.lead_id));
  }, [messages, selectedPipelineId, filteredLeadIds]);

  const filteredAppointments = useMemo(() => {
    if (selectedPipelineId === "all") return appointments;
    return appointments.filter(a => filteredLeadIds.has(a.lead_id));
  }, [appointments, selectedPipelineId, filteredLeadIds]);

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

  // Average time per stage
  const stageTimeData = useMemo(() => {
    return filteredStages.map((stage) => {
      const entries = filteredHistory.filter((h) => h.stage_id === stage.id);
      const durations = entries.map((h) => {
        const end = h.exited_at ? new Date(h.exited_at).getTime() : Date.now();
        return end - new Date(h.entered_at).getTime();
      });
      const avg = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
      const leadsInStage = filteredLeads.filter((l) => l.stage_id === stage.id).length;
      return {
        name: stage.name,
        color: stage.color,
        avgMs: avg,
        avgFormatted: formatDuration(avg),
        avgHours: Math.round(avg / 3600000 * 10) / 10,
        count: leadsInStage,
        totalEntries: entries.length,
      };
    });
  }, [filteredStages, filteredHistory, filteredLeads]);

  // Conversion rate between stages
  const conversionData = useMemo(() => {
    return filteredStages.map((stage, i) => {
      const leadsEntered = filteredHistory.filter((h) => h.stage_id === stage.id).map((h) => h.lead_id);
      const uniqueLeads = new Set(leadsEntered).size;

      let conversionRate = 0;
      if (i < filteredStages.length - 1) {
        const nextStage = filteredStages[i + 1];
        const leadsMovedNext = filteredHistory.filter((h) => h.stage_id === nextStage.id).map((h) => h.lead_id);
        const uniqueNext = new Set(leadsMovedNext).size;
        conversionRate = uniqueLeads > 0 ? Math.round((uniqueNext / uniqueLeads) * 100) : 0;
      }

      return {
        name: stage.name,
        color: stage.color,
        leads: uniqueLeads,
        conversion: conversionRate,
      };
    });
  }, [filteredStages, filteredHistory]);

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

    return {
      avgLeadResponse: avg(allLeadDeltas),
      avgUserResponse: avg(allUserDeltas),
      totalConversations: msgByLead.size,
    };
  }, [filteredMessages]);

  // Inactive leads
  const inactiveLeads = useMemo(() => {
    const now = Date.now();

    return filteredLeads.filter((lead) => {
      const leadMsgs = filteredMessages
        .filter((m) => m.lead_id === lead.id && m.status !== "system")
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      if (leadMsgs.length === 0) {
        // No messages at all — check created_at
        return now - new Date(lead.created_at).getTime() > inactiveThresholdMs;
      }

      const lastMsg = leadMsgs[0];
      return now - new Date(lastMsg.created_at).getTime() > inactiveThresholdMs;
    }).map((lead) => {
      const leadMsgs = filteredMessages
        .filter((m) => m.lead_id === lead.id && m.status !== "system")
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const lastMsg = leadMsgs[0];
      const stageName = stages.find((s) => s.id === lead.stage_id)?.name || "?";
      const pipelineName = pipelines.find(p => p.id === lead.pipeline_id)?.name || "?";
      return {
        ...lead,
        lastMessageAt: lastMsg?.created_at || lead.created_at,
        inactiveSince: lastMsg ? now - new Date(lastMsg.created_at).getTime() : now - new Date(lead.created_at).getTime(),
        stageName,
        pipelineName,
      };
    }).sort((a, b) => b.inactiveSince - a.inactiveSince);
  }, [filteredLeads, filteredMessages, stages, pipelines, inactiveThresholdMs]);

  // Distribution by stage (pie chart)
  const stageDistribution = useMemo(() => {
    return filteredStages.map(stage => ({
      name: stage.name,
      value: filteredLeads.filter(l => l.stage_id === stage.id).length,
      color: stage.color,
    })).filter(s => s.value > 0);
  }, [filteredStages, filteredLeads]);

  // Pipeline summary (when "all" selected)
  const pipelineSummary = useMemo(() => {
    if (selectedPipelineId !== "all") return [];
    return pipelines.map(p => {
      const pLeads = leads.filter(l => l.pipeline_id === p.id);
      const pStages = stages.filter(s => s.pipeline_id === p.id);
      const pMsgs = messages.filter(m => pLeads.some(l => l.id === m.lead_id));
      const totalInbound = pMsgs.filter(m => m.direction === "inbound").length;
      const totalOutbound = pMsgs.filter(m => m.direction === "outbound").length;
      return {
        id: p.id,
        name: p.name,
        color: p.color || "hsl(var(--primary))",
        totalLeads: pLeads.length,
        totalStages: pStages.length,
        totalInbound,
        totalOutbound,
      };
    });
  }, [selectedPipelineId, pipelines, leads, stages, messages]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando relatórios...</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Relatórios CRM</h1>
          <p className="text-sm text-muted-foreground">Análise completa de funil, tempos de resposta e leads inativos</p>
        </div>
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-muted-foreground" />
          <Select value={selectedPipelineId} onValueChange={setSelectedPipelineId}>
            <SelectTrigger className="w-52">
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

      {/* Pipeline Overview (when "all" is selected) */}
      {selectedPipelineId === "all" && pipelineSummary.length > 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pipelineSummary.map(p => (
            <Card key={p.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelectedPipelineId(p.id)}>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                  <h3 className="font-semibold text-foreground">{p.name}</h3>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-lg font-bold text-foreground">{p.totalLeads}</p>
                    <p className="text-xs text-muted-foreground">Leads</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-foreground">{p.totalStages}</p>
                    <p className="text-xs text-muted-foreground">Etapas</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-foreground">{p.totalInbound}</p>
                    <p className="text-xs text-muted-foreground">Msgs Recebidas</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-foreground">{p.totalOutbound}</p>
                    <p className="text-xs text-muted-foreground">Msgs Enviadas</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Users size={20} className="text-primary" />
              <div>
                <p className="text-2xl font-bold text-foreground">{filteredLeads.length}</p>
                <p className="text-xs text-muted-foreground">Total de Leads</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Timer size={20} className="text-blue-500" />
              <div>
                <p className="text-2xl font-bold text-foreground">{formatDuration(responseTimeData.avgUserResponse)}</p>
                <p className="text-xs text-muted-foreground">Tempo Resp. Médio (Você)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Timer size={20} className="text-green-500" />
              <div>
                <p className="text-2xl font-bold text-foreground">{formatDuration(responseTimeData.avgLeadResponse)}</p>
                <p className="text-xs text-muted-foreground">Tempo Resp. Médio (Lead)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle size={20} className="text-yellow-500" />
              <div>
                <p className="text-2xl font-bold text-foreground">{inactiveLeads.length}</p>
                <p className="text-xs text-muted-foreground">Leads Inativos ({inactiveThresholdLabel}+)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

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

        {/* Conversion per Stage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp size={16} /> Conversão por Etapa
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={conversionData}>
                <XAxis dataKey="name" tick={{ fill: chartTheme.axisColor, fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `${v}%`} tick={{ fill: chartTheme.axisColor, fontSize: 11 }} />
                <Tooltip
                  formatter={(value: number) => [`${value}%`, "Conversão"]}
                  contentStyle={chartTheme.tooltipStyle}
                  labelStyle={chartTheme.tooltipLabelStyle}
                  itemStyle={chartTheme.tooltipItemStyle}
                />
                <Bar dataKey="conversion" radius={[4, 4, 0, 0]}>
                  {conversionData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 space-y-1">
              {conversionData.map((s, i) => (
                <div key={s.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-foreground">{s.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">{s.leads} leads</span>
                    {i < conversionData.length - 1 && (
                      <Badge variant="secondary" className="text-[10px]">{s.conversion}%</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Stage Distribution Pie */}
      {stageDistribution.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users size={16} /> Distribuição de Leads por Etapa
            </CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      )}

      {/* Lead Score Section */}
      <LeadScoreSection leads={filteredLeads} stages={filteredStages} />

      {/* Attendant Metrics Section */}
      <AttendantMetricsSection messages={filteredMessages} leads={filteredLeads} appointments={filteredAppointments} />

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
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="7">7</SelectItem>
                  <SelectItem value="14">14</SelectItem>
                  <SelectItem value="30">30</SelectItem>
                </SelectContent>
              </Select>
              <Select value={inactiveUnit} onValueChange={(v) => setInactiveUnit(v as any)}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
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
              <p className="text-sm text-muted-foreground mb-3">{inactiveLeads.length} leads sem interação há mais de {inactiveDays} {inactiveUnit === "days" ? "dia(s)" : inactiveUnit === "weeks" ? "semana(s)" : "mês(es)"}</p>
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
                <p className="text-xs text-muted-foreground mt-2 text-center">Mostrando 100 de {inactiveLeads.length} leads inativos</p>
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
   Métricas por Atendente Section
   ═══════════════════════════════════════════════════ */
function AttendantMetricsSection({ messages, leads, appointments }: { messages: Message[]; leads: Lead[]; appointments: Appointment[] }) {
  const [metrics, setMetrics] = useState<any[]>([]);

  useEffect(() => {
    const run = async () => {
      const { data: profiles } = await supabase.from("profiles").select("id, nome");
      if (!profiles) return;

      const profileMap = new Map(profiles.map(p => [p.id, p.nome]));
      const grouped = new Map<string, { msgs: number; leads: Set<string> }>();

      for (const m of messages) {
        if (m.direction !== "outbound" || !m.sender_id) continue;
        if (!grouped.has(m.sender_id)) grouped.set(m.sender_id, { msgs: 0, leads: new Set() });
        const g = grouped.get(m.sender_id)!;
        g.msgs++;
        g.leads.add(m.lead_id);
      }

      const assignedCounts = new Map<string, number>();
      for (const l of leads) {
        if (l.assigned_to) assignedCounts.set(l.assigned_to, (assignedCounts.get(l.assigned_to) || 0) + 1);
      }

      const appointmentCounts = new Map<string, number>();
      const leadAssignMap = new Map(leads.map(l => [l.id, l.assigned_to]));
      for (const apt of appointments) {
        const assignedTo = leadAssignMap.get(apt.lead_id);
        if (assignedTo) {
          appointmentCounts.set(assignedTo, (appointmentCounts.get(assignedTo) || 0) + 1);
        }
      }

      const allUsers = new Set<string>();
      grouped.forEach((_, uid) => allUsers.add(uid));
      assignedCounts.forEach((_, uid) => allUsers.add(uid));

      const result = Array.from(allUsers).map((uid) => ({
        name: profileMap.get(uid) || uid.slice(0, 8),
        totalMsgs: grouped.get(uid)?.msgs || 0,
        leadsAtendidos: grouped.get(uid)?.leads.size || 0,
        assignedLeads: assignedCounts.get(uid) || 0,
        agendados: appointmentCounts.get(uid) || 0,
      })).sort((a, b) => b.totalMsgs - a.totalMsgs);

      setMetrics(result);
    };
    run();
  }, [messages, leads, appointments]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users size={16} /> Produtividade por Atendente
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Atendente</TableHead><TableHead>Msgs Enviadas</TableHead><TableHead>Leads Atendidos</TableHead><TableHead>Leads Atribuídos</TableHead><TableHead>Agendados</TableHead></TableRow></TableHeader>
          <TableBody>
            {metrics.map((m, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{m.name}</TableCell>
                <TableCell>{m.totalMsgs}</TableCell>
                <TableCell>{m.leadsAtendidos}</TableCell>
                <TableCell>{m.assignedLeads}</TableCell>
                <TableCell><Badge variant="secondary">{m.agendados}</Badge></TableCell>
              </TableRow>
            ))}
            {metrics.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Nenhuma métrica disponível</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
