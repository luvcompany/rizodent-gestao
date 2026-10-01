import * as React from "react";
import { cn } from "@/lib/utils";

export interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Gruda no topo do contêiner que rola (o main). */
  sticky?: boolean;
}

/** Barra de filtros em card: controles em linha que quebram. */
export const FilterBar = React.forwardRef<HTMLDivElement, FilterBarProps>(
  ({ sticky, className, children, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-card border border-border/60 bg-card p-3 shadow-xs",
        sticky && "sticky top-0 z-20 bg-card/90 backdrop-blur",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  ),
);
FilterBar.displayName = "FilterBar";
