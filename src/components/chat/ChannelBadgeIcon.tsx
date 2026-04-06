import whatsappLogo from "@/assets/whatsapp-logo.png";
import instagramLogo from "@/assets/instagram-logo.png";

interface ChannelBadgeIconProps {
  source: string | null | undefined;
  size?: number;
  className?: string;
}

export default function ChannelBadgeIcon({ source, size = 16, className = "" }: ChannelBadgeIconProps) {
  const s = (source || "").toLowerCase();
  let logo: string | null = null;

  if (s.includes("instagram")) {
    logo = instagramLogo;
  } else if (s.includes("whatsapp") || s.includes("facebook") || s === "" || !s) {
    // Default to WhatsApp for most CRM leads
    logo = whatsappLogo;
  }

  if (!logo) return null;

  return (
    <img
      src={logo}
      alt={s.includes("instagram") ? "Instagram" : "WhatsApp"}
      width={size}
      height={size}
      loading="lazy"
      className={`rounded-full ${className}`}
    />
  );
}
