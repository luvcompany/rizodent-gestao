import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Clock, ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ehPapelSdr } from "@/lib/desfechoLabel";

type StageHistory = {
  id: string;
  stage_id: string;
  entered_at: string;
  exited_at: string | null;
  /** Motivo escolhido ao desqualificar (só nas passagens para Desqualificado). */
  motivo?: string | null;
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
  // ==========================================================================
  // SIGILO DO CONTRATO (10/09/2026)
  // Este painel imprime o NOME de cada etapa por onde o lead passou e, para as
  // etapas que o papel não enxerga, busca o nome em get_lead_stage_history_names
  // — RPC SECURITY DEFINER que não filtra `visivel_para_sdr`. Resultado: a SDR
  // lia "Contratado" / "Não contratado" em texto puro no histórico de um lead
  // dela. Não é caso de laboratório: o dontus-sync move o lead pago para a etapa
  // de ganho enquanto ele ainda está com ela na carência de 24 h.
  //
  // O dono foi explícito: a SDR nunca lê se o lead contratou. Então, para o
  // papel 'sdr', o painel não existe — nem histórico, nem RPC.
  //
  // O teste é "mostra só para quem NÃO é SDR com papel já resolvido", e não
  // "esconde quando for SDR": no boot o papel chega nulo por um instante e a
  // segunda forma vazaria justamente nesse instante (mesma armadilha do guard
  // de rota que expulsava o closer da própria home). Quem não é SDR só perde o
  // painel por esse piscar, e ele volta sozinho quando o papel resolve.
  // ==========================================================================
  const { userRole, roleResolved } = useAuth();
  const podeVerHistorico = roleResolved && !ehPapelSdr(userRole);

  const [history, setHistory] = useState<StageHistory[]>([]);
  const [extraStages, setExtraStages] = useState<Record<string, Stage>>({});

  useEffect(() => {
    if (!podeVerHistorico) return;
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
  }, [leadId, podeVerHistorico]);

  // Fetch names for any stage_id not present in the current pipeline's stages prop
  // (happens when the lead was moved across pipelines, e.g. to Pós-venda).
  // Uses an RPC that bypasses pipeline-access RLS so stages from other funnels resolve correctly.
  useEffect(() => {
    if (!podeVerHistorico) return;
    const knownIds = new Set(stages.map((s) => s.id));
    const missing = Array.from(
      new Set(history.map((h) => h.stage_id).filter((id) => id && !knownIds.has(id) && !extraStages[id]))
    );
    if (missing.length === 0) return;
    (async () => {
      const { data } = await supabase.rpc("get_lead_stage_history_names", { _lead_id: leadId });
      if (data) {
        setExtraStages((prev) => {
          const next = { ...prev };
          for (const s of data as Stage[]) next[s.id] = s;
          return next;
        });
      }
    })();
  }, [history, stages, extraStages, leadId, podeVerHistorico]);


  // Guard depois dos hooks (a ordem deles não pode variar entre renders).
  if (!podeVerHistorico) return null;

  const resolveStage = (stageId: string): Stage | undefined =>
    stages.find((s) => s.id === stageId) || extraStages[stageId];
  const getStageName = (stageId: string) => resolveStage(stageId)?.name || "Desconhecida";
  const getStageColor = (stageId: string) => resolveStage(stageId)?.color || "hsl(var(--slate))";

  return (
    <section className="border-b border-border/60 px-5 py-5">
      <div className="mb-3 flex items-center gap-2">
        <Clock size={14} className="text-muted-foreground" />
        <h3 className="text-[15px] font-semibold text-foreground">Histórico de etapas</h3>
      </div>

      {/* Time since last inbound message */}
      {lastInboundAt && (
        <div className="mb-4 rounded-xl bg-surface-sunken p-3 text-sm">
          <span className="text-muted-foreground">Última msg do lead: </span>
          <span className="font-medium text-foreground">{formatRelativeTime(lastInboundAt)}</span>
        </div>
      )}

      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem histórico de etapas.</p>
      ) : (
        <div className="relative space-y-0 before:absolute before:bottom-3 before:left-[5px] before:top-3 before:w-px before:bg-border">
          {history.map((h, i) => {
            const duration = h.exited_at
              ? new Date(h.exited_at).getTime() - new Date(h.entered_at).getTime()
              : Date.now() - new Date(h.entered_at).getTime();

            return (
              <div key={h.id} className="relative pb-4 pl-6 text-xs last:pb-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className="absolute left-0 top-1 h-3 w-3 flex-shrink-0 rounded-full ring-4 ring-card"
                  style={{ backgroundColor: getStageColor(h.stage_id) }}
                />
                <span className="break-words font-semibold text-foreground">
                  {getStageName(h.stage_id)}
                </span>
                <span className="text-muted-foreground">
                  {formatDuration(duration)}
                </span>
                {!h.exited_at && (
                  <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary-soft-foreground">(atual)</span>
                )}
              </div>
              {h.motivo && (
                <p className="mt-1 text-[11px] text-muted-foreground">Motivo: {h.motivo}</p>
              )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
