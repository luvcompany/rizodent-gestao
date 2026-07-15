CREATE OR REPLACE FUNCTION public.rpt_faturamento_anuncio(p_from date, p_to date, p_clinica_id uuid DEFAULT NULL::uuid)
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
GRANT EXECUTE ON FUNCTION public.rpt_faturamento_anuncio(date, date, uuid) TO authenticated, service_role;