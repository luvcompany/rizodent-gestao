import * as React from "react";
import { cn } from "@/lib/utils";
import { toneColor, type Tone } from "./tones";
import { sparklinePoints } from "./helpers";

export interface SparklineProps extends Omit<React.SVGAttributes<SVGSVGElement>, "width" | "height"> {
  /** Série REAL recebida por prop. Com menos de 2 pontos válidos, não renderiza nada. */
  data: ReadonlyArray<number | null | undefined>;
  tone?: Tone;
  width?: number;
  height?: number;
}

/**
 * Minigráfico de linha. Só desenha a série que recebe; nunca gera dado.
 * Decorativo por padrão (aria-hidden); passe `aria-label` para anunciar.
 */
export const Sparkline = React.forwardRef<SVGSVGElement, SparklineProps>(
  ({ data, tone = "primary", width = 112, height = 44, className, ...rest }, ref) => {
    const rawId = React.useId();
    const gradId = `crm-spark-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const values = React.useMemo(
      () => (data ?? []).filter((v): v is number => typeof v === "number" && Number.isFinite(v)),
      [data],
    );
    if (values.length < 2) return null;

    const pts = sparklinePoints(values, width, height);
    const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
    const area = `${line} L${pts[pts.length - 1][0]} ${height} L${pts[0][0]} ${height} Z`;
    const color = toneColor(tone);
    const labelled = rest["aria-label"] != null || rest["aria-labelledby"] != null;

    return (
      <svg
        ref={ref}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        fill="none"
        className={cn("shrink-0 overflow-visible", className)}
        role={labelled ? "img" : undefined}
        aria-hidden={labelled ? undefined : true}
        focusable="false"
        {...rest}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.2 }} />
            <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId})`} stroke="none" />
        <path
          d={line}
          style={{ stroke: color }}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  },
);
Sparkline.displayName = "Sparkline";
