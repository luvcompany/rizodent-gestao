/**
 * Escopo de WABA / número de WhatsApp para modelos de mensagem (templates).
 *
 * Doutrina do produto: "cada número é um mundo".
 *  - lead/template com whatsapp_number_id NULL  => mundo LEGADO (número principal,
 *    integração `whatsapp_config` do tenant);
 *  - lead/template carimbado com um número      => mundo daquele número, e o
 *    template TEM de existir na WABA daquele número.
 *
 * Um template só vale dentro da WABA em que foi criado: enviar um template da
 * WABA A por um número da WABA B falha na Meta (ou, pior, casa por nome com
 * outro conteúdo).
 */

export const NUMERO_LEGADO_UUID = "00000000-0000-0000-0000-000000000000";

export type EscopoWaba = {
  /** null = mundo legado (whatsapp_config) */
  whatsappNumberId: string | null;
  wabaId: string | null;
  phoneNumberId: string | null;
  token: string | null;
  appId: string | null;
  integrationKey: string | null;
};

const vazio: EscopoWaba = {
  whatsappNumberId: null,
  wabaId: null,
  phoneNumberId: null,
  token: null,
  appId: null,
  integrationKey: null,
};

/** Credenciais/WABA da integração legada (`whatsapp_config`) do tenant. */
export async function escopoLegado(supabase: any, tenantId: string | null): Promise<EscopoWaba> {
  if (!tenantId) return { ...vazio };
  const { data: intg } = await supabase
    .from("integrations")
    .select("config, status")
    .eq("tenant_id", tenantId)
    .eq("key", "whatsapp_config")
    .maybeSingle();
  const cfg = ((intg as any)?.config ?? {}) as any;
  const token = cfg.access_token || cfg.token || null;
  const phoneNumberId = cfg.phone_number_id || null;
  return {
    whatsappNumberId: null,
    wabaId: cfg.waba_id || null,
    // Credencial só quando token E phone_number_id vêm JUNTOS da mesma config.
    phoneNumberId: token && phoneNumberId ? phoneNumberId : null,
    token: token && phoneNumberId ? token : null,
    appId: cfg.app_id || null,
    integrationKey: "whatsapp_config",
  };
}

/**
 * Escopo de um número cadastrado em `whatsapp_numbers` (mundo próprio).
 * A integração dele é `whatsapp_<phone_number_id>`.
 */
export async function escopoDoNumero(
  supabase: any,
  numberId: string,
  tenantId: string | null,
): Promise<EscopoWaba | null> {
  let q = supabase
    .from("whatsapp_numbers")
    .select("id, tenant_id, phone_number_id, waba_id, token, app_id, is_active")
    .eq("id", numberId)
    .eq("is_active", true);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data: num } = await q.maybeSingle();
  if (!num?.phone_number_id) return null;

  const { data: intg } = await supabase
    .from("integrations")
    .select("config, status")
    .eq("tenant_id", (num as any).tenant_id)
    .eq("key", `whatsapp_${(num as any).phone_number_id}`)
    .maybeSingle();
  if ((intg as any)?.status === "disabled") return null;

  const cfg = ((intg as any)?.config ?? {}) as any;
  const token = cfg.access_token || cfg.token || (num as any).token || null;
  const phoneNumberId = cfg.phone_number_id || (num as any).phone_number_id || null;
  return {
    whatsappNumberId: (num as any).id,
    wabaId: cfg.waba_id || (num as any).waba_id || null,
    phoneNumberId: token && phoneNumberId ? phoneNumberId : null,
    token: token && phoneNumberId ? token : null,
    appId: cfg.app_id || (num as any).app_id || null,
    integrationKey: `whatsapp_${(num as any).phone_number_id}`,
  };
}

/** Resolve o número (whatsapp_numbers) a partir de um phone_number_id da Meta. */
export async function numeroPorPhoneNumberId(
  supabase: any,
  phoneNumberId: string,
  tenantId: string | null,
): Promise<{ id: string; waba_id: string | null } | null> {
  if (!phoneNumberId) return null;
  let q = supabase
    .from("whatsapp_numbers")
    .select("id, waba_id")
    .eq("phone_number_id", phoneNumberId);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q.limit(1);
  const row = (data || [])[0];
  return row ? { id: row.id, waba_id: row.waba_id ?? null } : null;
}

/** Escopo do mundo de um lead: carimbado -> número dele; NULL -> legado. */
export async function escopoDoLead(
  supabase: any,
  lead: { whatsapp_number_id?: string | null; tenant_id?: string | null },
): Promise<EscopoWaba> {
  const numeroId = lead?.whatsapp_number_id ?? null;
  if (!numeroId) return escopoLegado(supabase, lead?.tenant_id ?? null);
  const esc = await escopoDoNumero(supabase, numeroId, lead?.tenant_id ?? null);
  return esc ?? { ...vazio, whatsappNumberId: numeroId };
}

/**
 * Papel "dono" de um número: se existe exatamente UM papel entre os usuários
 * com override explícito (granted) para o número, o template pertence a ele.
 * Caso contrário devolve null (visível a todos os papéis do tenant).
 */
export async function papelDonoDoNumero(supabase: any, numberId: string | null): Promise<string | null> {
  if (!numberId) return null;
  const { data: overrides } = await supabase
    .from("user_permission_overrides")
    .select("user_id")
    .eq("scope", "whatsapp_number")
    .eq("resource_id", numberId)
    .eq("granted", true);
  const userIds = (overrides || []).map((o: any) => o.user_id);
  if (userIds.length === 0) return null;

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .in("user_id", userIds);
  const distintos = Array.from(
    new Set(((roles || []) as any[]).map((r) => r.role).filter((r) => r && r !== "superadmin" && r !== "gerente")),
  );
  return distintos.length === 1 ? String(distintos[0]) : null;
}

/** Filtro canônico de WABA em consultas a crm_whatsapp_templates. */
export function filtrarWaba(query: any, numberId: string | null) {
  return numberId ? query.eq("whatsapp_number_id", numberId) : query.is("whatsapp_number_id", null);
}
