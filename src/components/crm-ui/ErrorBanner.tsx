import * as React from "react";
import { AlertCircle, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICON_STROKE } from "./icon";

type RetryProps =
  | { onRetry?: undefined; retryLabel?: React.ReactNode }
  | { onRetry: () => void; retryLabel: React.ReactNode };

export type ErrorBannerProps = Omit<React.HTMLAttributes<HTMLDivElement>, "children"> & {
  message: React.ReactNode;
  /** Carregando a nova tentativa: desabilita o botão. */
  retrying?: boolean;
} & RetryProps;

/** Faixa de erro (fundo destructive suave). O botão só existe se vier onRetry; o rótulo vem por prop. */
export const ErrorBanner = React.forwardRef<HTMLDivElement, ErrorBannerProps>(
  ({ message, onRetry, retryLabel, retrying, className, ...rest }, ref) => (
    <div
      ref={ref}
      role="alert"
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-xl border border-destructive/20 bg-destructive-soft p-4 text-destructive-soft-foreground",
        className,
      )}
      {...rest}
    >
      <AlertCircle size={18} strokeWidth={ICON_STROKE} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 text-sm">{message}</div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-destructive/30 bg-card px-3 text-[13px] font-medium text-destructive-soft-foreground transition-colors hover:bg-destructive-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RotateCw size={14} strokeWidth={ICON_STROKE} aria-hidden="true" className={cn(retrying && "animate-spin")} />
          {retryLabel}
        </button>
      ) : null}
    </div>
  ),
);
ErrorBanner.displayName = "ErrorBanner";
