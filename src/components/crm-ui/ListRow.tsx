import * as React from "react";
import { cn } from "@/lib/utils";

export interface ListRowProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Meta à direita do título (hora, data). */
  meta?: React.ReactNode;
  /** Coluna à direita (contador de não lidas, menu). */
  trailing?: React.ReactNode;
  active?: boolean;
  unread?: boolean;
  onClick?: React.MouseEventHandler<HTMLElement>;
  /**
   * Elemento raiz. Sem `as`, vira `button` quando há onClick e `div` quando
   * não há. Use `as="div"` com role/tabIndex próprios se a linha já tiver
   * botões dentro (botão dentro de botão é inválido).
   */
  as?: "div" | "li" | "button" | "a";
  href?: string;
}

/** Linha de lista (conversas, leads recentes): leading, título + meta, subtítulo, trailing. */
export const ListRow = React.forwardRef<HTMLElement, ListRowProps>(
  ({ leading, title, subtitle, meta, trailing, active, unread, onClick, as, className, children, ...rest }, ref) => {
    const tag = as ?? (onClick ? "button" : "div");
    const Comp = tag as React.ElementType;
    const isButton = tag === "button";

    return (
      <Comp
        ref={ref}
        type={isButton ? "button" : undefined}
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        data-active={active ? "" : undefined}
        data-unread={unread ? "" : undefined}
        className={cn(
          "relative flex w-full gap-3 border-b border-border/60 px-4 py-3.5 text-left transition-colors hover:bg-surface-sunken/60",
          (isButton || tag === "a") &&
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          active &&
            "rounded-xl border-b-transparent bg-primary-soft-2 hover:bg-primary-soft-2 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-primary",
          className,
        )}
        {...rest}
      >
        {leading ? <span className="shrink-0">{leading}</span> : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm text-foreground",
                unread ? "font-semibold" : "font-medium",
              )}
            >
              {title}
            </span>
            {meta != null ? <span className="shrink-0 text-xs text-tertiary">{meta}</span> : null}
          </span>
          {subtitle != null ? (
            <span
              className={cn(
                "mt-0.5 min-w-0 truncate text-[13px]",
                unread ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {subtitle}
            </span>
          ) : null}
          {children != null ? <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">{children}</span> : null}
        </span>
        {trailing != null ? <span className="flex shrink-0 items-center self-center">{trailing}</span> : null}
      </Comp>
    );
  },
);
ListRow.displayName = "ListRow";
