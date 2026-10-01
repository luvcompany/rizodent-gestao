import { useState } from "react";
import { SmilePlus, Reply, Forward } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Message = {
  id: string;
  content: string | null;
  type: string;
  direction: string;
};

type Props = {
  message: Message;
  onReply: (message: Message) => void;
  onForward: (message: Message) => void;
  onReact: (message: Message, emoji: string) => void;
  direction: string;
  canReact?: boolean;
};

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "👏"];

export default function MessageActions({ message, onReply, onForward, onReact, direction, canReact = true }: Props) {
  const [emojiOpen, setEmojiOpen] = useState(false);

  return (
    <div
      className={`absolute top-0 ${direction === "outbound" ? "-left-24" : "-right-24"} z-10 flex items-center gap-1 rounded-full border border-border/60 bg-card/95 p-1 shadow-card opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100`}
    >
      {canReact && (
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <button className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary" title="Reagir">
              <SmilePlus size={14} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto rounded-full border-border/60 p-1.5 shadow-float" side="top" align="center">
            <div className="flex gap-0.5">
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    onReact(message, emoji);
                    setEmojiOpen(false);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition-transform hover:scale-110 hover:bg-surface-sunken"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      <button
        onClick={() => onReply(message)}
        className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
        title="Responder"
      >
        <Reply size={14} />
      </button>

      <button
        onClick={() => onForward(message)}
        className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
        title="Encaminhar"
      >
        <Forward size={14} />
      </button>
    </div>
  );
}
