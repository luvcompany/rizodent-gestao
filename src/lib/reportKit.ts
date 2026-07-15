// reportKit — fundação canônica dos relatórios (datas em America/Bahia,
// paginação segura, classificação de origem, normalização de cidade e
// wrappers tipados das RPCs rpt_*).
//
// Regras de negócio aprovadas:
// - FATURAMENTO = soma de pagamentos por data_pagamento (nunca crm_leads.value).
// - CONTRATADO = paciente cujo PRIMEIRO pagamento cai no período.
// - Datas sempre no fuso America/Bahia (UTC-3 fixo, sem horário de verão);
//   períodos são inclusivos (o último dia entra inteiro).

import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Datas (America/Bahia = UTC-3 fixo, sem DST)
// ---------------------------------------------------------------------------

export const BAHIA_TZ = "America/Bahia";
const BAHIA_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3

/** Dia local (YYYY-MM-DD) em America/Bahia a partir de um timestamptz ISO. */
export function dayKeyBahia(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) throw new Error(`dayKeyBahia: data inválida: ${iso}`);
  // UTC-3 fixo: basta deslocar 3h e ler o dia em UTC.
  return new Date(t - BAHIA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Dia de hoje (YYYY-MM-DD) em America/Bahia. */
export function todayBahia(): string {
  return dayKeyBahia(new Date().toISOString());
}

/** Extrai o dia-calendário (Y/M/D) pretendido pelo chamador. */
function toDayParts(d: Date | string): { y: number; m: number; day: number } {
  if (typeof d === "string") {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return { y: +m[1], m: +m[2] - 1, day: +m[3] };
    return toDayParts(new Date(d));
  }
  if (isNaN(d.getTime())) throw new Error("rangeBahia: data inválida");
  // Date vindo de date-picker: usa as partes locais do navegador.
  return { y: d.getFullYear(), m: d.getMonth(), day: d.getDate() };
}

/** Dia-calendário como parâmetro DATE ('YYYY-MM-DD') para as RPCs. */
export function asDateParam(d: Date | string): string {
  const { y, m, day } = toDayParts(d);
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Fronteiras UTC (ISO) de um período de dias em America/Bahia, inclusivo:
 * gteIso = from 00:00:00.000 (-03) e lteIso = to 23:59:59.999 (-03).
 * Use com .gte("coluna_timestamptz", gteIso).lte("coluna_timestamptz", lteIso).
 */
export function rangeBahia(from: Date | string, to: Date | string): { gteIso: string; lteIso: string } {
  const f = toDayParts(from);
  const t = toDayParts(to);
  const gte = Date.UTC(f.y, f.m, f.day) + BAHIA_OFFSET_MS;
  const lte = Date.UTC(t.y, t.m, t.day + 1) + BAHIA_OFFSET_MS - 1; // fim do último dia
  if (gte > lte) throw new Error("rangeBahia: 'from' é depois de 'to'");
  return { gteIso: new Date(gte).toISOString(), lteIso: new Date(lte).toISOString() };
}

// ---------------------------------------------------------------------------
// Horário comercial (métricas de tempo de resposta / não respondidos)
// ---------------------------------------------------------------------------

/** Horário comercial por dia da semana (0=domingo..6=sábado): ["HH:MM","HH:MM"].
 *  Dia ausente = fechado. Vem de tenants.business_hours (jsonb). */
export type BusinessHours = Record<string, [string, string]>;

function hhmmToMin(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Carrega o horário comercial do tenant (null = não configurado → relógio corrido). */
export async function loadBusinessHours(): Promise<BusinessHours | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- coluna nova, types.ts pode não conhecer
  const { data } = await (supabase.from("tenants").select("business_hours").limit(1).maybeSingle() as any);
  const bh = data?.business_hours;
  return bh && typeof bh === "object" ? (bh as BusinessHours) : null;
}

/**
 * Minutos DENTRO do horário comercial entre dois instantes (America/Bahia).
 * Tempo fora do expediente / dias fechados não conta — um lead que escreve 19h
 * e é respondido 7:35 do dia seguinte tem poucos minutos comerciais decorridos.
 * Sem config (hours = null) devolve o tempo corrido (comportamento antigo).
 */
export function businessMinutesBetween(fromIso: string, toIso: string, hours: BusinessHours | null): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  if (!hours) return Math.round((to - from) / 60000); // relógio corrido
  const DAY = 24 * 60 * 60 * 1000;
  // Desloca -3h: no tempo deslocado, a leitura UTC (dia/DOW/hora) = hora local Bahia.
  const fromL = from - BAHIA_OFFSET_MS;
  const toL = to - BAHIA_OFFSET_MS;
  let total = 0;
  for (let dayStart = Math.floor(fromL / DAY) * DAY; dayStart <= toL; dayStart += DAY) {
    const win = hours[String(new Date(dayStart).getUTCDay())];
    if (!win) continue; // dia fechado
    const open = dayStart + hhmmToMin(win[0]) * 60000;
    const close = dayStart + hhmmToMin(win[1]) * 60000;
    const s = Math.max(open, fromL);
    const e = Math.min(close, toL);
    if (e > s) total += e - s;
  }
  return Math.round(total / 60000);
}

// ---------------------------------------------------------------------------
// Paginação segura (supabase-js limita a 1000 linhas por request)
// ---------------------------------------------------------------------------

/** Builder mínimo aceito por fetchAllPaged (query supabase já com select/filtros). */
interface PagedBuilder {
  order(column: string, opts: { ascending: boolean }): {
    range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
  };
}

/**
 * Busca TODAS as linhas de uma query paginando em blocos.
 * - `build` deve retornar uma query NOVA a cada chamada (builders do supabase
 *   são de uso único), ex.: () => supabase.from("pagamentos").select("...").gte(...)
 * - `orderBy` é OBRIGATÓRIO e precisa ser uma coluna estável e única ("id"),
 *   senão páginas podem repetir/pular linhas.
 * - Lança erro em qualquer falha: nunca retorna resultado parcial silencioso.
 */
export async function fetchAllPaged<T>(
  build: () => PagedBuilder,
  orderBy: string,
  pageSize = 1000
): Promise<T[]> {
  if (!orderBy || !orderBy.trim()) {
    throw new Error("fetchAllPaged: orderBy estável é obrigatório (use 'id')");
  }
  const all: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await build()
      .order(orderBy, { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`fetchAllPaged: falha ao paginar (offset ${offset}): ${error.message}`);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
}

// ---------------------------------------------------------------------------
// Origem canônica do lead
// ---------------------------------------------------------------------------

export type OrigemCanonica = "Anúncio" | "Instagram Orgânico" | "WhatsApp/Direto" | "Indicação" | "Outros";

export const ORIGENS_CANONICAS: OrigemCanonica[] = [
  "Anúncio",
  "Instagram Orgânico",
  "WhatsApp/Direto",
  "Indicação",
  "Outros",
];

export interface LeadOrigemInput {
  source: string | null;
  ad_id?: string | null;
  nome_anuncio?: string | null;
}

/** minúsculas, sem acentos, espaços colapsados. */
function norm(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Cobre as variações reais do banco: "SEM ANÚNCIO", "SEM ANUNCIO", "SEM ANÚNIO",
// "Sem anúncio " (com espaço) e também "NÃO IDENTIFICADO".
const RE_SEM_ANUNCIO = /^(sem an|nao identificado)/;

/**
 * Classificação canônica de origem (corrige a antiga classifyOrigem, que
 * jogava todo "instagram" em Anúncio e tratava "SEM ANÚNCIO" como anúncio).
 *
 * Valores reais de source no banco: 'facebook_ad', 'instagram_ad', 'Anúncio',
 * 'whatsapp', 'Instagram Lite (@...)', 'Instagram', 'instagram', 'indicação',
 * 'Indicação', 'Outros', 'outro', 'Retroativo', 'Site', 'SEM ANÚNCIO', null.
 *
 * Prioridade:
 * 1. ad_id presente → Anúncio (sinal mais forte: vem do webhook da Meta e é a
 *    chave do ad_id_mapping; ad_id ainda sem linha no mapeamento continua
 *    sendo anúncio).
 * 2. Marcador "SEM ANÚNCIO"/"NÃO IDENTIFICADO" sem ad_id → NÃO é anúncio.
 * 3. source de anúncio (facebook_ad/instagram_ad/Anúncio) → Anúncio.
 * 4. Instagram sem anúncio (DM orgânico, 'Instagram Lite (...)') → Instagram Orgânico.
 * 5. whatsapp → WhatsApp/Direto; indicação → Indicação; resto → Outros.
 */
export function classifyOrigemCanonica(lead: LeadOrigemInput): OrigemCanonica {
  const adId = (lead.ad_id ?? "").trim();
  if (adId) return "Anúncio";

  const s = norm(lead.source);
  const semAnuncio = RE_SEM_ANUNCIO.test(norm(lead.nome_anuncio)) || RE_SEM_ANUNCIO.test(s);

  if (!semAnuncio && (s === "facebook_ad" || s === "instagram_ad" || s.endsWith("_ad") || s.endsWith("_ads") || s === "anuncio" || s.startsWith("anuncio"))) {
    return "Anúncio";
  }
  if (s.startsWith("instagram")) return "Instagram Orgânico";
  if (s.includes("whats")) return "WhatsApp/Direto";
  if (s.includes("indica")) return "Indicação";
  return "Outros";
}

// ---------------------------------------------------------------------------
// Cidade
// ---------------------------------------------------------------------------

export const SEM_CIDADE = "Sem cidade";

// Valores reais no banco: 'Itabuna', 'Vitória da Conquista', 'Ipiaú',
// 'Guanambi', 'VCA' (grafia alternativa) e null.
const CIDADES_CANONICAS: Record<string, string> = {
  "vca": "Vitória da Conquista",
  "vitoria da conquista": "Vitória da Conquista",
  "v. da conquista": "Vitória da Conquista",
  "itabuna": "Itabuna",
  "ipiau": "Ipiaú",
  "guanambi": "Guanambi",
};

/** Normaliza grafias de cidade; null/vazio vira "Sem cidade". */
export function normalizeCidade(cidade: string | null): string {
  const raw = (cidade ?? "").trim();
  if (!raw) return SEM_CIDADE;
  return CIDADES_CANONICAS[norm(raw)] ?? raw;
}

// ---------------------------------------------------------------------------
// Wrappers tipados das RPCs canônicas (rpt_*)
// As funções ainda serão criadas pela migração; por isso o cast em supabase.rpc
// (o types.ts gerado não as conhece). Todas resolvem o tenant no servidor
// (SECURITY DEFINER) — o mesmo número para qualquer usuário do tenant.
// ---------------------------------------------------------------------------

export interface FaturamentoRow {
  dia: string; // YYYY-MM-DD
  clinica_id: string;
  clinica: string;
  tipo: string;
  especialidade: string | null;
  total: number;
  qtd: number;
}

export interface ContratadoRow {
  paciente_id: string;
  nome: string;
  clinica: string;
  primeiro_pagamento: string; // YYYY-MM-DD
  valor_total_periodo: number;
}

export interface KpisAgendamentos {
  contracted: number;
  not_contracted: number;
  no_show: number;
  rescheduled: number;
  cancelled: number;
  pending: number;
  pending_vencidos: number; // subconjunto informativo de pending (não soma no total)
  total: number;
}

export interface LeadsInativos {
  mais_7_dias: number;
  mais_15_dias: number;
  mais_30_dias: number;
  base_total: number;
}

export interface TicketMedio {
  ticket_por_pagamento: number;
  ticket_por_paciente: number;
  num_pagamentos: number;
  num_pacientes: number;
}

/** Chama uma RPC rpt_* e lança erro em falha (nunca engole erro). */
async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as any)(fn, args);
  if (error) {
    // Função ainda não instalada no banco (PGRST202 = não encontrada no schema
    // cache): mensagem em PT-BR em vez do erro cru do PostgREST em inglês.
    const naoInstalada =
      (error as { code?: string }).code === "PGRST202" ||
      /schema cache|does not exist/i.test(error.message || "");
    if (naoInstalada) {
      throw new Error(
        `Função de relatório ${fn} ainda não instalada no banco — aplique a migração das funções rpt_*.`
      );
    }
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as T;
}

/** Coerção defensiva (numeric/bigint podem chegar como string do PostgREST). */
function num(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Faturamento diário por clínica/tipo/especialidade (soma de pagamentos). */
export async function rptFaturamento(
  from: Date | string,
  to: Date | string,
  clinicaId?: string | null
): Promise<FaturamentoRow[]> {
  const rows = await callRpc<any[]>("rpt_faturamento", {
    p_from: asDateParam(from),
    p_to: asDateParam(to),
    p_clinica_id: clinicaId ?? null,
  });
  return (rows ?? []).map((r) => ({
    dia: r.dia,
    clinica_id: r.clinica_id,
    clinica: r.clinica,
    tipo: r.tipo,
    especialidade: r.especialidade ?? null,
    total: num(r.total),
    qtd: num(r.qtd),
  }));
}

/** Uma linha por origem canônica: caixa recebido no período atribuído à origem
 *  do paciente (mesmo total do dashboard, reconciliando os R$ do período). */
export interface FaturamentoOrigemRow {
  origem: string;
  faturamento: number;
  pacientes: number;
  pagamentos: number;
}

/** Faturamento do período por origem canônica do paciente (caixa recebido).
 *  Fonte única compartilhada entre o Dashboard e a aba Origem & Conversão. */
export async function rptFaturamentoOrigem(
  from: Date | string,
  to: Date | string,
  clinicaId?: string | null
): Promise<FaturamentoOrigemRow[]> {
  const rows = await callRpc<any[]>("rpt_faturamento_origem", {
    p_from: asDateParam(from),
    p_to: asDateParam(to),
    p_clinica_id: clinicaId ?? null,
  });
  return (rows ?? []).map((r) => ({
    origem: r.origem,
    faturamento: num(r.faturamento),
    pacientes: num(r.pacientes),
    pagamentos: num(r.pagamentos),
  }));
}

/** Uma linha por anúncio: caixa recebido no período atribuído ao criativo
 *  real (ad_name → nome_anuncio → ad_headline), com buckets de fallback. */
export interface FaturamentoAnuncioRow {
  anuncio: string;
  faturamento: number;
  pacientes: number;
  pagamentos: number;
}

/** Faturamento do período por anúncio real (mesma lógica da admin-api). */
export async function rptFaturamentoAnuncio(
  from: Date | string,
  to: Date | string,
  clinicaId?: string | null
): Promise<FaturamentoAnuncioRow[]> {
  const rows = await callRpc<any[]>("rpt_faturamento_anuncio", {
    p_from: asDateParam(from),
    p_to: asDateParam(to),
    p_clinica_id: clinicaId ?? null,
  });
  return (rows ?? []).map((r) => ({
    anuncio: r.anuncio,
    faturamento: num(r.faturamento),
    pacientes: num(r.pacientes),
    pagamentos: num(r.pagamentos),
  }));
}

/** Pacientes contratados: primeiro pagamento (global) dentro do período. */
export async function rptContratados(
  from: Date | string,
  to: Date | string,
  clinicaId?: string | null
): Promise<ContratadoRow[]> {
  const rows = await callRpc<any[]>("rpt_contratados", {
    p_from: asDateParam(from),
    p_to: asDateParam(to),
    p_clinica_id: clinicaId ?? null,
  });
  return (rows ?? []).map((r) => ({
    paciente_id: r.paciente_id,
    nome: r.nome,
    clinica: r.clinica,
    primeiro_pagamento: r.primeiro_pagamento,
    valor_total_periodo: num(r.valor_total_periodo),
  }));
}

/** KPIs de agendamentos por scheduled_date (buckets exaustivos e disjuntos). */
export async function rptKpisAgendamentos(from: Date | string, to: Date | string): Promise<KpisAgendamentos> {
  const rows = await callRpc<any[]>("rpt_kpis_agendamentos", {
    p_from: asDateParam(from),
    p_to: asDateParam(to),
  });
  const r = rows?.[0] ?? {};
  return {
    contracted: num(r.contracted),
    not_contracted: num(r.not_contracted),
    no_show: num(r.no_show),
    rescheduled: num(r.rescheduled),
    cancelled: num(r.cancelled),
    pending: num(r.pending),
    pending_vencidos: num(r.pending_vencidos),
    total: num(r.total),
  };
}

/** Leads inativos (estoque da base inteira, buckets cumulativos +7/+15/+30). */
export async function rptLeadsInativos(): Promise<LeadsInativos> {
  const rows = await callRpc<any[]>("rpt_leads_inativos", {});
  const r = rows?.[0] ?? {};
  return {
    mais_7_dias: num(r.mais_7_dias),
    mais_15_dias: num(r.mais_15_dias),
    mais_30_dias: num(r.mais_30_dias),
    base_total: num(r.base_total),
  };
}

/** Ticket médio do período (por pagamento e por paciente). */
export async function rptTicketMedio(from: Date | string, to: Date | string): Promise<TicketMedio> {
  const rows = await callRpc<any[]>("rpt_ticket_medio", {
    p_from: asDateParam(from),
    p_to: asDateParam(to),
  });
  const r = rows?.[0] ?? {};
  return {
    ticket_por_pagamento: num(r.ticket_por_pagamento),
    ticket_por_paciente: num(r.ticket_por_paciente),
    num_pagamentos: num(r.num_pagamentos),
    num_pacientes: num(r.num_pacientes),
  };
}
