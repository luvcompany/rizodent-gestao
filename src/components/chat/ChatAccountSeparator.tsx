import instagramLogo from "@/assets/instagram-logo.png";

type Props = { username: string };

export default function ChatAccountSeparator({ username }: Props) {
  return (
    <div className="flex w-full justify-center py-3 select-none">
      <div className="flex items-center justify-center gap-2 rounded-full border border-border/60 bg-card px-4 py-1.5 shadow-xs">
        <img
          src={instagramLogo}
          alt="Instagram"
          width={16}
          height={16}
          className="opacity-90"
          loading="lazy"
        />
        <span className="text-xs font-medium text-tertiary">
          Conversando com{" "}
          <span className="font-semibold text-foreground">@{username}</span>
        </span>
      </div>
    </div>
  );
}
