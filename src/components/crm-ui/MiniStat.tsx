import * as React from "react";
import { cn } from "@/lib/utils";
import { toneClasses, type Tone } from "./tones";

export interface MiniStatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: Tone;
}

/** Tile compacto de número (KPIs de relatório, resumos em painel). */
export const MiniStat = React.forwardRef<HTMLDivElement, MiniStatProps>(
  ({ label, value, hint, tone = "muted", className, ...rest }, ref) => {
    const t = toneClasses(tone);
    return (
      <div ref={ref} className={cn("rounded-xl p-3", t.tile, className)} {...rest}>
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-1 text-[22px] font-bold leading-tight tracking-tight tabular-nums text-foreground">{value}</div>
        {hint != null ? <div className="mt-0.5 text-xs text-tertiary">{hint}</div> : null}
      </div>
    );
  },
);
MiniStat.displayName = "MiniStat";
