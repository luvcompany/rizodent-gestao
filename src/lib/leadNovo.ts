/**
 * O que conta como "lead novo" — regra única do dono (09/10/2026), calculada no
 * banco por public.eh_lead_novo(crm_leads) (migration 0023).
 *
 * Lead novo = quem ENTRA no sistema no período. Não conta:
 *  - quem só comentou no Instagram (comment_only);
 *  - o lead que a conciliação com o Dontus cria já em Contratado (source
 *    'kommo' — relato da gestão, 21/09/2026: "os contratados do dia estão
 *    contando como novo lead");
 *  - o lead sintético criado a partir de pagamento (Retroativo / tag
 *    sintetico_pagamento);
 *  - o lead que o dontus-sync cria direto em Contratado a partir do pagamento
 *    (tag criado_pelo_dontus, migration 0031);
 *  - o RECONTATO de quem já está na base (outro lead com o mesmo telefone ou
 *    Instagram criado antes);
 *  - o lead apagado e criado de novo em menos de 7 dias.
 *
 * Como o recontato precisa olhar a base inteira da clínica (que a SDR não
 * enxerga), a regra mora no banco: as telas pedem a coluna calculada
 * `eh_lead_novo` no select e contam com contaComoLeadNovo (não filtre pela
 * coluna calculada na consulta: a contagem HEAD com esse filtro falhou no
 * PostgREST). Antes cada tela tinha a sua régua
 * (Relatórios 345, Dashboard/Kanban 343, API 331 e painel de TV 329 em out/26).
 */
export const ORIGEM_CRIADA_PELA_CONCILIACAO = "kommo";

/** Coluna calculada (public.eh_lead_novo) — inclua no select de crm_leads. */
export const COLUNA_LEAD_NOVO = "eh_lead_novo";

/**
 * Lead carregado COM a coluna calculada `eh_lead_novo` usa a régua do banco.
 * Sem ela (select antigo), cai na régua antiga — só a conciliação fica de fora —
 * para nunca contar a mais por falta da coluna.
 */
export function contaComoLeadNovo(lead: { eh_lead_novo?: boolean | null; source?: string | null }): boolean {
  if (typeof lead.eh_lead_novo === "boolean") return lead.eh_lead_novo;
  return lead.source !== ORIGEM_CRIADA_PELA_CONCILIACAO;
}
