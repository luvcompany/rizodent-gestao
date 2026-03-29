import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Cpu, Pause, Play, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

interface Props {
  leadId: string;
}

export default function LeadAutomationPanel({ leadId }: Props) {
  const [execution, setExecution] = useState<any>(null);
  const [botName, setBotName] = useState("");
  const [nodeType, setNodeType] = useState("");
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    // Get lead automation_paused
    const { data: lead } = await supabase.from("crm_leads").select("automation_paused").eq("id", leadId).single();
    setPaused(!!(lead as any)?.automation_paused);

    // Get active execution
    const { data: exec } = await supabase
      .from("bot_executions")
      .select("*")
      .eq("lead_id", leadId)
      .in("status", ["active", "waiting_reply", "waiting_timeout"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    setExecution(exec);

    if (exec) {
      const { data: bot } = await supabase.from("bots").select("name").eq("id", exec.bot_id).single();
      setBotName(bot?.name || "?");
      if (exec.current_node_id) {
        const { data: node } = await supabase.from("bot_nodes").select("type").eq("id", exec.current_node_id).single();
        setNodeType(node?.type || "?");
      }
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [leadId]);

  const togglePause = async () => {
    const newVal = !paused;
    await supabase.from("crm_leads").update({ automation_paused: newVal } as any).eq("id", leadId);
    setPaused(newVal);
    toast.success(newVal ? "Automação pausada" : "Automação retomada");
  };

  const cancelExec = async () => {
    if (!execution) return;
    await supabase.from("bot_executions").update({ status: "cancelled", cancel_reason: "manual", finished_at: new Date().toISOString() }).eq("id", execution.id);
    setExecution(null);
    toast.success("Bot cancelado");
  };

  const statusLabel = (s: string) => {
    const m: Record<string, string> = { active: "Ativo", waiting_reply: "Aguardando resposta", waiting_timeout: "Aguardando timeout" };
    return m[s] || s;
  };

  if (loading) return null;

  return (
    <div className="p-4 border-b border-border">
      <h3 className="text-xs font-medium text-muted-foreground uppercase mb-2 flex items-center gap-1">
        <Cpu size={12} /> Automação
      </h3>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Pausar automação</span>
          <Switch checked={paused} onCheckedChange={togglePause} />
        </div>

        {execution ? (
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">{botName}</span>
              <Badge variant="secondary" className="text-[10px]">{statusLabel(execution.status)}</Badge>
            </div>
            <p className="text-[10px] text-muted-foreground">Nó atual: {nodeType}</p>
            <Button size="sm" variant="ghost" className="h-6 text-destructive text-xs gap-1 px-2" onClick={cancelExec}>
              <XCircle size={12} /> Cancelar bot
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Nenhum bot ativo</p>
        )}
      </div>
    </div>
  );
}
