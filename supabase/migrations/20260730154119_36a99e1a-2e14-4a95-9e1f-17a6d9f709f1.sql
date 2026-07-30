CREATE OR REPLACE FUNCTION public.pagamento_conta_marketing(p_paciente_id uuid, p_recorrencia_orto boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN COALESCE(p_recorrencia_orto, false) THEN false
    WHEN p_paciente_id IS NULL THEN true
    WHEN NOT EXISTS (SELECT 1 FROM public.crm_lead_pacientes lp WHERE lp.paciente_id = p_paciente_id) THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.crm_lead_pacientes lp
      JOIN public.crm_leads l ON l.id = lp.lead_id
      WHERE lp.paciente_id = p_paciente_id
        AND NOT (
          l.source ILIKE 'whatsapp'
          AND NOT EXISTS (SELECT 1 FROM public.crm_appointments a WHERE a.lead_id = l.id)
        )
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.pagamento_conta_marketing(uuid, boolean) TO authenticated, service_role, anon;

CREATE OR REPLACE FUNCTION public.rpt_faturamento(p_from date, p_to date, p_clinica_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(dia date, clinica_id uuid, clinica text, tipo text, especialidade text, total numeric, qtd bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND public.pagamento_conta_marketing(p.paciente_id, p.recorrencia_orto)
    AND (p_clinica_id IS NULL OR p.clinica_id = p_clinica_id)
  GROUP BY p.data_pagamento, c.id, c.nome, p.tipo, p.especialidade
  ORDER BY p.data_pagamento, c.nome, p.tipo, p.especialidade;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpt_faturamento_anuncio(p_from date, p_to date, p_clinica_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(anuncio text, faturamento numeric, pacientes bigint, pagamentos bigint)
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
      AND public.pagamento_conta_marketing(p.paciente_id, p.recorrencia_orto)
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

CREATE OR REPLACE FUNCTION public.rpt_faturamento_criativo(p_from date, p_to date, p_clinica_id uuid DEFAULT NULL::uuid, p_janela_dias integer DEFAULT 90, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(criativo_key text, criativo text, faturamento numeric, pacientes bigint, pagamentos bigint, ads_no_grupo integer, ads_no_periodo bigint, contas integer, cidades text[], variantes integer, atribuido boolean, origem_atribuicao text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_service boolean;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Período inválido: informe p_from <= p_to';
  END IF;
  IF auth.uid() IS NOT NULL THEN
    v_tenant := public.current_tenant_id();
    IF v_tenant IS NULL THEN RAISE EXCEPTION 'Usuário sem tenant associado'; END IF;
  ELSE
    v_service := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role','') = 'service_role'
                 OR session_user IN ('postgres','supabase_admin','supabase_read_only_user');
    IF v_service AND p_tenant_id IS NOT NULL THEN v_tenant := p_tenant_id;
    ELSE v_tenant := public.rpt_resolve_tenant(); END IF;
  END IF;

  RETURN QUERY
  WITH primeiro AS (
    SELECT DISTINCT ON (m.lead_id) m.lead_id, m.ad_source_id
    FROM public.messages m WHERE m.ad_source_id IS NOT NULL
    ORDER BY m.lead_id, m.created_at ASC
  ),
  lead_pac AS (
    SELECT DISTINCT ON (lp.paciente_id) lp.paciente_id,
      COALESCE(pr.ad_source_id, l.ad_id) AS ad_id, l.created_at::date AS lead_em
    FROM public.crm_lead_pacientes lp
    JOIN public.crm_leads l ON l.id = lp.lead_id
    LEFT JOIN primeiro pr ON pr.lead_id = l.id
    WHERE l.tenant_id = v_tenant
    ORDER BY lp.paciente_id, lp.is_primary DESC NULLS LAST, l.created_at ASC
  ),
  pay AS (
    SELECT p.paciente_id, p.valor, p.data_pagamento
    FROM public.pagamentos p JOIN public.clinicas c ON c.id = p.clinica_id
    WHERE c.tenant_id = v_tenant AND p.data_pagamento BETWEEN p_from AND p_to
      AND public.pagamento_conta_marketing(p.paciente_id, p.recorrencia_orto)
      AND (p_clinica_id IS NULL OR p.clinica_id = p_clinica_id)
  ),
  base AS (
    SELECT pay.paciente_id, pay.valor, lp.ad_id,
      CASE WHEN lp.ad_id IS NOT NULL
                AND NOT (pay.data_pagamento < lp.lead_em)
                AND (p_janela_dias IS NULL OR pay.data_pagamento - lp.lead_em <= p_janela_dias)
           THEN COALESCE(ov.creative_key, am.creative_key)
           ELSE pac.creative_key_declarado END AS ck,
      CASE
        WHEN lp.ad_id IS NOT NULL
             AND NOT (pay.data_pagamento < lp.lead_em)
             AND (p_janela_dias IS NULL OR pay.data_pagamento - lp.lead_em <= p_janela_dias) THEN 'ok'
        WHEN pac.creative_key_declarado IS NOT NULL THEN 'declarada'
        WHEN lp.ad_id IS NULL THEN 'sem_anuncio'
        WHEN pay.data_pagamento < lp.lead_em THEN 'anterior'
        ELSE 'fora_janela' END AS situacao
    FROM pay
    LEFT JOIN lead_pac lp ON lp.paciente_id = pay.paciente_id
    LEFT JOIN public.pacientes pac ON pac.id = pay.paciente_id AND pac.tenant_id = v_tenant
    LEFT JOIN public.ad_id_mapping am ON am.ad_id = lp.ad_id AND am.tenant_id = v_tenant
    LEFT JOIN public.ad_creative_override ov ON ov.ad_id = lp.ad_id AND ov.tenant_id = v_tenant
  )
  SELECT
    CASE WHEN b.situacao IN ('ok','declarada') THEN b.ck END,
    CASE b.situacao
      WHEN 'sem_anuncio' THEN 'Sem anúncio vinculado'
      WHEN 'anterior'    THEN 'Pagamento anterior ao clique no anúncio'
      WHEN 'fora_janela' THEN 'Anúncio fora da janela de ' || p_janela_dias || ' dias'
      WHEN 'declarada'   THEN COALESCE(g.rotulo_manual, g.rotulo, 'Criativo informado na recepção')
      ELSE COALESCE(g.rotulo_manual, g.rotulo, 'Criativo não catalogado')
    END,
    ROUND(SUM(b.valor), 2), COUNT(DISTINCT b.paciente_id)::bigint, COUNT(*)::bigint,
    MAX(g.n_ads), COUNT(DISTINCT b.ad_id)::bigint, MAX(g.n_contas), MAX(g.cidades), MAX(g.n_variantes),
    (b.situacao = 'ok'),
    CASE b.situacao WHEN 'ok' THEN 'medida' WHEN 'declarada' THEN 'declarada' ELSE 'nenhuma' END
  FROM base b
  LEFT JOIN public.ad_creative_grupo g
    ON g.creative_key = b.ck AND g.tenant_id = v_tenant AND b.situacao IN ('ok','declarada')
  GROUP BY b.situacao, 1, 2
  ORDER BY 3 DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpt_faturamento_origem(p_from date, p_to date, p_clinica_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(origem text, faturamento numeric, pacientes bigint, pagamentos bigint)
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
      AND public.pagamento_conta_marketing(p.paciente_id, p.recorrencia_orto)
      AND (p_clinica_id IS NULL OR p.clinica_id = p_clinica_id)
  )
  SELECT COALESCE(po.origem, 'Outros') AS origem,
         COALESCE(SUM(pay.valor),0)::numeric AS faturamento,
         COUNT(DISTINCT pay.paciente_id)::bigint AS pacientes,
         COUNT(*)::bigint AS pagamentos
  FROM pay LEFT JOIN pac_orig po ON po.paciente_id = pay.paciente_id
  GROUP BY 1 ORDER BY 2 DESC;
END;
$function$;