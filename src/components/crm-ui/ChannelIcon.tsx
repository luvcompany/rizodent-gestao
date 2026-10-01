import * as React from "react";
import { Globe, Phone, Users } from "lucide-react";
import ChannelBadgeIcon from "@/components/chat/ChannelBadgeIcon";
import { cn } from "@/lib/utils";
import { ICON_STROKE } from "./icon";
import { conversationChannel, normalizeChannel, type ChannelVariant, type KnownChannel } from "./helpers";


export interface ChannelIconProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  channel: KnownChannel | string | null | undefined;
  size?: number;
  /**
   * Nome acessível. WhatsApp/Instagram já saem com o alt do ChannelBadgeIcon
   * ("WhatsApp"/"Instagram"), Facebook/Google com o nome da marca. Telefone,
   * indicação e desconhecido são decorativos, a menos que venha `label`.
   */
  label?: string;
  /**
   * `conversa` (padrão): mesmo resultado do ChannelBadgeIcon, o selo do canal
   * da CONVERSA. A origem crua vai direto para ele, então `instagram_ad`,
   * `facebook_ad`, `google_ads`, `site`, vazio etc. continuam WhatsApp, e só
   * Instagram orgânico vira Instagram.
   * `origem`: ícone da ORIGEM do lead (Kanban, tabelas), com Facebook, Google,
   * telefone, indicação e globo para o resto.
   */
  variant?: ChannelVariant;
}

/* Glifos oficiais de terceiros (decisão 18: cor oficial de marca de terceiros
   não vira token). WhatsApp e Instagram vêm do ChannelBadgeIcon; Facebook e
   Google não existem lá, então ficam aqui. */
function FacebookGlyph({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path
        fill="#1877F2"
        d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
      />
    </svg>
  );
}

function GoogleGlyph({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.29 14.28A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.28V6.61H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.39l4.01-3.11z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4.01 3.11C6.23 6.88 8.88 4.77 12 4.77z" />
    </svg>
  );
}

/**
 * Ícone do canal com cor oficial. No modo `conversa` é o ChannelBadgeIcon
 * (paridade total); no modo `origem`, telefone em slate, indicação em warning
 * e desconhecido em tertiary.
 */
export const ChannelIcon = React.forwardRef<HTMLSpanElement, ChannelIconProps>(
  ({ channel, size = 14, label, variant = "conversa", className, style, ...rest }, ref) => {
    if (variant === "conversa") {
      const kind = conversationChannel(channel);
      // Origem CRUA para o ChannelBadgeIcon: a regra dele decide (e o alt dele é o nome acessível).
      const badge = <ChannelBadgeIcon source={channel ?? null} size={size} className="block" />;
      return (
        <span
          ref={ref}
          data-channel={kind}
          className={cn("inline-flex shrink-0 items-center justify-center leading-none", className)}
          style={{ width: size, height: size, ...style }}
          {...(label != null ? { role: "img", "aria-label": label, title: label } : {})}
          {...rest}
        >
          {label != null ? <span aria-hidden="true">{badge}</span> : badge}
        </span>
      );
    }

    const kind = normalizeChannel(channel ?? "");
    let glyph: React.ReactNode;
    let defaultLabel: string | undefined;

    switch (kind) {
      case "whatsapp":
      case "instagram":
        // Reuso direto (import) do componente existente; o alt dele é o nome acessível.
        glyph = <ChannelBadgeIcon source={kind} size={size} className="block" />;
        break;
      case "facebook":
        glyph = <FacebookGlyph size={size} />;
        defaultLabel = "Facebook";
        break;
      case "google":
        glyph = <GoogleGlyph size={size} />;
        defaultLabel = "Google";
        break;
      case "phone":
        glyph = <Phone size={size} strokeWidth={ICON_STROKE} className="text-slate" aria-hidden="true" />;
        break;
      case "indicacao":
        glyph = <Users size={size} strokeWidth={ICON_STROKE} className="text-warning" aria-hidden="true" />;
        break;
      default:
        glyph = <Globe size={size} strokeWidth={ICON_STROKE} className="text-tertiary" aria-hidden="true" />;
    }

    // Nome acessível: `label` explícito vence. WhatsApp/Instagram já têm o alt
    // da <img>; nesse caso o wrapper não repete o nome.
    const imgHasAlt = kind === "whatsapp" || kind === "instagram";
    const name = label ?? (imgHasAlt ? undefined : defaultLabel);
    const a11y: React.HTMLAttributes<HTMLSpanElement> =
      name != null
        ? { role: "img", "aria-label": name, title: name }
        : imgHasAlt
          ? {}
          : { "aria-hidden": true };

    return (
      <span
        ref={ref}
        data-channel={kind ?? "unknown"}
        className={cn("inline-flex shrink-0 items-center justify-center leading-none", className)}
        style={{ width: size, height: size, ...style }}
        {...a11y}
        {...rest}
      >
        {label != null && imgHasAlt ? <span aria-hidden="true">{glyph}</span> : glyph}
      </span>
    );
  },
);
ChannelIcon.displayName = "ChannelIcon";
