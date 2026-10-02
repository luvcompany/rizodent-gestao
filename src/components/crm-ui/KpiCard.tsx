import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICON_STROKE, renderIcon, type IconLike } from "./icon";
import { Sparkline } from "./Sparkline";
import { toneClasses, type Tone } from "./tones";

export interface KpiDelta {
  /** Texto pronto (ex.: "+12%"), calculado pela tela. */
  value: React.ReactNode;
  positive: boolean;
  caption?: React.ReactNode;
}

export interface KpiCardProps extends Omit<React.HTMLAttributes<HTMLElement>, "onClick"> {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: IconLike;
  tone?: Tone;
  hint?: React.ReactNode;
  /** Nome antigo de `hint` (telas que ainda não foram redesenhadas). */
  detail?: React.ReactNode;
  /** Só aparece se vier (nunca inventar variação). */
  delta?: KpiDelta | null;
  /** Série real. Só aparece se vier com 2+ pontos. */
  spark?: ReadonlyArray<number | null | undefined> | null;
  /** Com onClick o card vira <button>. */
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  loading?: boolean;
  disabled?: boolean;
}

/** Card de KPI: chip de ícone + rótulo, número grande, hint, variação e sparkline opcionais. */
export const KpiCard = React.forwardRef<HTMLElement, KpiCardProps>(
  ({ label, value, icon, tone = "primary", hint: hintNovo, detail, delta, spark, onClick, loading, disabled, className, ...rest }, ref) => {
    const hint = hintNovo ?? detail;
    const t = toneClasses(tone);
    const interactive = typeof onClick === "function";
    const showSpark = !!spark && spark.filter((v) => typeof v === "number" && Number.isFinite(v)).length >= 2;

    const body = (
      <>
        <span className="flex items-center gap-3">
          {icon ? (
            <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", t.soft, t.icon)}>
              {renderIcon(icon, 20)}
            </span>
          ) : null}
          <span className="min-w-0 text-[13px] font-medium text-muted-foreground">{label}</span>
        </span>
        <span className="mt-3 flex items-end justify-between gap-3">
          <span className="block min-w-0">
            {loading ? (
              <span
                data-testid="kpi-loading"
                aria-hidden="true"
                className="block h-8 w-20 animate-pulse rounded-lg bg-muted"
              />
            ) : (
              <span className="block text-[32px] font-bold leading-none tracking-tight tabular-nums text-foreground">
                {value}
              </span>
            )}
            {delta ? (
              <span className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs" data-testid="kpi-delta">
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 font-semibold",
                    delta.positive ? "text-success-soft-foreground" : "text-destructive-soft-foreground",
                  )}
                >
                  {delta.positive ? (
                    <ArrowUp size={12} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  ) : (
                    <ArrowDown size={12} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  )}
                  {delta.value}
                </span>
                {delta.caption != null ? <span className="text-tertiary">{delta.caption}</span> : null}
              </span>
            ) : null}
          </span>
          {showSpark ? <Sparkline data={spark!} tone={tone} data-testid="kpi-spark" /> : null}
        </span>
        {hint != null ? <span className="mt-1.5 line-clamp-2 text-xs text-tertiary">{hint}</span> : null}
      </>
    );

    const base = cn(
      "block rounded-card border border-border/60 bg-card p-5 text-left text-card-foreground shadow-card",
      className,
    );

    if (interactive) {
      return (
        <button
          ref={ref as React.Ref<HTMLButtonElement>}
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-busy={loading || undefined}
          className={cn(
            "w-full transition-shadow hover:shadow-float focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60",
            base,
          )}
          {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        >
          {body}
        </button>
      );
    }

    return (
      <div ref={ref as React.Ref<HTMLDivElement>} className={base} aria-busy={loading || undefined} {...(rest as React.HTMLAttributes<HTMLDivElement>)}>
        {body}
      </div>
    );
  },
);
KpiCard.displayName = "KpiCard";

/** Nome antigo do tipo de tom, mantido para as telas antigas. */
export type SemanticTone = Tone;
