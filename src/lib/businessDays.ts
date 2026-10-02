import { toLocalDateISO } from "@/lib/utils";
import type { Horario } from "@/lib/horarioComercial";

/**
 * Regra de "dias úteis" única do sistema (faturamento/previsibilidade/relatórios):
 *  - Feriado do cliente (Set 'YYYY-MM-DD') ou nacional => 0
 *  - Com `diasAbertos`: dia da semana fora do horário comercial => 0
 *  - Sem `diasAbertos` (regra antiga): domingo => 0
 *  - Demais dias => 1
 */

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia, 12);
}

const cacheFeriados = new Map<number, { data: string; nome: string }[]>();

export function feriadosNacionais(ano: number): { data: string; nome: string }[] {
  const hit = cacheFeriados.get(ano);
  if (hit) return hit;
  const fixos: [string, string][] = [
    ["01-01", "Confraternização Universal"],
    ["04-21", "Tiradentes"],
    ["05-01", "Dia do Trabalho"],
    ["09-07", "Independência do Brasil"],
    ["10-12", "Nossa Senhora Aparecida"],
    ["11-02", "Finados"],
    ["11-15", "Proclamação da República"],
    ["12-25", "Natal"],
  ];
  if (ano >= 2024) fixos.push(["11-20", "Dia da Consciência Negra"]);
  const p = pascoa(ano);
  const mais = (dias: number) => { const d = new Date(p); d.setDate(d.getDate() + dias); return iso(d); };
  const lista = [
    ...fixos.map(([md, nome]) => ({ data: `${ano}-${md}`, nome })),
    { data: mais(-48), nome: "Carnaval (segunda)" },
    { data: mais(-47), nome: "Carnaval (terça)" },
    { data: mais(-2), nome: "Sexta-feira Santa" },
    { data: mais(60), nome: "Corpus Christi" },
  ].sort((x, y) => x.data.localeCompare(y.data));
  cacheFeriados.set(ano, lista);
  return lista;
}

const cacheSet = new Map<number, Set<string>>();
function ehFeriadoNacional(key: string, ano: number): boolean {
  let s = cacheSet.get(ano);
  if (!s) { s = new Set(feriadosNacionais(ano).map((f) => f.data)); cacheSet.set(ano, s); }
  return s.has(key);
}

const SEG_A_SEX: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);

export function diasAbertosParaRelatorio(horario: Horario | null | undefined): { dias: ReadonlySet<number>; padrao: boolean } {
  const chaves = horario ? Object.keys(horario).filter((k) => /^[0-6]$/.test(k) && (horario as any)[k]) : [];
  if (chaves.length === 0) return { dias: SEG_A_SEX, padrao: true };
  return { dias: new Set(chaves.map(Number)), padrao: false };
}

export function businessDayWeight(date: Date, holidays: Set<string>, diasAbertos?: ReadonlySet<number>): number {
  const key = toLocalDateISO(date);
  if (holidays.has(key) || ehFeriadoNacional(key, date.getFullYear())) return 0;
  const dow = date.getDay();
  if (diasAbertos) return diasAbertos.has(dow) ? 1 : 0;
  return dow === 0 ? 0 : 1;
}

export function ehDiaUtil(date: Date, holidays: Set<string>, diasAbertos?: ReadonlySet<number>): boolean {
  return businessDayWeight(date, holidays, diasAbertos) > 0;
}

/** Soma dias úteis no intervalo INCLUSIVO [start, end] (dia a dia, 12:00 local). */
export function businessDaysBetween(start: Date, end: Date, holidays: Set<string>, diasAbertos?: ReadonlySet<number>): number {
  if (!start || !end) return 0;
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0, 0);
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12, 0, 0, 0);
  if (e < s) return 0;
  let total = 0;
  const cur = new Date(s);
  while (cur <= e) {
    total += businessDayWeight(cur, holidays, diasAbertos);
    cur.setDate(cur.getDate() + 1);
  }
  return total;
}

export function formatarDiasUteis(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}
