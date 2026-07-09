// Edge function: link-preview
// Faz fetch da URL e extrai Open Graph / meta tags para exibir um card de preview.
// Requer JWT (usuário autenticado).

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

async function fetchPreview(url: string): Promise<Preview> {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; RizoDentBot/1.0; +https://rizodent-gestao.lovable.app)",
      Accept: "text/html,application/xhtml+xml",
    },
  });

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
      JSON.stringify({ error: "fetch_failed", detail: String(e) }),
      {
        status: 200, // 200 para não estourar toast no cliente
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
