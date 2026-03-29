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
    <div className="flex-shrink-0 bg-secondary/80 border-t border-border px-4 py-2 flex items-center gap-3">
      <div className="w-1 h-8 rounded-full bg-primary flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-primary">
          {replyTo.direction === "inbound" ? leadName : "Você"}
        </div>
        <div className="text-xs text-muted-foreground truncate">{replyTo.content || `[${replyTo.type}]`}</div>
      </div>
      <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
        <X size={16} />
      </button>
    </div>
  );
}
