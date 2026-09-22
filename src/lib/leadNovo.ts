/**
 * O que conta como "lead novo".
 *
 * A conciliação com o Dontus (edge function dontus-sync) cria um lead quando
 * entra uma venda de origem KOMMO e o paciente não existe no CRM. Esse lead
 * nasce já em Contratado, com source = 'kommo', no dia do pagamento — e
 * aparecia como "Novo lead" do dia (relato da gestão, 21/09/2026: "os
 * contratados do dia estão contando como novo lead"). Ele não é um contato
 * novo: é um paciente que já fechou e só faltava no CRM.
 *
 * A marca é o source 'kommo': só a conciliação grava esse valor (a tela não
 * oferece essa origem), e todos os 32 leads com ele, até 22/09/2026, foram
 * criados por ela.
 */
export const ORIGEM_CRIADA_PELA_CONCILIACAO = "kommo";

export function contaComoLeadNovo(lead: { source?: string | null }): boolean {
  return lead.source !== ORIGEM_CRIADA_PELA_CONCILIACAO;
}

/**
 * Filtro equivalente para consultas no banco: `.or(FILTRO_LEAD_NOVO)`.
 * Não use `.neq("source", "kommo")` — no SQL, `source <> 'kommo'` também
 * descarta os leads SEM origem (NULL), que são leads novos de verdade.
 */
export const FILTRO_LEAD_NOVO = `source.is.null,source.neq.${ORIGEM_CRIADA_PELA_CONCILIACAO}`;
