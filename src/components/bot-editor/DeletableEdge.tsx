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
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -100%) translate(${labelX}px,${labelY - 8}px)`,
              pointerEvents: "none",
            }}
            className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-card border border-border shadow-sm text-foreground"
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
            className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-5 h-5 rounded-full bg-destructive text-destructive-foreground shadow-md hover:scale-110 transition-transform cursor-pointer"
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
