import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_DEFINITIONS } from "@/types/bot";

function BotNode({ data, selected, type }: NodeProps) {
  const def = NODE_DEFINITIONS.find((d) => d.type === type) || NODE_DEFINITIONS[0];
  const isStart = type === "start";
  const isCondition = type === "condition";
  const isWaitReply = type === "wait_reply";

  // Build preview text
  let preview = "";
  if (data.text) preview = String(data.text).slice(0, 60);
  else if (data.note) preview = String(data.note).slice(0, 60);
  else if (data.tag) preview = `Tag: ${data.tag}`;
  else if (data.title) preview = String(data.title).slice(0, 60);
  else if (data.caption) preview = String(data.caption).slice(0, 60);

  return (
    <div
      className={`min-w-[220px] max-w-[280px] rounded-lg border-2 shadow-lg transition-all ${
        selected ? "border-primary ring-2 ring-primary/20" : "border-border"
      }`}
      style={{ background: "hsl(var(--card))" }}
    >
      {/* Input handle */}
      {!isStart && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !border-2 !border-background"
          style={{ background: def.color }}
        />
      )}

      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-t-md text-xs font-semibold"
        style={{ background: def.color, color: "#fff" }}
      >
        <span>{def.icon}</span>
        <span>{data.label || def.label}</span>
      </div>

      {/* Body */}
      <div className="px-3 py-2 min-h-[32px]">
        {preview ? (
          <p className="text-xs text-muted-foreground truncate">{preview}</p>
        ) : (
          <p className="text-xs text-muted-foreground/50 italic">Clique para configurar</p>
        )}
      </div>

      {/* Output handles */}
      {isCondition ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="true"
            className="!w-3 !h-3 !border-2 !border-background !left-[30%]"
            style={{ background: "#22c55e" }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            className="!w-3 !h-3 !border-2 !border-background !left-[70%]"
            style={{ background: "#ef4444" }}
          />
          <div className="flex justify-between px-3 pb-1">
            <span className="text-[10px] text-green-400">Sim</span>
            <span className="text-[10px] text-red-400">Não</span>
          </div>
        </>
      ) : isWaitReply ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="reply"
            className="!w-3 !h-3 !border-2 !border-background !left-[30%]"
            style={{ background: "#22c55e" }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="timeout"
            className="!w-3 !h-3 !border-2 !border-background !left-[70%]"
            style={{ background: "#f97316" }}
          />
          <div className="flex justify-between px-3 pb-1">
            <span className="text-[10px] text-green-400">Resposta</span>
            <span className="text-[10px] text-orange-400">Timeout</span>
          </div>
        </>
      ) : (
        !isStart || true) && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !border-2 !border-background"
          style={{ background: def.color }}
        />
      )}
    </div>
  );
}

export default memo(BotNode);
