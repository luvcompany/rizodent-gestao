// Allowlist de URLs de mídia — barra SSRF de segunda ordem.
//
// Motivo: várias functions leem `media_url` / `recording_url` de uma linha do
// banco e fazem `fetch()` direto. Quem consegue gravar nessas colunas (webhook,
// import, um cliente malicioso) passa a poder fazer a edge function bater em
// endereços internos (metadata da nuvem, 127.0.0.1, redes privadas) e, em
// alguns casos, ver o corpo da resposta na transcrição/sugestão.
//
// Regra: só https, e só hosts conhecidos (Storage do próprio projeto, CDN da
// Meta e o domínio de gravação da Api4Com). IP literal é sempre recusado.

const META_HOSTS = new Set([
  "lookaside.fbsbx.com",
  "lookaside.facebook.com",
]);

// Domínio das gravações da Api4Com (ver api4com_calls.recording_url).
const API4COM_HOSTS = new Set([
  "listener.api4com.com",
  "api.api4com.com",
]);

function isIpLiteral(host: string): boolean {
  // IPv4 puro ou qualquer coisa entre colchetes (IPv6) => sempre recusado.
  if (host.startsWith("[")) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function hostAllowed(host: string, supabaseHost: string): boolean {
  const h = host.toLowerCase();
  if (supabaseHost && h === supabaseHost) return true;
  if (META_HOSTS.has(h)) return true;
  if (API4COM_HOSTS.has(h)) return true;
  if (h === "whatsapp.net" || h.endsWith(".whatsapp.net")) return true;
  if (/^scontent([.-][a-z0-9-]+)*\.fbcdn\.net$/.test(h)) return true;
  return false;
}

export type MediaUrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * Valida uma URL de mídia antes de qualquer fetch.
 * Aceita também caminhos relativos dos buckets `chat-media` / `call-recordings`
 * (`chat-media/...`), que são resolvidos contra o Storage do próprio projeto.
 */
export function assertAllowedMediaUrl(raw: string | null | undefined): MediaUrlCheck {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, error: "media_url ausente" };

  const supabaseUrl = (globalThis as any).Deno?.env?.get?.("SUPABASE_URL") || "";
  let supabaseHost = "";
  try {
    supabaseHost = supabaseUrl ? new URL(supabaseUrl).host.toLowerCase() : "";
  } catch (_) { /* ignore */ }

  // Caminho de bucket (sem esquema) => resolve para o Storage do projeto.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    const path = value.replace(/^\/+/, "");
    const bucket = path.split("/")[0];
    if (bucket !== "chat-media" && bucket !== "call-recordings") {
      return { ok: false, error: "bucket de mídia não permitido" };
    }
    if (!supabaseUrl) return { ok: false, error: "SUPABASE_URL indisponível" };
    return { ok: true, url: `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${path}` };
  }

  let u: URL;
  try {
    u = new URL(value);
  } catch (_) {
    return { ok: false, error: "media_url inválida" };
  }

  if (u.protocol !== "https:") return { ok: false, error: "media_url deve usar https" };
  if (isIpLiteral(u.hostname)) return { ok: false, error: "media_url por IP não é permitida" };
  if (!hostAllowed(u.hostname, supabaseHost)) {
    return { ok: false, error: `host de mídia não permitido: ${u.hostname}` };
  }
  return { ok: true, url: u.toString() };
}

// touch
