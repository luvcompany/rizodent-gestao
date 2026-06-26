
-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_bot_executions_bot_started ON public.bot_executions(bot_id, started_at);
CREATE INDEX IF NOT EXISTS idx_ai_conv_analysis_created ON public.ai_conversation_analysis(created_at);
CREATE INDEX IF NOT EXISTS idx_crm_automation_queue_created_action ON public.crm_automation_queue(created_at, action_type);
CREATE INDEX IF NOT EXISTS idx_crm_followup_queue_created ON public.crm_followup_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_crm_broadcasts_created ON public.crm_broadcasts(created_at);

-- RPC de métricas de uso por tenant
CREATE OR REPLACE FUNCTION public.crm_usage_metrics(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_from timestamptz := p_from::timestamptz;
  v_to   timestamptz := (p_to + 1)::timestamptz;
  v_result jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('error','no_tenant');
  END IF;

  WITH
  bot_data AS (
    SELECT b.name AS bot_name,
           date_trunc('month', be.started_at) AS mes,
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
  ia_data AS (
    SELECT date_trunc('month', a.created_at) AS mes,
           a.mode,
           count(*) AS total,
           count(DISTINCT a.lead_id) AS leads
    FROM public.ai_conversation_analysis a
    JOIN public.crm_leads l ON l.id = a.lead_id
    WHERE a.created_at >= v_from AND a.created_at < v_to
      AND l.tenant_id = v_tenant
    GROUP BY 1,2
    ORDER BY 1,2
  ),
  fu_data AS (
    SELECT date_trunc('month', f.created_at) AS mes,
           count(*) FILTER (WHERE f.disparo1_sent_at IS NOT NULL) AS d1,
           count(*) FILTER (WHERE f.disparo2_sent_at IS NOT NULL) AS d2
    FROM public.crm_followup_queue f
    JOIN public.crm_leads l ON l.id = f.lead_id
    WHERE f.created_at >= v_from AND f.created_at < v_to
      AND l.tenant_id = v_tenant
    GROUP BY 1
    ORDER BY 1
  ),
  auto_data AS (
    SELECT date_trunc('month', q.created_at) AS mes,
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
    SELECT date_trunc('month', created_at) AS mes,
           count(*) AS campanhas,
           coalesce(sum(sent_count),0) AS enviados
    FROM public.crm_broadcasts
    WHERE created_at >= v_from AND created_at < v_to
      AND tenant_id = v_tenant
    GROUP BY 1
    ORDER BY 1
  )
  SELECT jsonb_build_object(
    'respostas_por_bot', coalesce((SELECT jsonb_agg(to_jsonb(bot_data)) FROM bot_data), '[]'::jsonb),
    'uso_ia',            coalesce((SELECT jsonb_agg(to_jsonb(ia_data))  FROM ia_data),  '[]'::jsonb),
    'followups',         coalesce((SELECT jsonb_agg(to_jsonb(fu_data))  FROM fu_data),  '[]'::jsonb),
    'automacoes',        coalesce((SELECT jsonb_agg(to_jsonb(auto_data))FROM auto_data),'[]'::jsonb),
    'broadcasts',        coalesce((SELECT jsonb_agg(to_jsonb(bc_data))  FROM bc_data),  '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_usage_metrics(date, date) TO authenticated;
