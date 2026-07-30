ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS comment_only boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_crm_leads_comment_only ON public.crm_leads (tenant_id) WHERE comment_only = true;

ALTER TABLE public.ig_accounts ADD COLUMN IF NOT EXISTS cidade text;

CREATE OR REPLACE FUNCTION public.rpt_origem_conversao(p_from date, p_to date, p_pipeline_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(origem text, leads bigint, atendidos bigint, agendados bigint, compareceram bigint, contratados bigint, faturamento numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.rpt_resolve_tenant();
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Período inválido: informe p_from <= p_to';
  END IF;
  RETURN QUERY
  WITH cohort AS (
    SELECT l.id, l.paciente_id, l.created_at, l.first_inbound_at,
           public.rpt_classify_origem(l.source, l.ad_id, l.nome_anuncio) AS origem_lead
    FROM public.crm_leads l
    WHERE l.tenant_id = v_tenant
      AND COALESCE(l.comment_only, false) = false
      AND l.created_at >= (p_from::timestamp AT TIME ZONE 'America/Bahia')
      AND l.created_at <  ((p_to + 1)::timestamp AT TIME ZONE 'America/Bahia')
      AND (p_pipeline_id IS NULL OR l.pipeline_id = p_pipeline_id)
  ),
  first_in AS (
    SELECT m.lead_id, min(m.created_at) AS fi
    FROM public.messages m JOIN cohort c ON c.id = m.lead_id
    WHERE m.direction = 'inbound' GROUP BY m.lead_id
  ),
  prim_pag AS (
    SELECT p.paciente_id, min(p.data_pagamento) AS primeiro
    FROM public.pagamentos p JOIN public.clinicas cl ON cl.id = p.clinica_id
    WHERE cl.tenant_id = v_tenant
      AND p.paciente_id IN (SELECT c2.paciente_id FROM cohort c2 WHERE c2.paciente_id IS NOT NULL)
    GROUP BY p.paciente_id
  ),
  flags AS (
    SELECT c.id, c.origem_lead, c.paciente_id,
      (COALESCE(f.fi, c.first_inbound_at) IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.messages m WHERE m.lead_id = c.id AND m.direction='outbound'
          AND m.created_at > COALESCE(f.fi, c.first_inbound_at))) AS atendido,
      EXISTS (SELECT 1 FROM public.crm_appointments a WHERE a.lead_id = c.id) AS agendado,
      EXISTS (SELECT 1 FROM public.crm_appointments a WHERE a.lead_id = c.id AND a.status IN ('contracted','not_contracted')) AS compareceu,
      (pp.primeiro IS NOT NULL AND pp.primeiro >= ((c.created_at AT TIME ZONE 'America/Bahia')::date - 30)) AS contratado
    FROM cohort c
    LEFT JOIN first_in f ON f.lead_id = c.id
    LEFT JOIN prim_pag pp ON pp.paciente_id = c.paciente_id
  ),
  cohort_agg AS (
    SELECT fl.origem_lead AS origem,
      count(*)::bigint AS leads,
      count(*) FILTER (WHERE fl.atendido)::bigint AS atendidos,
      count(*) FILTER (WHERE fl.agendado)::bigint AS agendados,
      count(*) FILTER (WHERE fl.compareceu)::bigint AS compareceram,
      count(*) FILTER (WHERE fl.contratado)::bigint AS contratados
    FROM flags fl GROUP BY fl.origem_lead
  ),
  pac_orig AS (
    SELECT DISTINCT ON (lp.paciente_id) lp.paciente_id,
      public.rpt_classify_origem(l.source, l.ad_id, l.nome_anuncio) AS origem,
      l.pipeline_id
    FROM public.crm_lead_pacientes lp JOIN public.crm_leads l ON l.id = lp.lead_id
    WHERE l.tenant_id = v_tenant
    ORDER BY lp.paciente_id, lp.is_primary DESC NULLS LAST, l.created_at ASC
  ),
  fat_agg AS (
    SELECT COALESCE(po.origem, 'Outros') AS origem, SUM(p.valor)::numeric AS faturamento
    FROM public.pagamentos p JOIN public.clinicas c ON c.id = p.clinica_id
    LEFT JOIN pac_orig po ON po.paciente_id = p.paciente_id
    WHERE c.tenant_id = v_tenant
      AND p.data_pagamento BETWEEN p_from AND p_to
      AND (p_pipeline_id IS NULL OR po.pipeline_id = p_pipeline_id)
    GROUP BY 1
  )
  SELECT COALESCE(ca.origem, fa.origem) AS origem,
         COALESCE(ca.leads,0)::bigint, COALESCE(ca.atendidos,0)::bigint,
         COALESCE(ca.agendados,0)::bigint, COALESCE(ca.compareceram,0)::bigint,
         COALESCE(ca.contratados,0)::bigint, COALESCE(fa.faturamento,0)::numeric
  FROM cohort_agg ca FULL OUTER JOIN fat_agg fa ON fa.origem = ca.origem
  ORDER BY COALESCE(ca.leads,0) DESC, COALESCE(fa.faturamento,0) DESC;
END;
$function$;