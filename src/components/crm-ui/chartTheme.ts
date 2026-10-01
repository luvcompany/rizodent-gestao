import type * as React from "react";
import { isTone, toneColor, type Tone } from "./tones";

/**
 * Tema de gráficos (recharts) do redesign, lido dos tokens do F1.
 *
 * Mantém a MESMA API do src/hooks/useChartTheme.ts (axisColor, gridColor,
 * labelColor, tooltipStyle, tooltipLabelStyle, tooltipItemStyle, brandSeries,
 * isDark) para que o hook antigo possa ser trocado por este sem mudar os
 * consumidores, e acrescenta gridProps, axisProps, barRadius, activeBar,
 * areaGradientStops e lineProps.
 *
 * Todos os valores são `hsl(var(--token))`: acompanham a marca e o tema sem
 * recalcular. Sem color-mix (seguro no html2canvas de /relatorios).
 */

/** Branco do texto sobre o fundo escuro da sidebar; fora da casca cai no foreground. */
const ON_DARK = "var(--sidebar-active-foreground, var(--foreground))";

export const CHART_SERIES = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-6))",
  "hsl(var(--chart-7))",
  "hsl(var(--chart-8))",
] as const;

export interface GradientStop {
  offset: string;
  stopColor: string;
  stopOpacity: number;
}

/** Cor de uma tone OU um valor CSS pronto (ex.: CHART_SERIES[2]). */
function resolveColor(toneOrColor: Tone | string | undefined): string {
  if (!toneOrColor) return toneColor("primary");
  return isTone(toneOrColor) ? toneColor(toneOrColor) : toneOrColor;
}

/** Degradê de área: cor a 18% no topo até 0% embaixo (`<stop {...s} />`). */
export function areaGradientStops(toneOrColor?: Tone | string, from = 0.18): GradientStop[] {
  const stopColor = resolveColor(toneOrColor);
  return [
    { offset: "0%", stopColor, stopOpacity: from },
    { offset: "100%", stopColor, stopOpacity: 0 },
  ];
}

export function buildCrmChartTheme(isDark: boolean) {
  const axisColor = "hsl(var(--text-tertiary))";
  const gridColor = "hsl(var(--border))";
  const labelColor = "hsl(var(--text-tertiary))";

  // Tooltip escuro em pílula: fundo da sidebar (sempre escura na casca).
  const tooltipStyle: React.CSSProperties = {
    background: "hsl(var(--sidebar-background))",
    border: "none",
    borderRadius: 8,
    color: `hsl(${ON_DARK})`,
    padding: "8px 12px",
    fontSize: 12,
    boxShadow: "var(--shadow-float)",
  };

  const tooltipLabelStyle: React.CSSProperties = {
    color: `hsl(${ON_DARK} / 0.6)`,
    fontSize: 11,
    marginBottom: 2,
  };

  const tooltipItemStyle: React.CSSProperties = {
    color: `hsl(${ON_DARK})`,
    fontSize: 12,
    fontWeight: 600,
    padding: 0,
  };

  /** Séries 1..8 (1 = marca). Superconjunto das 6 do hook antigo. */
  const brandSeries: string[] = [...CHART_SERIES];

  const gridProps = { vertical: false, strokeDasharray: "3 3", stroke: gridColor } as const;

  const axisProps = {
    axisLine: false,
    tickLine: false,
    tick: { fontSize: 11, fill: axisColor },
  } as const;

  const barRadius: [number, number, number, number] = [6, 6, 0, 0];

  /** Barra sob o cursor a 100%; as demais podem usar fillOpacity 0.9. */
  const activeBar = { fill: "hsl(var(--primary))", fillOpacity: 1 } as const;

  /** Faixa do cursor do Tooltip em gráfico de barras. */
  const tooltipCursor = { fill: "hsl(var(--muted))", opacity: 0.6 } as const;

  const lineProps = {
    type: "monotone",
    strokeWidth: 2,
    dot: { r: 4 },
    activeDot: { r: 5, stroke: "hsl(var(--card))", strokeWidth: 2 },
  } as const;

  return {
    // API antiga (useChartTheme)
    axisColor,
    gridColor,
    labelColor,
    tooltipStyle,
    tooltipLabelStyle,
    tooltipItemStyle,
    brandSeries,
    isDark,
    // Acréscimos do redesign
    gridProps,
    axisProps,
    barRadius,
    activeBar,
    tooltipCursor,
    areaGradientStops,
    lineProps,
  };
}

export type CrmChartTheme = ReturnType<typeof buildCrmChartTheme>;
