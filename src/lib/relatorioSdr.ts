// relatorioSdr — o que as duas telas do relatório por SDR (Fase 5 do rodízio)
// compartilham: o tipo da linha devolvida pelas RPCs, a chamada com erro em
// PT-BR e os formatadores de tempo/porcentagem/nota.
//
// Fontes (migration 20260909100200_sdr_fase5_relatorios.sql):
//   relatorio_sdr(p_de, p_ate)        → gestor (is_gestor_equipe): todas as
//                                        SDRs + linha is_total = true.
//   relatorio_sdr_minha(p_de, p_ate)  → a própria SDR: só a linha dela.
// As duas devolvem SÓ números agregados — nenhum lead, nenhum telefone.
//
// Réguas (definidas no SQL, repetidas aqui só para a tela explicar):
//   • leads recebidos = leads que chegaram a ela no período (distribuição,
//     transferência ou criação), pela mesma régua do "Leads hoje" da Equipe;
//   • 1ª resposta = primeira mensagem HUMANA pela régua única do banco
//     (rodizio_msg_humana: conteúdo ou ligação, sem a saudação do bot, template,
//     espera automática ou log de sistema) enquanto o lead era dela; relógio
//     corrido, contado da
//     entrega do lead (se já havia mensagem esperando) ou da 1ª mensagem
//     recebida depois; crédito para a DONA do lead, não para quem digitou;
//   • agendamentos/comparecimentos = régua canônica (reportKit.kpiAgendamentos):
//     agendamentos = total − cancelados; compareceram = contratados + não
//     contratados; por DATA AGENDADA e crédito carimbado na criação;
//   • expediente = tempo com o ponto aberto, já sem as pausas.

import { supabase } from "@/integrations/supabase/client";

export type LinhaRelatorioSdr = {
  user_id: string | null;
  nome: string;
  email: string | null;
  no_rodizio: boolean | null;
  bloqueada: boolean | null;
  leads_recebidos: number;
  leads_respondidos: number;
  resp_amostra: number;
  resp_mediana_seg: number | null;
  resp_media_seg: number | null;
  agendamentos: number;
  compareceram: number;
  faltas: number;
  contratados: number;
  agend_cancelados: number;
  conversas_fechadas: number;
  pesquisa_respostas: number;
  pesquisa_nota_media: number | null;
  minutos_expediente: number;
  minutos_pausa: number;
  is_total: boolean;
};

export type RpcRelatorioSdr = "relatorio_sdr" | "relatorio_sdr_minha";

/** Estado de uma RPC na tela: nunca vira zero silencioso — carrega, mostra
 *  o dado ou mostra o erro (mesmo princípio de CrmRelatorios). */
export type EstadoRpc<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: T };

type ErroLike = { code?: string; message?: string; details?: string; hint?: string };

const comoErro = (e: unknown): ErroLike => (e && typeof e === "object" ? (e as ErroLike) : {});

/**
 * RPC ainda não publicada no banco (PGRST202: o site subiu antes de a
 * migration ser aplicada) — mesma detecção de useGestorEquipe. Compartilhada
 * com as telas da Fase 2 (fechar conversa, ponto, pesquisa), que vivem a mesma
 * janela entre publicar o site e aplicar as migrations.
 */
export const rpcAusente = (e: unknown): boolean => {
  const err = comoErro(e);
  return err.code === "PGRST202" || /could not find the function/i.test(String(err.message ?? ""));
};

export const TEXTO_RPC_AUSENTE_RELATORIO =
  "O relatório por SDR ainda não foi instalado no banco (migration da Fase 5 pendente).";

/**
 * Mensagem legível para o usuário (RAISE EXCEPTION do Postgres chega em
 * `message`). `textoRpcAusente` é o aviso em PT-BR quando a RPC ainda não
 * existe no banco — cada tela diz qual migration está faltando.
 */
export function mensagemDeErroRpc(
  e: unknown,
  fallback: string,
  textoRpcAusente: string = TEXTO_RPC_AUSENTE_RELATORIO,
): string {
  const err = comoErro(e);
  if (rpcAusente(err)) return textoRpcAusente;
  const m = err.message || err.details || err.hint;
  return typeof m === "string" && m.trim() ? m : fallback;
}

/** numeric/bigint do PostgREST podem chegar como string; nulo continua nulo. */
const numOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
};
const num = (v: unknown): number => numOuNulo(v) ?? 0;

function normalizarLinha(r: Record<string, unknown>): LinhaRelatorioSdr {
  return {
    user_id: (r.user_id as string | null) ?? null,
    nome: String(r.nome ?? ""),
    email: (r.email as string | null) ?? null,
    no_rodizio: typeof r.no_rodizio === "boolean" ? r.no_rodizio : null,
    bloqueada: typeof r.bloqueada === "boolean" ? r.bloqueada : null,
    leads_recebidos: num(r.leads_recebidos),
    leads_respondidos: num(r.leads_respondidos),
    resp_amostra: num(r.resp_amostra),
    resp_mediana_seg: numOuNulo(r.resp_mediana_seg),
    resp_media_seg: numOuNulo(r.resp_media_seg),
    agendamentos: num(r.agendamentos),
    compareceram: num(r.compareceram),
    faltas: num(r.faltas),
    contratados: num(r.contratados),
    agend_cancelados: num(r.agend_cancelados),
    conversas_fechadas: num(r.conversas_fechadas),
    pesquisa_respostas: num(r.pesquisa_respostas),
    pesquisa_nota_media: numOuNulo(r.pesquisa_nota_media),
    minutos_expediente: num(r.minutos_expediente),
    minutos_pausa: num(r.minutos_pausa),
    is_total: r.is_total === true,
  };
}

/**
 * Chama a RPC do relatório. `de`/`ate` no formato DATE 'YYYY-MM-DD' (use
 * reportKit.asDateParam). Lança Error com mensagem em PT-BR — quem chama
 * decide como mostrar. Lista vazia é resposta válida (zero SDRs), não erro.
 */
export async function buscarRelatorioSdr(
  fn: RpcRelatorioSdr,
  de: string,
  ate: string,
): Promise<LinhaRelatorioSdr[]> {
  // RPCs da Fase 5 ainda não estão em types.ts (arquivo gerado pelo Lovable);
  // mesmo padrão do resto do projeto para RPC não tipada.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(fn, { p_de: de, p_ate: ate });
  if (error) throw new Error(mensagemDeErroRpc(error, "Não foi possível carregar o relatório."));
  const linhas = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return linhas.map(normalizarLinha);
}

// ---------------------------------------------------------------------------
// Formatação (PT-BR)
// ---------------------------------------------------------------------------

/** Segundos → "45s" | "28min" | "7h 50min" | "2d 3h"; nulo/zero → "—". */
export function fmtSegundos(seg: number | null | undefined): string {
  if (seg === null || seg === undefined || !Number.isFinite(seg) || seg < 0) return "—";
  const s = Math.round(seg);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}min` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** Minutos → "0min" | "45min" | "7h 30min" | "38h". */
export function fmtMinutos(min: number | null | undefined): string {
  const m = Math.max(0, Math.round(min ?? 0));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}min` : `${h}h`;
}

/** Porcentagem inteira "91%"; sem denominador → "—". */
export function fmtPct(numerador: number, denominador: number): string {
  if (!denominador || denominador <= 0) return "—";
  return `${Math.round((numerador / denominador) * 100)}%`;
}

/** Nota média "4,5"; sem nota → "—". */
export function fmtNota(nota: number | null | undefined): string {
  if (nota === null || nota === undefined || !Number.isFinite(nota)) return "—";
  return nota.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Inteiro com separador de milhar em PT-BR. */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("pt-BR");
}

/** Taxa de comparecimento pela régua canônica: compareceram / (compareceram + faltas). */
export function taxaComparecimento(l: Pick<LinhaRelatorioSdr, "compareceram" | "faltas">): string {
  return fmtPct(l.compareceram, l.compareceram + l.faltas);
}


/** Ligações por SDR (RPC relatorio_sdr_ligacoes): SDR vê só a si; gestor vê todas. */
export type LigacoesSdr = {
  user_id: string;
  ligacoes_feitas: number;
  ligacoes_atendidas: number;
  duracao_media_seg: number;
  telefonia_feitas: number;
  whatsapp_feitas: number;
};

export async function buscarLigacoesSdr(de: string, ate: string, userId?: string | null): Promise<LigacoesSdr[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("relatorio_sdr_ligacoes", {
    p_de: de, p_ate: ate, p_user_id: userId ?? null,
  });
  if (error) {
    if (rpcAusente(error)) return [];
    throw new Error(mensagemDeErroRpc(error, "Não foi possível carregar as ligações."));
  }
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    user_id: String(r.user_id),
    ligacoes_feitas: num(r.ligacoes_feitas),
    ligacoes_atendidas: num(r.ligacoes_atendidas),
    duracao_media_seg: num(r.duracao_media_seg),
    telefonia_feitas: num(r.telefonia_feitas),
    whatsapp_feitas: num(r.whatsapp_feitas),
  }));
}
