import { useEffect, useState, useCallback } from "react";
import { Mic, File as FileIcon, Image, ExternalLink, Phone, PhoneIncoming, PhoneMissed, PhoneOff } from "lucide-react";
import { cleanTemplateName } from "@/lib/templateUtils";
import AudioPlayer from "./AudioPlayer";
import AudioTranscriptionToggle from "./AudioTranscriptionToggle";
import { supabase } from "@/integrations/supabase/client";
import { getSignedMediaUrl, extractStoragePath } from "@/lib/mediaUtils";

type ChatMessage = {
  id?: string;
  lead_id?: string;
  type: string;
  content: string | null;
  media_url: string | null;
  transcription?: string | null;
  created_at?: string | null;
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

const formatAppointmentLabel = (scheduledDate?: string | null, scheduledTime?: string | null) => {
  if (!scheduledDate) return "data e horário a confirmar";

  const [year, month, day] = scheduledDate.split("-");
  const timeLabel = scheduledTime ? ` às ${scheduledTime.slice(0, 5)}` : "";
  return `${day}/${month}/${year}${timeLabel}`;
};

function replaceTemplatePlaceholders(
  text: string,
  values: {
    leadName: string;
    appointmentLabel?: string | null;
    serviceLabel?: string | null;
  },
): string {
  if (!text) return text;

  const safeLeadName = values.leadName.trim() || "cliente";
  const safeAppointmentLabel = values.appointmentLabel?.trim() || "data e horário a confirmar";
  const safeServiceLabel = values.serviceLabel?.trim() || "consulta";

  return text
    .replace(/\{\{\s*1\s*\}\}/g, safeLeadName)
    .replace(/\{\{\s*2\s*\}\}/g, safeAppointmentLabel)
    .replace(/\{\{\s*3\s*\}\}/g, safeServiceLabel)
    .replace(/\[primeiro nome\]/gi, safeLeadName)
    .replace(/\[nome\]/gi, safeLeadName)
    .replace(/\[data e horário\]/gi, safeAppointmentLabel)
    .replace(/\[data e horario\]/gi, safeAppointmentLabel)
    .replace(/\[data\]/gi, safeAppointmentLabel)
    .replace(/\[serviço\]/gi, safeServiceLabel)
    .replace(/\[servico\]/gi, safeServiceLabel);
}

function TemplateMessageBubble({
  templateName,
  leadName,
  leadId,
  messageCreatedAt,
}: {
  templateName: string;
  leadName?: string;
  leadId?: string;
  messageCreatedAt?: string | null;
}) {
  const [template, setTemplate] = useState<TemplateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [headerSignedUrl, setHeaderSignedUrl] = useState<string | null>(null);
  const [resolvedLeadName, setResolvedLeadName] = useState<string>(leadName?.trim() || "");
  const [resolvedAppointmentLabel, setResolvedAppointmentLabel] = useState<string>("data e horário a confirmar");
  const [resolvedServiceLabel, setResolvedServiceLabel] = useState<string>("consulta");

  useEffect(() => {
    let isMounted = true;

    if (!leadId) {
      setResolvedLeadName(leadName?.trim() || "");
      return () => {
        isMounted = false;
      };
    }

    Promise.all([
      supabase
        .from("crm_leads")
        .select("name, servico_interesse")
        .eq("id", leadId)
        .maybeSingle(),
      supabase
        .from("crm_appointments")
        .select("scheduled_date, scheduled_time, status, created_at")
        .eq("lead_id", leadId)
        .order("scheduled_date", { ascending: false })
        .order("scheduled_time", { ascending: false }),
    ]).then(([leadResult, appointmentResult]) => {
      if (!isMounted) return;

      const fetchedLeadName = leadResult.data?.name?.trim() || leadName?.trim() || "";
      const fetchedService = leadResult.data?.servico_interesse?.trim() || "consulta";

      const appts = appointmentResult.data || [];
      let chosen: { scheduled_date: string | null; scheduled_time: string | null } | null = null;

      if (appts.length > 0) {
        const msgTime = messageCreatedAt ? new Date(messageCreatedAt).getTime() : null;
        const scoreDistance = (a: typeof appts[number]) => {
          if (!a.scheduled_date || msgTime == null) return Number.POSITIVE_INFINITY;
          const t = new Date(`${a.scheduled_date}T${a.scheduled_time || "00:00:00"}`).getTime();
          return Math.abs(t - msgTime);
        };

        const active = appts.filter((a) => a.status === "confirmed" || a.status === "pending");
        const pool = active.length > 0 ? active : appts;

        if (msgTime != null) {
          chosen = [...pool].sort((a, b) => scoreDistance(a) - scoreDistance(b))[0];
        } else {
          chosen = pool[0];
        }
      }

      const appointmentLabel = chosen
        ? formatAppointmentLabel(chosen.scheduled_date, chosen.scheduled_time)
        : "data e horário a confirmar";

      setResolvedLeadName(fetchedLeadName);
      setResolvedServiceLabel(fetchedService);
      setResolvedAppointmentLabel(appointmentLabel);
    });

    return () => {
      isMounted = false;
    };
  }, [leadId, leadName, messageCreatedAt]);

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

          // Busca URL para qualquer header que seja uma URL (IMAGE, VIDEO, ou type incorreto)
          if (data.header_content?.startsWith("http")) {
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
    ? replaceTemplatePlaceholders(template.body_text, {
        leadName: resolvedLeadName || "cliente",
        appointmentLabel: resolvedAppointmentLabel,
        serviceLabel: resolvedServiceLabel,
      })
    : null;

  // Detecta tipo do header de forma robusta:
  // – compara header_type case-insensitivo
  // – usa extensão da URL como fallback (caso header_type esteja errado no banco)
  const hType = (template.header_type || "").toUpperCase();
  const hUrl = headerSignedUrl || "";
  const isVideoByUrl = /\.(mp4|mov|webm|3gpp?)(\?|#|$)/i.test(hUrl);
  const isHeaderVideo = hType === "VIDEO" || (hType === "IMAGE" && isVideoByUrl);
  const isHeaderImage = hType === "IMAGE" && !isVideoByUrl;
  const isHeaderText = hType === "TEXT";

  return (
    <div className="min-w-[220px]">
      {template.header_type && template.header_content && (
        <div className="mb-1">
          {isHeaderImage ? (
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
          ) : isHeaderVideo ? (
            headerSignedUrl ? (
              <video
                src={headerSignedUrl}
                controls
                className="rounded-t-lg max-h-[200px] w-full"
              />
            ) : (
              <div className="bg-muted rounded-t-lg h-[120px] flex items-center justify-center">
                <span className="text-3xl">🎬</span>
              </div>
            )
          ) : isHeaderText ? (
            <p className="text-sm font-bold text-foreground">{template.header_content}</p>
          ) : null}
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

function useSignedUrl(mediaUrl: string | null): string | null {
  // If it's a chat-media storage URL, start as null so we don't render the (potentially 403) public URL
  const initial = mediaUrl && extractStoragePath(mediaUrl) ? null : mediaUrl;
  const [signedUrl, setSignedUrl] = useState<string | null>(initial);

  useEffect(() => {
    if (!mediaUrl || !isMediaUrl(mediaUrl)) {
      setSignedUrl(mediaUrl);
      return;
    }

    const storagePath = extractStoragePath(mediaUrl);
    if (storagePath) {
      setSignedUrl(null);
      getSignedMediaUrl(mediaUrl).then(setSignedUrl);
    } else {
      setSignedUrl(mediaUrl);
    }
  }, [mediaUrl]);

  return signedUrl;
}

export default function ChatMessageContent({
  message,
  onMediaClick,
  leadName,
}: {
  message: ChatMessage;
  onMediaClick?: (url: string, type: "image" | "video") => void;
  leadName?: string;
}) {
  const resolvedUrl = useSignedUrl(message.media_url);
  const hasResolvedMedia = isMediaUrl(resolvedUrl);
  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [resolvedUrl]);
  const handleImgError = useCallback(() => setImgError(true), []);

  if (message.type === "call") {
    const label = message.content || "📞 Chamada de voz";
    const isMissed = /perdida|não atendida/i.test(label);
    const isRejected = /recusada/i.test(label);
    const isFailed = /não completada|falhou/i.test(label);
    const isInbound = /recebida/i.test(label);
    let Icon = Phone;
    let color = "text-foreground";
    if (isMissed || isRejected || isFailed) {
      Icon = isRejected ? PhoneOff : PhoneMissed;
      color = "text-destructive";
    } else if (isInbound) {
      Icon = PhoneIncoming;
    }
    const clean = label.replace(/^📞\s*/, "");
    const hasRecording = isMediaUrl(resolvedUrl);
    return (
      <div className="flex flex-col gap-1.5">
        <div className={`flex items-center gap-2 text-sm ${color}`}>
          <Icon size={16} className="flex-shrink-0" />
          <span className="whitespace-nowrap">{clean}</span>
        </div>
        {hasRecording && (
          <>
            <AudioPlayer src={resolvedUrl!} />
            <AudioTranscriptionToggle messageId={message.id} initialTranscription={message.transcription} />
          </>
        )}
      </div>
    );
  }

  if (message.type === "template" || message.content?.startsWith("📋 Template:")) {
    const name = message.type === "template"
      ? message.content?.replace("📋 Template: ", "").trim() || ""
      : message.content?.replace("📋 Template: ", "").trim() || "";
    if (name) {
      return <TemplateMessageBubble templateName={name} leadName={leadName} leadId={message.lead_id} messageCreatedAt={message.created_at} />;
    }
  }

  if (["image", "sticker"].includes(message.type) && hasResolvedMedia) {
    if (imgError) {
      return (
        <p className="text-sm text-muted-foreground italic">
          {message.content?.trim() || (message.type === "sticker" ? "🩷 Figurinha" : "🖼️ Imagem")}
        </p>
      );
    }
    return (
      <div>
        <img
          src={resolvedUrl!}
          alt={message.type === "sticker" ? "Figurinha" : "Imagem"}
          className={message.type === "sticker" ? "max-w-[150px]" : "rounded mb-1 max-w-full max-h-64 cursor-pointer hover:opacity-90 transition-opacity"}
          onError={handleImgError}
          onClick={() => message.type === "image" && onMediaClick ? onMediaClick(resolvedUrl!, "image") : undefined}
        />
        {message.content?.trim() && (
          <p className="text-sm whitespace-pre-wrap mt-1">{message.content}</p>
        )}
      </div>
    );
  }

  if (message.type === "video" && hasResolvedMedia) {
    const isInstagramPermalink = /instagram\.com\/(reel|p|tv)\//i.test(resolvedUrl!);
    if (isInstagramPermalink) {
      return (
        <a
          href={resolvedUrl!}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-primary hover:underline p-2 bg-secondary/50 rounded"
        >
          <span>🎬</span>
          <span className="flex-1 truncate">{message.content?.trim() || "Ver no Instagram"}</span>
          <ExternalLink size={14} className="flex-shrink-0" />
        </a>
      );
    }
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
      return (
        <div>
          <AudioPlayer src={resolvedUrl!} />
          <AudioTranscriptionToggle messageId={message.id} initialTranscription={message.transcription} />
        </div>
      );
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

  if (message.content?.trim() || hasResolvedMedia) {
    return (
      <div>
        {hasResolvedMedia && (
          imgError ? (
            <p className="text-sm text-muted-foreground italic">🖼️ Mídia expirada</p>
          ) : (
            <img
              src={resolvedUrl!}
              alt="Mídia"
              className="rounded mb-1 max-w-full max-h-64 cursor-pointer hover:opacity-90 transition-opacity"
              onError={handleImgError}
              onClick={() => onMediaClick?.(resolvedUrl!, "image")}
            />
          )
        )}
        {message.content?.trim() && (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        )}
      </div>
    );
  }

  if (message.media_url && !hasResolvedMedia) {
    return <p className="text-sm text-muted-foreground italic">[{message.type}] carregando mídia antiga...</p>;
  }

  if (message.type !== "text") {
    return <p className="text-sm text-muted-foreground italic">[{message.type}]</p>;
  }

  return null;
}
