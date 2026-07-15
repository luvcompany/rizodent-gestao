// Resolução determinística e DEFENSIVA de cidade a partir da origem do anúncio.
// NUNCA lança exceção — em qualquer erro retorna null, para não travar o webhook.

export function adIdSuffix(adId: string | null | undefined): string | null {
  if (!adId) return null;
  const s = String(adId).trim();
  return s.length >= 4 ? s.slice(-4) : null;
}

// Fallback: heurística SÓ pelo nome da conta de anúncio (nunca texto de criativo).
function cidadeFromAccountName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes("guanambi")) return "Guanambi";
  if (n.includes("itabuna")) return "Itabuna";
  if (n.includes("ipiau") || n.includes("ipiaú")) return "Ipiaú";
  if (n.includes("vca") || n.includes("vitoria") || n.includes("vitória") || n.includes("conquista")) return "Vitória da Conquista";
  return null;
}

async function lookup(supabase: any, tenantId: string, col: string, val: string | null): Promise<string | null> {
  if (!val) return null;
  try {
    const { data, error } = await supabase
      .from("ad_account_map")
      .select("cidade")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .eq(col, val)
      .limit(1)
      .maybeSingle();
    if (!error && data && data.cidade) return data.cidade as string;
  } catch (_e) { /* engole */ }
  return null;
}

// Ordem de prioridade: ad_account_id > sufixo do ad_id > page_id > nome da conta.
// SEMPRE retorna (string | null); NUNCA lança.
export async function resolveCidade(opts: {
  supabase: any;
  tenantId: string;
  adAccountId?: string | null;
  adId?: string | null;
  pageId?: string | null;
  adAccountName?: string | null;
}): Promise<string | null> {
  try {
    const { supabase, tenantId } = opts;
    if (!supabase || !tenantId) return null;
    const acct = opts.adAccountId ? String(opts.adAccountId).replace(/^act_/, "").trim() : null;
    const suffix = adIdSuffix(opts.adId);
    const pageId = opts.pageId ? String(opts.pageId).trim() : null;
    return (
      (await lookup(supabase, tenantId, "ad_account_id", acct)) ||
      (await lookup(supabase, tenantId, "ad_id_suffix", suffix)) ||
      (await lookup(supabase, tenantId, "page_id", pageId)) ||
      cidadeFromAccountName(opts.adAccountName)
    );
  } catch (_e) {
    return null;
  }
}
