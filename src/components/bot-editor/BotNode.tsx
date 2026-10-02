import { memo, useState, useRef, useEffect } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_DEFINITIONS } from "@/types/bot";
import { MoreVertical, Copy, Trash2 } from "lucide-react";

function BotNode({ data, selected, type, id }: NodeProps) {
  const def = NODE_DEFINITIONS.find((d) => d.type === type) || NODE_DEFINITIONS[0];
  const isStart = type === "start";
  const isCondition = type === "condition";
  const isWaitReply = type === "wait_reply";
  const isSendText = type === "send_text";
  const isSendMenu = type === "send_menu";
  const isHighlighted = !!(data as any)._highlighted;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const templateButtons = (data.templateButtons as { id: string; title: string }[]) || [];
  const hasTemplateButtons = isSendText && templateButtons.length > 0;

  const menuType = (data.menuType as string) || "buttons";
  const menuButtons = (data.buttons as { id: string; title: string }[]) || [];
  const listSections = (data.listSections as { title: string; rows: { id: string; title: string }[] }[]) || [];
  const listRows = listSections.flatMap(s => s.rows);
  const menuItems = isSendMenu ? (menuType === "list" ? listRows : menuButtons) : [];
  const hasMenuButtons = isSendMenu && menuItems.length > 0;

  let preview = "";
  if (isWaitReply && data.saveToField) preview = `💾 [${String(data.saveToField)}]`;
  else if (data.templateId && data.templateName) preview = `📄 ${String(data.templateName)}`;
  else if (data.text) preview = String(data.text as string).slice(0, 60);
  else if (data.note) preview = String(data.note as string).slice(0, 60);
  else if (data.tag) preview = `Tag: ${String(data.tag)}`;
  else if (data.title) preview = String(data.title as string).slice(0, 60);
  else if (data.caption) preview = String(data.caption as string).slice(0, 60);
  else if (data.bodyText) preview = String(data.bodyText as string).slice(0, 60);
  else if (data.audioUrl) preview = "🎵 Áudio gravado";
  else if (data.fileUrl) preview = "📁 Arquivo anexado";

  const branchHandles: { id: string; label: string; color: string }[] = [];

  if (isCondition) {
    branchHandles.push({ id: "true", label: "Sim", color: "#22c55e" });
    branchHandles.push({ id: "false", label: "Não", color: "#ef4444" });
  } else if (isWaitReply) {
    branchHandles.push({ id: "reply", label: "Resposta", color: "#22c55e" });
    branchHandles.push({ id: "timeout", label: "Timeout", color: "hsl(var(--warning))" });
  } else if (isSendText) {
    if (hasTemplateButtons) {
      templateButtons.forEach((btn) => {
        branchHandles.push({ id: `btn-${btn.id}`, label: btn.title, color: "#3b82f6" });
      });
    }
    branchHandles.push({ id: "reply", label: "Resposta", color: "#22c55e" });
    branchHandles.push({ id: "timeout", label: "Timeout", color: "hsl(var(--warning))" });
  } else if (isSendMenu) {
    if (hasMenuButtons) {
      menuItems.forEach((btn) => {
        branchHandles.push({ id: `menu-${btn.id}`, label: btn.title || "Opção", color: "#3b82f6" });
      });
    }
    branchHandles.push({ id: "reply", label: "Resposta", color: "#22c55e" });
    branchHandles.push({ id: "timeout", label: "Timeout", color: "hsl(var(--warning))" });
  }

  const hasBranching = branchHandles.length > 0;

  return (
    <div
      className={`min-w-[220px] max-w-[280px] rounded-xl bg-card transition-all ${
        isHighlighted
          ? "border-2 border-success ring-4 ring-success/30 shadow-float scale-105"
          : selected
            ? "border-2 border-primary ring-2 ring-primary/40 shadow-float"
            : "border border-border/70 shadow-crm-card hover:shadow-float"
      }`}
      style={{ background: "hsl(var(--card))" }}
    >
      {!isStart && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-2.5 !h-2.5 !border-2 !border-card !shadow-xs"
          style={{ background: def.color }}
        />
      )}

      {/* Header */}
      <div
        className="flex items-center gap-2 min-h-9 px-2.5 py-1.5 rounded-t-[11px] text-[13px] font-semibold leading-tight relative"
        style={{ background: def.color, color: "#fff" }}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/20 text-xs">{def.icon}</span>
        <span className="flex-1">{String(data.label || def.label)}</span>
        {!isStart && (
          <div ref={menuRef} className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              className="p-1 rounded-md hover:bg-white/20 transition-colors"
            >
              <MoreVertical size={14} />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-50 min-w-[150px] rounded-xl border shadow-float p-1"
                style={{ background: "hsl(var(--popover))", borderColor: "hsl(var(--border))" }}
              >
                <button
                  className="flex items-center gap-2 w-full h-8 px-2.5 rounded-lg text-xs font-medium hover:bg-accent text-popover-foreground transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    (data as any).onDuplicate?.(id);
                  }}
                >
                  <Copy size={12} /> Duplicar
                </button>
                <button
                  className="flex items-center gap-2 w-full h-8 px-2.5 rounded-lg text-xs font-medium hover:bg-destructive-soft text-destructive transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    (data as any).onDeleteNode?.(id);
                  }}
                >
                  <Trash2 size={12} /> Excluir
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 min-h-[36px]">
        {(data.description as string) && (
          <p className="text-[11px] font-medium text-foreground/80 mb-1">{String(data.description).slice(0, 50)}</p>
        )}
        {preview ? (
          <p className="text-xs text-muted-foreground truncate">{preview}</p>
        ) : (
          <p className="text-xs text-tertiary italic">Clique para configurar</p>
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
                className="!w-2.5 !h-2.5 !border-2 !border-card !shadow-xs"
                style={{ background: h.color, left: `${pct}%` }}
              />
            );
          })}
          <div className="flex justify-between px-2 pb-1 gap-1">
            {branchHandles.map((h) => (
              <span key={h.id} className="text-[10px] font-semibold truncate text-center flex-1" style={{ color: h.color }}>
                {h.label}
              </span>
            ))}
          </div>
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-2.5 !h-2.5 !border-2 !border-card !shadow-xs"
          style={{ background: def.color }}
        />
      )}
    </div>
  );
}

export default memo(BotNode);
