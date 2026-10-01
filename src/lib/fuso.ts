// Fuso da clínica no front.
//
// Antes cada tela fixava America/Bahia (fuso da clínica de origem, UTC-3). No v2 o fuso
// é o do tenant (tenants.timezone), lido uma vez no login pelo AuthContext e
// guardado aqui. Enquanto não carrega (ou sem tenant, como o superadmin), vale
// America/Sao_Paulo — o mesmo DEFAULT da coluna tenants.timezone.
//
// Tudo por Intl, com o offset lido no próprio instante: serve para qualquer
// IANA, inclusive com horário de verão.

export const FUSO_PADRAO = "America/Sao_Paulo";

const CHAVE_CACHE = "crm:fuso_do_tenant";

// Último fuso visto neste navegador: telas que calculam "hoje" logo no boot,
// antes da consulta ao tenant voltar, já usam o fuso certo.
let fusoAtual = (() => {
  try {
    const salvo = localStorage.getItem(CHAVE_CACHE);
    return salvo && valido(salvo) ? salvo : FUSO_PADRAO;
  } catch {
    return FUSO_PADRAO;
  }
})();

function valido(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Fuso em uso (o do tenant logado, ou a reserva). */
export function fusoDoTenant(): string {
  return fusoAtual;
}

/** Chamado pelo AuthContext ao carregar o tenant; valor inválido volta à reserva. */
export function definirFusoDoTenant(tz: string | null | undefined): void {
  const t = (tz || "").trim();
  fusoAtual = t && valido(t) ? t : FUSO_PADRAO;
  try {
    localStorage.setItem(CHAVE_CACHE, fusoAtual);
  } catch {
    /* sem storage: fica só em memória */
  }
}

function partes(instanteMs: number, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = fmt.formatToParts(new Date(instanteMs));
  const get = (t: string) => parseInt(p.find((x) => x.type === t)?.value || "0", 10) || 0;
  let hour = get("hour");
  if (hour === 24) hour = 0; // alguns motores devolvem "24" à meia-noite
  return { y: get("year"), m: get("month"), d: get("day"), hour, minute: get("minute"), second: get("second") };
}

/** Offset (ms) do fuso no instante: local - UTC (ex.: -3h em São Paulo). */
export function offsetDoFusoMs(instanteMs: number, tz: string = fusoAtual): number {
  const p = partes(instanteMs, tz);
  const comoUtc = Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute, p.second);
  return comoUtc - Math.floor(instanteMs / 1000) * 1000;
}

/** Dia local (YYYY-MM-DD) no fuso, a partir de um instante. */
export function diaNoFuso(instante: string | number | Date, tz: string = fusoAtual): string {
  const t = new Date(instante).getTime();
  if (!Number.isFinite(t)) throw new Error(`diaNoFuso: data inválida: ${String(instante)}`);
  const p = partes(t, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/**
 * Instante (ms epoch) de um horário de parede no fuso: y-m-d (m = 1..12) às
 * h:min. Duas passadas porque o offset do palpite pode diferir do da hora
 * local quando há troca de horário de verão no meio.
 */
export function instanteNoFusoMs(y: number, m: number, d: number, h = 0, min = 0, tz: string = fusoAtual): number {
  const alvo = Date.UTC(y, m - 1, d, h, min);
  let t = alvo - offsetDoFusoMs(alvo, tz);
  t = alvo - offsetDoFusoMs(t, tz);
  return t;
}
