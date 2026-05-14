import instagramLogo from "@/assets/instagram-logo.png";

type Props = { username: string };

export default function ChatAccountSeparator({ username }: Props) {
  return (
    <div className="w-full py-3 select-none">
      <div className="w-full flex items-center justify-center gap-2 bg-primary/10 px-4 py-2">
        <img
          src={instagramLogo}
          alt="Instagram"
          width={16}
          height={16}
          className="opacity-90"
          loading="lazy"
        />
        <span className="text-xs font-medium text-primary tracking-wide">
          Conversando com{" "}
          <span className="font-semibold">@{username}</span>
        </span>
      </div>
    </div>
  );
}
