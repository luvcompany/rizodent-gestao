/**
 * Telas de um WhatsApp Flow, lidas do JSON publicado na Meta.
 *
 * Por que isto existe: um template com botão de formulário só abre se o envio
 * mandar, em flow_action_data, exatamente os dados que a PRIMEIRA tela declara.
 * Antes isso era fixo ("dias"), o que só servia para o formulário de
 * confirmação — qualquer outro flow criado pela tela de Modelos quebraria no
 * envio. Agora o próprio flow diz o que precisa.
 *
 * O JSON vem em duas chamadas (assets → download_url), então fica em cache por
 * isolate: o mesmo modelo é enviado às centenas por dia.
 */

export type TelaDoFlow = {
  id: string;
  title: string;
  /** Nome → exemplo declarado no JSON (o mesmo que a Meta valida). */
  dados: Record<string, unknown>;
};

const CACHE = new Map<string, { quando: number; telas: TelaDoFlow[] }>();
const VALIDADE_MS = 10 * 60 * 1000;

/** Exemplo declarado para um campo de `data` (7.x usa __example__). */
function exemploDoCampo(definicao: unknown): unknown {
  if (definicao && typeof definicao === "object") {
    const d = definicao as Record<string, unknown>;
    if ("__example__" in d) return d.__example__;
    if ("example" in d) return d.example;
  }
  return null;
}

/**
 * Telas do flow, na ordem do JSON. Devolve null quando não deu para ler —
 * quem chama decide o que fazer (nunca lança, e nunca some com o envio).
 */
export async function lerTelasDoFlow(
  flowId: string,
  token: string,
  opcoes: { baseGraph?: string; timeoutMs?: number } = {},
): Promise<TelaDoFlow[] | null> {
  const id = String(flowId || "").trim();
  if (!id || !token) return null;

  const emCache = CACHE.get(id);
  if (emCache && Date.now() - emCache.quando < VALIDADE_MS) return emCache.telas;

  const base = opcoes.baseGraph || "https://graph.facebook.com/v25.0";
  const timeout = opcoes.timeoutMs ?? 6000;
  try {
    const assetsRes = await fetch(
      `${base}/${encodeURIComponent(id)}/assets?access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(timeout) },
    );
    if (!assetsRes.ok) return null;
    const assets = await assetsRes.json().catch(() => ({}));
    const arquivo = ((assets as any)?.data || []).find(
      (a: any) => String(a?.asset_type || "").toUpperCase() === "FLOW_JSON",
    );
    const link = arquivo?.download_url;
    if (!link) return null;

    const jsonRes = await fetch(String(link), { signal: AbortSignal.timeout(timeout) });
    if (!jsonRes.ok) return null;
    const flow = await jsonRes.json().catch(() => null);
    const telas = ((flow as any)?.screens || []).map((t: any) => {
      const dados: Record<string, unknown> = {};
      for (const [chave, definicao] of Object.entries(t?.data ?? {})) {
        dados[chave] = exemploDoCampo(definicao);
      }
      return { id: String(t?.id ?? ""), title: String(t?.title ?? t?.id ?? ""), dados };
    }).filter((t: TelaDoFlow) => t.id);
    if (telas.length === 0) return null;

    CACHE.set(id, { quando: Date.now(), telas });
    return telas;
  } catch {
    return null;
  }
}

/**
 * Dados que a tela de entrada do flow exige. `null` = não deu para descobrir.
 * `telaInicial` vem do botão do template (navigate_screen); sem ele, a 1ª tela.
 */
export async function dadosDaTelaInicial(
  flowId: string,
  token: string,
  telaInicial?: string | null,
  opcoes: { baseGraph?: string; timeoutMs?: number } = {},
): Promise<Record<string, unknown> | null> {
  const telas = await lerTelasDoFlow(flowId, token, opcoes);
  if (!telas) return null;
  const alvo = telaInicial ? telas.find((t) => t.id === telaInicial) : null;
  return (alvo ?? telas[0]).dados;
}

/** Só para teste: zera o cache entre casos. */
export function limparCacheDeFlows() {
  CACHE.clear();
}
