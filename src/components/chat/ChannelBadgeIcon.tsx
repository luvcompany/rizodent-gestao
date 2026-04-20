import whatsappLogo from "@/assets/whatsapp-logo.png";
import instagramLogo from "@/assets/instagram-logo.png";

interface ChannelBadgeIconProps {
  source: string | null | undefined;
  size?: number;
  className?: string;
}

export default function ChannelBadgeIcon({ source, size = 16, className = "" }: ChannelBadgeIconProps) {
  const s = (source || "").toLowerCase();
  const isInstagram = s.includes("instagram") && !s.includes("instagram_ad");
  const logo = isInstagram ? instagramLogo : whatsappLogo;
  const alt = isInstagram ? "Instagram" : "WhatsApp";

  if (!logo) return null;

  return (
    <img
      src={logo}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      className={`rounded-full ${className}`}
    />
  );
}
