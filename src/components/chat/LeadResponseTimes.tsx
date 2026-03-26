import { useMemo } from "react";
import { Timer, ArrowDown, ArrowUp } from "lucide-react";

type Message = {
  id: string;
  direction: string;
  created_at: string;
  status: string;
};

type Props = {
  messages: Message[];
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
  const { avgLeadResponse, avgUserResponse } = useMemo(() => {
    const sorted = [...messages]
      .filter((m) => m.status !== "system")
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const leadDeltas: number[] = [];
    const userDeltas: number[] = [];

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const delta = new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();

      // Lead responded after user message
      if (prev.direction === "outbound" && curr.direction === "inbound") {
        leadDeltas.push(delta);
      }
      // User responded after lead message
      if (prev.direction === "inbound" && curr.direction === "outbound") {
        userDeltas.push(delta);
      }
    }

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : -1;

    return {
      avgLeadResponse: avg(leadDeltas),
      avgUserResponse: avg(userDeltas),
    };
  }, [messages]);

  if (messages.length < 2) return null;

  return (
    <div className="p-4 border-b border-border">
      <div className="flex items-center gap-2 mb-2">
        <Timer size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase">Tempo de Resposta Médio</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="p-2 bg-secondary/50 rounded text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <ArrowDown size={12} className="text-blue-500" />
            <span className="text-[10px] text-muted-foreground uppercase">Lead</span>
          </div>
          <span className="font-semibold text-sm text-foreground">
            {avgLeadResponse >= 0 ? formatDuration(avgLeadResponse) : "—"}
          </span>
        </div>
        <div className="p-2 bg-secondary/50 rounded text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <ArrowUp size={12} className="text-green-500" />
            <span className="text-[10px] text-muted-foreground uppercase">Você</span>
          </div>
          <span className="font-semibold text-sm text-foreground">
            {avgUserResponse >= 0 ? formatDuration(avgUserResponse) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
