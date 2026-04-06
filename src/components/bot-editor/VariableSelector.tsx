import { useEffect, useRef, useState, useMemo } from "react";
import { LEAD_VARIABLES } from "@/types/bot";

type Props = {
  inputRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement>;
  value: string;
  onChange: (value: string) => void;
  extraVariables?: { key: string; label: string; example: string }[];
};

export default function VariableSelector({ inputRef, value, onChange, extraVariables = [] }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [cursorPos, setCursorPos] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const allVariables = useMemo(() => {
    const combined = [...LEAD_VARIABLES];
    for (const ev of extraVariables) {
      if (!combined.find(v => v.key === ev.key)) {
        combined.push(ev);
      }
    }
    return combined;
  }, [extraVariables]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    const handleInput = () => {
      const pos = el.selectionStart || 0;
      const textBefore = el.value.substring(0, pos);
      const lastBracket = textBefore.lastIndexOf("[");

      if (lastBracket !== -1 && !textBefore.substring(lastBracket).includes("]")) {
        const searchText = textBefore.substring(lastBracket + 1);
        setSearch(searchText.toLowerCase());
        setCursorPos(pos);
        setOpen(true);

        const rect = el.getBoundingClientRect();
        setPosition({ top: rect.bottom + 4, left: rect.left });
      } else {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    el.addEventListener("input", handleInput);
    el.addEventListener("keydown", handleKeyDown);
    return () => {
      el.removeEventListener("input", handleInput);
      el.removeEventListener("keydown", handleKeyDown);
    };
  }, [inputRef]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const filtered = allVariables.filter(
    (v) => v.key.toLowerCase().includes(search) || v.label.toLowerCase().includes(search)
  );

  // Group: lead variables vs custom
  const leadVars = filtered.filter(v => v.key.startsWith("lead.") || v.key.startsWith("data.") || v.key === "resposta.ultima");
  const customVars = filtered.filter(v => !v.key.startsWith("lead.") && !v.key.startsWith("data.") && v.key !== "resposta.ultima");

  const selectVariable = (variable: typeof LEAD_VARIABLES[0]) => {
    const el = inputRef.current;
    if (!el) return;

    const textBefore = value.substring(0, cursorPos);
    const lastBracket = textBefore.lastIndexOf("[");
    const textAfter = value.substring(cursorPos);

    const newValue = textBefore.substring(0, lastBracket) + `[${variable.key}]` + textAfter;
    onChange(newValue);
    setOpen(false);

    setTimeout(() => {
      const newPos = lastBracket + variable.key.length + 2;
      el.focus();
      el.setSelectionRange(newPos, newPos);
    }, 10);
  };

  if (!open || filtered.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-popover border border-border rounded-lg shadow-lg max-h-56 overflow-y-auto w-64"
      style={{ top: position.top, left: position.left }}
    >
      <div className="p-1">
        {customVars.length > 0 && (
          <>
            <p className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase">Variáveis do Bot</p>
            {customVars.map((v) => (
              <button
                key={v.key}
                type="button"
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent rounded-md flex items-center justify-between gap-2"
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectVariable(v);
                }}
              >
                <span className="font-medium text-foreground">💾 [{v.key}]</span>
                <span className="text-muted-foreground truncate">{v.label}</span>
              </button>
            ))}
          </>
        )}
        {leadVars.length > 0 && (
          <>
            {customVars.length > 0 && <div className="border-t border-border my-1" />}
            <p className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase">Variáveis do Lead</p>
            {leadVars.map((v) => (
              <button
                key={v.key}
                type="button"
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent rounded-md flex items-center justify-between gap-2"
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectVariable(v);
                }}
              >
                <span className="font-medium text-foreground">[{v.key}]</span>
                <span className="text-muted-foreground truncate">{v.label}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
