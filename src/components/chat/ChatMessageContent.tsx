import { Mic, File as FileIcon } from "lucide-react";

type ChatMessage = {
  type: string;
  content: string | null;
  media_url: string | null;
};

const isPublicMediaUrl = (mediaUrl: string | null) => Boolean(mediaUrl?.startsWith("http"));

const getDocumentLabel = (message: ChatMessage) => {
  if (message.content?.trim()) return message.content;
  if (!message.media_url || !isPublicMediaUrl(message.media_url)) return "Documento";

  try {
    const pathname = new URL(message.media_url).pathname;
    return decodeURIComponent(pathname.split("/").pop() || "Documento");
  } catch {
    return "Documento";
  }
};

export default function ChatMessageContent({ message }: { message: ChatMessage }) {
  const hasResolvedMedia = isPublicMediaUrl(message.media_url);

  if (["image", "sticker"].includes(message.type) && hasResolvedMedia) {
    return (
      <img
        src={message.media_url!}
        alt={message.type === "sticker" ? "Figurinha" : "Imagem"}
        className={message.type === "sticker" ? "max-w-[150px]" : "rounded mb-1 max-w-full max-h-64 cursor-pointer hover:opacity-90 transition-opacity"}
        onClick={() => message.type === "image" && window.open(message.media_url!, "_blank")}
      />
    );
  }

  if (message.type === "video" && hasResolvedMedia) {
    return <video src={message.media_url!} controls className="rounded mb-1 max-w-full max-h-64" />;
  }

  if (message.type === "audio") {
    if (hasResolvedMedia) {
      return <audio src={message.media_url!} controls className="max-w-full min-w-[200px]" />;
    }

    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Mic size={14} className="text-primary" />
        <span>Áudio salvo, carregando mídia...</span>
      </div>
    );
  }

  if (message.type === "document") {
    if (hasResolvedMedia) {
      return (
        <a href={message.media_url!} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary hover:underline p-2 bg-secondary/50 rounded">
          <FileIcon size={18} />
          <span className="truncate">{getDocumentLabel(message)}</span>
        </a>
      );
    }

    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-2 bg-secondary/50 rounded">
        <FileIcon size={18} />
        <span className="truncate">{getDocumentLabel(message)} — carregando arquivo...</span>
      </div>
    );
  }

  if (message.content?.trim()) {
    return <p className="text-sm whitespace-pre-wrap">{message.content}</p>;
  }

  if (message.media_url && !hasResolvedMedia) {
    return <p className="text-sm text-muted-foreground italic">[{message.type}] carregando mídia antiga...</p>;
  }

  if (message.type !== "text") {
    return <p className="text-sm text-muted-foreground italic">[{message.type}]</p>;
  }

  return null;
}
