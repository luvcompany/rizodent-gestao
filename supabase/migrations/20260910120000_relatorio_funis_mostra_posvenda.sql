-- =============================================================================
-- relatorio_funis: desfaz o filtro que escondia o funil de pós-venda da gestão.
--
-- O QUE ACONTECEU. Em 20260910010000_fechar_funcoes_abertas.sql eu tratei "o
-- funil de pós-venda aparece no relatório Comparar Funis" como vazamento e
-- passei a esconder a linha de quem não tem o papel posvenda nem é superadmin.
-- Foi erro, por dois motivos:
--
--   1. Não havia nada a proteger. A guarda no topo desta mesma função já recusa
--      quem não é crc, gerente ou superadmin. Quem chega ao corpo JÁ é gestão —
--      é o dono da clínica olhando o próprio faturamento.
--
--   2. O efeito prático foi cegar o dono. O lead que fecha é movido para o funil
--      de pós-venda, e a receita acompanha o lead. Escondendo a linha, sumiram
--      R$ 506.504,45 de 2026, medidos em 10/09/2026 — 42,6% da receita. No mês
--      corrente sumiam R$ 10.344,44 de R$ 53.212,44. O dono olhava o Funil
--      Principal, via R$ 665.539,08 e o número real era R$ 1.168.393,53.
--
-- Nada mais muda: a correção (b) da mesma migration, que recorta a CTE "vinc"
-- por cliente, continua exatamente como estava, e a assinatura, os REVOKE e os
-- GRANT são os mesmos.
--
-- FICA PARA DEPOIS, com decisão do dono: hoje a receita é atribuída ao funil em
-- que o lead ESTÁ, não àquele em que a venda aconteceu. Como o lead migra para a
-- pós-venda depois de fechar, o funil que vendeu perde o crédito. Creditar pelo
-- histórico (crm_lead_stage_history) daria o número por procedimento que o
-- relatório se propõe a mostrar — mas é mudança de régua, não conserto de bug.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.relatorio_funis(p_de date, p_ate date)
RETURNS TABLE(
  pipeline_id uuid, nome text, posicao integer,
  leads_total integer, leads_novos integer,
  agendamentos integer, compareceram integer, faltas integer, contratados integer,
  contratados_etapa integer, receita numeric, pagantes integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id(); v_tz text; v_ini timestamptz; v_fim timestamptz;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN RETURN; END IF;
  IF NOT (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role)
          OR public.has_role(auth.uid(), 'superadmin'::app_role)) THEN
    RAISE EXCEPTION 'Este relatório é da gestão.' USING ERRCODE = '42501';
  END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN
    RAISE EXCEPTION 'Período inválido.' USING ERRCODE = '22023';
  END IF;
  v_tz := public.rodizio_tz(v_tenant);
  v_ini := (p_de::timestamp) AT TIME ZONE v_tz;
  v_fim := ((p_ate + 1)::timestamp) AT TIME ZONE v_tz;

  RETURN QUERY
  WITH vinc AS (
    -- (b) só vínculos cujo lead é DESTE cliente: sem isto o DISTINCT ON podia
    -- eleger o vínculo de outra clínica e mandar o pagamento para o funil errado.
    SELECT DISTINCT ON (lp.paciente_id) lp.paciente_id, lp.lead_id
      FROM public.crm_lead_pacientes lp
      JOIN public.crm_leads lx ON lx.id = lp.lead_id AND lx.tenant_id = v_tenant
     ORDER BY lp.paciente_id, lp.is_primary DESC NULLS LAST, lp.created_at
  ), pag AS (
    SELECT l.pipeline_id, sum(pg.valor) AS receita, count(DISTINCT pg.paciente_id) AS pagantes
      FROM public.pagamentos pg
      JOIN vinc v ON v.paciente_id = pg.paciente_id
      JOIN public.crm_leads l ON l.id = v.lead_id AND l.tenant_id = v_tenant
     WHERE pg.data_pagamento BETWEEN p_de AND p_ate
       AND COALESCE(pg.recorrencia_orto, false) = false
       AND COALESCE(pg.nao_marketing, false) = false
     GROUP BY l.pipeline_id
  ), ag AS (
    SELECT l.pipeline_id,
           count(*) FILTER (WHERE COALESCE(a.status, '') <> 'cancelled') AS agendamentos,
           count(*) FILTER (WHERE a.status IN ('contracted', 'not_contracted')) AS compareceram,
           count(*) FILTER (WHERE a.status = 'no_show') AS faltas,
           count(*) FILTER (WHERE a.status = 'contracted') AS contratados
      FROM public.crm_appointments a
      JOIN public.crm_leads l ON l.id = a.lead_id AND l.tenant_id = v_tenant
     WHERE a.scheduled_date BETWEEN p_de AND p_ate
     GROUP BY l.pipeline_id
  ), ld AS (
    SELECT l.pipeline_id,
           count(*) AS leads_total,
           count(*) FILTER (WHERE l.created_at >= v_ini AND l.created_at < v_fim) AS leads_novos,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.crm_stages s
              WHERE s.id = l.stage_id
                AND (COALESCE(s.is_won, false) OR public.normaliza_nome_etapa(s.name) = 'contratado'))) AS contratados_etapa
      FROM public.crm_leads l
     WHERE l.tenant_id = v_tenant
     GROUP BY l.pipeline_id
  )
  SELECT p.id, p.name, p.position,
         COALESCE(ld.leads_total, 0)::integer, COALESCE(ld.leads_novos, 0)::integer,
         COALESCE(ag.agendamentos, 0)::integer, COALESCE(ag.compareceram, 0)::integer,
         COALESCE(ag.faltas, 0)::integer, COALESCE(ag.contratados, 0)::integer,
         COALESCE(ld.contratados_etapa, 0)::integer,
         COALESCE(pag.receita, 0)::numeric, COALESCE(pag.pagantes, 0)::integer
    FROM public.crm_pipelines p
    LEFT JOIN ld  ON ld.pipeline_id = p.id
    LEFT JOIN ag  ON ag.pipeline_id = p.id
    LEFT JOIN pag ON pag.pipeline_id = p.id
   WHERE p.tenant_id = v_tenant
     -- (a) sem filtro de pós-venda: ver o cabeçalho desta migration.
   ORDER BY p.position NULLS LAST, p.created_at;
END $fn$;
REVOKE ALL ON FUNCTION public.relatorio_funis(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_funis(date, date) TO authenticated, service_role;
