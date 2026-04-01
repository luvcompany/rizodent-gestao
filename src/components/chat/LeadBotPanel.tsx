import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, Play, Square, Loader2 } from "lucide-react";

type Props = {
  leadId: string;
};

export default function LeadBotPanel({ leadId }: Props) {
  const [bots, setBots] = useState<{ id: string; name: string }[]>([]);
  const [selectedBotId, setSelectedBotId] = useState("");
  const [activeExecution, setActiveExecution] = useState<{
    id: string;
    status: string;
    bot_name?: string;
    current_node_id?: string;
  } | null>(null);
  const [starting, setStarting] = useState(false);

  // Fetch published bots
  useEffect(() => {
    supabase
      .from("bots")
      .select("id, name")
      .eq("status", "published")
      .order("name")
      .then(({ data }) => { if (data) setBots(data); });
  }, []);

  // Check for active execution
  const checkExecution = useCallback(async () => {
    const { data } = await supabase
      .from("bot_executions")
      .select("id, status, current_node_id, bots(name)")
      .eq("lead_id", leadId)
      .in("status", ["active", "waiting_reply"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setActiveExecution({
        id: data.id,
        status: data.status,
        bot_name: (data as any).bots?.name,
        current_node_id: data.current_node_id || undefined,
      });
    } else {
      setActiveExecution(null);
    }
  }, [leadId]);

  useEffect(() => { checkExecution(); }, [checkExecution]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`bot-exec-${leadId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "bot_executions",
        filter: `lead_id=eq.${leadId}`,
      }, () => checkExecution())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [leadId, checkExecution]);

  const handleStart = async () => {
    if (!selectedBotId) { toast.error("Selecione um bot"); return; }
    setStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke("bot-engine", {
        body: { leadId, botId: selectedBotId, trigger: "manual_start" },
      });
      if (error) throw error;
      toast.success("Bot iniciado!");
      setSelectedBotId("");
      checkExecution();
    } catch (err: any) {
      toast.error(err.message || "Erro ao iniciar bot");
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!activeExecution) return;
    await supabase
      .from("bot_executions")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", activeExecution.id);
    toast.success("Bot encerrado");
    setActiveExecution(null);
  };

  return (
    <div className="p-4 border-b border-border">
      <h3 className="text-xs font-medium text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
        <Bot size={12} /> Bot de Automação
      </h3>

      {activeExecution ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="default" className="gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Bot ativo
            </Badge>
            <span className="text-xs text-muted-foreground truncate">{activeExecution.bot_name}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Status: {activeExecution.status === "waiting_reply" ? "Aguardando resposta" : "Executando"}
          </p>
          <Button variant="destructive" size="sm" onClick={handleStop} className="w-full gap-1.5">
            <Square size={12} /> Encerrar Bot
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {bots.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum bot publicado</p>
          ) : (
            <>
              <Select value={selectedBotId} onValueChange={setSelectedBotId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecionar bot..." />
                </SelectTrigger>
                <SelectContent>
                  {bots.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleStart}
                disabled={!selectedBotId || starting}
                className="w-full gap-1.5"
              >
                {starting ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                Iniciar Bot
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
