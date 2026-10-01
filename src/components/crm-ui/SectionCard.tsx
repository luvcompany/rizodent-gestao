import * as React from "react";
import { cn } from "@/lib/utils";
import { renderIcon, type IconLike } from "./icon";
import { toneClasses, type Tone } from "./tones";

type HeadingTag = "h2" | "h3" | "h4";

export interface SectionCardProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: IconLike;
  iconTone?: Tone;
  actions?: React.ReactNode;
  padding?: "md" | "lg" | "none";
  /** Elemento raiz. Padrão `div` (não cria landmark novo na árvore de acessibilidade). */
  as?: "div" | "section" | "article" | "aside" | "li";
  /** Tag do título. Padrão `h3`, igual ao CardTitle do kit. */
  titleAs?: HeadingTag;
  /** Classe extra do cabeçalho. */
  headerClassName?: string;
}

const PADDING = { md: "p-5", lg: "p-6", none: "" } as const;

/** Card de seção do redesign: raio de card, borda sutil e sombra de card. */
export const SectionCard = React.forwardRef<HTMLElement, SectionCardProps>(
  (
    {
      title,
      description,
      icon,
      iconTone = "primary",
      actions,
      padding = "md",
      as = "div",
      titleAs = "h3",
      headerClassName,
      className,
      children,
      ...rest
    },
    ref,
  ) => {
    const Comp = as as React.ElementType;
    const Heading = titleAs as React.ElementType;
    const hasHeader = title != null || description != null || icon != null || actions != null;
    const t = toneClasses(iconTone);
    return (
      <Comp
        ref={ref}
        className={cn(
          "rounded-card border border-border/60 bg-card text-card-foreground shadow-card",
          PADDING[padding],
          className,
        )}
        {...rest}
      >
        {hasHeader ? (
          <div
            className={cn(
              "mb-4 flex items-center justify-between gap-3",
              padding === "none" && "px-5 pt-5",
              headerClassName,
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              {icon ? (
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", t.soft, t.icon)}>
                  {renderIcon(icon, 18)}
                </span>
              ) : null}
              <div className="min-w-0">
                {title != null ? <Heading className="text-base font-semibold text-foreground">{title}</Heading> : null}
                {description != null ? (
                  <div className="text-[13px] text-muted-foreground">{description}</div>
                ) : null}
              </div>
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}
        {children}
      </Comp>
    );
  },
);
SectionCard.displayName = "SectionCard";
