import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const BUCKET = "chat-media";
const PUBLIC_PATH_MARKER = `/storage/v1/object/public/${BUCKET}/`;
const SIGNED_PATH_MARKER = `/storage/v1/object/sign/${BUCKET}/`;

/**
 * Extracts the storage path from a chat-media URL (public or signed).
 * Returns null if the URL is not a chat-media storage URL.
 */
export function extractStoragePath(url: string): string | null {
  if (!url) return null;

  // Handle public URLs
  const pubIdx = url.indexOf(PUBLIC_PATH_MARKER);
  if (pubIdx !== -1) {
    const raw = url.substring(pubIdx + PUBLIC_PATH_MARKER.length);
    return raw.split("?")[0]; // strip query params
  }

  // Handle signed URLs
  const signIdx = url.indexOf(SIGNED_PATH_MARKER);
  if (signIdx !== -1) {
    const raw = url.substring(signIdx + SIGNED_PATH_MARKER.length);
    return raw.split("?")[0];
  }

  return null;
}

/**
 * Returns a signed URL for a chat-media file.
 * If the input is not a chat-media storage URL, returns it unchanged.
 * Signed URLs expire after 1 hour (3600 seconds).
 */
export async function getSignedMediaUrl(storedUrl: string): Promise<string> {
  const path = extractStoragePath(storedUrl);
  if (!path) return storedUrl; // external URL, return as-is

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600);

  if (error || !data?.signedUrl) {
    console.warn("[mediaUtils] Failed to create signed URL for", path, error);
    return storedUrl;
  }

  return data.signedUrl;
}

/**
 * After uploading a file, get its path for storage in DB.
 * We store the full signed URL so it works immediately,
 * and regenerate signed URLs when displaying.
 */
export async function getUploadedFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600);

  if (error || !data?.signedUrl) {
    // Fallback to constructing URL manually
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  }

  return data.signedUrl;
}
