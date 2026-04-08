import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const BUCKET = "chat-media";
const PUBLIC_PATH_MARKER = `/storage/v1/object/public/${BUCKET}/`;
const SIGNED_PATH_MARKER = `/storage/v1/object/sign/${BUCKET}/`;

// In-memory signed URL cache: path -> { url, expiresAt }
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const SIGNED_URL_TTL = 50 * 60_000; // 50 minutes (URLs expire in 60 min, refresh early)
// Dedup in-flight requests
const inflightRequests = new Map<string, Promise<string>>();

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
 * Uses an in-memory cache to avoid redundant network requests.
 * If the input is not a chat-media storage URL, returns it unchanged.
 */
export async function getSignedMediaUrl(storedUrl: string): Promise<string> {
  const path = extractStoragePath(storedUrl);
  if (!path) return storedUrl; // external URL, return as-is

  // Check cache
  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  // Dedup: if there's already an inflight request for this path, reuse it
  const existing = inflightRequests.get(path);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, 3600);

      if (error || !data?.signedUrl) {
        console.warn("[mediaUtils] Failed to create signed URL for", path, error);
        return storedUrl;
      }

      // Cache the result
      signedUrlCache.set(path, {
        url: data.signedUrl,
        expiresAt: Date.now() + SIGNED_URL_TTL,
      });

      return data.signedUrl;
    } finally {
      inflightRequests.delete(path);
    }
  })();

  inflightRequests.set(path, promise);
  return promise;
}

/**
 * Batch-sign multiple media URLs at once. 
 * Returns a map from original URL to signed URL.
 */
export async function batchSignMediaUrls(urls: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const toSign: { originalUrl: string; path: string }[] = [];

  for (const url of urls) {
    if (!url) continue;
    const path = extractStoragePath(url);
    if (!path) {
      result.set(url, url);
      continue;
    }
    const cached = signedUrlCache.get(path);
    if (cached && cached.expiresAt > Date.now()) {
      result.set(url, cached.url);
      continue;
    }
    toSign.push({ originalUrl: url, path });
  }

  // Sign all uncached URLs in parallel
  if (toSign.length > 0) {
    const promises = toSign.map(async ({ originalUrl, path }) => {
      const signed = await getSignedMediaUrl(originalUrl);
      result.set(originalUrl, signed);
    });
    await Promise.all(promises);
  }

  return result;
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

  // Also cache this
  signedUrlCache.set(path, {
    url: data.signedUrl,
    expiresAt: Date.now() + SIGNED_URL_TTL,
  });

  return data.signedUrl;
}
