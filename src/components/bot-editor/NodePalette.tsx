import { NODE_DEFINITIONS, CATEGORY_LABELS, type NodeCategory } from "@/types/bot";

export default function NodePalette() {
  const categories = Object.entries(CATEGORY_LABELS).filter(([k]) => k !== "start") as [NodeCategory, string][];

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/botnode", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="w-[220px] border-r border-border/60 bg-card flex flex-col h-full">
      <div className="px-4 pt-3.5 pb-2">
        <h3 className="text-[13px] font-semibold text-foreground">Blocos</h3>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-3.5 sm:px-3">
        {categories.map(([cat, label]) => {
          const nodes = NODE_DEFINITIONS.filter((n) => n.category === cat);
          if (nodes.length === 0) return null;
          return (
            <div key={cat}>
              <p className="text-[11px] font-semibold text-tertiary uppercase tracking-wider px-1 mb-1.5">{label}</p>
              <div className="space-y-1">
                {nodes.map((def) => (
                  <div
                    key={def.type}
                    draggable
                    onDragStart={(e) => onDragStart(e, def.type)}
                    className="flex items-center gap-1.5 sm:gap-2 min-h-9 px-1.5 py-1 rounded-xl border border-border/60 bg-card shadow-xs hover:border-primary/40 hover:shadow-card cursor-grab active:cursor-grabbing transition-all text-xs"
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[13px]"
                      style={{ backgroundColor: `color-mix(in srgb, ${def.color} 14%, transparent)` }}
                    >
                      {def.icon}
                    </span>
                    <span className="text-foreground font-medium leading-tight truncate">{def.label}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
