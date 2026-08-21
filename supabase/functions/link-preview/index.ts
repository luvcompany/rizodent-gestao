// Edge function: link-preview
// Faz fetch da URL e extrai Open Graph / meta tags para exibir um card de preview.
// Requer JWT (usuário autenticado). Protegido contra SSRF.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { resolveCaller } from "../_shared/authz.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Preview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  host: string;
}

function pickMeta(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      return decodeHtml(m[1].trim());
    }
  }
  return null;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function absolutize(base: string, maybe: string | null): string | null {
  if (!maybe) return null;
  try {
    return new URL(maybe, base).toString();
  } catch {
    return null;
  }
}

// ===== Anti-SSRF =====
function isBlockedIp(ip: string): boolean {
  const v4mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4mapped) ip = v4mapped[1];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local / metadata
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  const low = ip.toLowerCase();
  if (low === "::1" || low === "::" ) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(low)) return true; // fc00::/7
  if (low.startsWith("fe80:")) return true; // link-local
  return false;
}

async function assertPublicTarget(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("invalid_url"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("blocked_scheme");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error("blocked_host");
  }
  if (/^[\d.]+$/.test(host) || host.includes(":")) {
    if (isBlockedIp(host)) throw new Error("blocked_host");
    return u;
  }
  const records: string[] = [];
  for (const type of ["A", "AAAA"] as const) {
    try {
      const r = await (Deno as any).resolveDns(host, type);
      if (Array.isArray(r)) records.push(...r);
    } catch { /* noop */ }
  }
  if (records.length === 0) throw new Error("dns_failed");
  if (records.some((ip) => isBlockedIp(ip))) throw new Error("blocked_host");
  return u;
}

async function safeFetch(rawUrl: string): Promise<Response> {
  let target = await assertPublicTarget(rawUrl);
  for (let hop = 0; hop <= 3; hop++) {
    const res = await fetch(target.toString(), {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; RizoDentBot/1.0; +https://rizodent-gestao.lovable.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      try { await res.body?.cancel(); } catch { /* noop */ }
      if (!loc || hop === 3) throw new Error("too_many_redirects");
      target = await assertPublicTarget(new URL(loc, target).toString());
      continue;
    }
    return res;
  }
  throw new Error("too_many_redirects");
}

async function fetchPreview(url: string): Promise<Preview> {
  const res = await safeFetch(url);

  const finalUrl = res.url || url;
  const host = new URL(finalUrl).host;

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("xhtml")) {
    // Ex.: link direto para imagem/PDF
    return {
      url: finalUrl,
      title: null,
      description: null,
      image: contentType.startsWith("image/") ? finalUrl : null,
      siteName: null,
      host,
    };
  }

  // Limita leitura a 512 KB — meta tags ficam sempre no head
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const MAX = 512 * 1024;
  if (reader) {
    while (total < MAX) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    try { await reader.cancel(); } catch { /* noop */ }
  }
  const html = new TextDecoder("utf-8", { fatal: false }).decode(
    concat(chunks),
  );

  const title = pickMeta(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([^<]+)<\/title>/i,
  ]);
  const description = pickMeta(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  ]);
  const image = pickMeta(html, [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ]);
  const siteName = pickMeta(html, [
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
  ]);

  return {
    url: finalUrl,
    title,
    description,
    image: absolutize(finalUrl, image),
    siteName,
    host,
  };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const { url } = await req.json().catch(() => ({ url: null }));
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return new Response(JSON.stringify({ error: "invalid_url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Requer usuário autenticado (JWT válido).
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const caller = await resolveCaller(req, supabase);
    if (!caller.ok) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: caller.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const preview = await fetchPreview(url);
    return new Response(JSON.stringify(preview), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    console.error("[link-preview] error:", e);
    return new Response(
      JSON.stringify({ error: "fetch_failed" }),
      {
        status: 200, // 200 para não estourar toast no cliente
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
