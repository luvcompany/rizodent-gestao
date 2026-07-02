CREATE OR REPLACE FUNCTION public.crm_usage_metrics(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_from timestamptz := p_from::timestamptz;
  v_to   timestamptz := (p_to + 1)::timestamptz;
  v_span_days int := (p_to - p_from) + 1;
  v_trunc text := CASE WHEN v_span_days <= 92 THEN 'day' ELSE 'month' END;
  v_result jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('error','no_tenant');
  END IF;

  WITH
  bot_data AS (
    SELECT b.name AS bot_name,
           date_trunc(v_trunc, be.started_at) AS mes,
           count(*) AS total,
           count(*) FILTER (WHERE be.status='completed') AS concluidos
    FROM public.bot_executions be
    JOIN public.bots b ON b.id = be.bot_id
    LEFT JOIN public.crm_leads l ON l.id = be.lead_id
    WHERE be.started_at >= v_from AND be.started_at < v_to
      AND (b.tenant_id = v_tenant OR l.tenant_id = v_tenant)
    GROUP BY 1,2
    ORDER BY 2,1
  ),
  ia_analysis AS (
    SELECT date_trunc(v_trunc, a.created_at) AS mes,
           'analyze'::text AS mode,
           count(*) AS total,
           count(DISTINCT a.lead_id) AS leads
    FROM public.ai_conversation_analysis a
    JOIN public.crm_leads l ON l.id = a.lead_id
    WHERE a.created_at >= v_from AND a.created_at < v_to
      AND l.tenant_id = v_tenant
    GROUP BY 1
  ),
  ia_suggestions AS (
    SELECT date_trunc(v_trunc, s.created_at) AS mes,
           COALESCE(s.status, 'suggested') AS mode,
           count(*) AS total,
           count(DISTINCT s.lead_id) AS leads
    FROM public.ai_reply_suggestions s
    JOIN public.crm_leads l ON l.id = s.lead_id
    WHERE s.created_at >= v_from AND s.created_at < v_to
      AND l.tenant_id = v_tenant
    GROUP BY 1,2
  ),
  ia_transcriptions AS (
    SELECT date_trunc(v_trunc, m.created_at) AS mes,
           'transcribe'::text AS mode,
           count(*) AS total,
           count(DISTINCT m.lead_id) AS leads
    FROM public.messages m
    WHERE m.created_at >= v_from AND m.created_at < v_to
      AND m.tenant_id = v_tenant
      AND m.transcription IS NOT NULL
      AND length(m.transcription) > 0
    GROUP BY 1
  ),
  ia_good AS (
    SELECT date_trunc(v_trunc, g.created_at) AS mes,
           'good_example'::text AS mode,
           count(*) AS total,
           count(DISTINCT g.lead_id) AS leads
    FROM public.ai_good_examples g
    LEFT JOIN public.crm_leads l ON l.id = g.lead_id
    WHERE g.created_at >= v_from AND g.created_at < v_to
      AND (g.tenant_id = v_tenant OR l.tenant_id = v_tenant)
    GROUP BY 1
  ),
  ia_data AS (
    SELECT * FROM ia_analysis
    UNION ALL SELECT * FROM ia_suggestions
    UNION ALL SELECT * FROM ia_transcriptions
    UNION ALL SELECT * FROM ia_good
  ),
  auto_data AS (
    SELECT date_trunc(v_trunc, q.created_at) AS mes,
           q.action_type,
           count(*) FILTER (WHERE q.status='sent') AS enviados,
           count(*) AS total
    FROM public.crm_automation_queue q
    JOIN public.crm_leads l ON l.id = q.lead_id
    WHERE q.created_at >= v_from AND q.created_at < v_to
      AND l.tenant_id = v_tenant
    GROUP BY 1,2
    ORDER BY 1,2
  ),
  bc_data AS (
    SELECT date_trunc(v_trunc, created_at) AS mes,
           count(*) AS campanhas,
           coalesce(sum(sent_count),0) AS enviados
    FROM public.crm_broadcasts
    WHERE created_at >= v_from AND created_at < v_to
      AND tenant_id = v_tenant
    GROUP BY 1
    ORDER BY 1
  )
  SELECT jsonb_build_object(
    'respostas_por_bot', coalesce((SELECT jsonb_agg(to_jsonb(bot_data) ORDER BY mes) FROM bot_data), '[]'::jsonb),
    'uso_ia',            coalesce((SELECT jsonb_agg(to_jsonb(ia_data) ORDER BY mes) FROM ia_data),  '[]'::jsonb),
    'automacoes',        coalesce((SELECT jsonb_agg(to_jsonb(auto_data) ORDER BY mes) FROM auto_data),'[]'::jsonb),
    'broadcasts',        coalesce((SELECT jsonb_agg(to_jsonb(bc_data) ORDER BY mes) FROM bc_data),  '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;