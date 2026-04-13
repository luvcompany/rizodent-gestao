import { useState, useEffect } from "react";
import { Mic, File as FileIcon, Image } from "lucide-react";
import { cleanTemplateName } from "@/lib/templateUtils";
import AudioPlayer from "./AudioPlayer";
import { supabase } from "@/integrations/supabase/client";
import { getSignedMediaUrl, extractStoragePath } from "@/lib/mediaUtils";

type ChatMessage = {
  type: string;
  content: string | null;
  media_url: string | null;
};

type TemplateData = {
  header_type: string | null;
  header_content: string | null;
  body_text: string | null;
  footer_text: string | null;
  buttons: { type: string; text: string; url?: string }[] | null;
};

const isMediaUrl = (mediaUrl: string | null) => Boolean(mediaUrl?.startsWith("http"));

const getDocumentLabel = (message: ChatMessage) => {
  if (message.content?.trim()) return message.content;
  if (!message.media_url || !isMediaUrl(message.media_url)) return "Documento";
  try {
    const pathname = new URL(message.media_url).pathname;
    return decodeURIComponent(pathname.split("/").pop() || "Documento");
  } catch {
    return "Documento";
  }
};

/** Replace {{1}}, {{2}}, etc. in template body with lead data */
function replaceTemplatePlaceholders(text: string, leadName: string): string {
  if (!text) return text;
  // {{1}} is typically the lead name; additional placeholders get the same fallback
    const name = leadName || "cliente";
    const fallbacks = [name];
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, index) => {
    const i = Number(index) - 1;
    return fallbacks[i] ?? leadName || "cliente";
  });
}

function TemplateMessageBubble({ templateName, leadName }: { templateName: string; leadName?: string }) {
  const [template, setTemplate] = useState<TemplateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [headerSignedUrl, setHeaderSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("crm_whatsapp_templates")
      .select("header_type, header_content, body_text, footer_text, buttons")
      .eq("name", templateName)
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) {
          setTemplate({
            ...data,
            buttons: data.buttons as TemplateData["buttons"],
          });
          // If header is IMAGE, resolve signed URL
          if (data.header_type === "IMAGE" && data.header_content) {
            const storagePath = extractStoragePath(data.header_content);
            if (storagePath) {
              getSignedMediaUrl(data.header_content).then(setHeaderSignedUrl);
            } else {
              setHeaderSignedUrl(data.header_content);
            }
          }
        }
        setLoading(false);
      });
  }, [templateName]);

  if (loading) {
    return <p className="text-sm text-muted-foreground italic">Carregando template...</p>;
  }

  if (!template) {
    return <p className="text-sm whitespace-pre-wrap">📋 Template: {cleanTemplateName(templateName)}</p>;
  }

  const resolvedBodyText = template.body_text
    ? replaceTemplatePlaceholders(template.body_text, leadName || "cliente")
    : null;

  return (
    <div className="min-w-[220px]">
      {template.header_type && template.header_content && (
        <div className="mb-1">
          {template.header_type === "IMAGE" ? (
            headerSignedUrl ? (
              <img
                src={headerSignedUrl}
                alt="Template header"
                className="rounded-t-lg max-h-[160px] w-full object-cover"
              />
            ) : (
              <div className="bg-muted rounded-t-lg h-[120px] flex items-center justify-center">
                <Image size={32} className="text-muted-foreground" />
              </div>
            )
          ) : (
            <p className="text-sm font-bold text-foreground">{template.header_content}</p>
          )}
        </div>
      )}
      {resolvedBodyText && (
        <p className="text-sm whitespace-pre-wrap text-foreground">{resolvedBodyText}</p>
      )}
      {template.footer_text && (
        <p className="text-[11px] text-muted-foreground mt-1">{template.footer_text}</p>
      )}
      {template.buttons && template.buttons.length > 0 && (
        <div className="mt-2 -mx-3 -mb-2 border-t border-border/50">
          {template.buttons.map((btn, i) => (
            <div
              key={i}
              className={`text-center text-xs font-medium text-primary py-2.5 cursor-default select-none ${
                i < template.buttons!.length - 1 ? "border-b border-border/50" : ""
              }`}
            >
              {btn.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Hook to resolve a media URL to a signed URL if it's a chat-media storage URL.
 */
function useSignedUrl(mediaUrl: string | null): string | null {
  const [signedUrl, setSignedUrl] = useState<string | null>(mediaUrl);

  useEffect(() => {
    if (!mediaUrl || !isMediaUrl(mediaUrl)) {
      setSignedUrl(mediaUrl);
      return;
    }

    const storagePath = extractStoragePath(mediaUrl);
    if (storagePath) {
      getSignedMediaUrl(mediaUrl).then(setSignedUrl);
    } else {
      setSignedUrl(mediaUrl);
    }
  }, [mediaUrl]);

  return signedUrl;
}

export default function ChatMessageContent({ message, onMediaClick, leadName }: { message: ChatMessage; onMediaClick?: (url: string, type: "image" | "video") => void; leadName?: string }) {
  const resolvedUrl = useSignedUrl(message.media_url);
  const hasResolvedMedia = isMediaUrl(resolvedUrl);

  // Template messages
  if (message.type === "template" || message.content?.startsWith("📋 Template:")) {
    const name = message.type === "template"
      ? message.content?.replace("📋 Template: ", "").trim() || ""
      : message.content?.replace("📋 Template: ", "").trim() || "";
    if (name) {
      return <TemplateMessageBubble templateName={name} leadName={leadName} />;
    }
  }

  if (["image", "sticker"].includes(message.type) && hasResolvedMedia) {
    return (
      <div>
        <img
          src={resolvedUrl!}
          alt={message.type === "sticker" ? "Figurinha" : "Imagem"}
          className={message.type === "sticker" ? "max-w-[150px]" : "rounded mb-1 max-w-full max-h-64 cursor-pointer hover:opacity-90 transition-opacity"}
          onClick={() => message.type === "image" && onMediaClick ? onMediaClick(resolvedUrl!, "image") : undefined}
        />
        {message.content?.trim() && (
          <p className="text-sm whitespace-pre-wrap mt-1">{message.content}</p>
        )}
      </div>
    );
  }

  if (message.type === "video" && hasResolvedMedia) {
    return (
      <div>
        <div className="relative cursor-pointer" onClick={() => onMediaClick?.(resolvedUrl!, "video")}>
          <video src={resolvedUrl!} className="rounded mb-1 max-w-full max-h-64" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-background/80 flex items-center justify-center">
              <span className="text-foreground text-lg ml-0.5">▶</span>
            </div>
          </div>
        </div>
        {message.content?.trim() && (
          <p className="text-sm whitespace-pre-wrap mt-1">{message.content}</p>
        )}
      </div>
    );
  }

  if (message.type === "audio") {
    if (hasResolvedMedia) {
      return <AudioPlayer src={resolvedUrl!} />;
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
        <a href={resolvedUrl!} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary hover:underline p-2 bg-secondary/50 rounded">
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

  if (["button", "interactive", "reaction", "contacts", "location", "order", "referral", "system"].includes(message.type)) {
    if (message.content?.trim()) {
      return <p className="text-sm whitespace-pre-wrap">{message.content}</p>;
    }
    return <p className="text-sm text-muted-foreground italic">[{message.type}]</p>;
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
