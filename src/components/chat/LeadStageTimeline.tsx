import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Clock, ArrowRight } from "lucide-react";

type StageHistory = {
  id: string;
  stage_id: string;
  entered_at: string;
  exited_at: string | null;
};

type Stage = {
  id: string;
  name: string;
  color: string;
};

type Props = {
  leadId: string;
  stages: Stage[];
  lastInboundAt: string | null; // timestamp of last inbound message
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}min`;
  const days = Math.floor(hours / 24);
  if (days === 1) return `1 dia`;
  return `${days} dias`;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  return formatDuration(diff) + " atrás";
}

export default function LeadStageTimeline({ leadId, stages, lastInboundAt }: Props) {
  const [history, setHistory] = useState<StageHistory[]>([]);
  const [extraStages, setExtraStages] = useState<Record<string, Stage>>({});

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from("crm_lead_stage_history")
        .select("*")
        .eq("lead_id", leadId)
        .order("entered_at", { ascending: true });
      if (data) setHistory(data as StageHistory[]);
    };
    fetch();

    // Use realtime instead of polling
    const channel = supabase
      .channel(`stage-history-${leadId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "crm_lead_stage_history",
        filter: `lead_id=eq.${leadId}`,
      }, () => fetch())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [leadId]);

  // Fetch names for any stage_id not present in the current pipeline's stages prop
  // (happens when the lead was moved across pipelines, e.g. to Pós-venda).
  useEffect(() => {
    const knownIds = new Set(stages.map((s) => s.id));
    const missing = Array.from(
      new Set(history.map((h) => h.stage_id).filter((id) => id && !knownIds.has(id) && !extraStages[id]))
    );
    if (missing.length === 0) return;
    (async () => {
      const { data } = await supabase
        .from("crm_stages")
        .select("id,name,color")
        .in("id", missing);
      if (data) {
        setExtraStages((prev) => {
          const next = { ...prev };
          for (const s of data as Stage[]) next[s.id] = s;
          return next;
        });
      }
    })();
  }, [history, stages, extraStages]);

  const resolveStage = (stageId: string): Stage | undefined =>
    stages.find((s) => s.id === stageId) || extraStages[stageId];
  const getStageName = (stageId: string) => resolveStage(stageId)?.name || "Desconhecida";
  const getStageColor = (stageId: string) => resolveStage(stageId)?.color || "#6366f1";

  return (
    <div className="p-4 border-b border-border">
      <div className="flex items-center gap-2 mb-2">
        <Clock size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase">Histórico de Etapas</span>
      </div>

      {/* Time since last inbound message */}
      {lastInboundAt && (
        <div className="mb-3 p-2 bg-secondary/50 rounded text-sm">
          <span className="text-muted-foreground">Última msg do lead: </span>
          <span className="font-medium text-foreground">{formatRelativeTime(lastInboundAt)}</span>
        </div>
      )}

      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem histórico de etapas.</p>
      ) : (
        <div className="space-y-1">
          {history.map((h, i) => {
            const duration = h.exited_at
              ? new Date(h.exited_at).getTime() - new Date(h.entered_at).getTime()
              : Date.now() - new Date(h.entered_at).getTime();

            return (
              <div key={h.id} className="flex items-center gap-2 text-xs">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getStageColor(h.stage_id) }}
                />
                <span className="font-medium text-foreground truncate">
                  {getStageName(h.stage_id)}
                </span>
                <span className="text-muted-foreground">
                  {formatDuration(duration)}
                </span>
                {!h.exited_at && (
                  <span className="text-primary text-[10px] font-semibold">(atual)</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
