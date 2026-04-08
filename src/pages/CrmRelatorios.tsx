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
import { Clock, Timer, Users, TrendingUp, AlertTriangle, Zap, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

type Stage = { id: string; name: string; color: string; position: number };
type StageHistory = { lead_id: string; stage_id: string; entered_at: string; exited_at: string | null };
type Lead = { id: string; name: string; phone: string | null; stage_id: string; created_at: string; score?: number; last_message_at?: string | null; assigned_to?: string | null };
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
  const [stages, setStages] = useState<Stage[]>([]);
  const [history, setHistory] = useState<StageHistory[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [inactiveDays, setInactiveDays] = useState("3");

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      // Only fetch messages from last 90 days for performance
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const [stagesRes, historyRes, leadsRes, messagesRes] = await Promise.all([
        supabase.from("crm_stages").select("*").order("position"),
        supabase.from("crm_lead_stage_history").select("lead_id, stage_id, entered_at, exited_at"),
        supabase.from("crm_leads").select("id, name, phone, stage_id, created_at, last_inbound_at, last_outbound_at, score, last_message_at"),
        supabase.from("messages").select("id, lead_id, direction, created_at, status").gte("created_at", ninetyDaysAgo),
      ]);
      setStages((stagesRes.data as Stage[]) || []);
      setHistory((historyRes.data as StageHistory[]) || []);
      setLeads((leadsRes.data as Lead[]) || []);
      setMessages((messagesRes.data as Message[]) || []);
      setLoading(false);
    };
    fetchAll();
  }, []);

  // Average time per stage
  const stageTimeData = useMemo(() => {
    return stages.map((stage) => {
      const entries = history.filter((h) => h.stage_id === stage.id);
      const durations = entries.map((h) => {
        const end = h.exited_at ? new Date(h.exited_at).getTime() : Date.now();
        return end - new Date(h.entered_at).getTime();
      });
      const avg = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
      const leadsInStage = leads.filter((l) => l.stage_id === stage.id).length;
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
  }, [stages, history, leads]);

  // Conversion rate between stages
  const conversionData = useMemo(() => {
    return stages.map((stage, i) => {
      const leadsEntered = history.filter((h) => h.stage_id === stage.id).map((h) => h.lead_id);
      const uniqueLeads = new Set(leadsEntered).size;

      let conversionRate = 0;
      if (i < stages.length - 1) {
        const nextStage = stages[i + 1];
        const leadsMovedNext = history.filter((h) => h.stage_id === nextStage.id).map((h) => h.lead_id);
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
  }, [stages, history]);

  // Response times per lead
  const responseTimeData = useMemo(() => {
    const leadMap = new Map<string, { leadDeltas: number[]; userDeltas: number[] }>();

    const msgByLead = new Map<string, Message[]>();
    messages.forEach((m) => {
      if (m.status === "system") return;
      const arr = msgByLead.get(m.lead_id) || [];
      arr.push(m);
      msgByLead.set(m.lead_id, arr);
    });

    msgByLead.forEach((msgs, leadId) => {
      const sorted = msgs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const leadDeltas: number[] = [];
      const userDeltas: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        const delta = new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
        if (prev.direction === "outbound" && curr.direction === "inbound") leadDeltas.push(delta);
        if (prev.direction === "inbound" && curr.direction === "outbound") userDeltas.push(delta);
      }
      leadMap.set(leadId, { leadDeltas, userDeltas });
    });

    const allLeadDeltas: number[] = [];
    const allUserDeltas: number[] = [];
    leadMap.forEach(({ leadDeltas, userDeltas }) => {
      allLeadDeltas.push(...leadDeltas);
      allUserDeltas.push(...userDeltas);
    });

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    return {
      avgLeadResponse: avg(allLeadDeltas),
      avgUserResponse: avg(allUserDeltas),
      totalConversations: msgByLead.size,
    };
  }, [messages]);

  // Inactive leads
  const inactiveLeads = useMemo(() => {
    const threshold = parseInt(inactiveDays) * 86400000;
    const now = Date.now();

    return leads.filter((lead) => {
      const leadMsgs = messages
        .filter((m) => m.lead_id === lead.id && m.status !== "system")
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      if (leadMsgs.length === 0) return true;

      const lastMsg = leadMsgs[0];
      // If last message was ours and lead hasn't replied
      if (lastMsg.direction === "outbound") {
        return now - new Date(lastMsg.created_at).getTime() > threshold;
      }
      return false;
    }).map((lead) => {
      const leadMsgs = messages
        .filter((m) => m.lead_id === lead.id && m.status !== "system")
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const lastMsg = leadMsgs[0];
      const stageName = stages.find((s) => s.id === lead.stage_id)?.name || "?";
      return {
        ...lead,
        lastMessageAt: lastMsg?.created_at || lead.created_at,
        inactiveSince: lastMsg ? now - new Date(lastMsg.created_at).getTime() : now - new Date(lead.created_at).getTime(),
        stageName,
      };
    }).sort((a, b) => b.inactiveSince - a.inactiveSince);
  }, [leads, messages, stages, inactiveDays]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando relatórios...</div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Relatórios CRM</h1>
        <p className="text-sm text-muted-foreground">Análise de funil, tempos de resposta e leads inativos</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Users size={20} className="text-primary" />
              <div>
                <p className="text-2xl font-bold text-foreground">{leads.length}</p>
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
                <p className="text-xs text-muted-foreground">Leads Inativos ({inactiveDays}d+)</p>
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
                <XAxis type="number" tickFormatter={(v) => `${v}h`} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number) => [formatDuration(value * 3600000), "Tempo Médio"]}
                  labelFormatter={(label) => `Etapa: ${label}`}
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
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(value: number) => [`${value}%`, "Conversão"]} />
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

      {/* Lead Score Section */}
      <LeadScoreSection leads={leads} stages={stages} />

      {/* Attendant Metrics Section */}
      <AttendantMetricsSection messages={messages} leads={leads} />

      {/* Inactive Leads */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle size={16} className="text-yellow-500" /> Leads Inativos
            </CardTitle>
            <Select value={inactiveDays} onValueChange={setInactiveDays}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">+1 dia</SelectItem>
                <SelectItem value="3">+3 dias</SelectItem>
                <SelectItem value="7">+7 dias</SelectItem>
                <SelectItem value="14">+14 dias</SelectItem>
                <SelectItem value="30">+30 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {inactiveLeads.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum lead inativo no período selecionado 🎉</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {inactiveLeads.map((lead) => (
                <div key={lead.id} className="flex items-center justify-between p-2 rounded bg-secondary/50 text-sm">
                  <div>
                    <span className="font-medium text-foreground">{lead.name}</span>
                    {lead.phone && <span className="text-muted-foreground ml-2 text-xs">{lead.phone}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="text-[10px]">{lead.stageName}</Badge>
                    <span className="text-xs text-destructive font-medium">{formatDuration(lead.inactiveSince)}</span>
                  </div>
                </div>
              ))}
            </div>
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
function AttendantMetricsSection({ messages, leads }: { messages: Message[]; leads: Lead[] }) {
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
        const assigned = (l as any).assigned_to;
        if (assigned) assignedCounts.set(assigned, (assignedCounts.get(assigned) || 0) + 1);
      }

      const result = Array.from(grouped.entries()).map(([uid, g]) => ({
        name: profileMap.get(uid) || uid.slice(0, 8),
        totalMsgs: g.msgs,
        leadsAtendidos: g.leads.size,
        assignedLeads: assignedCounts.get(uid) || 0,
      })).sort((a, b) => b.totalMsgs - a.totalMsgs);

      setMetrics(result);
    };
    run();
  }, [messages, leads]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users size={16} /> Métricas por Atendente
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Atendente</TableHead><TableHead>Mensagens Enviadas</TableHead><TableHead>Leads Atendidos</TableHead><TableHead>Leads Atribuídos</TableHead></TableRow></TableHeader>
          <TableBody>
            {metrics.map((m, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{m.name}</TableCell>
                <TableCell>{m.totalMsgs}</TableCell>
                <TableCell>{m.leadsAtendidos}</TableCell>
                <TableCell>{m.assignedLeads}</TableCell>
              </TableRow>
            ))}
            {metrics.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Nenhuma métrica disponível</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
