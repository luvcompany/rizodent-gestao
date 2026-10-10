// A Api4Com manda o horário LOCAL (Bahia) com sufixo "Z" ("2026-10-09T13:25:15.000Z"
// é 13:25 em Salvador, não em UTC). Conferido nas 2.876 ligações de jul–out/26: a
// ligação chegava ao banco 3 h "antes" de acontecer (migration 0032). O instante
// real é esse relógio em -03:00. Valor com fuso explícito passa sem mudança.
export function instanteApi4com(s: unknown): string | null {
  if (!s) return null;
  const t = Date.parse(String(s).replace(/Z$/i, "-03:00"));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
