import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/components/chat/imageCompressor";
import { toast } from "sonner";

export const MEDIA_LIMITS = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
};

export type MediaKind = "image" | "video" | "document" | "audio";

export function detectKind(file: File | Blob, fallbackName?: string): MediaKind {
  const type = (file as File).type || "";
  const name = ((file as File).name || fallbackName || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (/\.(ogg|opus|mp3|m4a|aac|wav|webm|amr)$/i.test(name)) return "audio";
  return "document";
}

export async function uploadAutomationMedia(
  file: File | Blob,
  folder: string,
  opts?: { fileName?: string; contentType?: string }
): Promise<{ url: string; path: string; name: string; mime: string } | null> {
  let toUpload: File | Blob = file;
  const name = opts?.fileName || (file as File).name || `arquivo_${Date.now()}`;
  const kind = detectKind(file, name);

  // Validate sizes — mirror ChatInput rules
  if (kind === "image" && (file as File).size > MEDIA_LIMITS.image) {
    toast.error("Imagem maior que 5MB.");
    return null;
  }
  if (kind === "video" && (file as File).size > MEDIA_LIMITS.video) {
    toast.error("Vídeo maior que 16MB.");
    return null;
  }
  if (kind === "document" && (file as File).size > MEDIA_LIMITS.document) {
    toast.error("Documento maior que 100MB.");
    return null;
  }
  if (kind === "audio" && (file as File).size > MEDIA_LIMITS.audio) {
    toast.error("Áudio maior que 16MB.");
    return null;
  }

  // Compress images > 4MB (same as ChatInput)
  if (kind === "image" && (file as File).size > 4 * 1024 * 1024) {
    try {
      toUpload = await compressImage(file as File);
    } catch {
      // keep original
    }
  }

  const ext = name.includes(".") ? name.split(".").pop() : "bin";
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const contentType = opts?.contentType || (file as File).type || undefined;

  const { error } = await supabase.storage.from("chat-media").upload(path, toUpload, {
    contentType,
  });
  if (error) {
    toast.error(`Erro ao fazer upload: ${error.message}`);
    return null;
  }

  // Long-lived signed URL (1 year) — automations fire later and Meta needs accessible URL
  const { data, error: signErr } = await supabase.storage
    .from("chat-media")
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  if (signErr || !data?.signedUrl) {
    toast.error("Erro ao gerar URL do arquivo.");
    return null;
  }

  return {
    url: data.signedUrl,
    path,
    name,
    mime: contentType || "application/octet-stream",
  };
}
