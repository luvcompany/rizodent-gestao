// "Cada número é um mundo": um lead carimbado (crm_leads.whatsapp_number_id)
// pertence ao número que o trouxe; lead NULL é o mundo LEGADO (número principal,
// que não tem linha em whatsapp_numbers).
//
// Estes helpers derivam o MUNDO de um funil/etapa a partir do canal
// (funnel_channels -> integration_key -> phone_number_id -> whatsapp_numbers.id).
// Retornam `null` para o mundo legado — que é exatamente o valor que o lead
// carrega em whatsapp_number_id nesse caso, então o filtro é sempre:
//   numberId ? .eq("whatsapp_number_id", numberId) : .is("whatsapp_number_id", null)

export interface MundoDaEtapa {
  tenantId: string | null;
  pipelineId: string | null;
  /** id em whatsapp_numbers, ou null para o mundo legado (número principal). */
  numberId: string | null;
}

/** Número (whatsapp_numbers.id) do canal de WhatsApp de um funil; null = legado. */
export async function numeroDoFunil(
  admin: any,
  pipelineId: string | null,
  tenantId: string | null,
): Promise<string | null> {
  if (!pipelineId || !tenantId) return null;

  const { data: canais } = await admin
    .from("funnel_channels")
    .select("channel_config, created_at")
    .eq("channel_type", "whatsapp")
    .eq("pipeline_id", pipelineId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1);

  const key = (canais?.[0]?.channel_config as any)?.integration_key as string | undefined;
  // Sem canal, ou canal apontando para a integração única antiga: mundo legado.
  if (!key || key === "whatsapp_config") return null;

  const { data: integration } = await admin
    .from("integrations")
    .select("config")
    .eq("tenant_id", tenantId)
    .eq("key", key)
    .maybeSingle();
  const phoneNumberId = String((integration as any)?.config?.phone_number_id || "");
  if (!phoneNumberId || !/^\d+$/.test(phoneNumberId)) return null;

  const { data: numero } = await admin
    .from("whatsapp_numbers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();

  return (numero as any)?.id ?? null;
}

/**
 * Mundo de uma ETAPA (usado pelas automações, que são presas a stage_id).
 * `cache` opcional evita repetir as queries por etapa dentro de um mesmo tick.
 */
export async function mundoDaEtapa(
  admin: any,
  stageId: string | null,
  cache?: Map<string, MundoDaEtapa>,
): Promise<MundoDaEtapa> {
  const vazio: MundoDaEtapa = { tenantId: null, pipelineId: null, numberId: null };
  if (!stageId) return vazio;
  const emCache = cache?.get(stageId);
  if (emCache) return emCache;

  const { data: stage } = await admin
    .from("crm_stages")
    .select("pipeline_id, tenant_id")
    .eq("id", stageId)
    .maybeSingle();
  if (!stage) {
    cache?.set(stageId, vazio);
    return vazio;
  }

  const tenantId = (stage as any).tenant_id ?? null;
  const pipelineId = (stage as any).pipeline_id ?? null;
  const numberId = await numeroDoFunil(admin, pipelineId, tenantId);
  const mundo: MundoDaEtapa = { tenantId, pipelineId, numberId };
  cache?.set(stageId, mundo);
  return mundo;
}

/** Aplica o filtro de mundo numa query de crm_leads já iniciada. */
export function filtrarMundo(query: any, numberId: string | null): any {
  return numberId ? query.eq("whatsapp_number_id", numberId) : query.is("whatsapp_number_id", null);
}

/** Um lead carimbado com `leadNumberId` pertence ao mundo `numberId`? */
export function mesmoMundo(leadNumberId: string | null | undefined, numberId: string | null): boolean {
  return (leadNumberId ?? null) === (numberId ?? null);
}
