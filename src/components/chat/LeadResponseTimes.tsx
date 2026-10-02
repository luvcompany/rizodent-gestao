import { useMemo } from "react";
import { Timer, ArrowDown, ArrowUp } from "lucide-react";
import { temposDeResposta, type MensagemParaTempo } from "@/lib/temposDeResposta";

type Props = {
  messages: MensagemParaTempo[];
};

function formatDuration(ms: number): string {
  if (ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}min`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export default function LeadResponseTimes({ messages }: Props) {
  const { avgLeadResponse, avgUserResponse } = useMemo(() => temposDeResposta(messages), [messages]);

  if (messages.length < 2) return null;

  return (
    <div className="border-b border-border/60 px-5 py-5">
      <div className="mb-4 flex items-center gap-2">
        <Timer size={16} strokeWidth={1.75} className="shrink-0 text-tertiary" />
        <span className="text-[15px] font-semibold text-foreground">Tempo de Resposta Médio</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="min-w-0 rounded-xl border border-border/60 bg-surface-sunken/70 p-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <ArrowDown size={14} strokeWidth={1.75} className="shrink-0 text-info" />
            <span className="text-xs font-medium text-muted-foreground">Lead</span>
          </div>
          <span className="block text-xl font-bold leading-tight tracking-tight tabular-nums text-foreground">
            {avgLeadResponse >= 0 ? formatDuration(avgLeadResponse) : "—"}
          </span>
        </div>
        <div className="min-w-0 rounded-xl border border-border/60 bg-surface-sunken/70 p-3" title="Respostas enviadas por pessoas da equipe (bot e automações não contam)">
          <div className="mb-1.5 flex items-center gap-1.5">
            <ArrowUp size={14} strokeWidth={1.75} className="shrink-0 text-success" />
            <span className="text-xs font-medium text-muted-foreground">Equipe</span>
          </div>
          <span className="block text-xl font-bold leading-tight tracking-tight tabular-nums text-foreground">
            {avgUserResponse >= 0 ? formatDuration(avgUserResponse) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
