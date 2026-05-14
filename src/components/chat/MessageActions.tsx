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
      className={`absolute top-0 ${direction === "outbound" ? "-left-20" : "-right-20"} flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity`}
    >
      {canReact && (
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <button className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors" title="Reagir">
              <SmilePlus size={14} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" side="top" align="center">
            <div className="flex gap-1">
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    onReact(message, emoji);
                    setEmojiOpen(false);
                  }}
                  className="text-lg hover:scale-125 transition-transform p-1"
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
        className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        title="Responder"
      >
        <Reply size={14} />
      </button>

      <button
        onClick={() => onForward(message)}
        className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        title="Encaminhar"
      >
        <Forward size={14} />
      </button>
    </div>
  );
}
