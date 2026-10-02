/**
 * Lista única de origens do lead: cadastro, painel, editor de tags e filtro
 * usam os mesmos valores (minúsculos, sem acento).
 */
export type OrigemLead = { valor: string; rotulo: string };

/** Escolhíveis no cadastro e no painel (lead de WhatsApp). */
export const ORIGENS_LEAD: OrigemLead[] = [
  { valor: "whatsapp", rotulo: "WhatsApp" },
  { valor: "facebook_ad", rotulo: "Anúncio Facebook" },
  { valor: "instagram_ad", rotulo: "Anúncio Instagram" },
  { valor: "google_ads", rotulo: "Google Ads" },
  { valor: "instagram", rotulo: "Instagram" },
  { valor: "facebook", rotulo: "Facebook" },
  { valor: "site", rotulo: "Site" },
  { valor: "indicacao", rotulo: "Indicação" },
  { valor: "organico", rotulo: "Orgânico" },
  { valor: "ligacao", rotulo: "Ligação" },
  { valor: "manual", rotulo: "Manual" },
  { valor: "outro", rotulo: "Outro" },
];

/** Escolhíveis no lead de Instagram. */
export const ORIGENS_LEAD_INSTAGRAM: OrigemLead[] = [
  { valor: "comentario", rotulo: "Comentário" },
  { valor: "direct", rotulo: "Direct" },
  { valor: "anuncio", rotulo: "Anúncio" },
];

/** Só leitura (não escolhíveis). */
export const ORIGENS_LEAD_SISTEMA: OrigemLead[] = [
  { valor: "webhook", rotulo: "Integração (webhook)" },
  { valor: "import", rotulo: "Importação" },
];

const TODAS = [...ORIGENS_LEAD, ...ORIGENS_LEAD_INSTAGRAM, ...ORIGENS_LEAD_SISTEMA];
const VALORES = new Set(TODAS.map((o) => o.valor));

/** Um item por grupo no filtro. */
export const FILTRO_ORIGENS: OrigemLead[] = [
  { valor: "anuncio", rotulo: "Anúncio" },
  { valor: "google_ads", rotulo: "Google Ads" },
  { valor: "whatsapp", rotulo: "WhatsApp" },
  { valor: "instagram", rotulo: "Instagram" },
  { valor: "facebook", rotulo: "Facebook" },
  { valor: "site", rotulo: "Site" },
  { valor: "indicacao", rotulo: "Indicação" },
  { valor: "organico", rotulo: "Orgânico" },
  { valor: "ligacao", rotulo: "Ligação" },
  { valor: "manual", rotulo: "Manual" },
  { valor: "outro", rotulo: "Outro" },
  { valor: "webhook", rotulo: "Integração (webhook)" },
  { valor: "import", rotulo: "Importação" },
];

const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const SINONIMOS: Record<string, string> = {
  telefone: "ligacao",
  "meta ads": "anuncio",
  google: "google_ads",
  "google ads": "google_ads",
  importacao: "import",
};

/** Forma canônica do texto gravado; desconhecido → null. */
export function origemLeadCanonica(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const t = semAcento(texto);
  if (!t) return null;
  if (VALORES.has(t)) return t;
  if (SINONIMOS[t]) return SINONIMOS[t];
  if (t.endsWith("_ads")) return "anuncio";
  return null;
}

/** Rótulo da origem, ou o texto como veio. */
export function rotuloOrigemLead(texto: string | null | undefined): string {
  if (!texto) return "";
  const c = origemLeadCanonica(texto);
  return (c && TODAS.find((o) => o.valor === c)?.rotulo) || texto;
}

/** Grupo do filtro: anúncio junta *_ad e anuncio; instagram junta comentario e direct. */
export function grupoDoFiltro(texto: string | null | undefined): string | null {
  const c = origemLeadCanonica(texto);
  if (!c) return null;
  if (c === "facebook_ad" || c === "instagram_ad" || c === "anuncio") return "anuncio";
  if (c === "comentario" || c === "direct") return "instagram";
  return c;
}
