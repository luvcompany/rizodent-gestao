import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { Trash2 } from "lucide-react";

export default function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  label,
  markerEnd,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const onDelete = data?.onDelete as ((id: string) => void) | undefined;

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={{ strokeWidth: 1.5, strokeDasharray: "5 4", ...style }} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -100%) translate(${labelX}px,${labelY - 8}px)`,
              pointerEvents: "none",
            }}
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-card border border-border/60 shadow-xs text-foreground"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY + (label ? 8 : 0)}px)`,
            pointerEvents: "all",
          }}
          className="group"
        >
          <button
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all flex items-center justify-center w-6 h-6 rounded-full bg-card border border-border/60 text-destructive shadow-float hover:bg-destructive-soft hover:scale-110 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(id);
            }}
            title="Excluir conexão"
          >
            <Trash2 size={10} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
