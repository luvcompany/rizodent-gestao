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

/** Feriados nacionais (fixos + móveis pela Páscoa) — cópia de feriadosNacionais em src/lib/businessDays.ts. */
const cacheFeriados = new Map<number, Set<string>>();
export function feriadosNacionais(ano: number): Set<string> {
  const hit = cacheFeriados.get(ano);
  if (hit) return hit;
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  const pascoa = Date.UTC(ano, mes - 1, dia);
  const mais = (dias: number) => new Date(pascoa + dias * 86400000).toISOString().slice(0, 10);
  const fixos = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"];
  if (ano >= 2024) fixos.push("11-20");
  const set = new Set<string>([
    ...fixos.map((md) => `${ano}-${md}`),
    mais(-48), mais(-47), mais(-2), mais(60), // Carnaval (seg/ter), Sexta-feira Santa, Corpus Christi
  ]);
  cacheFeriados.set(ano, set);
  return set;
}

/**
 * Dias da semana abertos pelo horário comercial do cliente (tenants.business_hours,
 * chaves "0".."6"). Sem horário configurado: segunda a sexta — mesma regra de
 * diasAbertosParaRelatorio em src/lib/businessDays.ts.
 */
export function diasAbertosDoHorario(horario: Record<string, unknown> | null | undefined): Set<number> {
  const chaves = horario ? Object.keys(horario).filter((k) => /^[0-6]$/.test(k) && (horario as any)[k]) : [];
  return chaves.length ? new Set(chaves.map(Number)) : new Set([1, 2, 3, 4, 5]);
}

/**
 * Regra única de "dias úteis" do sistema (mesma de src/lib/businessDays.ts):
 * feriado do cliente ou nacional = 0; com `diasAbertos`, dia fora do horário
 * comercial = 0; sem `diasAbertos` (regra antiga), domingo = 0; demais = 1.
 * (Sábado é meio expediente, mas conta como dia inteiro no faturamento.)
 */
export function businessDayWeight(day: string, holidays: Set<string>, diasAbertos?: Set<number>): number {
  const { y, m, d } = dayParts(day);
  if (holidays.has(day) || feriadosNacionais(y).has(day)) return 0;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (diasAbertos) return diasAbertos.has(dow) ? 1 : 0;
  if (dow === 0) return 0;
  return 1;
}

/** Soma o peso de dias úteis no intervalo INCLUSIVO [startDay, endDay]. */
export function businessDaysBetween(startDay: string, endDay: string, holidays: Set<string>, diasAbertos?: Set<number>): number {
  let total = 0;
  for (let d = assertDay(startDay); d <= assertDay(endDay); d = addDays(d, 1)) {
    total += businessDayWeight(d, holidays, diasAbertos);
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
