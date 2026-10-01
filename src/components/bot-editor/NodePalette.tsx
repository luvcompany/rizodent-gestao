import { NODE_DEFINITIONS, CATEGORY_LABELS, type NodeCategory } from "@/types/bot";

export default function NodePalette() {
  const categories = Object.entries(CATEGORY_LABELS).filter(([k]) => k !== "start") as [NodeCategory, string][];

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/botnode", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="flex h-full w-[180px] shrink-0 flex-col border-r border-border/60 bg-card sm:w-[220px]">
      <div className="border-b border-border/60 p-4">
        <h3 className="text-sm font-semibold text-foreground">Blocos</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {categories.map(([cat, label]) => {
          const nodes = NODE_DEFINITIONS.filter((n) => n.category === cat);
          if (nodes.length === 0) return null;
          return (
            <div key={cat}>
              <p className="mb-2 px-1 text-xs font-semibold text-muted-foreground">{label}</p>
              <div className="space-y-1.5">
                {nodes.map((def) => (
                  <div
                    key={def.type}
                    draggable
                    onDragStart={(e) => onDragStart(e, def.type)}
                    className="flex cursor-grab items-center gap-2 rounded-control border border-border/60 bg-card px-3 py-2.5 text-xs shadow-card transition-all hover:border-primary/40 hover:bg-primary-soft/30 active:cursor-grabbing"
                  >
                    <span className="text-sm">{def.icon}</span>
                    <span className="text-foreground font-medium truncate">{def.label}</span>
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
