// Fuso horário por clínica. Usa Intl.DateTimeFormat (suportado pelo Deno) para
// extrair partes locais de uma data em qualquer TZ IANA. Fallback: America/Sao_Paulo.

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export function resolveTz(tz?: string | null): string {
  const t = (tz || "").trim();
  return t || "America/Sao_Paulo";
}

export function localParts(
  date: Date,
  tz: string,
): { hour: number; minute: number; weekday: number; day: number; month: number; year: number } {
  const timeZone = resolveTz(tz);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  let hour = parseInt(get("hour"), 10) || 0;
  if (hour === 24) hour = 0; // Intl pode retornar "24" para meia-noite em algumas locales
  const minute = parseInt(get("minute"), 10) || 0;
  const day = parseInt(get("day"), 10) || 1;
  const month = parseInt(get("month"), 10) || 1;
  const year = parseInt(get("year"), 10) || 1970;
  const weekday = WEEKDAY_MAP[get("weekday")] ?? 0;
  return { hour, minute, weekday, day, month, year };
}

export function hmInTz(date: Date, tz: string): number {
  const { hour, minute } = localParts(date, tz);
  return hour * 60 + minute;
}
