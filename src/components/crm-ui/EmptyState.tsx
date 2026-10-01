import * as React from "react";
import { cn } from "@/lib/utils";
import { renderIcon, type IconLike } from "./icon";

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: IconLike;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Só a ação que já existe na tela (nunca criar botão novo). */
  action?: React.ReactNode;
}

/** Estado vazio centralizado: ícone em círculo suave, título, texto e ação opcional. */
export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon, title, description, action, className, ...rest }, ref) => (
    <div ref={ref} className={cn("px-4 py-12 text-center", className)} {...rest}>
      {icon ? (
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg">
          {renderIcon(icon, 24)}
        </span>
      ) : null}
      <div className="text-[15px] font-semibold text-foreground">{title}</div>
      {description != null ? (
        <div className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">{description}</div>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  ),
);
EmptyState.displayName = "EmptyState";
