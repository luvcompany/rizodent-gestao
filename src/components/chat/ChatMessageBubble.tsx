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
  ad_headline?: string | null;
  ad_body?: string | null;
  ad_image_url?: string | null;
  ad_source_url?: string | null;
  ad_source_id?: string | null;
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
            {msg.direction === "inbound" && (msg.ad_source_url || msg.ad_headline || msg.ad_image_url) && (
              <div className="mb-2 rounded-lg overflow-hidden border border-border bg-muted/40">
                {msg.ad_image_url && (
                  <div className="relative">
                    <img src={msg.ad_image_url} alt="Anúncio" className="w-full h-48 object-cover" />
                    <span className="absolute top-2 left-2 flex items-center gap-1 bg-background/90 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                      <svg viewBox="0 0 24 24" className="w-3 h-3 fill-[#1877F2]"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                      Anúncio do Facebook
                    </span>
                  </div>
                )}
                {!msg.ad_image_url && (
                  <div className="flex items-center gap-1 px-3 pt-2">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-[#1877F2]"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                    <span className="text-[10px] font-semibold text-muted-foreground">Anúncio do Facebook</span>
                  </div>
                )}
                <div className="px-3 py-2 space-y-0.5">
                  {msg.ad_headline && <p className="text-xs font-bold text-foreground leading-tight">{msg.ad_headline}</p>}
                  {msg.ad_body && <p className="text-[11px] text-muted-foreground line-clamp-2">{msg.ad_body}</p>}
                  {msg.ad_source_url && (
                    <a href={msg.ad_source_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-500 hover:underline truncate block">
                      {msg.ad_source_url.replace(/^https?:\/\//, '').slice(0, 50)}
                    </a>
                  )}
                </div>
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
