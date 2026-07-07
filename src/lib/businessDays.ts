import { toLocalDateISO } from "@/lib/utils";

/**
 * Regra de "dias úteis" única do sistema:
 *  - Domingo (getDay() === 0) => 0
 *  - Feriado (data local 'YYYY-MM-DD' presente no Set) => 0
 *  - Sábado (getDay() === 6) => 0.5 (meio dia)
 *  - Demais dias (Seg-Sex) => 1
 */
export function businessDayWeight(date: Date, holidays: Set<string>): number {
  const key = toLocalDateISO(date);
  if (holidays.has(key)) return 0;
  const dow = date.getDay();
  if (dow === 0) return 0;
  if (dow === 6) return 0.5;
  return 1;
}

/**
 * Soma o peso de dias úteis no intervalo INCLUSIVO [start, end], iterando dia a dia.
 * Constrói cada dia em HORÁRIO LOCAL 12:00 para não escorregar por causa de fuso.
 */
export function businessDaysBetween(start: Date, end: Date, holidays: Set<string>): number {
  if (!start || !end) return 0;
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0, 0);
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12, 0, 0, 0);
  if (e < s) return 0;
  let total = 0;
  const cur = new Date(s);
  while (cur <= e) {
    total += businessDayWeight(cur, holidays);
    cur.setDate(cur.getDate() + 1);
  }
  return total;
}
