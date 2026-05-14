type Props = { username: string };

export default function ChatAccountSeparator({ username }: Props) {
  return (
    <div className="flex items-center justify-center py-2 select-none">
      <span className="text-[11px] text-primary bg-primary/10 border border-primary/20 px-3 py-1 rounded-full font-medium">
        Conversando com @{username}
      </span>
    </div>
  );
}
