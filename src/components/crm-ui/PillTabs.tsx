import * as React from "react";
import { cn } from "@/lib/utils";
import { renderIcon, type IconLike } from "./icon";

export interface PillTabItem<T extends string | number> {
  value: T;
  label: React.ReactNode;
  count?: number | null;
  icon?: IconLike;
  disabled?: boolean;
  /** Nome acessível quando o rótulo é só ícone. */
  "aria-label"?: string;
}

export interface PillTabsProps<T extends string | number>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue"> {
  items: ReadonlyArray<PillTabItem<T>>;
  value: T;
  /** NoInfer: o tipo vem de items/value, então um setState serve direto. */
  onChange: (value: NoInfer<T>) => void;
  size?: "sm" | "md";
  /**
   * `tabs` (padrão): role=tablist/tab com aria-selected e setas do teclado.
   * `buttons`: role=group com <button aria-pressed>, para telas cujo controle
   * hoje é um grupo de botões e que precisam manter o papel "button" no
   * inventário de acessibilidade (regra "só muda a pele").
   */
  semantics?: "tabs" | "buttons";
}

/**
 * Controle segmentado em pílulas (NÃO é Radix). Para trocas que hoje são
 * botões: Kanban/Lista, Dia/Semana/Mês, 7/14/30 dias. Onde a tela já usa
 * Tabs do Radix, use `<Tabs variant="pill">` do kit (F2), nunca este
 * componente, e nenhum Select/Tabs existente é trocado por ele (decisão 1).
 */
function PillTabsInner<T extends string | number>(
  { items, value, onChange, size = "md", semantics = "tabs", className, onKeyDown, ...rest }: PillTabsProps<T>,
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  const btnRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const isTabs = semantics === "tabs";
  const selectedIndex = items.findIndex((it) => it.value === value);
  // Roving tabindex: a aba selecionada (ou a primeira habilitada) recebe o foco do Tab.
  const focusIndex =
    selectedIndex >= 0 && !items[selectedIndex].disabled ? selectedIndex : items.findIndex((it) => !it.disabled);

  const move = (from: number, dir: 1 | -1 | "first" | "last") => {
    const n = items.length;
    if (n === 0) return;
    let i = dir === "first" ? -1 : dir === "last" ? n : from;
    const step = dir === "first" ? 1 : dir === "last" ? -1 : dir;
    for (let k = 0; k < n; k++) {
      i = (i + step + n) % n;
      if (!items[i].disabled) {
        btnRefs.current[i]?.focus();
        if (items[i].value !== value) onChange(items[i].value);
        return;
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || !isTabs) return;
    const current = btnRefs.current.findIndex((b) => b === document.activeElement);
    if (current < 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") move(current, 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(current, -1);
    else if (e.key === "Home") move(current, "first");
    else if (e.key === "End") move(current, "last");
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      role={isTabs ? "tablist" : "group"}
      aria-orientation={isTabs ? "horizontal" : undefined}
      className={cn("inline-flex flex-wrap items-center gap-1", className)}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {items.map((it, i) => {
        const selected = it.value === value;
        const hasCount = typeof it.count === "number";
        return (
          <button
            key={String(it.value)}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role={isTabs ? "tab" : undefined}
            aria-selected={isTabs ? selected : undefined}
            aria-pressed={isTabs ? undefined : selected}
            aria-label={it["aria-label"]}
            tabIndex={isTabs ? (i === focusIndex ? 0 : -1) : undefined}
            disabled={it.disabled}
            data-state={selected ? "active" : "inactive"}
            onClick={() => {
              if (!selected) onChange(it.value);
            }}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
              size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-[13px]",
              selected
                ? "bg-primary text-primary-foreground shadow-brand"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {it.icon ? renderIcon(it.icon, size === "sm" ? 14 : 16) : null}
            {it.label}
            {hasCount ? (
              <span
                className={cn(
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                  selected ? "bg-primary-foreground/25 text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {it.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export const PillTabs = React.forwardRef(PillTabsInner) as (<T extends string | number>(
  props: PillTabsProps<T> & { ref?: React.Ref<HTMLDivElement> },
) => React.ReactElement | null) & { displayName?: string };
PillTabs.displayName = "PillTabs";
