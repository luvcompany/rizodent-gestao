// "Cada equipe é um mundo": o número de WhatsApp pertence a um MUNDO
// (whatsapp_numbers.mundo), não a um usuário nem a si mesmo:
//   - 'crc'      → equipe central (CRC, SDR, pós-venda). Inclui o número
//                  principal legado (lead com whatsapp_number_id NULL) e TODOS
//                  os números centrais, ativos ou não — o oficial novo, o de
//                  contingência, o antigo. Conectar um número novo não muda nada.
//   - 'closer' / 'recepcao' → números de quem os possui (dono_user_id);
//   - 'posvenda' → número conectado pela própria pós-venda (raro): só dela.
//
// Antes (até 09/10/2026) estes helpers comparavam o ID do número: funil legado
// só alcançava lead NULL e funil de número próprio só o lead daquele número.
// Resultado: no dia em que o número oficial passou a carimbar os leads novos,
// eles saíram de bots, follow-ups, disparos, rodízio e Dontus; e os funis do
// closer sem canal (FACETA, IMPLANTE…) nunca alcançaram os leads do closer.
// A regra agora é a mesma do banco (mundo_numero_whatsapp / 0014): compara o
// MUNDO, nunca o id.

export const MUNDO_CENTRAL = "crc";
/** uuid que não casa com nenhum número (filtro "nenhum lead"). */
const NENHUM = "00000000-0000-0000-0000-000000000000";

export interface MundoRef {
  tenantId: string | null;
  pipelineId: string | null;
  /** 'crc' (central), 'closer', 'recepcao' ou 'posvenda'. */
  mundo: string;
  /** Dono do mundo (closer/recepção) quando conhecido; null = qualquer dono / central. */
  dono: string | null;
  /** ids de whatsapp_numbers do tenant que pertencem a este mundo (ativos ou não). */
  numberIds: string[];
  /** ids dos números de OUTROS mundos do tenant (usado no mundo central). */
  idsDeOutrosMundos: string[];
  /** Lead sem número carimbado (NULL = número principal legado) é deste mundo? */
  semNumero: boolean;
}

/** Compatibilidade com o nome antigo (automações são presas a etapa). */
export type MundoDaEtapa = MundoRef;

type NumeroRow = { id: string; mundo: string | null; dono_user_id: string | null };

/** Espelho de public.normaliza_mundo: papel dono → mundo do número. */
function normalizaMundo(papel: string | null | undefined): string {
  const p = String(papel ?? "");
  return ["", "crc", "sdr", "crc_legacy", "superadmin", "gerente"].includes(p) ? MUNDO_CENTRAL : p;
}

const cacheTenant = new Map<string, { em: number; numeros: NumeroRow[]; mundoLegado: string }>();
const TTL_MS = 60_000;

/** Números do tenant (com mundo/dono) e o mundo do número legado (whatsapp_config). */
async function numerosDoTenant(admin: any, tenantId: string): Promise<{ numeros: NumeroRow[]; mundoLegado: string }> {
  const hit = cacheTenant.get(tenantId);
  if (hit && Date.now() - hit.em < TTL_MS) return hit;
  const [{ data: nums }, { data: legado }] = await Promise.all([
    admin.from("whatsapp_numbers").select("id, mundo, dono_user_id").eq("tenant_id", tenantId),
    admin.from("integrations").select("owner_role").eq("tenant_id", tenantId).eq("key", "whatsapp_config").maybeSingle(),
  ]);
  const val = {
    em: Date.now(),
    numeros: ((nums || []) as NumeroRow[]).map((n) => ({ ...n, mundo: n.mundo || MUNDO_CENTRAL })),
    mundoLegado: normalizaMundo((legado as any)?.owner_role ?? null),
  };
  cacheTenant.set(tenantId, val);
  return val;
}

async function montarMundo(
  admin: any,
  tenantId: string | null,
  pipelineId: string | null,
  mundo: string,
  dono: string | null,
): Promise<MundoRef> {
  if (!tenantId) {
    return { tenantId, pipelineId, mundo, dono, numberIds: [], idsDeOutrosMundos: [], semNumero: mundo === MUNDO_CENTRAL };
  }
  const { numeros, mundoLegado } = await numerosDoTenant(admin, tenantId);
  const doMundo = (n: NumeroRow) => n.mundo === mundo && (!dono || !n.dono_user_id || n.dono_user_id === dono);
  return {
    tenantId,
    pipelineId,
    mundo,
    dono,
    numberIds: numeros.filter(doMundo).map((n) => n.id),
    idsDeOutrosMundos: numeros.filter((n) => !doMundo(n)).map((n) => n.id),
    semNumero: mundo === mundoLegado,
  };
}

/** Mundo central (CRC/SDR/pós-venda) do tenant — o da operação comercial e do Dontus. */
export function mundoCentral(admin: any, tenantId: string | null): Promise<MundoRef> {
  return montarMundo(admin, tenantId, null, MUNDO_CENTRAL, null);
}

/** Mundo do número (whatsapp_numbers.id) de um lead; NULL = número legado. */
export async function mundoDoNumero(admin: any, tenantId: string | null, numberId: string | null): Promise<MundoRef> {
  if (!tenantId) return montarMundo(admin, tenantId, null, MUNDO_CENTRAL, null);
  const { numeros, mundoLegado } = await numerosDoTenant(admin, tenantId);
  if (!numberId) return montarMundo(admin, tenantId, null, mundoLegado, null);
  const n = numeros.find((x) => x.id === numberId);
  return montarMundo(admin, tenantId, null, n?.mundo ?? MUNDO_CENTRAL, n?.dono_user_id ?? null);
}

/**
 * Mundo de um FUNIL:
 *  1. canal de WhatsApp do funil → número → mundo/dono do número;
 *  2. sem canal (ou canal que não resolve): pelos papéis do funil
 *     (allowed_roles sem gerente/superadmin) — só closer → mundo do closer
 *     (dono = quem criou, se for closer); só recepção → idem; senão central.
 */
export async function mundoDoFunil(admin: any, pipelineId: string | null, tenantId: string | null): Promise<MundoRef> {
  if (!pipelineId || !tenantId) return montarMundo(admin, tenantId, pipelineId, MUNDO_CENTRAL, null);

  const { data: canais } = await admin
    .from("funnel_channels")
    .select("channel_config, created_at")
    .eq("channel_type", "whatsapp")
    .eq("pipeline_id", pipelineId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1);
  const key = (canais?.[0]?.channel_config as any)?.integration_key as string | undefined;

  if (key) {
    const { data: integration } = await admin
      .from("integrations")
      .select("config, owner_role")
      .eq("tenant_id", tenantId)
      .eq("key", key)
      .maybeSingle();
    const phoneNumberId = String((integration as any)?.config?.phone_number_id || "");
    if (phoneNumberId && /^\d+$/.test(phoneNumberId)) {
      const { data: numero } = await admin
        .from("whatsapp_numbers")
        .select("mundo, dono_user_id")
        .eq("tenant_id", tenantId)
        .eq("phone_number_id", phoneNumberId)
        .maybeSingle();
      if (numero) {
        return montarMundo(admin, tenantId, pipelineId, (numero as any).mundo || MUNDO_CENTRAL, (numero as any).dono_user_id ?? null);
      }
    }
    if (integration) {
      return montarMundo(admin, tenantId, pipelineId, normalizaMundo((integration as any).owner_role ?? null), null);
    }
  }

  const { data: funil } = await admin
    .from("crm_pipelines")
    .select("allowed_roles, created_by")
    .eq("id", pipelineId)
    .maybeSingle();
  const papeis = (((funil as any)?.allowed_roles ?? []) as string[]).filter((r) => r !== "gerente" && r !== "superadmin");
  const unico = papeis.length > 0 && papeis.every((r) => r === papeis[0]) ? papeis[0] : null;
  if (unico === "closer" || unico === "recepcao") {
    let dono: string | null = null;
    const criador = (funil as any)?.created_by ?? null;
    if (criador) {
      const { data: papel } = await admin
        .from("user_roles").select("role").eq("user_id", criador).eq("role", unico).maybeSingle();
      if (papel) dono = criador;
    }
    return montarMundo(admin, tenantId, pipelineId, unico, dono);
  }
  return montarMundo(admin, tenantId, pipelineId, MUNDO_CENTRAL, null);
}

/**
 * Mundo de uma ETAPA (usado pelas automações, que são presas a stage_id).
 * `cache` opcional evita repetir as queries por etapa dentro de um mesmo tick.
 */
export async function mundoDaEtapa(
  admin: any,
  stageId: string | null,
  cache?: Map<string, MundoRef>,
): Promise<MundoRef> {
  if (!stageId) return montarMundo(admin, null, null, MUNDO_CENTRAL, null);
  const emCache = cache?.get(stageId);
  if (emCache) return emCache;

  const { data: stage } = await admin
    .from("crm_stages")
    .select("pipeline_id, tenant_id")
    .eq("id", stageId)
    .maybeSingle();
  const mundo = await mundoDoFunil(admin, (stage as any)?.pipeline_id ?? null, (stage as any)?.tenant_id ?? null);
  cache?.set(stageId, mundo);
  return mundo;
}

/** Aplica o filtro de mundo numa query de crm_leads já iniciada. */
export function filtrarMundo(query: any, m: MundoRef): any {
  if (m.mundo === MUNDO_CENTRAL) {
    const fora = m.idsDeOutrosMundos;
    if (m.semNumero) {
      return fora.length ? query.or(`whatsapp_number_id.is.null,whatsapp_number_id.not.in.(${fora.join(",")})`) : query;
    }
    const q = query.not("whatsapp_number_id", "is", null);
    return fora.length ? q.not("whatsapp_number_id", "in", `(${fora.join(",")})`) : q;
  }
  const ids = m.numberIds;
  if (m.semNumero) {
    return ids.length ? query.or(`whatsapp_number_id.is.null,whatsapp_number_id.in.(${ids.join(",")})`) : query.is("whatsapp_number_id", null);
  }
  return query.in("whatsapp_number_id", ids.length ? ids : [NENHUM]);
}

/** Um lead carimbado com `leadNumberId` pertence ao mundo `m`? */
export function mesmoMundo(leadNumberId: string | null | undefined, m: MundoRef): boolean {
  const id = leadNumberId ?? null;
  if (!id) return m.semNumero;
  if (m.mundo === MUNDO_CENTRAL) return !m.idsDeOutrosMundos.includes(id);
  return m.numberIds.includes(id);
}

/**
 * O mesmo filtro de `filtrarMundo` como expressão `.or(...)` do PostgREST, para
 * encaixar no meio de uma cadeia já montada:
 *   admin.from("crm_leads").select(...).or(orDoMundo(central)).in("id", ids)
 */
export function orDoMundo(m: MundoRef): string {
  if (m.mundo === MUNDO_CENTRAL) {
    const fora = m.idsDeOutrosMundos;
    if (m.semNumero) {
      return fora.length
        ? `whatsapp_number_id.is.null,whatsapp_number_id.not.in.(${fora.join(",")})`
        : "whatsapp_number_id.is.null,whatsapp_number_id.not.is.null";
    }
    return fora.length
      ? `and(whatsapp_number_id.not.is.null,whatsapp_number_id.not.in.(${fora.join(",")}))`
      : "whatsapp_number_id.not.is.null";
  }
  const ids = m.numberIds.length ? m.numberIds : [NENHUM];
  return m.semNumero
    ? `whatsapp_number_id.is.null,whatsapp_number_id.in.(${ids.join(",")})`
    : `whatsapp_number_id.in.(${ids.join(",")})`;
}
