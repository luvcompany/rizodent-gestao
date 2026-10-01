import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface LeadScoreBadgeProps {
  score: number | null | undefined;
  compact?: boolean;
}

function getBand(score: number) {
  if (score >= 80) return { label: "VIP", className: "border-success/30 bg-success-soft text-success-soft-foreground" };
  if (score >= 60) return { label: "Quente", className: "border-destructive/30 bg-destructive-soft text-destructive-soft-foreground" };
  if (score >= 30) return { label: "Morno", className: "border-warning/30 bg-warning-soft text-warning-soft-foreground" };
  return { label: "Frio", className: "bg-muted text-muted-foreground border-border" };
}

export default function LeadScoreBadge({ score, compact }: LeadScoreBadgeProps) {
  const value = typeof score === "number" ? score : 0;
  const band = getBand(value);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${band.className}`}
        >
          <span>{value}</span>
          {!compact && <span className="opacity-70">· {band.label}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-[240px]">
        <div className="space-y-0.5">
          <div className="font-semibold">Health Score: {value}/100 ({band.label})</div>
          <div className="opacity-80">Calculado por: mensagens, agendamentos, dias inativo, cancelamentos e visitas à clínica.</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
