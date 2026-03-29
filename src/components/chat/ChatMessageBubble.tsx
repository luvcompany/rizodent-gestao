import { forwardRef } from "react";
import { Check, CheckCheck, Clock } from "lucide-react";
import ChatMessageContent from "./ChatMessageContent";
import MessageActions from "./MessageActions";

type Message = {
  id: string;
  lead_id: string;
  direction: string;
  type: string;
  content: string | null;
  media_url: string | null;
  status: string;
  created_at: string;
  whatsapp_message_id?: string | null;
  reply_to_message_id?: string | null;
  reactions?: { emoji: string; from: string }[];
};

type Props = {
  msg: Message;
  leadName: string;
  allMessages: Message[];
  onReply: (msg: Message) => void;
  onForward: (msg: Message) => void;
  onReact: (msg: Message, emoji: string) => void;
  onMediaClick: (url: string, type: "image" | "video") => void;
  onScrollToMessage: (msgId: string) => void;
};

function getStatusIcon(status: string) {
  switch (status) {
    case "read": return <CheckCheck size={14} className="text-blue-400" />;
    case "delivered": return <CheckCheck size={14} className="text-muted-foreground" />;
    case "sent": return <Check size={14} className="text-muted-foreground" />;
    default: return <Clock size={14} className="text-muted-foreground" />;
  }
}

function getQuotedLabel(msg: Message) {
  if (["image", "sticker"].includes(msg.type)) return "📷 Foto";
  if (msg.type === "video") return "🎥 Vídeo";
  if (msg.type === "audio") return "🎤 Áudio";
  if (msg.type === "document") return "📄 Documento";
  return msg.content || `[${msg.type}]`;
}

const ChatMessageBubble = forwardRef<HTMLDivElement, Props>(
  ({ msg, leadName, allMessages, onReply, onForward, onReact, onMediaClick, onScrollToMessage }, ref) => {
    const quotedMsg = msg.reply_to_message_id
      ? allMessages.find((m) => m.id === msg.reply_to_message_id)
      : null;

    const rawReactions = Array.isArray(msg.reactions) ? msg.reactions : [];
    const reactionsMap = new Map<string, string>();
    rawReactions.forEach((r) => reactionsMap.set(r.from, r.emoji));
    const reactions = Array.from(reactionsMap.entries()).map(([from, emoji]) => ({ from, emoji }));

    return (
      <div ref={ref} className="w-full flex transition-all duration-300 rounded-lg">
        <div className={`relative group max-w-[65%] min-w-[120px] ${msg.direction === "outbound" ? "ml-auto" : "mr-auto"}`}>
          <MessageActions
            message={msg}
            direction={msg.direction}
            onReply={onReply}
            onForward={onForward}
            onReact={onReact}
          />
          <div className={`rounded-lg px-3 py-2 ${
            msg.direction === "outbound"
              ? "bg-primary/20 text-foreground rounded-br-none"
              : "bg-card border border-border text-foreground rounded-bl-none"
          }`}>
            {quotedMsg && (
              <div
                onClick={() => onScrollToMessage(quotedMsg.id)}
                className="mb-1.5 rounded-md bg-background/60 border-l-2 border-primary px-2.5 py-1.5 cursor-pointer hover:bg-background/80 transition-colors flex gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-primary">
                    {quotedMsg.direction === "inbound" ? leadName : "Você"}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {getQuotedLabel(quotedMsg)}
                  </div>
                </div>
                {["image", "sticker", "video"].includes(quotedMsg.type) && quotedMsg.media_url?.startsWith("http") && (
                  <img src={quotedMsg.media_url} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                )}
              </div>
            )}
            <ChatMessageContent message={msg} onMediaClick={onMediaClick} />
            <div className={`flex items-center gap-1 mt-1 ${msg.direction === "outbound" ? "justify-end" : ""}`}>
              <span className="text-[10px] text-muted-foreground">
                {new Date(msg.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
              {msg.direction === "outbound" && getStatusIcon(msg.status)}
            </div>
          </div>
          {reactions.length > 0 && (
            <div className={`flex gap-0.5 mt-[-8px] ${msg.direction === "outbound" ? "justify-end mr-1" : "justify-start ml-1"}`}>
              {reactions.map((r, i) => (
                <span key={i} className="text-sm bg-card border border-border rounded-full px-1.5 py-0.5 shadow-sm">
                  {r.emoji}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
);

ChatMessageBubble.displayName = "ChatMessageBubble";
export default ChatMessageBubble;
export type { Message };
