import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  leadId: string;
}

export default function LeadFollowUpPanel({ leadId }: Props) {
  const [queue, setQueue] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("crm_followup_queue")
      .select("*")
      .eq("lead_id", leadId)
      .in("status", ["waiting_disparo1", "waiting_disparo2", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setQueue(data);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [leadId]);

  const togglePause = async () => {
    if (!queue) return;
    const newStatus = queue.status === "paused" ? "waiting_disparo1" : "paused";
    await supabase.from("crm_followup_queue").update({
      status: newStatus,
      updated_at: new Date().toISOString(),
    }).eq("id", queue.id);
    setQueue((prev: any) => ({ ...prev, status: newStatus }));
    toast.success(newStatus === "paused" ? "Follow up pausado" : "Follow up retomado");
  };

  if (loading || !queue) return null;

  const statusLabel: Record<string, string> = {
    waiting_disparo1: "Aguardando disparo 1",
    waiting_disparo2: "Aguardando disparo 2",
    paused: "Pausado",
  };

  const nextDisparo = queue.status === "waiting_disparo1"
    ? queue.disparo1_scheduled_at
    : queue.disparo2_scheduled_at;

  return (
    <div className="p-4 border-b border-border">
      <h3 className="text-xs font-medium text-muted-foreground uppercase mb-2 flex items-center gap-1">
        <RefreshCw size={12} /> Follow Up
      </h3>
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-foreground">Follow Up Ativo</span>
          <Badge variant="secondary" className="text-[10px]">
            {statusLabel[queue.status] || queue.status}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Tentativas: {queue.attempt_count || 0}
        </p>
        {nextDisparo && (
          <p className="text-[10px] text-muted-foreground">
            Próximo disparo: {new Date(nextDisparo).toLocaleString("pt-BR")}
          </p>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs gap-1 px-2"
          onClick={togglePause}
        >
          {queue.status === "paused" ? (
            <><Play size={12} className="text-green-500" /> Retomar</>
          ) : (
            <><Pause size={12} className="text-amber-500" /> Pausar</>
          )}
        </Button>
      </div>
    </div>
  );
}
