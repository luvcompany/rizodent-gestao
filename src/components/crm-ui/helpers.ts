/**
 * Funções puras do crm-ui (separadas dos componentes para o fast refresh).
 */

export type KnownChannel = "whatsapp" | "instagram" | "facebook" | "google" | "phone" | "indicacao";

/** `conversa`: canal da conversa (regra do ChannelBadgeIcon). `origem`: origem do lead. */
export type ChannelVariant = "conversa" | "origem";

/**
 * Canal da CONVERSA pela mesma regra do ChannelBadgeIcon: só Instagram que
 * não é `instagram_ad` vira Instagram; todo o resto (inclusive vazio) é WhatsApp.
 */
export function conversationChannel(source: string | null | undefined): "whatsapp" | "instagram" {
  const s = (source || "").toLowerCase();
  return s.includes("instagram") && !s.includes("instagram_ad") ? "instagram" : "whatsapp";
}

/** Normaliza a origem crua do banco para um canal conhecido (ou null). */
export function normalizeChannel(channel: string | null | undefined): KnownChannel | null {
  const s = (channel || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!s) return null;
  if (s.includes("whatsapp") || s === "wa" || s === "wpp") return "whatsapp";
  if (s.includes("instagram") || s === "ig") return "instagram";
  if (s.includes("facebook") || s === "fb") return "facebook";
  if (s.includes("google")) return "google";
  if (s === "phone" || s.includes("telefone") || s.includes("ligacao")) return "phone";
  if (s.includes("indicacao") || s === "referral") return "indicacao";
  return null;
}

/**
 * Iniciais do nome pela regra que as telas já usam
 * (`split(" ").map(w => w[0]).join("").slice(0, 2)`): 1ª letra das DUAS
 * PRIMEIRAS palavras ("Maria da Silva" → "MD"); nome de uma palavra → 1 letra.
 * Única diferença: ignora o que não é letra/dígito (emoji, pontuação), onde a
 * regra antiga cortava o emoji ao meio. Para texto idêntico ao da tela, passe
 * `initials` no InitialsAvatar.
 */
export function initialsOf(name: string | null | undefined): string {
  const words = (name || "")
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? "")
    .join("")
    .toUpperCase();
}

/** Converte a série em pontos (x, y) dentro da caixa, com 2px de respiro para o traço. */
export function sparklinePoints(data: ReadonlyArray<number>, width: number, height: number): Array<[number, number]> {
  const pad = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;
  const stepX = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;
  return data.map((v, i) => {
    const x = pad + i * stepX;
    // Série constante: linha no meio (não inventa inclinação).
    const y = range === 0 ? height / 2 : pad + (1 - (v - min) / range) * (height - pad * 2);
    return [Number(x.toFixed(2)), Number(y.toFixed(2))];
  });
}

/** Alfa de 14% em hex (0x24 = 36/255). */
export const PILL_BG_ALPHA_HEX = "24";

/** `#RGB`/`#RRGGBB` → `#RRGGBB` + alfa. Outro formato (ou hex com alfa) → null. */
export function hexWithAlpha(color: string, alphaHex: string = PILL_BG_ALPHA_HEX): string | null {
  const c = color.trim();
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}${alphaHex}`;
  if (/^#[0-9a-f]{6}$/i.test(c)) return `${c}${alphaHex}`;
  return null;
}

