/**
 * Camada de dados do painel admin (react-query).
 *
 * - Escritas passam por edge functions (`invocarFuncao`); o que é só leitura
 *   vai direto nas tabelas/RPCs, sob a RLS de superadmin.
 * - As tabelas e RPCs novas (P01/P02) ainda não estão no types.ts gerado, por
 *   isso o acesso é pelo cliente sem tipos (`db`). O P90 regenera o types.ts.
 * - Chaves de cache em `chavesAdmin`, para as telas invalidarem depois de
 *   escrever.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motivoDoServidor } from "@/lib/erroDeFuncao";
import {
  COLUNAS_TENANT_ADMIN,
  type AccessLogRow,
  type AlertaMeta,
  type AuditRow,
  type ClientesListaResposta,
  type Fatura,
  type FiltrosAcessos,
  type FiltrosAuditoria,
  type FiltrosClientes,
  type FiltrosFaturas,
  type MetricasPlataforma,
  type Modulo,
  type Paginado,
  type Plano,
  type SegmentPreset,
  type SystemSettings,
  type TenantAdmin,
  type TenantModulo,
  type UsuarioDoTenant,
} from "./types";

// Tabelas/RPCs novas ainda fora do types.ts gerado (ver cabeçalho).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const MSG_PADRAO = "Não foi possível concluir a operação. Tente de novo.";

/**
 * Chama uma edge function e devolve o corpo. Em erro (HTTP não-2xx ou corpo
 * `{error}`), lança Error com a mensagem que o servidor mandou.
 */
export async function invocarFuncao<T = unknown>(nome: string, body?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(nome, { body: body ?? {} });
  const corpoComErro =
    data !== null && typeof data === "object" && "error" in (data as Record<string, unknown>) &&
    Boolean((data as Record<string, unknown>).error);
  if (error || corpoComErro) {
    throw new Error(await motivoDoServidor(data, error, MSG_PADRAO));
  }
  return data as T;
}

/** Erro do PostgREST/RPC como Error com mensagem legível. */
function falha(error: { message?: string } | null | undefined, padrao = MSG_PADRAO): never {
  throw new Error(error?.message || padrao);
}

/** 'AAAA-MM-DD' vira início/fim do dia local; ISO passa como está. */
function limiteDeData(valor: string, fim: boolean): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const d = new Date(`${valor}T${fim ? "23:59:59.999" : "00:00:00"}`);
    return d.toISOString();
  }
  return valor;
}

function intervalo(pagina: number, porPagina: number): [number, number] {
  const inicio = Math.max(0, pagina) * porPagina;
  return [inicio, inicio + porPagina - 1];
}

/** Chaves de cache do admin. Use `chavesAdmin.raiz` para invalidar tudo. */
export const chavesAdmin = {
  raiz: ["admin"] as const,
  souSuperadmin: (userId: string | null | undefined) => ["admin", "sou-superadmin", userId ?? null] as const,
  clientes: (filtros?: FiltrosClientes) =>
    (filtros ? ["admin", "clientes", filtros] : ["admin", "clientes"]) as readonly unknown[],
  buscaClientes: (termo: string) => ["admin", "clientes", "busca", termo] as const,
  tenant: (id: string | null | undefined) => ["admin", "tenant", id ?? null] as const,
  systemSettings: () => ["admin", "system-settings"] as const,
  modulosCatalogo: () => ["admin", "modulos-catalogo"] as const,
  tenantModulos: (id: string | null | undefined) => ["admin", "tenant-modulos", id ?? null] as const,
  segmentos: () => ["admin", "segmentos"] as const,
  usuariosDoTenant: (id: string | null | undefined) => ["admin", "usuarios-do-tenant", id ?? null] as const,
  auditoria: (filtros?: FiltrosAuditoria) =>
    (filtros ? ["admin", "auditoria", filtros] : ["admin", "auditoria"]) as readonly unknown[],
  acessos: (filtros?: FiltrosAcessos) =>
    (filtros ? ["admin", "acessos", filtros] : ["admin", "acessos"]) as readonly unknown[],
  planos: (apenasAtivos?: boolean) =>
    (apenasAtivos === undefined ? ["admin", "planos"] : ["admin", "planos", { apenasAtivos }]) as readonly unknown[],
  faturas: (filtros?: FiltrosFaturas) =>
    (filtros ? ["admin", "faturas", filtros] : ["admin", "faturas"]) as readonly unknown[],
  metricasPlataforma: () => ["admin", "metricas-plataforma"] as const,
  alertasMeta: () => ["admin", "alertas-meta"] as const,
  numerosPorUsuario: (id: string | null | undefined) => ["admin", "numeros-por-usuario", id ?? null] as const,
};

/**
 * O usuário logado é superadmin? Lê a própria linha em user_roles (policy
 * 'Users can view own roles'). Em erro de rede LANÇA, para o guard não
 * confundir falha com "não é superadmin".
 */
export function useSouSuperadmin(userId: string | null | undefined) {
  return useQuery({
    queryKey: chavesAdmin.souSuperadmin(userId),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    retry: 2,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId as string)
        .eq("role", "superadmin")
        .maybeSingle();
      if (error) falha(error, "Não foi possível conferir o seu acesso.");
      return Boolean(data);
    },
  });
}

/** Lista paginada de clientes (RPC admin_clientes_listar). */
export function useClientesAdmin(filtros: FiltrosClientes = {}) {
  const porPagina = filtros.porPagina ?? 25;
  const pagina = filtros.pagina ?? 0;
  const normalizado: FiltrosClientes = {
    busca: filtros.busca?.trim() || undefined,
    status: filtros.status ?? "ativos",
    segmento: filtros.segmento || null,
    pagina,
    porPagina,
  };
  return useQuery({
    queryKey: chavesAdmin.clientes(normalizado),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ClientesListaResposta> => {
      const { data, error } = await db.rpc("admin_clientes_listar", {
        p_busca: normalizado.busca ?? null,
        p_status: normalizado.status,
        p_segmento: normalizado.segmento,
        p_limite: porPagina,
        p_offset: pagina * porPagina,
      });
      if (error) falha(error);
      const r = (data ?? {}) as Partial<ClientesListaResposta>;
      return { total: Number(r.total ?? 0), itens: Array.isArray(r.itens) ? r.itens : [] };
    },
  });
}

/** Busca curta de clientes (paleta ⌘K): até 8, qualquer status. */
export function useBuscaClientes(termo: string) {
  const t = termo.trim();
  return useQuery({
    queryKey: chavesAdmin.buscaClientes(t),
    enabled: t.length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<ClientesListaResposta> => {
      const { data, error } = await db.rpc("admin_clientes_listar", {
        p_busca: t,
        p_status: "todos",
        p_limite: 8,
      });
      if (error) falha(error);
      const r = (data ?? {}) as Partial<ClientesListaResposta>;
      return { total: Number(r.total ?? 0), itens: Array.isArray(r.itens) ? r.itens : [] };
    },
  });
}

/** Um cliente, com as colunas de TenantAdmin. `null` = não encontrado. */
export function useTenantAdmin(id: string | null | undefined) {
  return useQuery({
    queryKey: chavesAdmin.tenant(id),
    enabled: Boolean(id),
    queryFn: async (): Promise<TenantAdmin | null> => {
      const { data, error } = await db
        .from("tenants")
        .select(COLUNAS_TENANT_ADMIN.join(", "))
        .eq("id", id)
        .maybeSingle();
      if (error) falha(error);
      if (!data) return null;
      const t = data as TenantAdmin;
      return { ...t, vocabulary: t.vocabulary ?? {} };
    },
  });
}

/** Marca e dados jurídicos do sistema (system_settings id = 1). */
export function useSystemSettings() {
  return useQuery({
    queryKey: chavesAdmin.systemSettings(),
    queryFn: async (): Promise<SystemSettings | null> => {
      const { data, error } = await db.from("system_settings").select("*").eq("id", 1).maybeSingle();
      if (error) falha(error);
      return (data as SystemSettings | null) ?? null;
    },
  });
}

/** Catálogo de módulos, na ordem de exibição. */
export function useModulosCatalogo() {
  return useQuery({
    queryKey: chavesAdmin.modulosCatalogo(),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Modulo[]> => {
      const { data, error } = await db.from("modules").select("*").order("sort", { ascending: true, nullsFirst: false });
      if (error) falha(error);
      return (data as Modulo[] | null) ?? [];
    },
  });
}

/** Linhas de tenant_modules do cliente (sem linha = padrão do catálogo). */
export function useTenantModulos(id: string | null | undefined) {
  return useQuery({
    queryKey: chavesAdmin.tenantModulos(id),
    enabled: Boolean(id),
    queryFn: async (): Promise<TenantModulo[]> => {
      const { data, error } = await db.from("tenant_modules").select("*").eq("tenant_id", id);
      if (error) falha(error);
      return (data as TenantModulo[] | null) ?? [];
    },
  });
}

/** Segmentos (segment_presets), na ordem de exibição. */
export function useSegmentos() {
  return useQuery({
    queryKey: chavesAdmin.segmentos(),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SegmentPreset[]> => {
      const { data, error } = await db.from("segment_presets").select("*").order("sort", { ascending: true });
      if (error) falha(error);
      return (data as SegmentPreset[] | null) ?? [];
    },
  });
}

/** Usuários do cliente (RPC admin_tenant_users). */
export function useUsuariosDoTenant(id: string | null | undefined) {
  return useQuery({
    queryKey: chavesAdmin.usuariosDoTenant(id),
    enabled: Boolean(id),
    queryFn: async (): Promise<UsuarioDoTenant[]> => {
      const { data, error } = await db.rpc("admin_tenant_users", { _tenant_id: id });
      if (error) falha(error);
      return (data as UsuarioDoTenant[] | null) ?? [];
    },
  });
}

/** Ações do administrador (admin_audit_log), paginadas no servidor. */
export function useAuditLog(filtros: FiltrosAuditoria) {
  const porPagina = filtros.porPagina ?? 50;
  const chave: FiltrosAuditoria = { ...filtros, porPagina };
  return useQuery({
    queryKey: chavesAdmin.auditoria(chave),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Paginado<AuditRow>> => {
      let q = db.from("admin_audit_log").select("*", { count: "exact" }).order("created_at", { ascending: false });
      if (filtros.tenantId) q = q.eq("target_tenant_id", filtros.tenantId);
      if (filtros.action) q = q.eq("action", filtros.action);
      if (filtros.actorId) q = q.eq("actor_id", filtros.actorId);
      if (filtros.desde) q = q.gte("created_at", limiteDeData(filtros.desde, false));
      if (filtros.ate) q = q.lte("created_at", limiteDeData(filtros.ate, true));
      const [de, ate] = intervalo(filtros.pagina, porPagina);
      const { data, error, count } = await q.range(de, ate);
      if (error) falha(error);
      return { linhas: (data as AuditRow[] | null) ?? [], total: count ?? 0 };
    },
  });
}

/** Acessos (access_logs), paginados no servidor. */
export function useAccessLogs(filtros: FiltrosAcessos) {
  const porPagina = filtros.porPagina ?? 20;
  const chave: FiltrosAcessos = { ...filtros, porPagina };
  return useQuery({
    queryKey: chavesAdmin.acessos(chave),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Paginado<AccessLogRow>> => {
      let q = db
        .from("access_logs")
        .select("id, user_id, email, tenant_id, context, event, ip, user_agent, metadata, created_at", { count: "exact" })
        .order("created_at", { ascending: false });
      if (filtros.tenantId) q = q.eq("tenant_id", filtros.tenantId);
      if (filtros.contexto) q = q.eq("context", filtros.contexto);
      const email = filtros.email?.trim();
      if (email) q = q.ilike("email", `%${email.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
      if (filtros.desde) q = q.gte("created_at", limiteDeData(filtros.desde, false));
      if (filtros.ate) q = q.lte("created_at", limiteDeData(filtros.ate, true));
      const [de, ate] = intervalo(filtros.pagina, porPagina);
      const { data, error, count } = await q.range(de, ate);
      if (error) falha(error);
      return { linhas: (data as AccessLogRow[] | null) ?? [], total: count ?? 0 };
    },
  });
}

/** Planos, do mais barato ao mais caro. `apenasAtivos` filtra is_active. */
export function usePlanos(opcoes: { apenasAtivos?: boolean } = {}) {
  return useQuery({
    queryKey: chavesAdmin.planos(opcoes.apenasAtivos),
    queryFn: async (): Promise<Plano[]> => {
      let q = db.from("plans").select("*").order("monthly_price", { ascending: true });
      if (opcoes.apenasAtivos) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) falha(error);
      return ((data as Plano[] | null) ?? []).map((p) => ({ ...p, monthly_price: Number(p.monthly_price) }));
    },
  });
}

/** Faturas (tenant_invoices) com o nome do cliente, mais recentes primeiro. */
export function useFaturas(filtros: FiltrosFaturas = {}) {
  return useQuery({
    queryKey: chavesAdmin.faturas(filtros),
    queryFn: async (): Promise<Fatura[]> => {
      let q = db
        .from("tenant_invoices")
        .select("id, tenant_id, reference_month, amount, status, paid_at, receipt_url, notes, created_at, tenants(name, display_name)")
        .order("reference_month", { ascending: false })
        .order("created_at", { ascending: false });
      if (filtros.tenantId) q = q.eq("tenant_id", filtros.tenantId);
      if (filtros.status) q = q.eq("status", filtros.status);
      const { data, error } = await q;
      if (error) falha(error);
      return ((data as Fatura[] | null) ?? []).map((f) => ({ ...f, amount: Number(f.amount) }));
    },
  });
}

/** KPIs da plataforma (RPC admin_platform_metrics). */
export function useMetricasPlataforma() {
  return useQuery({
    queryKey: chavesAdmin.metricasPlataforma(),
    staleTime: 60_000,
    queryFn: async (): Promise<MetricasPlataforma | null> => {
      const { data, error } = await db.rpc("admin_platform_metrics");
      if (error) falha(error);
      return (data as MetricasPlataforma | null) ?? null;
    },
  });
}

/** Alertas de WhatsApp/Meta de todos os clientes (RPC admin_meta_alertas). */
export function useAlertasMeta() {
  return useQuery({
    queryKey: chavesAdmin.alertasMeta(),
    staleTime: 60_000,
    queryFn: async (): Promise<AlertaMeta[]> => {
      const { data, error } = await db.rpc("admin_meta_alertas");
      if (error) falha(error);
      return Array.isArray(data) ? (data as AlertaMeta[]) : [];
    },
  });
}

/* ------------------------------------------------------------------------ */
/* Números de WhatsApp por usuário (pacote B)                                */
/* ------------------------------------------------------------------------ */

/**
 * Uma linha de admin_numeros_por_usuario: usuário vinculado ao cliente ×
 * número do cliente.
 * - `acesso`: o que o usuário enxerga hoje (mesma regra de
 *   can_access_whatsapp_number).
 * - `origem`: 'papel' (sem marcação gravada: gerente = todos, demais =
 *   nenhum), 'explicito' (marcado por um superadmin ou "não" gravado) ou
 *   'automatico' (liberado por gatilho ao conectar o número/criar o usuário).
 * - `granted`: valor gravado (null = sem marcação).
 * - `no_rodizio`: membro ativo do rodízio do cliente (o rodízio ainda não
 *   olha o número do lead).
 * - `numero_so_de_closer`: só closer/recepção têm o número marcado (nenhum
 *   usuário de papel geral): os modelos novos dele ficam para esse papel.
 */
export interface LinhaNumeroUsuario {
  user_id: string;
  nome: string | null;
  email: string | null;
  papel: string | null;
  is_blocked: boolean;
  numero_id: string;
  numero_nome: string | null;
  phone_e164: string | null;
  phone_number_id: string;
  numero_ativo: boolean;
  numero_status: string;
  numero_padrao: boolean;
  waba_pausada: boolean;
  acesso: boolean;
  origem: "papel" | "explicito" | "automatico";
  granted: boolean | null;
  no_rodizio: boolean;
  numero_so_de_closer: boolean;
}

export interface ResultadoDefinirNumeros {
  ok: boolean;
  liberados: number;
  bloqueados: number;
  alterou: boolean;
}

/** Usuário × número do cliente (RPC admin_numeros_por_usuario, só superadmin). */
export function useNumerosPorUsuario(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: chavesAdmin.numerosPorUsuario(tenantId),
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<LinhaNumeroUsuario[]> => {
      const { data, error } = await db.rpc("admin_numeros_por_usuario", { p_tenant: tenantId });
      if (error) falha(error, "Não foi possível carregar os números dos usuários.");
      return (data as LinhaNumeroUsuario[] | null) ?? [];
    },
  });
}

/**
 * Define os números que o usuário usa no cliente (RPC
 * admin_definir_numeros_usuario): marcados = liberados; todos os outros
 * números do cliente ficam com "não" explícito. Auditado no servidor.
 */
export async function definirNumerosDoUsuario(args: {
  userId: string;
  tenantId: string;
  numeros: string[];
}): Promise<ResultadoDefinirNumeros> {
  const { data, error } = await db.rpc("admin_definir_numeros_usuario", {
    p_user: args.userId,
    p_tenant: args.tenantId,
    p_numeros: args.numeros,
  });
  if (error) falha(error, "Não foi possível salvar os números do usuário.");
  return data as ResultadoDefinirNumeros;
}
