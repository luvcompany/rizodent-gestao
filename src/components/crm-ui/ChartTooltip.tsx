import * as React from "react";
import { cn } from "@/lib/utils";

/** Item do payload do Tooltip do recharts (subconjunto usado aqui). */
export interface ChartTooltipItem {
  name?: React.ReactNode;
  value?: number | string | ReadonlyArray<number | string>;
  color?: string;
  fill?: string;
  stroke?: string;
  dataKey?: string | number | ((obj: unknown) => unknown);
  payload?: unknown;
}

export type ChartTooltipFormatter = (
  value: ChartTooltipItem["value"],
  name: ChartTooltipItem["name"],
  item: ChartTooltipItem,
  index: number,
) => React.ReactNode | [React.ReactNode, React.ReactNode];

export interface ChartTooltipProps {
  /** Injetados pelo recharts quando usado em `<Tooltip content={<ChartTooltip />} />`. */
  active?: boolean;
  payload?: ReadonlyArray<ChartTooltipItem>;
  label?: React.ReactNode;
  /** Como o formatter do recharts: devolve o valor ou [valor, nome]. */
  formatter?: ChartTooltipFormatter;
  labelFormatter?: (label: React.ReactNode, payload: ReadonlyArray<ChartTooltipItem>) => React.ReactNode;
  /** Esconde o nome da série (útil com série única). */
  hideName?: boolean;
  /** Esconde o ponto de cor. */
  hideIndicator?: boolean;
  className?: string;
}

/**
 * Conteúdo de tooltip escuro em pílula (fundo da sidebar, que é sempre escura
 * na casca do CRM). Sem color-mix: seguro dentro do reportRef (html2canvas).
 */
export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
  hideName,
  hideIndicator,
  className,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const shownLabel = labelFormatter ? labelFormatter(label, payload) : label;

  return (
    <div
      className={cn(
        "rounded-lg bg-sidebar px-3 py-2 text-xs text-sidebar-active-foreground shadow-float",
        className,
      )}
    >
      {shownLabel != null && shownLabel !== "" ? (
        <div className="mb-1 text-[11px] text-sidebar-active-foreground/60">{shownLabel}</div>
      ) : null}
      <div className="space-y-0.5">
        {payload.map((item, i) => {
          let value: React.ReactNode = Array.isArray(item.value) ? item.value.join(" – ") : (item.value as React.ReactNode);
          let name: React.ReactNode = item.name;
          if (formatter) {
            const out = formatter(item.value, item.name, item, i);
            if (Array.isArray(out)) {
              value = out[0];
              name = out[1];
            } else {
              value = out;
            }
          }
          const dot = item.color || item.stroke || item.fill;
          return (
            <div key={i} className="flex items-center gap-2">
              {!hideIndicator && dot ? (
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} />
              ) : null}
              {!hideName && name != null && name !== "" ? (
                <span className="text-sidebar-active-foreground/60">{name}</span>
              ) : null}
              <span className="ml-auto text-xs font-semibold tabular-nums">{value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
