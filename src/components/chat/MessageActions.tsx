import { useState } from "react";
import { SmilePlus, Reply, Forward } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { motivoParaNaoEncaminhar } from "./ForwardMessageDialog";

type Message = {
  id: string;
  content: string | null;
  type: string;
  direction: string;
  status?: string | null;
  channel?: string | null;
  template_snapshot?: unknown;
};

type Props = {
  message: Message;
  onReply: (message: Message) => void;
  onForward: (message: Message) => void;
  onReact: (message: Message, emoji: string) => void;
  direction: string;
  canReact?: boolean;
  /**
   * Força mostrar/esconder "Encaminhar". Sem ele (CONV-6), o botão some em
   * modelo, mensagem do sistema, ligação e Instagram — o que o encaminhar não
   * consegue reenviar como o paciente recebeu.
   */
  canForward?: boolean;
};

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "👏"];

export default function MessageActions({ message, onReply, onForward, onReact, direction, canReact = true, canForward }: Props) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const podeEncaminhar = canForward ?? motivoParaNaoEncaminhar(message) === null;

  return (
    <div
      className={`absolute top-0 ${direction === "outbound" ? "-left-20" : "-right-20"} flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity`}
    >
      {canReact && (
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
             <Button variant="outline" size="icon" className="h-8 w-8 rounded-full border-border/60 bg-card text-muted-foreground shadow-xs" title="Reagir">
              <SmilePlus size={14} />
             </Button>
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

      <Button
        variant="outline"
        size="icon"
        onClick={() => onReply(message)}
        className="h-8 w-8 rounded-full border-border/60 bg-card text-muted-foreground shadow-xs"
        title="Responder"
      >
        <Reply size={14} />
      </Button>

      {podeEncaminhar && (
        <Button
          variant="outline"
          size="icon"
          onClick={() => onForward(message)}
          className="h-8 w-8 rounded-full border-border/60 bg-card text-muted-foreground shadow-xs"
          title="Encaminhar"
        >
          <Forward size={14} />
        </Button>
      )}
    </div>
  );
}
