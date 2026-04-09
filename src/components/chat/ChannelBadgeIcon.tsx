import whatsappLogo from "@/assets/whatsapp-logo.png";
import instagramLogo from "@/assets/instagram-logo.png";

interface ChannelBadgeIconProps {
  source: string | null | undefined;
  size?: number;
  className?: string;
}

export default function ChannelBadgeIcon({ source, size = 16, className = "" }: ChannelBadgeIconProps) {
  // Always show WhatsApp as the channel icon since WhatsApp is the active integration.
  // The source field indicates ad origin (facebook_ad, instagram_ad), not the messaging channel.
  const logo = whatsappLogo;

  if (!logo) return null;

  return (
    <img
      src={logo}
      alt="WhatsApp"
      width={size}
      height={size}
      loading="lazy"
      className={`rounded-full ${className}`}
    />
  );
}
