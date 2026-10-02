import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErro } from "@/lib/mensagemDeErro";

/**
 * FUNÇÃO DA ETAPA (crm_stages.funcao, migration 20260929002040).
 *
 * As regras do sistema (pagamento, agenda, rodízio, SDR) acham a etapa por
 * esta marca, não pelo nome: a clínica renomeia "Contratado" para "Cirurgia
 * fechada" e o pagamento continua levando o lead para lá. Uma função por funil
 * (índice crm_stages_funcao_unica); funil de pós-venda não usa.
 *
 * A lista é a MESMA do CHECK crm_stages_funcao_valida e de
 * supabase/functions/_shared/etapaFuncao.ts — src/lib/etapaFuncao.test.ts
 * confere as três. Ampliar a lista exige migration nova e mudança aqui e no
 * _shared, juntas.
 */
export const FUNCOES_ETAPA = [
  "conversando",
  "relacionamento",
  "pre_agendado",
  "agendado",
  "reagendar",
  "reagendado",
  "nao_compareceu",
  "compareceu",
  "compareceu_agendou",
  "contratado",
  "nao_contratado",
  "desqualificado",
] as const;

export type FuncaoEtapa = (typeof FUNCOES_ETAPA)[number];

/** Rótulo para a tela (espelha public.etapa_funcao_rotulo). */
export const ROTULO_FUNCAO: Record<FuncaoEtapa, string> = {
  conversando: "Conversando",
  relacionamento: "Relacionamento",
  pre_agendado: "Pré-agendado",
  agendado: "Agendado",
  reagendar: "Reagendar",
  reagendado: "Reagendado",
  nao_compareceu: "Não compareceu",
  compareceu: "Compareceu",
  compareceu_agendou: "Compareceu e agendou",
  contratado: "Contratado",
  nao_contratado: "Não contratado",
  desqualificado: "Desqualificado",
};

export type TipoDaEtapa = "ganho" | "perda" | "aberta";

/**
 * O Tipo que a função impõe (o gatilho stage_regras_padrao_trg recusa Tipo
 * incoerente): contratado = Ganho; nao_contratado e desqualificado = Perda;
 * as outras = Aberta. A tela trava o seletor de Tipo quando há função.
 */
export function tipoDaFuncao(funcao: FuncaoEtapa): TipoDaEtapa {
  if (funcao === "contratado") return "ganho";
  if (funcao === "nao_contratado" || funcao === "desqualificado") return "perda";
  return "aberta";
}

/** Funções cuja etapa nasce oculta para a SDR (desfecho é da gestão). */
export const FUNCOES_OCULTAS_PARA_SDR: readonly FuncaoEtapa[] = ["contratado", "nao_contratado", "compareceu_agendou"];

export function ehFuncaoEtapa(valor: unknown): valor is FuncaoEtapa {
  return typeof valor === "string" && (FUNCOES_ETAPA as readonly string[]).includes(valor);
}

// Espelho exato de public.normaliza_nome_etapa: lower(btrim(translate(...))).
// Os mesmos caracteres do translate (nada de NFD, que tiraria acentos que o
// banco mantém), e o btrim do Postgres só corta espaço.
const COM_ACENTO = "ÁÀÃÂÄáàãâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÕÔÖóòõôöÚÙÛÜúùûüÇç";
const SEM_ACENTO = "AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc";

/**
 * Nome normalizado como o banco compara (dedupe de etapa, função pelo nome).
 * Use para validar "já existe a etapa" antes de chamar crm_stages_inserir.
 */
export function normalizaNomeEtapa(nome: string | null | undefined): string {
  let saida = "";
  for (const ch of nome ?? "") {
    const i = COM_ACENTO.indexOf(ch);
    saida += i >= 0 ? SEM_ACENTO[i] : ch;
  }
  return saida.replace(/^ +| +$/g, "").toLowerCase();
}

const FUNCAO_POR_NOME: Record<string, FuncaoEtapa> = {
  conversando: "conversando",
  "em conversa": "conversando",
  relacionamento: "relacionamento",
  "pre - agendado": "pre_agendado",
  "pre-agendado": "pre_agendado",
  "pre agendado": "pre_agendado",
  agendado: "agendado",
  reagendar: "reagendar",
  reagendado: "reagendado",
  "nao compareceu": "nao_compareceu",
  compareceu: "compareceu",
  "compareceu e agendou": "compareceu_agendou",
  contratado: "contratado",
  "nao contratado": "nao_contratado",
  desqualificado: "desqualificado",
};

/**
 * A função que o banco INFERE para uma etapa nova sem função (espelha
 * public.etapa_funcao_por_nome): nome exato, nunca "contém". "Compareceu e
 * agendou" não é "compareceu"; "Contrato enviado" não é nada.
 */
export function funcaoPorNome(nome: string | null | undefined): FuncaoEtapa | null {
  return FUNCAO_POR_NOME[normalizaNomeEtapa(nome)] ?? null;
}

export interface EtapaComFuncao {
  id: string;
  pipeline_id?: string | null;
  funcao?: string | null;
  is_won?: boolean | null;
  position?: number | null;
}

/**
 * A etapa com a função pedida numa lista de etapas (de um funil só, ou filtre
 * por `pipelineId`). Só pela função, nunca pelo nome, e sem alternativa. Para
 * "a etapa de contrato" (com a alternativa de Ganho) use etapaDeContrato.
 */
export function etapaDaFuncao<T extends EtapaComFuncao>(
  stages: readonly T[] | null | undefined,
  funcao: FuncaoEtapa,
  pipelineId?: string | null,
): T | null {
  return (stages ?? []).find((s) => (!pipelineId || s.pipeline_id === pipelineId) && s.funcao === funcao) ?? null;
}

/**
 * A etapa de CONTRATO de um funil (espelha public.etapa_de_contrato): a com a
 * função 'contratado'; sem ela, a 1ª etapa de Ganho. No funil de PÓS-VENDA não
 * existe etapa de contrato: o Ganho de lá ("Concluído") é o fim do
 * acompanhamento de quem já comprou — tratá-lo como contrato moveria o
 * paciente a cada pagamento e contaria o retorno como venda. Por isso
 * `funilDePosVenda` é obrigatório: quem chama tem de saber de que funil são as
 * etapas (crm_pipelines.is_posvenda).
 */
export function etapaDeContrato<T extends EtapaComFuncao>(
  stages: readonly T[] | null | undefined,
  funilDePosVenda: boolean,
  pipelineId?: string | null,
): T | null {
  if (funilDePosVenda) return null;
  const doFunil = (stages ?? []).filter((s) => !pipelineId || s.pipeline_id === pipelineId);
  const exata = doFunil.find((s) => s.funcao === "contratado");
  if (exata) return exata;
  const ganhos = doFunil.filter((s) => s.is_won === true);
  ganhos.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return ganhos[0] ?? null;
}

const CAMPOS_ETAPA = "id, pipeline_id, funcao, is_won, position";

/**
 * Move o lead para a etapa com a função pedida, no funil em que ele está
 * ('contratado' usa a régua de etapaDeContrato). Com `cruzarParaFunilPadrao`,
 * se o funil do lead não tiver a função, procura no funil padrão do cliente
 * (crm_pipelines.is_default — nunca pelo nome "Funil Principal") e troca o
 * lead de funil.
 *
 * Lead em funil de PÓS-VENDA: nada muda (null). As regras do funil comercial
 * não agem lá — o funil não usa função, o Ganho "Concluído" não é contrato — e
 * o lead não é puxado de volta para o funil padrão.
 *
 * Devolve o id da etapa para a qual o lead foi, ou null quando não houve
 * movimento (sem etapa com a função, lead de pós-venda, ou o lead já estava
 * nela). A RLS barrada não devolve erro, devolve 0 linhas: aí a função LANÇA,
 * para o chamador não anunciar um movimento que não houve. O histórico de
 * etapa é escrito só pelo gatilho sync_lead_stage_history.
 */
export async function moverLeadParaFuncao(
  leadId: string,
  funcao: FuncaoEtapa,
  opcoes: { cruzarParaFunilPadrao?: boolean } = {},
): Promise<string | null> {
  // crm_stages.funcao ainda não está nos tipos gerados (types.ts não é editado
  // à mão): as consultas passam por um cliente sem tipos.
  const db = supabase as any;

  const { data: lead, error: leadErr } = await db
    .from("crm_leads")
    .select("id, stage_id, pipeline_id, tenant_id")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr) throw leadErr;
  if (!lead) return null;

  const achar = (etapas: EtapaComFuncao[] | null, posVenda: boolean) =>
    funcao === "contratado" ? etapaDeContrato(etapas, posVenda) : etapaDaFuncao(etapas, funcao);

  let alvo: EtapaComFuncao | null = null;
  if (lead.pipeline_id) {
    const { data: funil, error: funilErr } = await db
      .from("crm_pipelines")
      .select("id, is_posvenda")
      .eq("id", lead.pipeline_id)
      .maybeSingle();
    if (funilErr) throw funilErr;
    if (funil?.is_posvenda === true) return null;

    const { data: etapas, error } = await db
      .from("crm_stages")
      .select(CAMPOS_ETAPA)
      .eq("pipeline_id", lead.pipeline_id)
      .order("position");
    if (error) throw error;
    alvo = achar(etapas as EtapaComFuncao[] | null, false);
  }

  // Cruzar para o funil padrão é do SERVIDOR (RPC desfecho_cruzar_para_funil_padrao):
  // recepção e closer não enxergam o funil is_default pela RLS, então a busca
  // pelo front não achava nada e o desfecho dizia "segue na etapa atual".
  if (!alvo && opcoes.cruzarParaFunilPadrao) {
    if (funcao !== "compareceu_agendou") return null;
    const { data, error } = await db.rpc("desfecho_cruzar_para_funil_padrao", { p_lead_id: leadId });
    if (error) throw new Error(mensagemDeErro(error, "Não foi possível mover o lead para o funil principal."));
    return (data as any)?.movido === true ? ((data as any).etapa_id as string) : null;
  }

  if (!alvo || alvo.id === lead.stage_id) return null;

  const payload: Record<string, unknown> = { stage_id: alvo.id, updated_at: new Date().toISOString() };
  if (alvo.pipeline_id && alvo.pipeline_id !== lead.pipeline_id) payload.pipeline_id = alvo.pipeline_id;

  const { data: movidas, error: moveErr } = await db
    .from("crm_leads")
    .update(payload)
    .eq("id", leadId)
    .select("id");
  if (moveErr) throw moveErr;
  if (!movidas || movidas.length === 0) {
    throw new Error("Seu perfil não tem permissão para mover este lead de etapa.");
  }
  return alvo.id;
}
