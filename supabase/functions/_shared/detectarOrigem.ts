// Detecta a ORIGEM do lead pelo texto da PRIMEIRA mensagem recebida.
// Usado só na criação do lead, quando NÃO há referral de anúncio da Meta.
// Retorna null quando o texto não casa com nenhum padrão conhecido.

function normalizar(texto: string): string {
  return (texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function detectarOrigemPorTexto(texto: string): string | null {
  const t = normalizar(texto);
  if (!t) return null;

  // Google Ads primeiro — se um dia o texto também citar o site, Google Ads ganha.
  if (t.includes("vim pelo anuncio do google")) return "google_ads";
  if (t.includes("quero avaliar implante dentario na rizodent")) return "google_ads";

  if (t.includes("vim do site")) return "site";

  return null;
}
