import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Retorna a data como string "YYYY-MM-DD" em HORÁRIO LOCAL (fuso do navegador).
 *
 * IMPORTANTE: NÃO use `new Date().toISOString().split("T")[0]` para representar
 * "hoje". Em fusos negativos como BRT (UTC-3), entre ~21:00 e 23:59 do dia local,
 * o `toISOString` retorna o dia seguinte em UTC, gerando bugs em datas de
 * pagamento, filtros e relatórios. Sempre use `toLocalDateISO()`.
 */
export function toLocalDateISO(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

