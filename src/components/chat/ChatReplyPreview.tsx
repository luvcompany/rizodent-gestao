import { X } from "lucide-react";

type ReplyMessage = {
  id: string;
  content: string | null;
  type: string;
  direction: string;
};

type Props = {
  replyTo: ReplyMessage;
  leadName: string;
  onCancel: () => void;
};

export default function ChatReplyPreview({ replyTo, leadName, onCancel }: Props) {
  return (
    <div className="mx-3 mb-2 flex flex-shrink-0 items-center gap-3 rounded-xl border border-border/60 bg-surface-sunken px-3 py-2">
      <div className="h-9 w-[3px] flex-shrink-0 rounded-full bg-primary" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-primary">
          {replyTo.direction === "inbound" ? leadName : "Você"}
        </div>
        <div className="truncate text-[13px] text-muted-foreground">{replyTo.content || `[${replyTo.type}]`}</div>
      </div>
      <button onClick={onCancel} className="flex h-7 w-7 items-center justify-center rounded-full text-tertiary transition-colors hover:bg-card hover:text-foreground">
        <X size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}
