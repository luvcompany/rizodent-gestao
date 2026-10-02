// Horário comercial da clínica no navegador — espelho de
// supabase/functions/_shared/horarioComercial.ts (mesma regra, mesmas mensagens,
// mesmos casos de teste: sexta 19h, domingo, feriado, Manaus).
//
// Fonte única do DADO: tenants.business_hours (+ timezone e
// business_hours_confirmado_em), lido por get_my_tenant_config (useTenantConfig).
// Formato: {"0".."6": ["HH:MM","HH:MM"]}, 0 = domingo, intervalo [abre, fecha)
// no fuso da clínica; dia ausente = fechado; feriado fecha o dia. O banco
// garante o formato (CHECK tenants_business_hours_valido) e recusa o resto em
// set_tenant_business_hours com "Horário inválido: …" — validarHorario() dá a
// mesma mensagem ANTES de chamar a RPC.

import { fusoDoTenant, instanteNoFusoMs, offsetDoFusoMs } from "@/lib/fuso";

export type DiaDaSemana = "0" | "1" | "2" | "3" | "4" | "5" | "6";
/** Janela de um dia: [abre, fecha) em "HH:MM" no fuso da clínica. */
export type Janela = [string, string];
/** {"0".."6": ["HH:MM","HH:MM"]} — 0 = domingo; dia ausente = fechado. */
export type Horario = Partial<Record<DiaDaSemana, Janela>>;

export interface HorarioDaClinica {
  horas: Horario;
  /** Fuso IANA; sem ele, o do tenant logado (src/lib/fuso.ts). */
  tz?: string;
  /** Feriados do cliente, "YYYY-MM-DD". */
  feriados?: ReadonlySet<string>;
}

/** Padrão do produto (= horario_comercial_padrao() no banco): seg–sex 08:00–18:00. */
export const HORARIO_PADRAO: Readonly<Horario> = Object.freeze({
  "1": ["08:00", "18:00"],
  "2": ["08:00", "18:00"],
  "3": ["08:00", "18:00"],
  "4": ["08:00", "18:00"],
  "5": ["08:00", "18:00"],
});

const DIAS_DE_BUSCA = 14;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const NO_DIA = ["no domingo", "na segunda", "na terça", "na quarta", "na quinta", "na sexta", "no sábado"];
const DIA_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// ---------------------------------------------------------------------------
// Validação (mesmas regras e mensagens do banco)
// ---------------------------------------------------------------------------

// Os dois ramos têm as duas chaves: o tsconfig do app não é strict e não
// estreita a união só pelo `ok`.
export type ResultadoDaValidacao =
  | { ok: true; valor: Horario; erro?: undefined }
  | { ok: false; erro: string; valor?: undefined };

/** Confere o formato; devolve uma cópia limpa ou "Horário inválido: …". */
export function validarHorario(v: unknown): ResultadoDaValidacao {
  const falha = (motivo: string): ResultadoDaValidacao => ({ ok: false, erro: `Horário inválido: ${motivo}` });
  if (!v || typeof v !== "object" || Array.isArray(v)) return falha("formato não reconhecido.");
  const chaves = Object.keys(v as Record<string, unknown>).sort();
  if (chaves.length === 0) return falha("marque ao menos um dia aberto.");
  const valor: Horario = {};
  for (const k of chaves) {
    if (!/^[0-6]$/.test(k)) return falha(`o dia "${k}" não existe (use 0 = domingo … 6 = sábado).`);
    const dia = NO_DIA[Number(k)];
    const par = (v as Record<string, unknown>)[k];
    if (!Array.isArray(par) || par.length !== 2 || typeof par[0] !== "string" || typeof par[1] !== "string") {
      return falha(`${dia}, informe a abertura e o fechamento.`);
    }
    const [abre, fecha] = par as [string, string];
    if (!HHMM.test(abre) || !HHMM.test(fecha)) return falha(`${dia}, use horas no formato HH:MM (ex.: 08:00).`);
    if (fecha <= abre) return falha(`${dia}, o fechamento (${fecha}) precisa ser depois da abertura (${abre}).`);
    valor[k as DiaDaSemana] = [abre, fecha];
  }
  return { ok: true, valor };
}

export function horarioValido(v: unknown): v is Horario {
  return validarHorario(v).ok;
}

function horasDe(h: Horario | HorarioDaClinica): Horario {
  return "horas" in h ? (h as HorarioDaClinica).horas : (h as Horario);
}

/** Dias da semana abertos (0 = domingo), sem olhar feriado — para os dias úteis dos relatórios. */
export function diasAbertos(h: Horario | HorarioDaClinica): Set<number> {
  const dias = new Set<number>();
  for (const k of Object.keys(horasDe(h))) if (/^[0-6]$/.test(k)) dias.add(Number(k));
  return dias;
}

// ---------------------------------------------------------------------------
// Aberto / próxima abertura
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, "0");

function minutosDe(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function paraMs(instante: number | Date | string): number {
  const ms = typeof instante === "number" ? instante : new Date(instante).getTime();
  if (!Number.isFinite(ms)) throw new Error(`horarioComercial: instante inválido: ${String(instante)}`);
  return ms;
}

/** Parede do relógio local como se fosse UTC: getUTC* = hora local da clínica. */
function parede(ms: number, tz: string): Date {
  return new Date(ms + offsetDoFusoMs(ms, tz));
}

function ymdDe(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Instante (ms) de "HH:MM" no dia local `dia` (parede UTC à meia-noite), no fuso. */
function instanteLocal(dia: Date, hhmm: string, tz: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return instanteNoFusoMs(dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(), h, m, tz);
}

function janelaDoDia(h: HorarioDaClinica, dia: Date): Janela | null {
  if (h.feriados?.has(ymdDe(dia))) return null;
  const w = h.horas[String(dia.getUTCDay()) as DiaDaSemana];
  if (!w || !(minutosDe(w[1]) > minutosDe(w[0]))) return null;
  return w;
}

/** A clínica está aberta nesse instante (dia com janela, sem feriado, dentro de [abre, fecha))? */
export function estaAberto(h: HorarioDaClinica, instante: number | Date | string): boolean {
  const tz = h.tz || fusoDoTenant();
  const local = parede(paraMs(instante), tz);
  const w = janelaDoDia(h, local);
  if (!w) return false;
  const min = local.getUTCHours() * 60 + local.getUTCMinutes();
  return min >= minutosDe(w[0]) && min < minutosDe(w[1]);
}

/**
 * Próxima abertura (ms) a partir do instante; null = aberto agora. Procura até
 * 14 dias à frente; sem abertura nesse prazo também devolve null (o banco
 * devolve o próprio instante).
 */
export function proximaAbertura(h: HorarioDaClinica, instante: number | Date | string): number | null {
  const tz = h.tz || fusoDoTenant();
  const local = parede(paraMs(instante), tz);
  const agoraMin = local.getUTCHours() * 60 + local.getUTCMinutes();
  const meiaNoite = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  for (let i = 0; i <= DIAS_DE_BUSCA; i++) {
    const dia = new Date(meiaNoite + i * 86_400_000);
    const w = janelaDoDia(h, dia);
    if (!w) continue;
    if (i === 0) {
      if (agoraMin >= minutosDe(w[0]) && agoraMin < minutosDe(w[1])) return null;
      if (agoraMin < minutosDe(w[0])) return instanteLocal(dia, w[0], tz);
      continue; // hoje já fechou
    }
    return instanteLocal(dia, w[0], tz);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

/** "seg a sex 08:00–18:00, sáb 07:00–12:00" (dias iguais e seguidos agrupados). */
export function descreverHorario(h: Horario | HorarioDaClinica): string {
  const horas = horasDe(h);
  const grupos: { dias: number[]; janela: string }[] = [];
  let anterior: string | null = null;
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    const w = horas[String(d) as DiaDaSemana];
    const janela = w ? `${w[0]}–${w[1]}` : null;
    if (janela && janela === anterior) grupos[grupos.length - 1].dias.push(d);
    else if (janela) grupos.push({ dias: [d], janela });
    anterior = janela;
  }
  if (grupos.length === 0) return "fechado todos os dias";
  return grupos
    .map(({ dias, janela }) => {
      const nomes = dias.map((d) => DIA_CURTO[d]);
      const rotulo =
        nomes.length === 1 ? nomes[0] : nomes.length === 2 ? `${nomes[0]} e ${nomes[1]}` : `${nomes[0]} a ${nomes[nomes.length - 1]}`;
      return `${rotulo} ${janela}`;
    })
    .join(", ");
}

/** "Horário Padrão de Brasília (America/Sao_Paulo)"; sem nome no Intl, só o IANA. */
export function rotuloDoFuso(tz: string): string {
  try {
    const nome = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, timeZoneName: "long" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    return nome && nome !== tz ? `${nome} (${tz})` : tz;
  } catch {
    return tz;
  }
}
