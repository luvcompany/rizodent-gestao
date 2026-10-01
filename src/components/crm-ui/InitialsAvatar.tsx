import * as React from "react";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChannelIcon } from "./ChannelIcon";
import { ICON_STROKE } from "./icon";
import { initialsOf, type ChannelVariant } from "./helpers";

export type AvatarSize = 24 | 28 | 36 | 44 | 56;

export interface InitialsAvatarProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  name?: string | null;
  src?: string | null;
  size?: AvatarSize;
  /**
   * Origem crua do lead para o selo do canal (16px) no canto inferior direito.
   * Omitida (undefined) = sem selo. `null`/vazio desenha o selo mesmo assim,
   * como o ChannelBadgeIcon faz hoje (WhatsApp).
   */
  channel?: string | null;
  /** Modo do selo. Padrão `conversa` (paridade com o ChannelBadgeIcon). */
  channelVariant?: ChannelVariant;
  /** Texto das iniciais já calculado pela tela (vence o cálculo a partir de `name`). */
  initials?: string;
  /**
   * Esconde as iniciais do nome acessível. Padrão false: as iniciais entram no
   * nome acessível, como no Avatar de hoje.
   */
  decorative?: boolean;
  /** Texto alternativo da foto. Padrão vazio (o nome costuma estar ao lado). */
  alt?: string;
}

const SIZE: Record<AvatarSize, { box: string; text: string; icon: number }> = {
  24: { box: "h-6 w-6", text: "text-[10px]", icon: 12 },
  28: { box: "h-7 w-7", text: "text-[11px]", icon: 14 },
  36: { box: "h-9 w-9", text: "text-[13px]", icon: 16 },
  44: { box: "h-11 w-11", text: "text-[15px]", icon: 18 },
  56: { box: "h-14 w-14", text: "text-lg", icon: 22 },
};

/** Avatar: foto, ou iniciais em primary-soft; selo do canal opcional. */
export const InitialsAvatar = React.forwardRef<HTMLSpanElement, InitialsAvatarProps>(
  (
    { name, src, size = 36, channel, channelVariant = "conversa", initials: initialsProp, decorative = false, alt = "", className, ...rest },
    ref,
  ) => {
    const [broken, setBroken] = React.useState(false);
    React.useEffect(() => setBroken(false), [src]);
    const s = SIZE[size] ?? SIZE[36];
    const initials = initialsProp ?? initialsOf(name);
    const showImg = !!src && !broken;

    return (
      <span ref={ref} className={cn("relative inline-flex shrink-0", s.box, className)} {...rest}>
        {showImg ? (
          <img
            src={src!}
            alt={alt}
            className={cn("h-full w-full rounded-full object-cover", s.box)}
            onError={() => setBroken(true)}
            loading="lazy"
          />
        ) : (
          <span
            aria-hidden={decorative || !initials ? true : undefined}
            className={cn(
              "flex h-full w-full select-none items-center justify-center rounded-full bg-primary-soft font-semibold text-primary-soft-fg",
              s.text,
            )}
          >
            {initials || <User size={s.icon} strokeWidth={ICON_STROKE} />}
          </span>
        )}
        {channel !== undefined ? (
          <span className="absolute -bottom-0.5 -right-0.5 inline-flex rounded-full bg-card ring-2 ring-card">
            <ChannelIcon channel={channel} variant={channelVariant} size={16} />
          </span>
        ) : null}
      </span>
    );
  },
);
InitialsAvatar.displayName = "InitialsAvatar";
