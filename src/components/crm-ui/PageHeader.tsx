import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { renderIcon, type IconLike } from "./icon";
import { toneClasses, type Tone } from "./tones";

export interface BreadcrumbItem {
  label: React.ReactNode;
  /** Com `to`, o trecho vira Link. Sem `to`, fica como texto. */
  to?: string;
}

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  /** Aceita ReactNode (há subtítulos com link dentro). */
  subtitle?: React.ReactNode;
  icon?: IconLike;
  iconTone?: Tone;
  /** Trechos ANTES do título ("Automações / Criar Bot" = [{label:'Automações', to}] + title). */
  breadcrumb?: BreadcrumbItem[];
  actions?: React.ReactNode;
}

/** Cabeçalho de página: título, subtítulo, breadcrumb opcional e ações à direita. */
export const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ title, subtitle, icon, iconTone = "primary", breadcrumb, actions, className, ...rest }, ref) => {
    const hasCrumbs = !!breadcrumb && breadcrumb.length > 0;
    const t = toneClasses(iconTone);
    return (
      <div
        ref={ref}
        className={cn("mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}
        {...rest}
      >
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", t.soft, t.icon)}>
              {renderIcon(icon, 20)}
            </span>
          ) : null}
          <div className="min-w-0">
            {hasCrumbs ? (
              <h1 className="flex flex-wrap items-center text-xl font-bold tracking-tight text-foreground">
                {breadcrumb!.map((item, i) => (
                  <React.Fragment key={i}>
                    {item.to ? (
                      <Link
                        to={item.to}
                        className="rounded-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {item.label}
                      </Link>
                    ) : (
                      <span>{item.label}</span>
                    )}
                    <span aria-hidden="true" className="mx-2 text-tertiary">
                      /
                    </span>
                  </React.Fragment>
                ))}
                <span>{title}</span>
              </h1>
            ) : (
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
            )}
            {subtitle != null && subtitle !== false ? (
              <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    );
  },
);
PageHeader.displayName = "PageHeader";
