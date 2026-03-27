import { ArrowRight, Edit } from "lucide-react";

type Props = {
  content: string;
  timestamp: string;
  stageColor?: string | null;
};

export default function ChatActivitySeparator({ content, timestamp, stageColor }: Props) {
  const isStageChange = content.includes("Etapa alterada");
  const time = new Date(timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  // Extract destination stage name from "Etapa alterada: X → Y"
  const destStageName = isStageChange ? content.split("→").pop()?.trim() : null;

  return (
    <div className="flex items-center gap-3 py-2 select-none">
      <div className="flex-1 h-px bg-border" />
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-secondary/80 px-3 py-1 rounded-full">
          {isStageChange ? <ArrowRight size={12} /> : <Edit size={12} />}
          <span>{content}</span>
          <span className="text-muted-foreground/60">· {time}</span>
        </div>
        {isStageChange && stageColor && (
          <div className="flex items-center gap-1.5">
            <div
              className="h-2 w-10 rounded-full"
              style={{ backgroundColor: stageColor }}
            />
            {destStageName && (
              <span className="text-[10px] font-medium" style={{ color: stageColor }}>
                {destStageName}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}
