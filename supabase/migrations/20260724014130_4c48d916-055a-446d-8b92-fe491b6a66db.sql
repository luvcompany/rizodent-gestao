
-- Alinha rpt_faturamento, rpt_faturamento_origem e rpt_faturamento_anuncio
-- à regra do endpoint /reports/financeiro: ortodontia em manutenção
-- (pagamentos.recorrencia_orto = true) NÃO conta no faturamento.
-- A coluna é NOT NULL DEFAULT false, portanto o filtro é simples.
-- Nada mais na lógica muda (assinatura, retorno, granularidade, RLS).

CREATE OR REPLACE FUNCTION public.rpt_faturamento(
  p_from date,
  p_to date,
  p_clinica_id uuid DEFAULT NULL
)
RETURNS TABLE (
  dia date,
  clinica_id uuid,
  clinica text,
  tipo text,
  especialidade text,
  total numeric,
  qtd bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.rpt_resolve_tenant();
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Período inválido: informe p_from <= p_to';
  END IF;

  RETURN QUERY
  SELECT
    p.data_pagamento           AS dia,
    c.id                       AS clinica_id,
    c.nome                     AS clinica,
    p.tipo                     AS tipo,
    p.especialidade            AS especialidade,
    SUM(p.valor)               AS total,
    COUNT(*)::bigint           AS qtd
  FROM public.pagamentos p
  JOIN public.clinicas c ON c.id = p.clinica_id
  WHERE c.tenant_id = v_tenant
    AND p.data_pagamento BETWEEN p_from AND p_to
    AND p.recorrencia_orto = false
    AND (p_clinica_id IS NULL OR p.clinica_id = p_clinica_id)
  GROUP BY p.data_pagamento, c.id, c.nome, p.tipo, p.especialidade
  ORDER BY p.data_pagamento, c.nome, p.tipo, p.especialidade;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpt_faturamento_origem(
  p_from date, p_to date, p_clinica_id uuid DEFAULT NULL
)
RETURNS TABLE (origem text, faturamento numeric, pacientes bigint, pagamentos bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant uuid := public.rpt_resolve_tenant();
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Período inválido: informe p_from <= p_to';
  END IF;
  RETURN QUERY
  WITH pac_orig AS (
    SELECT DISTINCT ON (lp.paciente_id) lp.paciente_id,
      public.rpt_classify_origem(l.source, l.ad_id, l.nome_anuncio) AS origem
    FROM public.crm_lead_pacientes lp
    JOIN public.crm_leads l ON l.id = lp.lead_id
    WHERE l.tenant_id = v_tenant
    ORDER BY lp.paciente_id, lp.is_primary DESC NULLS LAST, l.created_at ASC
  ),
  pay AS (
    SELECT p.paciente_id, p.valor
    FROM public.pagamentos p
    JOIN public.clinicas c ON c.id = p.clinica_id
    WHERE c.tenant_id = v_tenant
      AND p.data_pagamento BETWEEN p_from AND p_to
      AND p.recorrencia_orto = false
      AND (p_clinica_id IS NULL OR p.clinica_id = p_clinica_id)
  )
  SELECT COALESCE(po.origem, 'Outros') AS origem,
         COALESCE(SUM(pay.valor),0)::numeric AS faturamento,
         COUNT(DISTINCT pay.paciente_id)::bigint AS pacientes,
         COUNT(*)::bigint AS pagamentos
  FROM pay LEFT JOIN pac_orig po ON po.paciente_id = pay.paciente_id
  GROUP BY 1 ORDER BY 2 DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpt_faturamento_anuncio(
  p_from date, p_to date, p_clinica_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(anuncio text, faturamento numeric, pacientes bigint, pagamentos bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.rpt_resolve_tenant();
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Período inválido: informe p_from <= p_to';
  END IF;
  RETURN QUERY
  WITH lead_anuncio AS (
    SELECT DISTINCT ON (lp.paciente_id) lp.paciente_id,
      COALESCE(NULLIF(btrim(am.ad_name),''), NULLIF(btrim(l.nome_anuncio),''), NULLIF(btrim(am.ad_headline),'')) AS anuncio,
      (l.ad_id IS NOT NULL OR l.source ~* '(facebook|instagram|_ad|meta)') AS is_ad
    FROM public.crm_lead_pacientes lp
    JOIN public.crm_leads l ON l.id = lp.lead_id
    LEFT JOIN public.ad_id_mapping am ON am.ad_id = l.ad_id AND am.tenant_id = v_tenant
    WHERE l.tenant_id = v_tenant
    ORDER BY lp.paciente_id, lp.is_primary DESC NULLS LAST, l.created_at ASC
  ),
  pay AS (
    SELECT p.paciente_id, p.valor
    FROM public.pagamentos p JOIN public.clinicas c ON c.id = p.clinica_id
    WHERE c.tenant_id = v_tenant
      AND p.data_pagamento BETWEEN p_from AND p_to
      AND p.recorrencia_orto = false
      AND (p_clinica_id IS NULL OR p.clinica_id = p_clinica_id)
  )
  SELECT COALESCE(la.anuncio, NULLIF(btrim(pac.nome_anuncio),''),
           CASE WHEN COALESCE(la.is_ad,false) THEN 'Anúncio (não identificado)' ELSE 'Sem anúncio / outro' END) AS anuncio,
         COALESCE(SUM(pay.valor),0)::numeric AS faturamento,
         COUNT(DISTINCT pay.paciente_id)::bigint AS pacientes,
         COUNT(*)::bigint AS pagamentos
  FROM pay
  LEFT JOIN lead_anuncio la ON la.paciente_id = pay.paciente_id
  LEFT JOIN public.pacientes pac ON pac.id = pay.paciente_id AND pac.tenant_id = v_tenant
  GROUP BY 1 ORDER BY 2 DESC;
END;
$function$;
