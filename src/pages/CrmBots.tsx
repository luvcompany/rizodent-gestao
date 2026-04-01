import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Cpu, Activity, Pause, Play, Eye, Clock, CheckCircle2, XCircle, AlertTriangle, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Bot {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
  stage_count?: number;
}

interface Execution {
  id: string;
  bot_id: string;
  lead_id: string;
  current_node_id: string | null;
  status: string;
  waiting_since: string | null;
  timeout_at: string | null;
  waiting_for: string | null;
  started_at: string;
  finished_at: string | null;
  cancel_reason: string | null;
  lead_name?: string;
  lead_phone?: string;
  bot_name?: string;
  node_type?: string;
}

const CrmBots = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState("bots");
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Monitoring state
  const [activeExecs, setActiveExecs] = useState<Execution[]>([]);
  const [historyExecs, setHistoryExecs] = useState<Execution[]>([]);
  const [metrics, setMetrics] = useState({ active: 0, completed: 0, responseRate: 0, recovered: 0 });
  const [monLoading, setMonLoading] = useState(false);

  const fetchBots = async () => {
    setLoading(true);
    const { data: botsData } = await supabase.from("bots").select("*").order("created_at", { ascending: false });
    const { data: configs } = await supabase.from("stage_bot_config").select("bot_id");
    const countMap: Record<string, number> = {};
    configs?.forEach((c: any) => { if (c.bot_id) countMap[c.bot_id] = (countMap[c.bot_id] || 0) + 1; });
    setBots((botsData || []).map((b: any) => ({ ...b, stage_count: countMap[b.id] || 0 })));
    setLoading(false);
  };

  const fetchMonitoring = async () => {
    setMonLoading(true);
    const [{ data: active }, { data: history }, { data: allBots }, { data: leads }, { data: nodes }] = await Promise.all([
      supabase.from("bot_executions").select("*").in("status", ["active", "waiting_reply", "waiting_timeout"]).order("started_at", { ascending: false }),
      supabase.from("bot_executions").select("*").in("status", ["completed", "cancelled"]).gte("finished_at", new Date(Date.now() - 86400000).toISOString()).order("finished_at", { ascending: false }).limit(50),
      supabase.from("bots").select("id, name"),
      supabase.from("crm_leads").select("id, name, phone"),
      supabase.from("bot_nodes").select("id, type"),
    ]);

    const botMap: Record<string, string> = {};
    allBots?.forEach((b: any) => { botMap[b.id] = b.name; });
    const leadMap: Record<string, { name: string; phone: string }> = {};
    leads?.forEach((l: any) => { leadMap[l.id] = { name: l.name, phone: l.phone || "" }; });
    const nodeMap: Record<string, string> = {};
    nodes?.forEach((n: any) => { nodeMap[n.id] = n.type; });

    const enrich = (e: any): Execution => ({
      ...e,
      lead_name: leadMap[e.lead_id]?.name || "?",
      lead_phone: leadMap[e.lead_id]?.phone || "",
      bot_name: botMap[e.bot_id] || "?",
      node_type: e.current_node_id ? nodeMap[e.current_node_id] || "?" : "-",
    });

    setActiveExecs((active || []).map(enrich));
    setHistoryExecs((history || []).map(enrich));

    const completedToday = (history || []).filter((e: any) => e.status === "completed").length;
    const totalFinished = (history || []).length;
    setMetrics({
      active: (active || []).length,
      completed: completedToday,
      responseRate: totalFinished > 0 ? Math.round((completedToday / totalFinished) * 100) : 0,
      recovered: 0,
    });
    setMonLoading(false);
  };

  useEffect(() => { fetchBots(); }, []);
  useEffect(() => { if (tab === "monitoring") fetchMonitoring(); }, [tab]);

  const createBot = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const { data, error } = await supabase.from("bots").insert({ name: newName.trim(), description: newDesc.trim() || null }).select().single();
    if (error) { toast.error("Erro ao criar bot"); setCreating(false); return; }
    toast.success("Bot criado!");
    setShowNew(false); setNewName(""); setNewDesc(""); setCreating(false);
    navigate(`/crm/bots/${data.id}`);
  };

  const toggleActive = async (bot: Bot) => {
    await supabase.from("bots").update({ active: !bot.active }).eq("id", bot.id);
    setBots(prev => prev.map(b => b.id === bot.id ? { ...b, active: !b.active } : b));
  };

  const deleteBot = async (id: string) => {
    if (!confirm("Excluir este bot?")) return;
    await supabase.from("bots").delete().eq("id", id);
    setBots(prev => prev.filter(b => b.id !== id));
    toast.success("Bot excluído");
  };

  const pauseAllAutomations = async () => {
    await supabase.from("crm_leads").update({ automation_paused: true } as any).neq("id", "00000000-0000-0000-0000-000000000000");
    toast.success("Todas automações pausadas");
  };

  const resumeAllAutomations = async () => {
    await supabase.from("crm_leads").update({ automation_paused: false } as any).neq("id", "00000000-0000-0000-0000-000000000000");
    toast.success("Automações retomadas");
  };

  const cancelExecution = async (execId: string) => {
    await supabase.from("bot_executions").update({ status: "cancelled", cancel_reason: "manual", finished_at: new Date().toISOString() }).eq("id", execId);
    fetchMonitoring();
    toast.success("Execução cancelada");
  };

  const statusLabel = (s: string) => {
    const m: Record<string, { label: string; color: string }> = {
      active: { label: "Ativo", color: "bg-blue-500" },
      waiting_reply: { label: "Aguardando resposta", color: "bg-amber-500" },
      waiting_timeout: { label: "Aguardando timeout", color: "bg-orange-500" },
      completed: { label: "Concluído", color: "bg-green-500" },
      cancelled: { label: "Cancelado", color: "bg-destructive" },
    };
    const info = m[s] || { label: s, color: "bg-muted" };
    return <Badge variant="secondary" className={`${info.color} text-white text-[10px]`}>{info.label}</Badge>;
  };

  const timeAgo = (dt: string | null) => {
    if (!dt) return "-";
    const diff = Date.now() - new Date(dt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m`;
    return `${Math.floor(hrs / 24)}d`;
  };

  const countdown = (dt: string | null) => {
    if (!dt) return "-";
    const diff = new Date(dt).getTime() - Date.now();
    if (diff <= 0) return "Expirado";
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bots de Automação</h1>
          <p className="text-sm text-muted-foreground">Crie e gerencie fluxos automatizados para seus leads</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowNew(true)} className="gap-2"><Plus size={16} /> Novo Bot</Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="bots" className="gap-1"><Cpu size={14} /> Bots</TabsTrigger>
          <TabsTrigger value="monitoring" className="gap-1"><Activity size={14} /> Monitoramento</TabsTrigger>
        </TabsList>

        <TabsContent value="bots" className="mt-4">
          {loading ? (
            <div className="text-center text-muted-foreground py-12">Carregando...</div>
          ) : bots.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                <Cpu size={48} className="text-muted-foreground/50" />
                <p className="text-muted-foreground">Nenhum bot criado ainda</p>
                <Button variant="outline" onClick={() => setShowNew(true)}>Criar primeiro bot</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {bots.map(bot => (
                <Card key={bot.id}>
                  <CardHeader className="flex flex-row items-start justify-between pb-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">{bot.name}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {bot.description?.trim() || "Sem descrição"}
                      </p>
                    </div>
                    <Switch checked={bot.active} onCheckedChange={() => toggleActive(bot)} />
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-xs text-muted-foreground mb-3">Vinculado a {bot.stage_count} etapa{bot.stage_count !== 1 ? "s" : ""}</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => navigate(`/crm/bots/${bot.id}`)}><Pencil size={14} /> Editar</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteBot(bot.id)}><Trash2 size={14} /></Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="monitoring" className="mt-4 space-y-6">
          {monLoading ? (
            <div className="text-center text-muted-foreground py-12">Carregando...</div>
          ) : (
            <>
              {/* Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card><CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-foreground">{metrics.active}</p>
                  <p className="text-xs text-muted-foreground">Execuções ativas</p>
                </CardContent></Card>
                <Card><CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-green-500">{metrics.completed}</p>
                  <p className="text-xs text-muted-foreground">Concluídas hoje</p>
                </CardContent></Card>
                <Card><CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-foreground">{metrics.responseRate}%</p>
                  <p className="text-xs text-muted-foreground">Taxa de conclusão</p>
                </CardContent></Card>
                <Card><CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-primary">{metrics.recovered}</p>
                  <p className="text-xs text-muted-foreground">Recuperados hoje</p>
                </CardContent></Card>
              </div>

              {/* Global controls */}
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" className="gap-1" onClick={pauseAllAutomations}><Pause size={14} /> Pausar todas automações</Button>
                <Button variant="outline" size="sm" className="gap-1" onClick={resumeAllAutomations}><Play size={14} /> Retomar todas</Button>
                <Button variant="ghost" size="sm" className="gap-1 ml-auto" onClick={fetchMonitoring}><Activity size={14} /> Atualizar</Button>
              </div>

              {/* Active executions */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Execuções Ativas ({activeExecs.length})</h3>
                {activeExecs.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">Nenhuma execução ativa no momento.</p>
                ) : (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Lead</TableHead>
                          <TableHead className="text-xs">Bot</TableHead>
                          <TableHead className="text-xs">Nó Atual</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs">Esperando</TableHead>
                          <TableHead className="text-xs">Timeout</TableHead>
                          <TableHead className="text-xs">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activeExecs.map(exec => (
                          <TableRow key={exec.id}>
                            <TableCell className="text-xs">
                              <div>{exec.lead_name}</div>
                              <div className="text-muted-foreground">{exec.lead_phone}</div>
                            </TableCell>
                            <TableCell className="text-xs">{exec.bot_name}</TableCell>
                            <TableCell className="text-xs">{exec.node_type}</TableCell>
                            <TableCell>{statusLabel(exec.status)}</TableCell>
                            <TableCell className="text-xs">{timeAgo(exec.waiting_since)}</TableCell>
                            <TableCell className="text-xs">{countdown(exec.timeout_at)}</TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => cancelExecution(exec.id)} title="Cancelar">
                                  <XCircle size={14} className="text-destructive" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => navigate(`/crm/conversa/${exec.lead_id}`)} title="Ver conversa">
                                  <Eye size={14} />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {/* History */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Histórico (últimas 24h)</h3>
                {historyExecs.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">Nenhuma execução nas últimas 24h.</p>
                ) : (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Lead</TableHead>
                          <TableHead className="text-xs">Bot</TableHead>
                          <TableHead className="text-xs">Resultado</TableHead>
                          <TableHead className="text-xs">Duração</TableHead>
                          <TableHead className="text-xs">Motivo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {historyExecs.map(exec => {
                          const duration = exec.finished_at && exec.started_at
                            ? timeAgo(exec.started_at)
                            : "-";
                          return (
                            <TableRow key={exec.id}>
                              <TableCell className="text-xs">{exec.lead_name}</TableCell>
                              <TableCell className="text-xs">{exec.bot_name}</TableCell>
                              <TableCell>{statusLabel(exec.status)}</TableCell>
                              <TableCell className="text-xs">{duration}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{exec.cancel_reason || "-"}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo Bot</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Nome</Label><Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex: Follow-up Agendamento" /></div>
            <div><Label>Descrição (opcional)</Label><Textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Descreva o objetivo deste bot" rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
            <Button onClick={createBot} disabled={creating || !newName.trim()}>Criar e Editar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CrmBots;
