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

/**
 * Mundo de uma PESSOA (closer/recepção: só os números dela; demais: central).
 * Usado para recortar o que um closer ou uma recepcionista alcança dentro de
 * um funil (disparo em massa), igual ao que a RLS deixa ela ver.
 */
export function mundoDaPessoa(
  admin: any,
  tenantId: string | null,
  pipelineId: string | null,
  userId: string,
  papeis: string[],
): Promise<MundoRef> {
  const mundo = mundoDoUsuario(papeis);
  return montarMundo(admin, tenantId, pipelineId, mundo, mundo === MUNDO_CENTRAL ? null : userId);
}

// ---------------------------------------------------------------------------
// Equipe de uma PESSOA. Antes (até 09/10/2026) as functions descobriam "os
// números do closer" contando user_permission_overrides — que eram gravados na
// conexão do número. Agora o número guarda o próprio mundo e dono
// (whatsapp_numbers.mundo / dono_user_id) e a permissão por usuário virou só
// exceção do superadmin; contar overrides deixava o closer sem número (ninguém
// grava mais) ou, pior, dava a ele um número de outra equipe.

/** Linha de whatsapp_numbers com o que decide a equipe. */
export type NumeroDaEquipe = { mundo: string | null; dono_user_id: string | null };

/**
 * Equipe (mundo) em que a pessoa trabalha e CONECTA números: closer e recepção
 * são donos do próprio mundo; CRC, SDR, legado, gerência, superadmin e
 * pós-venda são a central. Mesma régua de public.normaliza_mundo para o papel
 * de quem conectou (integrations.owner_role).
 */
export function mundoDoUsuario(papeis: string[]): string {
  if (papeis.includes("closer")) return "closer";
  if (papeis.includes("recepcao")) return "recepcao";
  return MUNDO_CENTRAL;
}

/**
 * O número é da equipe desta pessoa? Closer/recepção: números do mundo dela
 * com dono = ela (ou sem dono, que vale para o grupo inteiro). Demais papéis:
 * números do mundo central. Não considera exceções por usuário — quem precisa
 * da regra completa de ACESSO (com exceção e gerência vendo tudo) chama a RPC
 * can_access_whatsapp_number com o JWT da pessoa.
 */
export function numeroEhDaEquipe(n: NumeroDaEquipe, userId: string, papeis: string[]): boolean {
  const meu = mundoDoUsuario(papeis);
  if ((n.mundo || MUNDO_CENTRAL) !== meu) return false;
  if (meu === "closer" || meu === "recepcao") return !n.dono_user_id || n.dono_user_id === userId;
  return true;
}

/**
 * Espelho de public.usuario_do_mundo_do_numero (0014), para quando não há JWT
 * à mão (ex.: o DESTINO de uma transferência). Sem gerência/superadmin (eles
 * enxergam tudo pela can_access) e sem exceções por usuário.
 */
export function usuarioDoMundoDoNumero(n: NumeroDaEquipe, userId: string, papeis: string[]): boolean {
  const mundo = n.mundo || MUNDO_CENTRAL;
  if (mundo === "closer" || mundo === "recepcao") {
    return n.dono_user_id ? n.dono_user_id === userId : papeis.includes(mundo);
  }
  if (mundo === "posvenda") return papeis.includes("posvenda");
  return papeis.some((p) => ["crc", "sdr", "crc_legacy", "posvenda"].includes(p));
}

export type DonoDaConexao = {
  /** Quem conecta pode mexer neste número (é da equipe dele, ou é gestão, ou o número é novo)? */
  podeMexer: boolean;
  /** owner_role a gravar na integração (o gatilho copia para whatsapp_numbers.mundo). */
  ownerRole: string | null;
  /** Mundo resultante do número. */
  mundo: string;
  /** config.owner_user_id a gravar ("" = número da equipe inteira). */
  ownerUserId: string;
};

/**
 * De quem fica um número ao ser conectado/reconectado (minha-conexao-whatsapp
 * e whatsapp-oauth-callback).
 *  - Número NOVO no cliente: da equipe de quem conecta — crc, sdr, crc_legacy,
 *    gerente e superadmin → central; closer/recepção → o próprio papel, com a
 *    pessoa como dona.
 *  - Número que JÁ existe (cadastro ou integração): não muda de equipe. O
 *    owner_role da integração é mantido (NULL fica NULL = central, salvo se o
 *    número já for de outra equipe) — o gatilho trg_integracao_whatsapp_numero
 *    copia o owner_role para whatsapp_numbers.mundo, então gravar o papel de
 *    quem reconectou mudaria o número de mundo e as conversas sumiriam.
 *  - Só a equipe do número (ou gerência/superadmin) mexe nele.
 */
export function donoDaConexao(p: {
  papeis: string[];
  userId: string;
  numero: { mundo: string | null; dono_user_id: string | null } | null;
  integracao: { owner_role: string | null; config?: Record<string, any> | null } | null;
}): DonoDaConexao {
  const { papeis, userId, numero, integracao } = p;
  const gestao = papeis.includes("gerente") || papeis.includes("superadmin");
  const donoDaIntegracao = String(integracao?.config?.owner_user_id || "") || null;
  const equipeExistente: NumeroDaEquipe | null = numero
    ? { mundo: numero.mundo, dono_user_id: numero.dono_user_id }
    : integracao
    ? { mundo: normalizaMundo(integracao.owner_role), dono_user_id: donoDaIntegracao }
    : null;
  const podeMexer = !equipeExistente || gestao || numeroEhDaEquipe(equipeExistente, userId, papeis);

  const ownerRole: string | null = integracao
    ? (integracao.owner_role ?? (numero?.mundo && numero.mundo !== MUNDO_CENTRAL ? numero.mundo : null))
    : numero
    ? (numero.mundo || MUNDO_CENTRAL)
    : mundoDoUsuario(papeis);
  const mundo = normalizaMundo(ownerRole);
  const ownerUserId = mundo === MUNDO_CENTRAL
    ? ""
    : String(donoDaIntegracao || numero?.dono_user_id || (equipeExistente ? "" : userId));
  return { podeMexer, ownerRole, mundo, ownerUserId };
}

/** Ordem de preferência entre números da mesma equipe: ativo, padrão, mais antigo (a mesma do numeroDeSaida). */
export function ordemDeNumeros<T extends { is_active?: boolean | null; is_default?: boolean | null; created_at?: string | null }>(
  a: T,
  b: T,
): number {
  return Number(!!b.is_active) - Number(!!a.is_active) ||
    Number(!!b.is_default) - Number(!!a.is_default) ||
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
}

/**
 * Números (ativos e inativos) da equipe da pessoa no tenant, na ordem de
 * preferência. `select` escolhe as colunas extras (id, mundo, dono_user_id,
 * is_active, is_default e created_at vêm sempre).
 */
export async function numerosDaEquipeDoUsuario(
  admin: any,
  tenantId: string,
  userId: string,
  papeis: string[],
  select = "phone_number_id",
): Promise<any[]> {
  const colunas = `id, mundo, dono_user_id, is_active, is_default, created_at${select ? `, ${select}` : ""}`;
  const { data, error } = await admin.from("whatsapp_numbers").select(colunas).eq("tenant_id", tenantId);
  if (error) throw new Error(`whatsapp_numbers: ${error.message}`);
  return ((data || []) as any[]).filter((n) => numeroEhDaEquipe(n, userId, papeis)).sort(ordemDeNumeros);
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
