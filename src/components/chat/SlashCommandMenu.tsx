import { useState, useEffect, useRef, useMemo } from "react";
import { FileText, Bot, Search } from "lucide-react";
import { cleanTemplateName } from "@/lib/templateUtils";

type Template = {
  id: string;
  name: string;
  body_text: string | null;
  category: string;
};

type BotItem = {
  id: string;
  name: string;
  description: string | null;
};

type Props = {
  query: string;
  templates: Template[];
  bots: BotItem[];
  onSelectTemplate: (template: Template) => void;
  onSelectBot: (bot: BotItem) => void;
  onClose: () => void;
  visible: boolean;
};

export default function SlashCommandMenu({ query, templates, bots, onSelectTemplate, onSelectBot, onClose, visible }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredItems = useMemo(() => {
    const q = query.toLowerCase();
    const tItems = templates
      .filter(t => t.name.toLowerCase().includes(q) || (t.body_text || "").toLowerCase().includes(q))
      .map(t => ({ type: "template" as const, data: t, label: cleanTemplateName(t.name), desc: t.body_text?.substring(0, 60) || "" }));
    const bItems = bots
      .filter(b => b.name.toLowerCase().includes(q) || (b.description || "").toLowerCase().includes(q))
      .map(b => ({ type: "bot" as const, data: b, label: b.name, desc: b.description?.substring(0, 60) || "" }));
    return [...tItems, ...bItems];
  }, [query, templates, bots]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visible) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, filteredItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && filteredItems.length > 0) {
        e.preventDefault();
        const item = filteredItems[selectedIndex];
        if (item.type === "template") onSelectTemplate(item.data as Template);
        else onSelectBot(item.data as BotItem);
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visible, filteredItems, selectedIndex, onSelectTemplate, onSelectBot, onClose]);

  if (!visible || filteredItems.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-72 overflow-y-auto rounded-2xl border border-border/60 bg-card p-1.5 shadow-float" ref={listRef}>
      <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Search size={10} /> Atalhos rápidos
      </div>
      {filteredItems.map((item, i) => (
        <button
          key={`${item.type}-${(item.data as any).id}`}
          className={`mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
            i === selectedIndex ? "bg-primary-soft text-primary-soft-foreground" : "text-foreground hover:bg-surface-sunken"
          }`}
          onClick={() => {
            if (item.type === "template") onSelectTemplate(item.data as Template);
            else onSelectBot(item.data as BotItem);
          }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-control ${
            item.type === "template" ? "bg-info-soft text-info-soft-foreground" : "bg-purple-soft text-purple-soft-foreground"
          }`}>
            {item.type === "template" ? <FileText size={14} /> : <Bot size={14} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{item.label}</div>
            {item.desc && <div className="text-[11px] text-muted-foreground truncate">{item.desc}</div>}
          </div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${item.type === "template" ? "bg-info-soft text-info-soft-foreground" : "bg-purple-soft text-purple-soft-foreground"}`}>{item.type === "template" ? "Template" : "Bot"}</span>
        </button>
      ))}
    </div>
  );
}
