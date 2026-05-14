import instagramLogo from "@/assets/instagram-logo.png";

type Props = { username: string };

export default function ChatAccountSeparator({ username }: Props) {
  return (
    <div className="w-full py-3 select-none">
      <div className="w-full flex items-center justify-center gap-2 rounded-md bg-gradient-to-r from-primary/15 via-primary/25 to-primary/15 border border-primary/40 px-4 py-2 shadow-sm">
        <img
          src={instagramLogo}
          alt="Instagram"
          width={18}
          height={18}
          className="rounded-sm"
          loading="lazy"
        />
        <span className="text-sm font-semibold text-foreground tracking-wide">
          Conversando com{" "}
          <span className="text-primary font-bold">@{username}</span>
        </span>
      </div>
    </div>
  );
}
