export type AdOption = {
  ad_id: string;
  imagem_origem: string | null;
  nome_anuncio: string | null;
  descricao_anuncio: string | null;
  link_anuncio: string | null;
  ad_account_id: string | null;
  ad_account_name: string | null;
  group_key: string;
};

type AdCandidate = Omit<AdOption, "group_key">;

const normalizedText = (value: string | null) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");

const normalizedImage = (value: string | null) => {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
};

/** Prefere a miniatura guardada no sistema; links da Meta (fbcdn) expiram. */
const guardada = (v: string | null) => !!v && v.includes("/chat-media/");
function melhorImagem(a: string | null, b: string | null): string | null {
  if (guardada(a)) return a;
  if (guardada(b)) return b;
  return a || b;
}

export function adGroupKey(ad: AdCandidate): string {
  const account = normalizedText(ad.ad_account_id || ad.ad_account_name) || "sem-conta";
  const identity = normalizedText(ad.nome_anuncio)
    || normalizedText(ad.descricao_anuncio)
    || normalizedImage(ad.imagem_origem)
    || ad.ad_id;
  return `${account}::${identity}`;
}

export function mergeAdCandidates(candidates: AdCandidate[]): AdOption[] {
  const byAdId = new Map<string, AdCandidate>();
  for (const candidate of candidates) {
    const current = byAdId.get(candidate.ad_id);
    byAdId.set(candidate.ad_id, current ? {
      ad_id: current.ad_id,
      imagem_origem: melhorImagem(current.imagem_origem, candidate.imagem_origem),
      nome_anuncio: current.nome_anuncio || candidate.nome_anuncio,
      descricao_anuncio: current.descricao_anuncio || candidate.descricao_anuncio,
      link_anuncio: current.link_anuncio || candidate.link_anuncio,
      ad_account_id: current.ad_account_id || candidate.ad_account_id,
      ad_account_name: current.ad_account_name || candidate.ad_account_name,
    } : candidate);
  }

  const grouped = new Map<string, AdOption>();

  for (const candidate of byAdId.values()) {
    const group_key = adGroupKey(candidate);
    const current = grouped.get(group_key);
    if (!current) {
      grouped.set(group_key, { ...candidate, group_key });
      continue;
    }

    grouped.set(group_key, {
      ad_id: current.ad_id || candidate.ad_id,
      imagem_origem: melhorImagem(current.imagem_origem, candidate.imagem_origem),
      nome_anuncio: current.nome_anuncio || candidate.nome_anuncio,
      descricao_anuncio: current.descricao_anuncio || candidate.descricao_anuncio,
      link_anuncio: current.link_anuncio || candidate.link_anuncio,
      ad_account_id: current.ad_account_id || candidate.ad_account_id,
      ad_account_name: current.ad_account_name || candidate.ad_account_name,
      group_key,
    });
  }

  return Array.from(grouped.values());
}