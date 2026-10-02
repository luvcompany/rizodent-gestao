// Quem pode o quê num funil — espelho, na tela, das policies do banco em
// crm_pipelines, crm_stages e crm_automations (P18, migration
// 20260929002340_v2_automacoes_tela.sql). A autoridade é o banco: aqui é só para
// não OFERECER um botão que o banco vai recusar (AUTO-21/SDR-04: a SDR via "Nova
// Etapa" e "Adicionar automação" no funil da clínica e levava um erro em inglês).
// Também usado pelo Kanban (P20, REC-05) para o "+" entre as colunas.
//
// Regras (um papel por usuário — ver src/lib/roles.ts):
//   - gestão (gerente, crc, superadmin): tudo, em todo funil que enxerga;
//   - pós-venda: as policies "Staff" valem para ele nos funis que enxerga;
//   - recepção e closer: só no funil com o papel deles em allowed_roles
//     (funil_do_papel_do_usuario); funil sem allowed_roles é da gestão;
//   - SDR: só no funil que ela criou (funil_meu: created_by = ela);
//   - etapa com função no sistema (crm_stages.funcao): só a gestão renomeia e
//     só a gestão (ou o pós-venda, que não usa função) exclui;
//   - funil criado pelo sistema para um papel: só a gestão exclui.

import { mensagemDeErro, ehMensagemDoProduto, FRASE_SEM_PERMISSAO } from "@/lib/mensagemDeErro";

export interface FunilParaPermissao {
  id?: string;
  created_by?: string | null;
  allowed_roles?: readonly string[] | null;
  description?: string | null;
  is_default?: boolean | null;
  is_instagram?: boolean | null;
  is_posvenda?: boolean | null;
}

export interface EtapaParaPermissao {
  funcao?: string | null;
}

type Papel = string | null | undefined;

/** Início da descrição que ensure_role_default_pipeline grava no funil do papel. */
export const DESCRICAO_FUNIL_DO_PAPEL = "Funil criado automaticamente para o papel ";

/** Gerente, CRC ou superadmin: define função da etapa, reordena funis, exclui o funil de papel. */
export function ehGestaoDoFunil(papel: Papel): boolean {
  return papel === "gerente" || papel === "crc" || papel === "superadmin";
}

/** Os papéis das policies "Staff can …" (gestão + pós-venda): excluem funil/etapa com leads. */
export function ehStaffDoFunil(papel: Papel): boolean {
  return ehGestaoDoFunil(papel) || papel === "posvenda";
}

/** Funil que o sistema criou para um papel (recepção ou closer — ensure_role_default_pipeline). */
export function funilDoSistemaParaPapel(funil: FunilParaPermissao | null | undefined): boolean {
  return !!funil && !funil.created_by && (funil.description ?? "").startsWith(DESCRICAO_FUNIL_DO_PAPEL);
}

/**
 * Criar etapa e automação neste funil (e alterar etapa/automação dele): o
 * mesmo recorte das policies de INSERT/UPDATE de crm_stages e crm_automations
 * e de crm_stages_inserir.
 */
export function podeCriarNoFunil(
  papel: Papel,
  funil: FunilParaPermissao | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!funil) return false;
  if (ehStaffDoFunil(papel)) return true;
  if (papel === "recepcao" || papel === "closer") {
    return (funil.allowed_roles ?? []).includes(papel);
  }
  if (papel === "sdr") return !!userId && funil.created_by === userId;
  return false;
}

/**
 * Alterar cor, Tipo e ordem de uma etapa: a régua de criar no funil e, para
 * SDR, recepção e closer, nunca etapa com função no sistema (REC-02) — essas
 * são da estrutura da clínica.
 */
export function podeAlterarEtapa(
  papel: Papel,
  funil: FunilParaPermissao | null | undefined,
  etapa: EtapaParaPermissao,
  userId: string | null | undefined,
): boolean {
  return podeCriarNoFunil(papel, funil, userId) && (!etapa.funcao || ehStaffDoFunil(papel));
}

/** Renomear: etapa com função no sistema só pela gestão (gatilho trg_etapa_funcao_renomear_so_gestao). */
export function podeRenomearEtapa(
  papel: Papel,
  funil: FunilParaPermissao | null | undefined,
  etapa: EtapaParaPermissao,
  userId: string | null | undefined,
): boolean {
  return podeAlterarEtapa(papel, funil, etapa, userId) && (!etapa.funcao || ehGestaoDoFunil(papel));
}

/**
 * Excluir etapa: SDR, recepção e closer só etapa sem função (e sem lead — isso
 * a tela descobre na hora, por etapa_tem_lead; policies de DELETE).
 */
export function podeExcluirEtapa(
  papel: Papel,
  funil: FunilParaPermissao | null | undefined,
  etapa: EtapaParaPermissao,
  userId: string | null | undefined,
): boolean {
  return podeAlterarEtapa(papel, funil, etapa, userId);
}

/**
 * Oferecer "Excluir funil". O que impede um funil específico (padrão,
 * Instagram, número de WhatsApp, rodízio, transmissão em aberto) vem do banco
 * (funil_exclusao_impedimento), com a frase, na hora do clique.
 */
export function podeExcluirFunil(
  papel: Papel,
  funil: FunilParaPermissao | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!funil) return false;
  if (ehStaffDoFunil(papel)) return !funilDoSistemaParaPapel(funil) || ehGestaoDoFunil(papel);
  if (papel === "recepcao" || papel === "closer") {
    return (funil.allowed_roles ?? []).includes(papel) && !funilDoSistemaParaPapel(funil);
  }
  if (papel === "sdr") return !!userId && funil.created_by === userId;
  return false;
}

/**
 * Duplicar funil: a cópia apaga as etapas herdadas do funil do rodízio (com
 * função) e grava as do funil de origem com a função — coisa da gestão e do
 * pós-venda (que só duplica funil de pós-venda, sem função).
 */
export function podeDuplicarFunil(papel: Papel): boolean {
  return ehStaffDoFunil(papel);
}

/** RPC pipelines_definir_ordem: só gestão. */
export function podeReordenarFunis(papel: Papel): boolean {
  return ehGestaoDoFunil(papel);
}

/** RPC crm_etapa_definir_funcao: só gestão. */
export function podeDefinirFuncaoDaEtapa(papel: Papel): boolean {
  return ehGestaoDoFunil(papel);
}

/** RPC crm_funil_definir_posvenda: gerente (dono) ou superadmin. */
export function podeMarcarFunilDePosVenda(papel: Papel): boolean {
  return papel === "gerente" || papel === "superadmin";
}

/** Funil da recepção ou do closer: o papel em allowed_roles ou o funil que o sistema criou para ele. */
export function funilDePapelDaEquipe(funil: FunilParaPermissao | null | undefined): boolean {
  if (!funil) return false;
  return funilDoSistemaParaPapel(funil)
    || (funil.allowed_roles ?? []).some((papel) => papel === "recepcao" || papel === "closer");
}

/**
 * Oferecer "Marcar/Desmarcar funil de pós-venda" neste funil. Desmarcar vale
 * sempre; marcar, não no funil padrão, no do Instagram nem no da recepção ou
 * do closer (hide_posvenda_pipelines o esconderia do próprio papel) — a RPC
 * recusa os três. Número de WhatsApp, rodízio e leads o banco confere na hora
 * e devolve a frase.
 */
export function podeAlternarPosVendaDoFunil(papel: Papel, funil: FunilParaPermissao | null | undefined): boolean {
  if (!funil || !podeMarcarFunilDePosVenda(papel)) return false;
  if (funil.is_posvenda) return true;
  return !funil.is_default && !funil.is_instagram && !funilDePapelDaEquipe(funil);
}

/** Frase para a recusa de permissão (42501) ao criar/alterar no funil, por papel. */
export function fraseSemPermissaoNoFunil(papel: Papel): string {
  if (papel === "sdr") return "Você só pode criar etapas e automações nos funis que você criou.";
  if (papel === "recepcao" || papel === "closer") {
    return "Seu perfil só cria etapas e automações no funil do seu papel.";
  }
  return FRASE_SEM_PERMISSAO;
}

/**
 * Erro do banco numa ação do funil, em PT-BR. Frase do produto (RAISE das
 * nossas funções) passa como veio; a recusa crua da RLS ("new row violates
 * row-level security policy…", 42501) vira a frase do papel.
 */
export function mensagemDeErroNoFunil(erro: unknown, papel: Papel, padrao?: string): string {
  const e = (erro && typeof erro === "object" ? erro : {}) as { code?: unknown; message?: unknown };
  const msg = typeof e.message === "string" ? e.message : "";
  if (!ehMensagemDoProduto(msg) && (e.code === "42501" || /row-level security/i.test(msg))) {
    return fraseSemPermissaoNoFunil(papel);
  }
  return mensagemDeErro(erro, padrao);
}
