import * as React from "react";
import { cn } from "@/lib/utils";
import { toneClasses, type Tone } from "./tones";
import { hexWithAlpha } from "./helpers";

export interface StatusPillProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color"> {
  tone?: Tone;
  /**
   * Cor vinda do banco (etapa, funil, marcador). Vai no PONTO e no fundo a ~14%;
   * o texto fica neutro (text-foreground), porque a maioria das cores
   * escolhidas pelo usuário não passa AA como texto de 11px. Hex vira hex com
   * alfa (`#RRGGBB24`); outros formatos usam uma camada com opacidade. Nunca
   * color-mix: o html2canvas da exportação de /relatorios quebra com ele.
   * Com `color`, o ponto aparece por padrão (dot=false tira).
   */
  color?: string | null;
  /**
   * Só com `color`: cor do texto quando a tela já pinta o texto com a cor da
   * etapa hoje e precisa manter. Sem ela, o texto é neutro.
   */
  textColor?: string;
  dot?: boolean;
}

/** Pílula de status: fundo suave do tom e texto AA (-soft-foreground), ou cor do banco no ponto e no fundo. */
export const StatusPill = React.forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ tone = "muted", color, textColor, dot, className, style, children, ...rest }, ref) => {
    const custom = typeof color === "string" && color.trim() !== "" ? color.trim() : null;
    const showDot = dot ?? !!custom;
    const t = toneClasses(tone);
    const bgHex = custom ? hexWithAlpha(custom) : null;
    const needsLayer = !!custom && !bgHex;

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex h-6 max-w-full shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-[11px] font-medium",
          !custom && t.soft,
          !custom && t.fg,
          custom && !textColor && "text-foreground",
          needsLayer && "relative isolate",
          className,
        )}
        style={
          custom
            ? { ...(textColor ? { color: textColor } : null), ...(bgHex ? { backgroundColor: bgHex } : null), ...style }
            : style
        }
        {...rest}
      >
        {needsLayer ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 -z-10 rounded-full opacity-[0.14]"
            style={{ backgroundColor: custom! }}
          />
        ) : null}
        {showDot ? (
          <span
            aria-hidden="true"
            className={cn("mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full", !custom && "bg-current")}
            style={custom ? { backgroundColor: custom } : undefined}
          />
        ) : null}
        <span className="truncate">{children}</span>
      </span>
    );
  },
);
StatusPill.displayName = "StatusPill";
