import { useEffect, useState, useCallback } from "react";
import { Mic, File as FileIcon, Image, ExternalLink, Phone, PhoneIncoming, PhoneMissed, PhoneOff, Film, BookOpen, Share2, Star } from "lucide-react";
import { cleanTemplateName } from "@/lib/templateUtils";
import AudioPlayer from "./AudioPlayer";
import AudioTranscriptionToggle from "./AudioTranscriptionToggle";
import { supabase } from "@/integrations/supabase/client";
import { getSignedMediaUrl, extractStoragePath } from "@/lib/mediaUtils";
import { linkify } from "@/lib/linkify";
import { LinkPreview } from "./LinkPreview";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// Detecta conteúdo especial do Instagram (reel, story reply, shared post)
type IgSpecialKind = "reel" | "story" | "share";
function detectInstagramSpecial(content: string | null | undefined): { kind: IgSpecialKind; label: string; caption: string | null } | null {
  if (!content) return null;
  const trimmed = content.trim();
  const patterns: { kind: IgSpecialKind; regex: RegExp; label: string }[] = [
    { kind: "reel", regex: /^🎬\s*Reel compartilhado/i, label: "Reel compartilhado" },
    { kind: "story", regex: /^📖\s*(Resposta a story|Menção em story)/i, label: "Resposta a story" },
    { kind: "share", regex: /^🔗\s*Publicação compartilhada/i, label: "Publicação compartilhada" },
  ];
  for (const p of patterns) {
    const m = trimmed.match(p.regex);
    if (m) {
      const label = (m[1] as string) || p.label;
      const rest = trimmed.replace(p.regex, "").trim();
      const caption = rest
        .replace(/^https?:\/\/\S+/i, "")
        .replace(/^\n?💬\s*/, "")
        .trim();
      return { kind: p.kind, label, caption: caption || null };
    }
  }
  return null;
}

function InstagramSpecialCard({
  kind,
  label,
  caption,
  mediaUrl,
  mediaType,
  onMediaClick,
}: {
  kind: IgSpecialKind;
  label: string;
  caption: string | null;
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
  onMediaClick?: (url: string, type: "image" | "video") => void;
}) {
  const [imgError, setImgError] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const Icon = kind === "reel" ? Film : kind === "story" ? BookOpen : Share2;

  // Detecta vídeo por extensão quando o tipo não foi informado pelo backend
  const looksLikeVideo = mediaUrl ? /\.(mp4|mov|webm|m4v)(\?|$)/i.test(mediaUrl) : false;
  const looksLikeImage = mediaUrl ? /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(mediaUrl) : false;
  const effectiveType: "image" | "video" | null =
    mediaType ?? (looksLikeVideo ? "video" : looksLikeImage ? "image" : null);

  const hasError = effectiveType === "video" ? videoError : imgError;
  const canPreview = !!mediaUrl && !hasError && effectiveType !== null;

  const handleOpen = () => {
    if (!mediaUrl) return;
    if (onMediaClick && effectiveType && !hasError) {
      onMediaClick(mediaUrl, effectiveType);
    } else {
      window.open(mediaUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="flex flex-col gap-2 max-w-[280px]">
      <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#E1306C" }}>
        <Icon size={12} />
        <span>{label}</span>
      </div>
      {canPreview && effectiveType === "video" && (
        <button
          type="button"
          className="relative cursor-pointer rounded-lg overflow-hidden bg-black/5 group text-left"
          onClick={handleOpen}
        >
          <video
            src={mediaUrl!}
            preload="metadata"
            className="w-full max-h-64 object-cover"
            onError={() => setVideoError(true)}
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-12 h-12 rounded-full bg-background/80 flex items-center justify-center group-hover:scale-110 transition-transform">
              <span className="text-foreground text-lg ml-0.5">▶</span>
            </div>
          </div>
        </button>
      )}
      {canPreview && effectiveType === "image" && (
        <img
          src={mediaUrl!}
          alt={label}
          className="rounded-lg max-w-full max-h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity"
          onError={() => setImgError(true)}
          onClick={handleOpen}
        />
      )}
      {!canPreview && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Icon size={20} className="flex-shrink-0" />
          <span className="flex-1">
            {hasError
              ? "Mídia indisponível (expirada no Instagram)"
              : mediaUrl
                ? "Prévia não disponível"
                : "Mídia não disponível"}
          </span>
        </div>
      )}
      {mediaUrl && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleOpen();
          }}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline self-start"
        >
          <ExternalLink size={12} /> Abrir mídia
        </button>
      )}
      {caption && <p className="text-sm whitespace-pre-wrap break-words">{caption}</p>}
    </div>
  );
}

// Renderiza texto com URLs clicáveis + card de preview para o 1º link
function TextWithLinks({ text, className }: { text: string; className?: string }) {
  const { nodes, urls } = linkify(text);
  const previewUrl = urls[0];
  return (
    <div className="min-w-0 max-w-full">
      <p className={`text-sm whitespace-pre-wrap break-words ${className || ""}`}>{nodes}</p>
      {previewUrl && <LinkPreview url={previewUrl} />}
    </div>
  );
}


type ChatMessage = {
  id?: string;
  lead_id?: string;
  type: string;
  content: string | null;
  media_url: string | null;
  transcription?: string | null;
  created_at?: string | null;
  status?: string | null;
  /** Modelo como FOI ENVIADO (gravado pelo send-whatsapp-message). */
  template_snapshot?: TemplateSnapshot | null;
};

/**
 * Modelo do WhatsApp como o paciente o RECEBEU.
 *
 * origem "envio"        → gravado pelo servidor na hora do envio (exato);
 * origem "reconstruido" → mensagem anterior a 19/09/2026, reconstruída uma vez
 *                         pelo histórico (consulta como estava no dia do envio;
 *                         o nome do lead é o de hoje — não há histórico de nome);
 * origem "sem_modelo"/"erro" → só o nome do modelo.
 */
type TemplateSnapshot = {
  v?: number;
  origem?: "envio" | "reconstruido" | "sem_modelo" | "erro" | string;
  nome?: string | null;
  header_type?: string | null;
  header_content?: string | null;
  body?: string | null;
  footer?: string | null;
  buttons?: { type: string; text: string; url?: string }[] | null;
  variaveis_reconstruidas?: boolean;
  /** só no reconstruído: de onde veio a data ({{2}}) */
  data_certeza?: "auditoria" | "nota" | "estimada" | "sem_consulta" | "desconhecida" | string | null;
  /** só no reconstruído: o nome veio do cadastro da consulta da época (senão, o nome atual) */
  nome_da_epoca?: boolean;
};

/** Registro do histórico é imutável: guarda na memória para não buscar de novo. */
const historicoDoModelo = new Map<string, TemplateSnapshot | null>();

const MIDIA_DA_META = /(^|\.)(whatsapp\.net|fbsbx\.com|fbcdn\.net)(\/|$)/i;

/** Aviso visível do que foi reconstruído (mensagens de antes de 19/09/2026). */
function avisoDeReconstrucao(r: TemplateSnapshot): string | null {
  if (r.origem !== "reconstruido" || !r.variaveis_reconstruidas) return null;
  const partes: string[] = [];
  if (r.data_certeza === "estimada") partes.push("data estimada pelo histórico");
  else if (r.data_certeza === "desconhecida") partes.push("a data enviada não pôde ser recuperada");
  else partes.push("texto reconstruído pelo histórico");
  if (!r.nome_da_epoca) partes.push("nome do cadastro atual");
  return `Enviado antes de 19/09/2026 · ${partes.join(" · ")}`;
}

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

/**
 * O balão do modelo mostra O QUE FOI ENVIADO — e nada mais.
 *
 * Até 19/09/2026 este componente remontava o texto a cada abertura da conversa,
 * com o nome ATUAL do lead, a consulta mais próxima entre as que existem HOJE e
 * o texto ATUAL do modelo, num formato próprio. Resultado (relato do dono):
 * remarcou a consulta e recarregou a página → o balão passou a mostrar a data
 * nova, que o paciente nunca recebeu. Agora:
 *   1. mensagem nova: o texto vem de messages.template_snapshot (gravado no envio);
 *   2. mensagem antiga: vem de mensagens_template_historico (reconstruído uma vez);
 *   3. sem nenhum dos dois: mostra só o nome do modelo — NUNCA completa com dados
 *      de hoje, porque isso é mostrar uma mensagem que não foi enviada.
 */
function TemplateMessageBubble({
  templateName,
  messageId,
  snapshot,
  enviando,
  falhou,
}: {
  templateName: string;
  messageId?: string;
  snapshot?: TemplateSnapshot | null;
  enviando?: boolean;
  falhou?: boolean;
}) {
  const [registro, setRegistro] = useState<TemplateSnapshot | null>(snapshot ?? null);
  const [loading, setLoading] = useState(!snapshot && !enviando && !!messageId);
  const [headerSignedUrl, setHeaderSignedUrl] = useState<string | null>(null);
  const [erroDeCarga, setErroDeCarga] = useState(false);
  const [midiaFalhou, setMidiaFalhou] = useState(false);

  useEffect(() => {
    if (snapshot) {
      setRegistro(snapshot);
      setLoading(false);
      return;
    }
    if (enviando || !messageId) {
      setLoading(false);
      return;
    }
    if (historicoDoModelo.has(messageId)) {
      setRegistro(historicoDoModelo.get(messageId) ?? null);
      setLoading(false);
      return;
    }
    let vivo = true;
    setLoading(true);
    setErroDeCarga(false);
    // A tabela é nova e ainda não está nos tipos gerados do Supabase.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("mensagens_template_historico")
      .select("snapshot")
      .eq("message_id", messageId)
      .maybeSingle()
      .then(({ data, error }: { data: { snapshot: TemplateSnapshot } | null; error: unknown }) => {
        if (!vivo) return;
        if (error) {
          // Falha de rede não é "não registrado": não guarda na memória e avisa.
          setErroDeCarga(true);
          setLoading(false);
          return;
        }
        const r = data?.snapshot ?? null;
        // Só guarda o que existe: a reconstrução ainda pode estar rodando.
        if (r) historicoDoModelo.set(messageId, r);
        setRegistro(r);
        setLoading(false);
      });
    return () => {
      vivo = false;
    };
  }, [messageId, snapshot, enviando]);

  // Mídia do cabeçalho: o registro guarda o ponteiro do arquivo; a URL assinada
  // é feita na hora de mostrar (assinatura expira, o arquivo não).
  useEffect(() => {
    const conteudo = registro?.header_content;
    setMidiaFalhou(false);
    if (!conteudo?.startsWith("http")) {
      setHeaderSignedUrl(null);
      return;
    }
    if (extractStoragePath(conteudo)) {
      getSignedMediaUrl(conteudo).then(setHeaderSignedUrl);
      return;
    }
    let vivo = true;
    let host = "";
    try { host = new URL(conteudo).hostname; } catch { /* URL inválida */ }
    if (MIDIA_DA_META.test(host) && registro?.nome) {
      // Link da CDN da Meta vence em ~30 dias. A mídia do cabeçalho é fixa do
      // modelo (não é variável do paciente): mostra a cópia atual do Storage.
      supabase
        .from("crm_whatsapp_templates")
        .select("header_content")
        .eq("name", registro.nome)
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (!vivo) return;
          const atual = data?.header_content || "";
          if (atual && extractStoragePath(atual)) getSignedMediaUrl(atual).then((u) => vivo && setHeaderSignedUrl(u));
          else setHeaderSignedUrl(conteudo);
        });
    } else {
      setHeaderSignedUrl(conteudo);
    }
    return () => {
      vivo = false;
    };
  }, [registro?.header_content, registro?.nome]);

  const nomeLimpo = cleanTemplateName(registro?.nome || templateName);

  if (enviando) {
    return <p className="text-sm text-muted-foreground italic">📋 Enviando o modelo {nomeLimpo}…</p>;
  }
  if (loading) {
    return <p className="text-sm text-muted-foreground italic">Carregando modelo...</p>;
  }
  if (!registro || !registro.body || registro.origem === "sem_modelo" || registro.origem === "erro") {
    return (
      <p className="text-sm whitespace-pre-wrap">
        📋 Modelo: {nomeLimpo}
        {erroDeCarga ? (
          <span className="block text-[11px] text-muted-foreground mt-0.5">
            Não foi possível carregar o texto enviado agora. Recarregue a conversa.
          </span>
        ) : !registro ? (
          <span className="block text-[11px] text-muted-foreground mt-0.5">
            O texto exato enviado ainda não foi registrado para esta mensagem.
          </span>
        ) : registro.origem === "sem_modelo" ? (
          <span className="block text-[11px] text-muted-foreground mt-0.5">
            O modelo foi apagado e o texto enviado não foi guardado.
          </span>
        ) : null}
      </p>
    );
  }

  // Detecta tipo do header de forma robusta:
  // – compara header_type case-insensitivo
  // – usa extensão da URL como fallback (caso header_type esteja errado no banco)
  const hType = (registro.header_type || "").toUpperCase();
  const hUrl = midiaFalhou ? "" : headerSignedUrl || "";
  const isVideoByUrl = /\.(mp4|mov|webm|3gpp?)(\?|#|$)/i.test(hUrl);
  const isHeaderVideo = hType === "VIDEO" || (hType === "IMAGE" && isVideoByUrl);
  const isHeaderImage = hType === "IMAGE" && !isVideoByUrl;
  const isHeaderText = hType === "TEXT";
  const botoes = Array.isArray(registro.buttons) ? registro.buttons : [];

  return (
    <div className="min-w-[220px]">
      {falhou && (
        <p className="text-[11px] font-medium text-destructive mb-1">Modelo não enviado — o paciente não recebeu esta mensagem.</p>
      )}
      {registro.header_type && registro.header_content && (
        <div className="mb-1">
          {isHeaderImage ? (
            hUrl ? (
              <img
                src={headerSignedUrl}
                alt="Imagem do modelo"
                onError={() => setMidiaFalhou(true)}
                className="rounded-t-lg max-h-[160px] w-full object-cover"
              />
            ) : (
              <div className="bg-muted rounded-t-lg h-[120px] flex items-center justify-center">
                <Image size={32} className="text-muted-foreground" />
              </div>
            )
          ) : isHeaderVideo ? (
            hUrl ? (
              <video
                src={headerSignedUrl}
                controls
                onError={() => setMidiaFalhou(true)}
                className="rounded-t-lg max-h-[200px] w-full"
              />
            ) : (
              <div className="bg-muted rounded-t-lg h-[120px] flex items-center justify-center">
                <span className="text-3xl">🎬</span>
              </div>
            )
          ) : isHeaderText ? (
            <p className="text-sm font-bold text-foreground">{registro.header_content}</p>
          ) : null}
        </div>
      )}
      <p className="text-sm whitespace-pre-wrap text-foreground">{registro.body}</p>
      {registro.footer && (
        <p className="text-[11px] text-muted-foreground mt-1">{registro.footer}</p>
      )}
      {avisoDeReconstrucao(registro) && (
        <p className="text-[10.5px] text-muted-foreground mt-1 italic">{avisoDeReconstrucao(registro)}</p>
      )}
      {botoes.length > 0 && (
        <div className="mt-2 -mx-3 -mb-2 border-t border-border/50">
          {botoes.map((btn, i) => (
            <div
              key={i}
              className={`text-center text-xs font-medium text-primary py-2.5 cursor-default select-none ${
                i < botoes.length - 1 ? "border-b border-border/50" : ""
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
  const { tenant } = useTenant();
  const { user } = useAuth();
  const [stickerSaving, setStickerSaving] = useState(false);
  const handleSaveSticker = useCallback(async () => {
    if (!tenant?.id || !message.media_url) return;
    setStickerSaving(true);
    const { error } = await supabase.from("crm_stickers").insert({
      tenant_id: tenant.id,
      media_url: message.media_url,
      origem: "recebida",
      created_by: user?.id ?? null,
    });
    setStickerSaving(false);
    if (error) {
      if ((error as any).code === "23505" || /duplicate|unique/i.test(error.message)) {
        toast("Já está na sua galeria");
      } else {
        toast.error(`Erro ao salvar figurinha: ${error.message}`);
      }
      return;
    }
    toast.success("Figurinha salva");
  }, [tenant?.id, user?.id, message.media_url]);

  // Instagram: reel/story/shared post — render distinctive clickable card
  const igSpecial = detectInstagramSpecial(message.content);
  if (igSpecial) {
    const mediaType: "image" | "video" | null =
      message.type === "video" ? "video" : message.type === "image" ? "image" : null;
    return (
      <InstagramSpecialCard
        kind={igSpecial.kind}
        label={igSpecial.label}
        caption={igSpecial.caption}
        mediaUrl={resolvedUrl}
        mediaType={mediaType}
        onMediaClick={onMediaClick}
      />
    );
  }


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
      return (
        <TemplateMessageBubble
          templateName={name}
          messageId={message.id}
          snapshot={message.template_snapshot ?? null}
          enviando={message.status === "sending"}
          falhou={message.status === "error" || message.status === "failed"}
        />
      );
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
    const isSticker = message.type === "sticker";
    return (
      <div className={isSticker ? "relative group inline-block" : undefined}>
        <img
          src={resolvedUrl!}
          alt={isSticker ? "Figurinha" : "Imagem"}
          className={isSticker ? "max-w-[150px]" : "rounded mb-1 max-w-full max-h-64 cursor-pointer hover:opacity-90 transition-opacity"}
          onError={handleImgError}
          onClick={() => message.type === "image" && onMediaClick ? onMediaClick(resolvedUrl!, "image") : undefined}
        />
        {isSticker && message.media_url && (
          <button
            type="button"
            onClick={handleSaveSticker}
            disabled={stickerSaving}
            title="Salvar na minha galeria"
            className="absolute top-1 right-1 p-1 rounded-full bg-background/90 border border-border shadow-sm text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
          >
            <Star size={14} />
          </button>
        )}
        {message.content?.trim() && (
          <TextWithLinks text={message.content} className="mt-1" />
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
          <video src={resolvedUrl!} preload="metadata" className="rounded mb-1 max-w-full max-h-64" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-background/80 flex items-center justify-center">
              <span className="text-foreground text-lg ml-0.5">▶</span>
            </div>
          </div>
        </div>
        {message.content?.trim() && (
          <TextWithLinks text={message.content} className="mt-1" />
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
      return <TextWithLinks text={message.content} />;
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
          <TextWithLinks text={message.content} />
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
