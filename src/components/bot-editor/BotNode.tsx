import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_DEFINITIONS } from "@/types/bot";

function BotNode({ data, selected, type }: NodeProps) {
  const def = NODE_DEFINITIONS.find((d) => d.type === type) || NODE_DEFINITIONS[0];
  const isStart = type === "start";
  const isCondition = type === "condition";
  const isWaitReply = type === "wait_reply";
  const isSendText = type === "send_text";
  const isSendMenu = type === "send_menu";

  // Template with buttons → dynamic handles
  const templateButtons = (data.templateButtons as { id: string; title: string }[]) || [];
  const hasTemplateButtons = isSendText && templateButtons.length > 0;

  // Menu buttons or list options
  const menuType = (data.menuType as string) || "buttons";
  const menuButtons = (data.buttons as { id: string; title: string }[]) || [];
  const listSections = (data.listSections as { title: string; rows: { id: string; title: string }[] }[]) || [];
  const listRows = listSections.flatMap(s => s.rows);
  const menuItems = isSendMenu ? (menuType === "list" ? listRows : menuButtons) : [];
  const hasMenuButtons = isSendMenu && menuItems.length > 0;

  // Build preview text
  let preview = "";
  if (data.templateId && data.templateName) preview = `📄 ${String(data.templateName)}`;
  else if (data.text) preview = String(data.text as string).slice(0, 60);
  else if (data.note) preview = String(data.note as string).slice(0, 60);
  else if (data.tag) preview = `Tag: ${String(data.tag)}`;
  else if (data.title) preview = String(data.title as string).slice(0, 60);
  else if (data.caption) preview = String(data.caption as string).slice(0, 60);
  else if (data.bodyText) preview = String(data.bodyText as string).slice(0, 60);
  else if (data.audioUrl) preview = "🎵 Áudio gravado";
  else if (data.fileUrl) preview = "📁 Arquivo anexado";

  // Determine branching handles
  const branchHandles: { id: string; label: string; color: string }[] = [];

  if (isCondition) {
    branchHandles.push({ id: "true", label: "Sim", color: "#22c55e" });
    branchHandles.push({ id: "false", label: "Não", color: "#ef4444" });
  } else if (isWaitReply) {
    branchHandles.push({ id: "reply", label: "Resposta", color: "#22c55e" });
    branchHandles.push({ id: "timeout", label: "Timeout", color: "#f97316" });
  } else if (hasTemplateButtons) {
    templateButtons.forEach((btn) => {
      branchHandles.push({ id: `btn-${btn.id}`, label: btn.title, color: "#3b82f6" });
    });
    branchHandles.push({ id: "no-response", label: "Sem resposta", color: "#f97316" });
  } else if (hasMenuButtons) {
    menuButtons.forEach((btn) => {
      branchHandles.push({ id: `menu-${btn.id}`, label: btn.title, color: "#3b82f6" });
    });
    branchHandles.push({ id: "no-response", label: "Sem resposta", color: "#f97316" });
  }

  const hasBranching = branchHandles.length > 0;

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
        <span>{String(data.label || def.label)}</span>
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
      {hasBranching ? (
        <>
          {branchHandles.map((h, i) => {
            const total = branchHandles.length;
            const pct = ((i + 1) / (total + 1)) * 100;
            return (
              <Handle
                key={h.id}
                type="source"
                position={Position.Bottom}
                id={h.id}
                className="!w-3 !h-3 !border-2 !border-background"
                style={{ background: h.color, left: `${pct}%` }}
              />
            );
          })}
          <div className="flex justify-between px-2 pb-1 gap-1">
            {branchHandles.map((h) => (
              <span key={h.id} className="text-[9px] truncate text-center flex-1" style={{ color: h.color }}>
                {h.label}
              </span>
            ))}
          </div>
        </>
      ) : (
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
