// Helpers canônicos de relatório para edge functions (Deno).
// Porta mínima da fundação src/lib/reportKit.ts (que importa o client do
// frontend e por isso não pode ser usada aqui). Mesmas regras aprovadas:
// - Datas SEMPRE em America/Bahia (UTC-3 fixo, sem horário de verão);
//   períodos são inclusivos (o último dia entra inteiro).
// - Paginação obrigatória além do cap de 1000 linhas do PostgREST
//   (nunca truncar silenciosamente).

export const BAHIA_TZ = "America/Bahia";
const BAHIA_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3 fixo

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayParts(day: string): { y: number; m: number; d: number } {
  const m = DAY_RE.exec(day);
  if (!m) throw new Error(`data inválida (esperado YYYY-MM-DD): ${day}`);
  return { y: +m[1], m: +m[2], d: +m[3] };
}

/** Valida um dia-calendário YYYY-MM-DD (lança erro se inválido). */
export function assertDay(day: string): string {
  dayParts(day);
  return day;
}

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

/** Soma (ou subtrai) dias a um dia-calendário YYYY-MM-DD. */
export function addDays(day: string, days: number): string {
  const { y, m, d } = dayParts(day);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Fronteiras UTC (ISO) de um período de dias em America/Bahia, inclusivo:
 * gteIso = from 00:00:00.000 (-03) e lteIso = to 23:59:59.999 (-03).
 * Use com .gte("coluna_timestamptz", gteIso).lte("coluna_timestamptz", lteIso).
 */
export function rangeBahia(fromDay: string, toDay: string): { gteIso: string; lteIso: string } {
  const f = dayParts(fromDay);
  const t = dayParts(toDay);
  const gte = Date.UTC(f.y, f.m - 1, f.d) + BAHIA_OFFSET_MS;
  const lte = Date.UTC(t.y, t.m - 1, t.d + 1) + BAHIA_OFFSET_MS - 1; // fim do último dia
  if (gte > lte) throw new Error("rangeBahia: 'from' é depois de 'to'");
  return { gteIso: new Date(gte).toISOString(), lteIso: new Date(lte).toISOString() };
}

/**
 * Regra única de "dias úteis" do sistema (mesma de src/lib/businessDays.ts):
 * domingo = 0, feriado = 0, sábado = 1, seg-sex = 1.
 * (Sábado é meio expediente, mas conta como dia inteiro no faturamento.)
 */
export function businessDayWeight(day: string, holidays: Set<string>): number {
  if (holidays.has(day)) return 0;
  const { y, m, d } = dayParts(day);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (dow === 0) return 0;
  return 1;
}

/** Soma o peso de dias úteis no intervalo INCLUSIVO [startDay, endDay]. */
export function businessDaysBetween(startDay: string, endDay: string, holidays: Set<string>): number {
  let total = 0;
  for (let d = assertDay(startDay); d <= assertDay(endDay); d = addDays(d, 1)) {
    total += businessDayWeight(d, holidays);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Paginação segura (PostgREST corta em 1000 linhas por request)
// ---------------------------------------------------------------------------

interface PagedResult {
  data: unknown[] | null;
  error: { message: string } | null;
}
interface PagedBuilder {
  order(column: string, opts: { ascending: boolean }): {
    range(from: number, to: number): PromiseLike<PagedResult>;
  };
}

/**
 * Busca TODAS as linhas de uma query paginando em blocos.
 * - `build` deve retornar uma query NOVA a cada chamada (builders do
 *   supabase-js são de uso único).
 * - `orderBy` é OBRIGATÓRIO e precisa ser coluna estável e única ("id").
 * - Lança erro em qualquer falha de página (nunca retorna parcial silencioso).
 */
export async function fetchAllPaged<T>(
  build: () => PagedBuilder,
  orderBy: string,
  pageSize = 1000,
): Promise<T[]> {
  if (!orderBy) throw new Error("fetchAllPaged: orderBy é obrigatório");
  const all: T[] = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await build()
      .order(orderBy, { ascending: true })
      .range(start, start + pageSize - 1);
    if (error) throw new Error(`fetchAllPaged: ${error.message}`);
    const rows = (data || []) as T[];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

/** Divide um array em blocos (p/ .in() com muitas chaves). */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Cidade (mesma semântica de normalizeCidade em src/lib/reportKit.ts)
// ---------------------------------------------------------------------------

export const SEM_CIDADE = "Sem cidade";

/**
 * Chave normalizada de cidade para casar texto livre com clinicas.cidade:
 * minúsculas, sem acentos, espaços colapsados; grafias conhecidas de
 * Vitória da Conquista ("VCA", "V. da Conquista") caem na mesma chave.
 * Retorna "" para nulo/vazio.
 */
export function normalizeCidadeKey(cidade: string | null | undefined): string {
  const base = (cidade || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
  if (!base) return "";
  if (base === "vca" || base === "v. da conquista" || base === "v da conquista") {
    return "vitoria da conquista";
  }
  return base;
}
