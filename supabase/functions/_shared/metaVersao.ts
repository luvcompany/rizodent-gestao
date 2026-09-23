/**
 * Versão da API da Meta em UM lugar só.
 *
 * Por que isto existe: a versão estava escrita à mão em cada arquivo, e dez
 * pontos ficaram para trás na v21 — que expira em 21/01/2027. Versão vencida
 * não devolve erro: a Meta responde com a versão seguinte e o comportamento
 * muda calado (um campo some, um formato vira outro). A próxima troca passa a
 * ser de uma linha, aqui.
 *
 * v25.0 saiu em 18/02/2026 e vale até 29/07/2028.
 *
 * Os dois hosts têm o mesmo esquema de versão, mas são APIs diferentes:
 *  - graph.facebook.com  → WhatsApp Cloud API, anúncios, Instagram via Facebook Login
 *  - graph.instagram.com → Instagram API with Instagram Login (token que começa com IGAA)
 */
export const META_GRAPH_VERSION = "v25.0";
export const IG_GRAPH_VERSION = "v25.0";

export const BASE_GRAPH_META = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
export const BASE_GRAPH_INSTAGRAM = `https://graph.instagram.com/${IG_GRAPH_VERSION}`;

/** Host certo para o token: IGAA… é Instagram Login; o resto é Facebook Login. */
export function baseGraphPorToken(token: string | null | undefined): string {
  return String(token || "").startsWith("IGAA") ? BASE_GRAPH_INSTAGRAM : BASE_GRAPH_META;
}
