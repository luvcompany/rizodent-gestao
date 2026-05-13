import { forwardRef } from "react";
import { Check, CheckCheck, Clock, AlertCircle, MessageCircle, ExternalLink, Reply } from "lucide-react";
import ChatMessageContent from "./ChatMessageContent";
import MessageActions from "./MessageActions";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

type Message = {
  id: string;
  lead_id: string;
  channel?: string;
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
  ad_account_name?: string | null;
  error_reason?: string | null;
  deleted_at?: string | null;
  instagram_comment_id?: string | null;
  instagram_post_id?: string | null;
  instagram_post_thumbnail?: string | null;
  instagram_post_permalink?: string | null;
  instagram_account_id?: string | null;
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
  igAccountsMap?: Record<string, string>;
};

function getStatusIcon(status: string) {
  switch (status) {
    case "read":
    case "played":
      return <CheckCheck size={14} className="text-blue-400" />;
    case "delivered": return <CheckCheck size={14} className="text-muted-foreground" />;
    case "sent":
    case "accepted":
      return <Check size={14} className="text-muted-foreground" />;
    case "failed":
    case "error":
      return null;
    case "sending":
      return <Clock size={14} className="text-muted-foreground animate-pulse" />;
    case "system":
      return null;
    default:
      // Any other confirmed status (e.g. future API statuses) → show as sent
      return <Check size={14} className="text-muted-foreground" />;
  }
}

function getQuotedLabel(msg: Message) {
  if (["image", "sticker"].includes(msg.type)) return "📷 Foto";
  if (msg.type === "video") return "🎥 Vídeo";
  if (msg.type === "audio") return "🎤 Áudio";
  if (msg.type === "document") return "📄 Documento";
  return msg.content || `[${msg.type}]`;
}

function getDefaultErrorMessage(msg: Message) {
  if (msg.channel === "instagram") {
    return "Falha ao enviar mensagem. Verifique a conexão com o Instagram e tente reenviar.";
  }

  return "Falha ao enviar mensagem. Verifique a conexão com o WhatsApp e tente reenviar.";
}

const ChatMessageBubble = forwardRef<HTMLDivElement, Props>(
  ({ msg, leadName, allMessages, onReply, onForward, onReact, onMediaClick, onScrollToMessage, igAccountsMap }, ref) => {
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
          {!msg.deleted_at && (
            <MessageActions
              message={msg}
              direction={msg.direction}
              onReply={onReply}
              onForward={onForward}
              onReact={onReact}
            />
          )}
          {msg.deleted_at ? (
            <div className={`rounded-lg px-3 py-2 italic text-muted-foreground text-sm bg-muted/40 border border-dashed border-border ${
              msg.direction === "outbound" ? "rounded-br-none" : "rounded-bl-none"
            }`}>
              🚫 Mensagem removida
              <div className={`flex items-center gap-1 mt-1 ${msg.direction === "outbound" ? "justify-end" : ""}`}>
                <span className="text-[10px] text-muted-foreground not-italic">
                  {new Date(msg.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
          ) : (
          <div className={`rounded-lg px-3 py-2 ${
            msg.type === "comment"
              ? (msg.direction === "outbound"
                  ? "bg-purple-500/15 border border-purple-500/40 text-foreground rounded-br-none"
                  : "bg-purple-500/10 border border-purple-500/30 text-foreground rounded-bl-none")
              : msg.direction === "outbound"
                ? "bg-primary/20 text-foreground rounded-br-none"
                : "bg-card border border-border text-foreground rounded-bl-none"
          }`}>
            {msg.type === "comment" && (
              <div className="mb-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-purple-600 dark:text-purple-400">
                  <MessageCircle size={11} />
                  <span>{msg.direction === "outbound" ? "Resposta ao comentário" : "Comentário no post"}</span>
                </div>
                {(msg.instagram_post_thumbnail || msg.instagram_post_id) && (
                  <a
                    href={msg.instagram_post_permalink || (msg.instagram_post_id ? `https://www.instagram.com/p/${msg.instagram_post_id}` : "#")}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 flex items-center gap-2 rounded-md bg-background/60 border border-border px-2 py-1.5 hover:bg-background transition-colors"
                    title="Ver post no Instagram"
                  >
                    {msg.instagram_post_thumbnail ? (
                      <img
                        src={msg.instagram_post_thumbnail}
                        alt="Post"
                        className="h-10 w-10 rounded object-cover flex-shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                        <MessageCircle size={16} className="text-muted-foreground" />
                      </div>
                    )}
                    <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                      Ver post <ExternalLink size={10} />
                    </span>
                  </a>
                )}
              </div>
            )}
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
            {msg.direction === "inbound" && (msg.ad_source_url || msg.ad_headline || msg.ad_image_url) && (() => {
              const isInstagram = [msg.ad_source_url, msg.ad_source_id, msg.ad_image_url].some(v => v && v.toLowerCase().includes("instagram"));
              const adLabel = isInstagram ? "Anúncio do Instagram" : "Anúncio do Facebook";
              const fbIcon = <svg viewBox="0 0 24 24" className="w-3 h-3 fill-[#1877F2]"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>;
              const igIcon = <svg viewBox="0 0 24 24" className="w-3 h-3 fill-[#E4405F]"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>;
              const icon = isInstagram ? igIcon : fbIcon;
              return (
                <div className="mb-2 rounded-lg overflow-hidden border border-border bg-muted/40">
                  {msg.ad_image_url && (
                    <div className="relative">
                      <img src={msg.ad_image_url} alt="Anúncio" className="w-full h-48 object-cover" />
                      <span className="absolute top-2 left-2 flex items-center gap-1 bg-background/90 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                        {icon}
                        {adLabel}
                      </span>
                    </div>
                  )}
                  {!msg.ad_image_url && (
                    <div className="flex items-center gap-1 px-3 pt-2">
                      {icon}
                      <span className="text-[10px] font-semibold text-muted-foreground">{adLabel}</span>
                    </div>
                  )}
                  <div className="px-3 py-2 space-y-0.5">
                    {msg.ad_headline && <p className="text-xs font-bold text-foreground leading-tight">{msg.ad_headline}</p>}
                    {msg.ad_account_name && <p className="text-[10px] text-primary/70 font-medium">Conta: {msg.ad_account_name}</p>}
                    {msg.ad_body && <p className="text-[11px] text-muted-foreground line-clamp-2">{msg.ad_body}</p>}
                    {msg.ad_source_url && (
                      <a href={msg.ad_source_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-500 hover:underline truncate block">
                        {msg.ad_source_url.replace(/^https?:\/\//, '').slice(0, 50)}
                      </a>
                    )}
                  </div>
                </div>
              );
            })()}
            <ChatMessageContent message={msg} onMediaClick={onMediaClick} leadName={leadName} />
            <div className={`flex items-center gap-1 mt-1 ${msg.direction === "outbound" ? "justify-end" : ""}`}>
              {msg.channel === "instagram" && msg.instagram_account_id && igAccountsMap?.[msg.instagram_account_id] && (
                <span className="text-[10px] px-1.5 py-0 rounded-full bg-primary/10 text-primary font-medium">
                  @{igAccountsMap[msg.instagram_account_id]}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground">
                {new Date(msg.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
              {msg.direction === "outbound" && getStatusIcon(msg.status)}
            </div>
            {msg.direction === "outbound" && (msg.status === "failed" || msg.status === "error") && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 mt-1 cursor-pointer bg-destructive/15 text-destructive rounded-md px-2 py-0.5 w-fit ml-auto">
                      <AlertCircle size={12} />
                      <span className="text-[11px] font-semibold">Erro</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[280px] text-xs">
                    {msg.error_reason || getDefaultErrorMessage(msg)}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {msg.type === "comment" && msg.direction === "inbound" && msg.instagram_comment_id && (
              <div className="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-purple-500/20">
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent("ig:set-comment-target", {
                      detail: {
                        comment_id: msg.instagram_comment_id,
                        post_id: msg.instagram_post_id ?? null,
                        preview: msg.content ?? "",
                      },
                    }));
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-700 dark:text-purple-300 hover:bg-purple-500/10 rounded px-1.5 py-0.5"
                >
                  <Reply size={11} /> Responder comentário
                </button>
              </div>
            )}
          </div>
          )}
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
