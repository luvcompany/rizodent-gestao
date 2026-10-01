/**
 * Cliente do painel admin para WhatsApp/Meta (P22).
 *
 * - Leitura: RPCs admin_meta_apps_listar, admin_meta_visao e
 *   admin_meta_alertas (migration 20260929000000) e a action webhook_info.
 * - Escrita: edge function admin-meta (superadmin) e, para o webhook de leads e
 *   as chaves de API, admin-update-tenant.
 *
 * Segredos: o navegador nunca recebe app_secret, token de WABA nem verify
 * token; só impressão digital (8 caracteres) e tamanho. As RPCs atuais ainda
 * devolvem `verify_token` em claro: `semSegredos` tira a chave logo na chegada,
 * para o valor não ficar no cache do react-query nem em nenhum componente.
 * O único segredo que aparece na tela é o que o servidor devolve UMA vez
 * (segredo novo do webhook de leads, chave de API recém-criada), e ele fica só
 * no estado do componente que mostrou.
 */
import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chavesAdmin, invocarFuncao } from "./api";
import type { AlertaMeta } from "./types";

// RPCs novas ainda fora do types.ts gerado (o P90 regenera).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/* ------------------------------------------------------------------------ */
/* Tipos                                                                     */
/* ------------------------------------------------------------------------ */

export type ModoApp = "development" | "live" | null;

/** Item de admin_meta_apps_listar (sem segredo). */
export interface AppMetaAdmin {
  id: string;
  tenant_id: string | null;
  tenant_nome: string | null;
  nome: string;
  app_id: string;
  app_secret_fingerprint: string | null;
  app_secret_tamanho: number | null;
  whatsapp_config_id: string | null;
  admin_login_config_id: string | null;
  embedded_signup_liberado: boolean;
  graph_version: string | null;
  is_system_default: boolean;
  ativo: boolean;
  modo_app: ModoApp | string;
  testado_em: string | null;
  webhook_verificado_em: string | null;
  webhook_ultimo_evento_em: string | null;
  created_at: string | null;
  updated_at: string | null;
  n_wabas: number;
  n_numeros: number;
  n_clientes_usando: number;
}

/** App como aparece em admin_meta_visao (app_em_uso / app_proprio). */
export interface AppDaVisao {
  id: string;
  nome: string;
  app_id: string;
  origem: "proprio" | "geral";
  ativo: boolean;
  modo_app: ModoApp | string;
  graph_version: string | null;
  whatsapp_config_id: string | null;
  admin_login_config_id: string | null;
  embedded_signup_liberado: boolean;
  testado_em: string | null;
  webhook_verificado_em: string | null;
  webhook_ultimo_evento_em: string | null;
  /** Só em app_proprio. */
  app_secret_fingerprint?: string | null;
  app_secret_tamanho?: number | null;
}

export type TokenTipo = "system_user" | "embedded_signup" | "coexistencia" | "admin_login";

/** can_send_message do health_status da Meta. */
export type PodeEnviarMeta = "AVAILABLE" | "LIMITED" | "BLOCKED";

/** health_status da WABA traduzido pelo admin-meta (meta_wabas.saude). */
export interface SaudeMeta {
  pode_enviar: PodeEnviarMeta | null;
  problemas: {
    entidade: string;
    id: string | null;
    pode_enviar: PodeEnviarMeta | null;
    codigo: number | null;
    descricao: string | null;
    solucao: string | null;
    /** Explicação PT-BR. */
    texto: string;
  }[];
}

export interface WabaAdmin {
  id: string;
  waba_id: string;
  nome: string | null;
  business_id: string | null;
  meta_app_id: string;
  token_fingerprint: string | null;
  token_tamanho: number | null;
  token_tipo: TokenTipo | string | null;
  token_expira_em: string | null;
  token_validado_em: string | null;
  subscribed_apps_ok: boolean;
  subscribed_em: string | null;
  status: "ativa" | "desativada" | "erro" | string;
  ultimo_erro: string | null;
  mm_lite: boolean | null;
  created_at: string | null;
  n_numeros: number;
  /** Pausa do administrador (null = em operação). O CRM não envia nem recebe nada pela WABA pausada. */
  pausada_em?: string | null;
  pausada_por?: string | null;
  pausada_por_nome?: string | null;
  pausa_motivo?: string | null;
  /** Saúde na Meta (health_status), gravada ao sincronizar/conectar/conferir. */
  saude?: SaudeMeta | null;
  saude_em?: string | null;
}

export type StatusNumero = "conectado" | "desativado" | "erro" | "pendente";

export interface NumeroAdmin {
  id: string;
  phone_number_id: string;
  display_name: string | null;
  phone_e164: string | null;
  waba_id: string | null;
  meta_waba_id: string | null;
  is_active: boolean;
  is_default: boolean;
  is_coexistence: boolean;
  status: StatusNumero | string;
  origem: string | null;
  verified_name: string | null;
  quality_rating: string | null;
  ultimo_webhook_em: string | null;
  ultimo_envio_em: string | null;
  ultimo_teste_em: string | null;
  ultimo_teste_ok: boolean | null;
  ultimo_erro: string | null;
  created_at: string | null;
  pipeline_id: string | null;
  pipeline_nome: string | null;
  /** A WABA deste número está pausada (espelho de meta_wabas.pausada_em). */
  waba_pausada?: boolean;
}

export interface FunilResumo {
  id: string;
  name: string;
  is_default: boolean;
}

export interface DesconhecidoMeta {
  phone_number_id: string;
  waba_id: string | null;
  display_phone: string | null;
  ultimo_em: string | null;
  eventos: number | null;
}

/** admin_meta_visao(p_tenant). */
export interface VisaoMeta {
  tenant: { id: string; nome: string; slug: string; meta_app_id: string | null };
  app_em_uso: AppDaVisao | null;
  app_proprio: AppDaVisao | null;
  wabas: WabaAdmin[];
  numeros: NumeroAdmin[];
  pipelines: FunilResumo[];
  desconhecidos: DesconhecidoMeta[];
}

export interface WebhookInfo {
  app: { id: string; nome: string; app_id: string };
  webhook_url: string;
  oauth_redirect_uri: string;
  verify_token_fingerprint: string | null;
  verify_token_tamanho: number | null;
  campos: string[];
  webhook_verificado_em: string | null;
  webhook_ultimo_evento_em: string | null;
}

export interface ResultadoImportacao {
  ok: true;
  criado: boolean;
  app: { id: string; app_id: string; nome: string; whatsapp_config_id: string | null };
  avisos: string[];
}

/** Campos aceitos por app_salvar. Vazio em segredo = mantém o atual. */
export interface DadosApp {
  id?: string;
  /** null = app do sistema; uuid = app próprio do cliente. */
  tenant_id?: string | null;
  nome?: string;
  app_id?: string;
  app_secret?: string;
  verify_token?: string;
  whatsapp_config_id?: string | null;
  admin_login_config_id?: string | null;
  graph_version?: string;
  ativo?: boolean;
  embedded_signup_liberado?: boolean;
  is_system_default?: boolean;
}

export interface ResultadoSalvarApp {
  ok: true;
  criado: boolean;
  app: Omit<AppMetaAdmin, "tenant_nome" | "n_wabas" | "n_numeros" | "n_clientes_usando"> & {
    verify_token_fingerprint: string | null;
    verify_token_tamanho: number | null;
  };
}

export interface AssinaturaApp {
  object: string | null;
  callback_url: string | null;
  active: boolean;
  fields: string[];
}

interface ExtrasTesteApp {
  embedded_signup: { config_id_preenchido: boolean; liberado: boolean };
  admin_login: { config_id_preenchido: boolean };
  webhook: { verificado_em: string | null; ultimo_evento_em: string | null };
  testado_em: string;
}

export type ResultadoTesteApp =
  | (ExtrasTesteApp & {
      ok: true;
      nome_na_meta: string | null;
      assinaturas: AssinaturaApp[];
      assinaturas_erro: string | null;
      whatsapp: {
        assinado: boolean;
        ativo: boolean;
        callback_url: string | null;
        callback_esperado: string;
        callback_confere: boolean;
        campos_faltando: string[];
      };
      modo_app: ModoApp | string;
    })
  | (ExtrasTesteApp & { ok: false; erro: string });

export interface NumeroSincronizado {
  id: string;
  phone_number_id: string;
  display_phone: string | null;
  novo: boolean;
  status: string;
  platform_type: string | null;
  code_verification_status: string | null;
  /** Coexistência com o app WhatsApp Business (não se registra na Cloud API). */
  is_coexistence?: boolean;
  canal_criado: boolean;
}

export interface WabaResposta {
  id?: string;
  waba_id?: string;
  nome?: string | null;
  business_id?: string | null;
  subscribed_apps_ok?: boolean;
  token_fingerprint?: string | null;
  token_tamanho?: number | null;
  token_expira_em?: string | null;
  status?: string;
  ultimo_erro?: string | null;
  pausada_em?: string | null;
  pausada_por?: string | null;
  pausa_motivo?: string | null;
  saude?: SaudeMeta | null;
  saude_em?: string | null;
}

export interface ResultadoSincronizacao {
  ok: boolean;
  waba: WabaResposta;
  numeros: NumeroSincronizado[];
  conflitos: { phone_number_id: string; display_phone: string | null }[];
  ausentes_na_meta: { id: string; phone_number_id: string }[];
  padrao_id: string | null;
}

export interface DadosNumero {
  numero_id: string;
  display_name?: string | null;
  is_default?: boolean;
  is_active?: boolean;
  /** null = sem funil. */
  pipeline_id?: string | null;
}

export interface DadosDaMetaNumero {
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
  name_status?: string;
  platform_type?: string;
  is_on_biz_app?: boolean;
  /** CONNECTED, DISCONNECTED, PENDING… */
  status?: string;
}

export type ResultadoTesteNumero =
  | {
    ok: true;
    dados: DadosDaMetaNumero | null;
    utilizavel: boolean;
    motivo: string | null;
    saude?: SaudeMeta | null;
    /** Envio limitado pela Meta (o número segue recebendo). */
    aviso?: string | null;
    pausada?: boolean;
  }
  | { ok: false; erro: string | null; dados: DadosDaMetaNumero | null; saude?: SaudeMeta | null; pausada?: boolean };

export interface ErroMeta {
  code: number | null;
  message: string;
  /** Explicação PT-BR de erros conhecidos (ex.: #200 = linha de crédito de parceiro). */
  explicacao?: string | null;
}

export type ResultadoEnvioTeste =
  | { ok: true; message_id: string | null; modelo?: string; idioma?: string }
  | { ok: false; erro: ErroMeta; modelo?: string; idioma?: string };

/** Resposta de waba_pausar / waba_retomar. `ja_estava` = nada mudou (idempotente). */
export interface ResultadoPausa {
  ok: true;
  ja_estava: boolean;
  numeros_pausados?: number;
  numeros_retomados?: number;
  waba: WabaResposta;
}

export type ResultadoSaudeWaba =
  | { ok: true; saude: SaudeMeta | null; saude_em: string; waba: WabaResposta }
  | { ok: false; erro: string };
export type ResultadoRegistro = { ok: true; status: "conectado" } | { ok: false; erro: ErroMeta };
export interface ResultadoSyncCoexistencia {
  ok: boolean;
  etapas: { sync_type: string; ok: boolean; erro: ErroMeta | null }[];
}

export type ResultadoAtribuir =
  | (Partial<ResultadoSincronizacao> & { ok: true; numero_id: string; ja_cadastrado?: boolean })
  | (Partial<ResultadoSincronizacao> & { ok: false; erro: string });

/** Resposta de get-whatsapp-config no modo admin. */
export type ConfigConexaoMeta =
  | { disponivel: false; motivo: string }
  | {
      disponivel: true;
      url: string;
      app_id: string;
      config_id: string;
      redirect_uri: string;
      graph_version: string;
    };

/** webhook_secret_info (admin-update-tenant). */
export interface WebhookLeadsInfo {
  definido: boolean;
  fingerprint: string | null;
  tamanho: number;
  url: string;
  cabecalho: string;
  rotated_at: string | null;
}

/** webhook_secret_rotacionar: `segredo` só nesta resposta. */
export interface WebhookLeadsRotacao extends WebhookLeadsInfo {
  segredo: string;
}

export interface ChaveApi {
  id: string;
  name: string | null;
  key_prefix: string | null;
  active: boolean;
  created_at: string;
  last_used_at: string | null;
}

/** api_key_criar: `chave` só nesta resposta. */
export interface ChaveApiCriada {
  id: string;
  chave: string;
  name: string;
  key_prefix: string;
}

/* ------------------------------------------------------------------------ */
/* Saneamento                                                                */
/* ------------------------------------------------------------------------ */

/** Chaves que nunca podem ficar no front, venha de onde vier. */
const CHAVES_SECRETAS = new Set(["verify_token", "app_secret", "token", "access_token", "api_token", "webhook_secret"]);

/** Cópia profunda sem as chaves secretas (defesa contra RPC que devolva demais). */
export function semSegredos<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map((v) => semSegredos(v)) as unknown as T;
  if (valor && typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      if (CHAVES_SECRETAS.has(k)) continue;
      saida[k] = semSegredos(v);
    }
    return saida as T;
  }
  return valor;
}

function erroDoBanco(error: { message?: string; code?: string } | null | undefined, padrao: string): Error {
  return new Error(error?.message || padrao);
}

/** Converte os contadores (bigint do Postgres pode vir como string). */
function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------------------ */
/* Chaves de cache                                                           */
/* ------------------------------------------------------------------------ */

export const chavesMeta = {
  raiz: ["admin", "meta"] as const,
  apps: () => ["admin", "meta", "apps"] as const,
  visao: (tenantId: string | null | undefined) => ["admin", "meta", "visao", tenantId ?? null] as const,
  webhookInfo: (metaAppId: string | null | undefined) => ["admin", "meta", "webhook-info", metaAppId ?? "geral"] as const,
  webhookLeads: (tenantId: string | null | undefined) => ["admin", "meta", "webhook-leads", tenantId ?? null] as const,
  chavesApi: (tenantId: string | null | undefined) => ["admin", "meta", "chaves-api", tenantId ?? null] as const,
  statusIntegracoes: (tenantId: string | null | undefined) =>
    ["admin", "meta", "status-integracoes", tenantId ?? null] as const,
};

/* ------------------------------------------------------------------------ */
/* Operações (edge functions)                                                */
/* ------------------------------------------------------------------------ */

function meta<T>(action: string, dados: Record<string, unknown> = {}): Promise<T> {
  return invocarFuncao<T>("admin-meta", { ...dados, action });
}

function tenantOp<T>(tenantId: string, action: string, dados: Record<string, unknown> = {}): Promise<T> {
  return invocarFuncao<T>("admin-update-tenant", { ...dados, tenant_id: tenantId, action });
}

/**
 * Wrappers tipados das actions. Não invalidam cache: nas telas, use
 * `useMetaOps()`, que invalida depois de cada escrita.
 */
export const metaOps = {
  importarAppGeral: (configId?: string | null) =>
    meta<ResultadoImportacao>("importar_app_geral_do_ambiente", configId ? { config_id: configId } : {}),
  salvarApp: (dados: DadosApp) => meta<ResultadoSalvarApp>("app_salvar", { ...dados }),
  testarApp: (id: string) => meta<ResultadoTesteApp>("app_testar", { id }),
  apagarApp: (id: string) => meta<{ ok: true }>("app_apagar", { id }),
  definirAppDoCliente: (tenantId: string, metaAppId: string | null) =>
    meta<{ ok: true; alterado: boolean; app_em_uso_id?: string | null; avisos: string[] }>("cliente_definir_app", {
      tenant_id: tenantId,
      meta_app_id: metaAppId,
    }),
  conectarWaba: (tenantId: string, wabaId: string, token: string) =>
    meta<ResultadoSincronizacao>("waba_conectar", { tenant_id: tenantId, waba_id: wabaId, token }),
  sincronizarWaba: (wabaRefId: string) =>
    meta<ResultadoSincronizacao>("waba_sincronizar_numeros", { waba_ref_id: wabaRefId }),
  trocarTokenWaba: (wabaRefId: string, token: string) =>
    meta<{ ok: true; waba: WabaResposta }>("waba_trocar_token", { waba_ref_id: wabaRefId, token }),
  assinarWaba: (wabaRefId: string) =>
    meta<{ ok: true; subscribed_apps_ok: boolean; erro: string | null; waba: WabaResposta }>("waba_assinar", {
      waba_ref_id: wabaRefId,
    }),
  /** Pausa total da WABA no CRM (motivo opcional). Não mexe na Meta. */
  pausarWaba: (wabaRefId: string, motivo?: string | null) =>
    meta<ResultadoPausa>("waba_pausar", { waba_ref_id: wabaRefId, motivo: motivo?.trim() ? motivo.trim() : null }),
  retomarWaba: (wabaRefId: string) => meta<ResultadoPausa>("waba_retomar", { waba_ref_id: wabaRefId }),
  saudeWaba: (wabaRefId: string) => meta<ResultadoSaudeWaba>("waba_saude", { waba_ref_id: wabaRefId }),
  removerWaba: (wabaRefId: string) =>
    meta<{ ok: true; numeros_desativados: number; assinatura_removida: boolean }>("waba_remover", {
      waba_ref_id: wabaRefId,
    }),
  atualizarNumero: (dados: DadosNumero) => meta<{ ok: true }>("numero_atualizar", { ...dados }),
  testarNumero: (numeroId: string) => meta<ResultadoTesteNumero>("numero_testar", { numero_id: numeroId }),
  /** Sem modelo: o servidor usa o 1º modelo APROVADO da WABA (pt_BR primeiro). */
  enviarTeste: (dados: { numero_id: string; para: string; modelo?: string; idioma?: string }) =>
    meta<ResultadoEnvioTeste>("numero_enviar_teste", {
      numero_id: dados.numero_id,
      para: dados.para,
      ...(dados.modelo?.trim() ? { modelo: dados.modelo.trim() } : {}),
      ...(dados.idioma?.trim() ? { idioma: dados.idioma.trim() } : {}),
    }),
  registrarNumero: (numeroId: string, pin: string) =>
    meta<ResultadoRegistro>("numero_registrar", { numero_id: numeroId, pin }),
  sincronizarCoexistencia: (numeroId: string) =>
    meta<ResultadoSyncCoexistencia>("numero_sincronizar_coexistencia", { numero_id: numeroId }),
  excluirNumero: (numeroId: string) => meta<{ ok: true }>("numero_excluir", { numero_id: numeroId }),
  transferirNumero: (numeroId: string, tenantDestino: string) =>
    meta<{ ok: true; avisos: string[] }>("numero_transferir", { numero_id: numeroId, tenant_destino: tenantDestino }),
  descartarDesconhecido: (phoneNumberId: string) =>
    meta<{ ok: true; removido: boolean }>("desconhecido_descartar", { phone_number_id: phoneNumberId }),
  atribuirDesconhecido: (phoneNumberId: string, tenantId: string) =>
    meta<ResultadoAtribuir>("desconhecido_atribuir", { phone_number_id: phoneNumberId, tenant_id: tenantId }),
  webhookInfo: (metaAppId?: string | null) =>
    meta<WebhookInfo & { ok: true }>("webhook_info", metaAppId ? { meta_app_id: metaAppId } : {}),

  /** Popup do Login do Facebook para Empresas (configuração de ADMIN). */
  configConexaoAdmin: (tenantId: string) =>
    invocarFuncao<ConfigConexaoMeta>("get-whatsapp-config", { modo: "admin", tenant_id: tenantId }),

  webhookLeadsInfo: (tenantId: string) => tenantOp<WebhookLeadsInfo & { ok: true }>(tenantId, "webhook_secret_info"),
  rotacionarWebhookLeads: (tenantId: string) =>
    tenantOp<WebhookLeadsRotacao & { ok: true }>(tenantId, "webhook_secret_rotacionar"),
  listarChavesApi: (tenantId: string) => tenantOp<{ ok: true; chaves: ChaveApi[] }>(tenantId, "api_key_listar"),
  criarChaveApi: (tenantId: string, nome: string) =>
    tenantOp<ChaveApiCriada & { ok: true }>(tenantId, "api_key_criar", { name: nome }),
  revogarChaveApi: (tenantId: string, id: string) => tenantOp<{ ok: true }>(tenantId, "api_key_revogar", { id }),
};

type MetaOps = typeof metaOps;

/** Operações que só leem: não precisam invalidar nada. */
const SO_LEITURA = new Set<keyof MetaOps>(["webhookInfo", "configConexaoAdmin", "webhookLeadsInfo", "listarChavesApi"]);

/**
 * Invalida tudo o que o admin mostra sobre WhatsApp/Meta: apps, visão dos
 * clientes, webhook, alertas (Início também usa) e a lista de clientes (que
 * conta números).
 */
export function useInvalidarMeta() {
  const qc = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: chavesMeta.raiz }),
      qc.invalidateQueries({ queryKey: chavesAdmin.alertasMeta() }),
      qc.invalidateQueries({ queryKey: chavesAdmin.clientes() }),
      qc.invalidateQueries({ queryKey: ["admin", "tenant"] }),
    ]);
  }, [qc]);
}

/**
 * `metaOps` com invalidação automática: depois de cada escrita (com sucesso ou
 * não, porque algumas gravam mesmo quando a Meta recusa, ex.: testado_em),
 * os hooks de leitura recarregam.
 */
export function useMetaOps(): MetaOps {
  const invalidar = useInvalidarMeta();
  return useMemo(() => {
    const saida = {} as Record<string, unknown>;
    for (const [nome, fn] of Object.entries(metaOps) as [keyof MetaOps, (...a: unknown[]) => Promise<unknown>][]) {
      if (SO_LEITURA.has(nome)) {
        saida[nome] = fn;
        continue;
      }
      saida[nome] = async (...args: unknown[]) => {
        try {
          return await fn(...args);
        } finally {
          void invalidar();
        }
      };
    }
    return saida as unknown as MetaOps;
  }, [invalidar]);
}

/* ------------------------------------------------------------------------ */
/* Leitura (react-query)                                                     */
/* ------------------------------------------------------------------------ */

/** Todos os apps Meta (geral e próprios dos clientes). */
export function useMetaApps() {
  return useQuery({
    queryKey: chavesMeta.apps(),
    queryFn: async (): Promise<AppMetaAdmin[]> => {
      const { data, error } = await db.rpc("admin_meta_apps_listar");
      if (error) throw erroDoBanco(error, "Não foi possível ler os apps Meta.");
      const lista = Array.isArray(data) ? semSegredos(data as AppMetaAdmin[]) : [];
      return lista.map((a) => ({
        ...a,
        n_wabas: num(a.n_wabas),
        n_numeros: num(a.n_numeros),
        n_clientes_usando: num(a.n_clientes_usando),
      }));
    },
  });
}

/** WhatsApp de um cliente: app em uso, WABAs, números, funis e desconhecidos. */
export function useMetaVisao(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: chavesMeta.visao(tenantId),
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<VisaoMeta> => {
      const { data, error } = await db.rpc("admin_meta_visao", { p_tenant: tenantId });
      if (error) throw erroDoBanco(error, "Não foi possível ler o WhatsApp do cliente.");
      const v = semSegredos((data ?? {}) as Partial<VisaoMeta>);
      return {
        tenant: v.tenant ?? { id: String(tenantId), nome: "", slug: "", meta_app_id: null },
        app_em_uso: v.app_em_uso ?? null,
        app_proprio: v.app_proprio ?? null,
        wabas: Array.isArray(v.wabas) ? v.wabas.map((w) => ({ ...w, n_numeros: num(w.n_numeros) })) : [],
        numeros: Array.isArray(v.numeros) ? v.numeros : [],
        pipelines: Array.isArray(v.pipelines) ? v.pipelines : [],
        desconhecidos: Array.isArray(v.desconhecidos) ? v.desconhecidos : [],
      };
    },
  });
}

/** Alertas de WhatsApp de todos os clientes (mesma chave do Início). */
export function useMetaAlertas() {
  return useQuery({
    queryKey: chavesAdmin.alertasMeta(),
    staleTime: 60_000,
    queryFn: async (): Promise<AlertaMeta[]> => {
      const { data, error } = await db.rpc("admin_meta_alertas");
      if (error) throw erroDoBanco(error, "Não foi possível ler os alertas.");
      return Array.isArray(data) ? (data as AlertaMeta[]) : [];
    },
  });
}

/** URLs e campos para colar na Meta. `metaAppId` nulo = app geral. */
export function useWebhookInfo(metaAppId: string | null | undefined, habilitado = true) {
  return useQuery({
    queryKey: chavesMeta.webhookInfo(metaAppId),
    enabled: habilitado,
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<WebhookInfo> => semSegredos(await metaOps.webhookInfo(metaAppId ?? null)),
  });
}

/** Webhook de leads do site do cliente (sem o segredo). */
export function useWebhookLeads(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: chavesMeta.webhookLeads(tenantId),
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<WebhookLeadsInfo> => {
      const r = await metaOps.webhookLeadsInfo(tenantId as string);
      return {
        definido: Boolean(r.definido),
        fingerprint: r.fingerprint ?? null,
        tamanho: num(r.tamanho),
        url: r.url,
        cabecalho: r.cabecalho || "x-webhook-secret",
        rotated_at: r.rotated_at ?? null,
      };
    },
  });
}

/** Chaves de API do cliente (só prefixo, nunca a chave). */
export function useChavesApi(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: chavesMeta.chavesApi(tenantId),
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<ChaveApi[]> => {
      const r = await metaOps.listarChavesApi(tenantId as string);
      return Array.isArray(r.chaves) ? r.chaves : [];
    },
  });
}

/* ------------------------------------------------------------------------ */
/* Status de Conversões Meta e Api4Com (só leitura)                          */
/* ------------------------------------------------------------------------ */

export interface StatusCapi {
  existe: boolean;
  enabled: boolean;
  dataset_id: string | null;
  tem_token: boolean;
  send_crm_events: boolean;
  send_lead_event: boolean;
  updated_at: string | null;
  ultimo_envio: string | null;
  ultimo_erro: string | null;
  enviados_7d: number;
  falhas_7d: number;
}

export interface StatusApi4com {
  existe: boolean;
  conectado: boolean;
  connected_at: string | null;
  webhook_registered: boolean;
  webhook_last_error: string | null;
  ramais: number;
  ultima_ligacao_em: string | null;
  ligacoes_30d: number;
}

export interface StatusIntegracoes {
  /** false = a RPC admin_integracoes_status ainda não existe no banco. */
  completo: boolean;
  capi: StatusCapi | null;
  api4com: StatusApi4com | null;
}

function rpcInexistente(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === "PGRST202" || error?.code === "42883" || /could not find the function/i.test(error?.message ?? "");
}

/**
 * Status de Conversões Meta e Api4Com do cliente. Usa a RPC
 * admin_integracoes_status(p_tenant) (superadmin, sem segredo). Enquanto ela
 * não existir, o Api4Com sai das ligações (api4com_calls, que o superadmin lê)
 * e o CAPI fica sem status.
 */
export function useStatusIntegracoes(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: chavesMeta.statusIntegracoes(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 60_000,
    queryFn: async (): Promise<StatusIntegracoes> => {
      const { data, error } = await db.rpc("admin_integracoes_status", { p_tenant: tenantId });
      if (!error) {
        const d = semSegredos((data ?? {}) as { capi?: StatusCapi | null; api4com?: StatusApi4com | null });
        return {
          completo: true,
          capi: d.capi
            ? { ...d.capi, enviados_7d: num(d.capi.enviados_7d), falhas_7d: num(d.capi.falhas_7d) }
            : null,
          api4com: d.api4com
            ? { ...d.api4com, ramais: num(d.api4com.ramais), ligacoes_30d: num(d.api4com.ligacoes_30d) }
            : null,
        };
      }
      if (!rpcInexistente(error)) throw erroDoBanco(error, "Não foi possível ler o status das integrações.");

      const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const [ultima, contagem] = await Promise.all([
        db
          .from("api4com_calls")
          .select("created_at")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(1),
        db
          .from("api4com_calls")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .gte("created_at", desde),
      ]);
      if (ultima.error) throw erroDoBanco(ultima.error, "Não foi possível ler as ligações.");
      if (contagem.error) throw erroDoBanco(contagem.error, "Não foi possível ler as ligações.");
      const ultimaEm = (ultima.data as { created_at: string }[] | null)?.[0]?.created_at ?? null;
      return {
        completo: false,
        capi: null,
        api4com: {
          existe: Boolean(ultimaEm),
          conectado: false,
          connected_at: null,
          webhook_registered: false,
          webhook_last_error: null,
          ramais: 0,
          ultima_ligacao_em: ultimaEm,
          ligacoes_30d: contagem.count ?? 0,
        },
      };
    },
  });
}

/* ------------------------------------------------------------------------ */
/* Rótulos                                                                   */
/* ------------------------------------------------------------------------ */

export function rotuloTokenTipo(tipo: string | null | undefined): string {
  switch (tipo) {
    case "system_user":
      return "Usuário do sistema";
    case "embedded_signup":
      return "Conexão pelo Facebook";
    case "coexistencia":
      return "Coexistência";
    case "admin_login":
      return "Login do administrador";
    default:
      return tipo || "—";
  }
}

export function rotuloModoApp(modo: string | null | undefined): string {
  if (modo === "live") return "Ao vivo";
  if (modo === "development") return "Desenvolvimento";
  return "Modo não informado";
}

/** Rótulo de can_send_message (saúde da Meta). */
export function rotuloPodeEnviar(p: PodeEnviarMeta | null | undefined): string {
  if (p === "AVAILABLE") return "Envio liberado";
  if (p === "LIMITED") return "Envio limitado";
  if (p === "BLOCKED") return "Envio bloqueado";
  return "Sem informação";
}

export function rotuloQualidade(q: string | null | undefined): string | null {
  switch ((q ?? "").toUpperCase()) {
    case "GREEN":
      return "Qualidade alta";
    case "YELLOW":
      return "Qualidade média";
    case "RED":
      return "Qualidade baixa";
    case "":
      return null;
    default:
      return `Qualidade ${q}`;
  }
}

/** Campos de webhook que o app precisa assinar (mesma lista do servidor). */
export const CAMPOS_WEBHOOK_META = [
  "messages",
  "smb_message_echoes",
  "calls",
  "message_template_status_update",
  "account_update",
  "history",
  "smb_app_state_sync",
] as const;

/** Dias até a data (negativo = já passou). null se não houver data. */
export function diasAte(iso: string | null | undefined, agora: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (t - agora.getTime()) / 86_400_000;
}

/** 'dd/mm' no fuso do navegador. */
export function diaMes(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/**
 * Gera um verify token aleatório (32 caracteres base64url) NO NAVEGADOR:
 * o humano copia para a Meta e o formulário manda ao servidor. O servidor
 * nunca devolve o valor salvo.
 */
export function gerarVerifyToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Mesma regra do servidor (admin-meta app_salvar). */
const RE_VERIFY_TOKEN = /^[A-Za-z0-9._~-]{16,200}$/;

/** Mensagem de erro do verify token digitado; null = válido (ou vazio). */
export function validarVerifyToken(valor: string): string | null {
  if (!valor) return null;
  if (valor.length < 16) return "Use pelo menos 16 caracteres.";
  if (valor.length > 200) return "Use no máximo 200 caracteres.";
  if (!RE_VERIFY_TOKEN.test(valor)) return "Use só letras, números, ponto, hífen, sublinhado ou til.";
  return null;
}

/** Ajuda do campo "Config ID do login do administrador" (AJUSTE DO COORDENADOR). */
export const AJUDA_ADMIN_LOGIN =
  "Crie no painel da Meta uma configuração do Login do Facebook para Empresas (variação Geral, token de usuário do " +
  "sistema, expiração Nunca, ativos Contas do WhatsApp, permissões whatsapp_business_management e " +
  "whatsapp_business_messaging) e cole o ID aqui";

/** Explica por que um número ficou pendente (crítica 14). */
export function motivoPendencia(n: {
  platform_type?: string | null;
  code_verification_status?: string | null;
  /** Coexistência (app WhatsApp Business + API): fica ON_PREMISE por natureza e não se registra. */
  is_coexistence?: boolean | null;
  is_on_biz_app?: boolean | null;
}): string | null {
  if (n.is_coexistence || n.is_on_biz_app) return null;
  if (n.platform_type && n.platform_type !== "CLOUD_API") {
    return "Ainda não está na Cloud API: use Registrar no menu do número (PIN de 6 dígitos).";
  }
  if (n.code_verification_status === "NOT_VERIFIED") {
    return "A Meta ainda não verificou este número: conclua a verificação no Gerenciador do WhatsApp.";
  }
  return null;
}

/** Nome do número para a tela: apelido, senão o número, senão o ID da Meta. */
export function nomeDoNumero(n: Pick<NumeroAdmin, "display_name" | "phone_e164" | "phone_number_id">): string {
  return n.display_name?.trim() || n.phone_e164 || n.phone_number_id;
}
