import whatsappLogo from "@/assets/whatsapp-logo.png";

type Props = { label: string };

/** Divisória na conversa: mostra por qual número do WhatsApp as mensagens seguintes passaram. */
export default function ChatNumberSeparator({ label }: Props) {
  return (
    <div className="flex w-full justify-center py-3 select-none">
      <div className="flex items-center justify-center gap-2 rounded-full border border-border/60 bg-card px-4 py-1.5 shadow-xs">
        <img src={whatsappLogo} alt="WhatsApp" width={16} height={16} className="opacity-90" loading="lazy" />
        <span className="text-xs font-medium text-tertiary">
          Pelo número <span className="font-semibold text-foreground">{label}</span>
        </span>
      </div>
    </div>
  );
}
