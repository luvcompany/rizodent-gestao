import { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from "react";
import type React from "react";
import { FileText, Bot, MessageSquareText } from "lucide-react";
import { cleanTemplateName } from "@/lib/templateUtils";

/**
 * Menu do "/" no compositor do chat — CONV-1, CONV-2 (CRC-02).
 *
 * Grupos, nesta ordem: "Respostas rápidas" (crm_quick_replies: preenche a
 * caixa, não envia; também no Instagram), "Modelos" (só WhatsApp: abre a
 * confirmação do modelo) e "Bots" (se o compositor passar algum).
 *
 * Teclado: quem recebe as teclas é o CAMPO de texto, que as repassa a
 * `tratarTecla` (ref). Antes o menu escutava o Enter no `document`, DEPOIS do
 * handler do React: o Enter enviava "/con" ao paciente e só então o menu
 * agia. Agora, com o menu aberto, Enter/Tab/setas/Esc são do menu e o campo
 * não envia nada. Eventos já tratados por outro (defaultPrevented) são
 * ignorados.
 */

type Template = {
  id: string;
  name: string;
  body_text: string | null;
  category?: string | null;
};

type BotItem = {
  id: string;
  name: string;
  description: string | null;
};

export type RespostaRapida = {
  id: string;
  title: string;
  content: string;
};

type Item =
  | { type: "resposta"; data: RespostaRapida; label: string; desc: string }
  | { type: "template"; data: Template; label: string; desc: string }
  | { type: "bot"; data: BotItem; label: string; desc: string };

type Props = {
  query: string;
  respostas?: RespostaRapida[];
  templates: Template[];
  bots: BotItem[];
  onSelectResposta?: (resposta: RespostaRapida) => void;
  onSelectTemplate: (template: Template) => void;
  onSelectBot: (bot: BotItem) => void;
  onClose: () => void;
  visible: boolean;
};

export type SlashCommandMenuHandle = {
  /** Trata a tecla do campo. true = o menu usou a tecla (o campo não deve agir). */
  tratarTecla: (e: React.KeyboardEvent | KeyboardEvent) => boolean;
  /** Há item para escolher com o filtro atual. */
  temItens: () => boolean;
};

const ROTULO_DO_GRUPO: Record<Item["type"], string> = {
  resposta: "Respostas rápidas",
  template: "Modelos",
  bot: "Bots",
};

const SlashCommandMenu = forwardRef<SlashCommandMenuHandle, Props>(function SlashCommandMenu(
  { query, respostas = [], templates, bots, onSelectResposta, onSelectTemplate, onSelectBot, onClose, visible },
  ref,
) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredItems = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const rItems: Item[] = respostas
      .filter(r => r.title.toLowerCase().includes(q) || (r.content || "").toLowerCase().includes(q))
      .map(r => ({ type: "resposta", data: r, label: r.title, desc: r.content?.substring(0, 60) || "" }));
    const tItems: Item[] = templates
      .filter(t => t.name.toLowerCase().includes(q) || (t.body_text || "").toLowerCase().includes(q))
      .map(t => ({ type: "template", data: t, label: cleanTemplateName(t.name), desc: t.body_text?.substring(0, 60) || "" }));
    const bItems: Item[] = bots
      .filter(b => b.name.toLowerCase().includes(q) || (b.description || "").toLowerCase().includes(q))
      .map(b => ({ type: "bot", data: b, label: b.name, desc: b.description?.substring(0, 60) || "" }));
    return [...rItems, ...tItems, ...bItems];
  }, [query, respostas, templates, bots]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Mantém o item marcado à vista quando anda pelas setas.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-indice="${selectedIndex}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  const escolher = (item: Item) => {
    if (item.type === "resposta") onSelectResposta?.(item.data);
    else if (item.type === "template") onSelectTemplate(item.data);
    else onSelectBot(item.data);
  };

  useImperativeHandle(ref, () => ({
    temItens: () => visible && filteredItems.length > 0,
    tratarTecla: (e) => {
      if (!visible || e.defaultPrevented) return false;
      if (e.key === "Escape") {
        onClose();
        return true;
      }
      if (filteredItems.length === 0) return false;
      if (e.key === "ArrowDown") {
        setSelectedIndex(prev => Math.min(prev + 1, filteredItems.length - 1));
        return true;
      }
      if (e.key === "ArrowUp") {
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        return true;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        const item = filteredItems[Math.min(selectedIndex, filteredItems.length - 1)];
        if (item) escolher(item);
        return true;
      }
      return false;
    },
  }), [visible, filteredItems, selectedIndex, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible || filteredItems.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Atalhos do /"
      className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-64 overflow-y-auto rounded-xl border border-border/60 bg-card p-1 shadow-float"
      ref={listRef}
    >
      {filteredItems.map((item, i) => {
        const novoGrupo = i === 0 || filteredItems[i - 1].type !== item.type;
        return (
          <div key={`${item.type}-${item.data.id}`}>
            {novoGrupo && (
               <div className="sticky top-0 border-b border-border/60 bg-card px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {ROTULO_DO_GRUPO[item.type]}
              </div>
            )}
            <button
              type="button"
              role="option"
              aria-selected={i === selectedIndex}
              data-indice={i}
               className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                 i === selectedIndex ? "bg-primary-soft text-primary-soft-fg" : "text-foreground hover:bg-surface-sunken"
              }`}
              // Não tira o foco do campo ao clicar (a pessoa continua digitando).
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => escolher(item)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
               <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                item.type === "resposta"
                   ? "bg-success-soft"
                   : item.type === "template" ? "bg-info-soft" : "bg-purple-soft"
              }`}>
                 {item.type === "resposta" ? <MessageSquareText size={14} className="text-success" />
                   : item.type === "template" ? <FileText size={14} className="text-info" />
                   : <Bot size={14} className="text-purple" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{item.label}</div>
                {item.desc && <div className="text-[11px] text-muted-foreground truncate">{item.desc}</div>}
              </div>
               <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.type === "resposta" ? "bg-success-soft text-success-soft-foreground" : item.type === "template" ? "bg-info-soft text-info-soft-foreground" : "bg-purple-soft text-purple-soft-foreground"}`}>
                {item.type === "resposta" ? "Resposta" : item.type === "template" ? "Modelo" : "Bot"}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
});

export default SlashCommandMenu;
