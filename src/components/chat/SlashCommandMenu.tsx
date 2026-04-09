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
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-lg shadow-xl z-50 max-h-64 overflow-y-auto" ref={listRef}>
      <div className="px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border flex items-center gap-1.5">
        <Search size={10} /> Atalhos rápidos
      </div>
      {filteredItems.map((item, i) => (
        <button
          key={`${item.type}-${(item.data as any).id}`}
          className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
            i === selectedIndex ? "bg-primary/10 text-primary" : "hover:bg-muted/50 text-foreground"
          }`}
          onClick={() => {
            if (item.type === "template") onSelectTemplate(item.data as Template);
            else onSelectBot(item.data as BotItem);
          }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
            item.type === "template" ? "bg-blue-100 dark:bg-blue-900/30" : "bg-violet-100 dark:bg-violet-900/30"
          }`}>
            {item.type === "template" ? <FileText size={14} className="text-blue-500" /> : <Bot size={14} className="text-violet-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{item.label}</div>
            {item.desc && <div className="text-[11px] text-muted-foreground truncate">{item.desc}</div>}
          </div>
          <span className="text-[10px] text-muted-foreground uppercase">{item.type === "template" ? "Template" : "Bot"}</span>
        </button>
      ))}
    </div>
  );
}
