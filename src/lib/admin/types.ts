/**
 * Tipos do painel admin, escritos à mão.
 *
 * As tabelas e RPCs novas (P01/P02) ainda não estão em
 * src/integrations/supabase/types.ts; quando o types.ts for regenerado (P90),
 * estes tipos continuam valendo como contrato das telas.
 *
 * Regra: nenhum tipo aqui carrega segredo (app_secret, token de WABA, verify
 * token de cliente, segredo de webhook). Das credenciais, o front só conhece
 * impressão digital e tamanho.
 */

/** Status do cliente. 'deleted' é o legado; a lixeira é `deleted_at` preenchido. */
export type StatusTenant = "active" | "paused" | "deleted";

export type SegmentoKey = "odontologia" | "oftalmologia" | "estetica" | "medica_geral";

/** Termos do CRM por segmento (segment_presets.vocabulary / tenants.vocabulary). */
export interface Vocabulario {
  pessoa?: string;
  pessoa_plural?: string;
  servico?: string;
  servico_plural?: string;
  unidade?: string;
  unidade_plural?: string;
  profissional?: string;
  especialidades?: string[];
  servicos_interesse?: string[];
  receita_recorrente_label?: string | null;
}

/** Colunas de `tenants` que o admin lê (nunca `select('*')`). */
export interface TenantAdmin {
  id: string;
  slug: string;
  name: string;
  display_name: string | null;
  status: StatusTenant | string;
  deleted_at: string | null;
  is_protected: boolean;
  segment: SegmentoKey | string;
  vocabulary: Vocabulario;
  timezone: string;
  logo_url: string | null;
  logo_dark_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  primary_color_dark: string | null;
  secondary_color: string | null;
  font_family: string | null;
  radius_px: number | null;
  login_title: string | null;
  login_subtitle: string | null;
  login_footer: string | null;
  login_bg_url: string | null;
  hide_system_brand: boolean;
  /** NULL = usa o app Meta geral do sistema. */
  meta_app_id: string | null;
  trial_ends_at: string | null;
  created_at: string;
  branding_version: number;
}

/** Lista exata de colunas usada no SELECT de `useTenantAdmin`. */
export const COLUNAS_TENANT_ADMIN = [
  "id",
  "slug",
  "name",
  "display_name",
  "status",
  "deleted_at",
  "is_protected",
  "segment",
  "vocabulary",
  "timezone",
  "logo_url",
  "logo_dark_url",
  "favicon_url",
  "primary_color",
  "primary_color_dark",
  "secondary_color",
  "font_family",
  "radius_px",
  "login_title",
  "login_subtitle",
  "login_footer",
  "login_bg_url",
  "hide_system_brand",
  "meta_app_id",
  "trial_ends_at",
  "created_at",
  "branding_version",
] as const satisfies readonly (keyof TenantAdmin)[];

export type FonteMarca = "Inter" | "Manrope" | "Poppins" | "DM Sans" | "Nunito Sans";

/** `system_settings` (singleton id = 1, sem segredo). */
export interface SystemSettings {
  id: 1;
  product_name: string;
  short_name: string;
  tagline: string | null;
  logo_url: string | null;
  logo_dark_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  primary_color_dark: string | null;
  secondary_color: string | null;
  font_family: FonteMarca | string;
  radius_px: number;
  primary_domain: string | null;
  support_email: string | null;
  legal_operator_name: string | null;
  legal_operator_doc: string | null;
  legal_contact_email: string | null;
  legal_address: string | null;
  legal_updated_at: string | null;
  public_version: number;
  updated_at: string;
  updated_by: string | null;
}

export type CategoriaModulo = "atendimento" | "ferramentas" | "gestao" | "integracoes";
export type DisponibilidadeModulo = "essencial" | "disponivel" | "beta" | "indisponivel";

/** Catálogo `modules`. */
export interface Modulo {
  key: string;
  name: string;
  description: string;
  category: CategoriaModulo | string;
  default_enabled: boolean;
  availability: DisponibilidadeModulo | string;
  sort: number | null;
}

/** Linha de `tenant_modules` (ausência = vale o default_enabled do catálogo). */
export interface TenantModulo {
  tenant_id: string;
  module_key: string;
  enabled: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

/** `segment_presets`. */
export interface SegmentPreset {
  key: SegmentoKey | string;
  label: string;
  vocabulary: Vocabulario;
  ai_system_prompt: string;
  sort: number;
}

/** `admin_audit_log`. `before`/`after` já chegam sem segredo (o servidor redige). */
export interface AuditRow {
  id: number;
  actor_id: string;
  target_tenant_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

/** `access_logs`. */
export interface AccessLogRow {
  id: string;
  user_id: string | null;
  email: string | null;
  tenant_id: string | null;
  context: string;
  event: string;
  ip: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Item de `admin_clientes_listar`. */
export interface ClienteListaItem {
  id: string;
  slug: string;
  name: string;
  display_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  segment: string;
  status: StatusTenant | string;
  deleted_at: string | null;
  is_protected: boolean;
  plano_nome: string | null;
  usuarios: number;
  numeros_whatsapp: number;
  created_at: string;
}

export interface ClientesListaResposta {
  total: number;
  itens: ClienteListaItem[];
}

export type FiltroStatusClientes = "ativos" | "pausados" | "lixeira" | "todos";

export interface FiltrosClientes {
  busca?: string;
  status?: FiltroStatusClientes;
  segmento?: string | null;
  /** Índice da página, começando em 0. */
  pagina?: number;
  porPagina?: number;
}

/** Linha de `admin_tenant_users(_tenant_id)`. */
export interface UsuarioDoTenant {
  id: string;
  nome: string | null;
  email: string | null;
  cargo: string | null;
  is_blocked: boolean;
  last_login_at: string | null;
  must_change_password: boolean;
  role: string | null;
}

/** `plans`. */
export interface Plano {
  id: string;
  name: string;
  monthly_price: number;
  user_limit: number;
  lead_limit: number;
  message_limit: number;
  features: Record<string, unknown> | unknown[];
  is_active: boolean;
  created_at: string;
}

export type StatusFatura = "open" | "paid" | string;

/** `tenant_invoices` com o nome do cliente. */
export interface Fatura {
  id: string;
  tenant_id: string;
  reference_month: string;
  amount: number;
  status: StatusFatura;
  paid_at: string | null;
  receipt_url: string | null;
  notes: string | null;
  created_at: string;
  tenants: { name: string; display_name: string | null } | null;
}

/** `admin_platform_metrics()`. */
export interface MetricasPlataforma {
  mrr: number;
  tenants_total: number;
  clients_active: number;
  clients_paused: number;
  clients_deleted: number;
  users_total: number;
  users_active_30d: number;
  leads_month: number;
  messages_month: number;
}

export type TipoAlertaMeta =
  | "sem_app_geral"
  | "token_expirando"
  | "token_expirado"
  | "waba_sem_assinatura"
  | "waba_erro"
  | "numero_teste_falhou"
  | "numero_desconhecido"
  | "cliente_sem_numero"
  | "webhook_rejeitado";

/** Item de `admin_meta_alertas()`. */
export interface AlertaMeta {
  tipo: TipoAlertaMeta | string;
  severidade: "erro" | "aviso";
  tenant_id: string | null;
  tenant_nome: string | null;
  mensagem: string;
  ref_id: string | null;
}

/** Resultado paginado das consultas com `range()`. */
export interface Paginado<T> {
  linhas: T[];
  total: number;
}

export interface FiltrosAuditoria {
  tenantId?: string | null;
  action?: string | null;
  actorId?: string | null;
  /** 'AAAA-MM-DD' (dia inteiro, no fuso do navegador) ou ISO completo. */
  desde?: string | null;
  ate?: string | null;
  /** Índice da página, começando em 0. */
  pagina: number;
  porPagina?: number;
}

export interface FiltrosAcessos {
  tenantId?: string | null;
  contexto?: string | null;
  /** Filtra por e-mail (contém, sem diferenciar maiúsculas). */
  email?: string | null;
  desde?: string | null;
  ate?: string | null;
  /** Índice da página, começando em 0. */
  pagina: number;
  porPagina?: number;
}

export interface FiltrosFaturas {
  tenantId?: string | null;
  status?: StatusFatura | null;
}
