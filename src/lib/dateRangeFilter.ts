import { endOfDay, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek, subDays, subMonths, subWeeks } from "date-fns";
import { ptBR } from "date-fns/locale";

export type DatePreset = "all" | "today" | "yesterday" | "this_week" | "last_week" | "7days" | "this_month" | "last_month" | "custom" | "multi";

export interface DateRangeFilterValue {
  preset: DatePreset;
  customFrom?: Date;
  customTo?: Date;
  customRanges?: { from: Date; to: Date }[];
}

export function getDateRangesFromFilter(value: DateRangeFilterValue): { start: Date; end: Date }[] | null {
  const now = new Date();
  switch (value.preset) {
    case "today": return [{ start: startOfDay(now), end: endOfDay(now) }];
    case "yesterday": { const y = subDays(now, 1); return [{ start: startOfDay(y), end: endOfDay(y) }]; }
    case "this_week": return [{ start: startOfWeek(now, { locale: ptBR }), end: endOfWeek(now, { locale: ptBR }) }];
    case "last_week": return [{ start: startOfWeek(subWeeks(now, 1), { locale: ptBR }), end: endOfWeek(subWeeks(now, 1), { locale: ptBR }) }];
    case "7days": return [{ start: subDays(now, 7), end: now }];
    case "this_month": return [{ start: startOfMonth(now), end: endOfMonth(now) }];
    case "last_month": return [{ start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)) }];
    case "custom":
      if (value.customFrom && value.customTo) return [{ start: startOfDay(value.customFrom), end: endOfDay(value.customTo) }];
      if (value.customFrom) return [{ start: startOfDay(value.customFrom), end: endOfDay(value.customFrom) }];
      return null;
    case "multi": {
      const ranges = (value.customRanges || []).filter((r) => r.from && r.to);
      if (ranges.length === 0) return null;
      return ranges.map((r) => ({ start: startOfDay(r.from), end: endOfDay(r.to) }));
    }
    default: return null;
  }
}

export function getDateRangeFromFilter(value: DateRangeFilterValue): { start: Date; end: Date } | null {
  const list = getDateRangesFromFilter(value);
  if (!list || list.length === 0) return null;
  const start = list.reduce((min, r) => (r.start < min ? r.start : min), list[0].start);
  const end = list.reduce((max, r) => (r.end > max ? r.end : max), list[0].end);
  return { start, end };
}