import { NODE_DEFINITIONS, CATEGORY_LABELS, type NodeCategory } from "@/types/bot";

export default function NodePalette() {
  const categories = Object.entries(CATEGORY_LABELS).filter(([k]) => k !== "start") as [NodeCategory, string][];

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/botnode", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="w-[220px] border-r border-border bg-card flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Blocos</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {categories.map(([cat, label]) => {
          const nodes = NODE_DEFINITIONS.filter((n) => n.category === cat);
          if (nodes.length === 0) return null;
          return (
            <div key={cat}>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1.5">{label}</p>
              <div className="space-y-1">
                {nodes.map((def) => (
                  <div
                    key={def.type}
                    draggable
                    onDragStart={(e) => onDragStart(e, def.type)}
                    className="flex items-center gap-2 px-2 py-2 rounded-md border border-border bg-secondary/50 hover:border-primary/30 cursor-grab active:cursor-grabbing transition-colors text-xs"
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
