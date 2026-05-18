-- 1) Health Score v2
CREATE OR REPLACE FUNCTION public.recalculate_lead_score(p_lead_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_score integer := 0;
  v_msg_inbound integer := 0;
  v_stage_changes integer := 0;
  v_appointments_confirmed integer := 0;
  v_appointments_cancelled integer := 0;
  v_days_inactive integer := 30;
  v_days_since_visit integer := 9999;
  v_has_feedback boolean := false;
  v_has_complaint boolean := false;
  v_tags text[];
  v_paciente uuid;
BEGIN
  SELECT COUNT(*) INTO v_msg_inbound
    FROM messages WHERE lead_id = p_lead_id AND direction = 'inbound';
  v_score := v_score + LEAST(v_msg_inbound, 10) * 10;

  SELECT COUNT(*) INTO v_stage_changes
    FROM crm_lead_stage_history WHERE lead_id = p_lead_id;
  v_score := v_score + LEAST(v_stage_changes, 4) * 15;

  SELECT COUNT(*) INTO v_appointments_confirmed
    FROM crm_appointments WHERE lead_id = p_lead_id
     AND status IN ('confirmed','contracted');
  v_score := v_score + LEAST(v_appointments_confirmed, 3) * 30;

  SELECT COUNT(*) INTO v_appointments_cancelled
    FROM crm_appointments WHERE lead_id = p_lead_id
     AND status IN ('cancelled','no_show','not_contracted');
  v_score := v_score - (v_appointments_cancelled * 40);

  SELECT tags, paciente_id,
         COALESCE(EXTRACT(DAY FROM now() - GREATEST(last_inbound_at, last_message_at))::int, 30)
    INTO v_tags, v_paciente, v_days_inactive
    FROM crm_leads WHERE id = p_lead_id;

  IF v_tags IS NOT NULL THEN
    v_has_feedback := 'feedback_positivo' = ANY(v_tags);
    v_has_complaint := 'reclamacao' = ANY(v_tags);
  END IF;
  IF v_has_feedback THEN v_score := v_score + 20; END IF;
  IF v_has_complaint THEN v_score := v_score - 15; END IF;

  IF v_days_inactive >= 30 THEN
    v_score := v_score - 20;
  END IF;

  IF v_paciente IS NOT NULL THEN
    SELECT COALESCE(EXTRACT(DAY FROM now() - MAX(data_pagamento))::int, 9999)
      INTO v_days_since_visit
      FROM pagamentos WHERE paciente_id = v_paciente;
    IF v_days_since_visit >= 180 AND v_days_since_visit < 9999 THEN
      v_score := v_score - 25;
    END IF;
  END IF;

  IF v_score < 0 THEN v_score := 0; END IF;
  IF v_score > 100 THEN v_score := 100; END IF;

  UPDATE crm_leads SET score = v_score WHERE id = p_lead_id;
  RETURN v_score;
END;
$function$;

-- 2) Dashboard metrics RPC
CREATE OR REPLACE FUNCTION public.posvenda_dashboard_metrics()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_result jsonb;
BEGIN
  IF NOT (
    has_role(auth.uid(), 'posvenda'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR has_role(auth.uid(), 'superadmin'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH base AS (
    SELECT l.id, l.name, l.phone, l.score, l.tags, l.last_inbound_at, l.paciente_id, l.assigned_to,
           (SELECT MAX(data_pagamento) FROM pagamentos p WHERE p.paciente_id = l.paciente_id) AS ultima_visita,
           (SELECT COUNT(*) FROM crm_appointments a WHERE a.lead_id = l.id
              AND a.status IN ('cancelled','no_show','not_contracted')
              AND a.updated_at >= now() - interval '60 days') AS cancelados_recentes
      FROM crm_leads l
     WHERE l.tenant_id = v_tenant
       AND l.is_blocked = false
  ),
  em_risco AS (
    SELECT * FROM base
     WHERE (last_inbound_at IS NOT NULL AND last_inbound_at < now() - interval '30 days')
        OR cancelados_recentes > 0
        OR score < 30
  ),
  sumidos AS (
    SELECT * FROM base
     WHERE ultima_visita IS NOT NULL AND ultima_visita < (now() - interval '180 days')::date
  ),
  vips AS (
    SELECT * FROM base WHERE score >= 80
  ),
  recem_contratados AS (
    SELECT b.* FROM base b
      JOIN crm_appointments a ON a.lead_id = b.id
     WHERE a.status = 'contracted'
       AND a.updated_at >= now() - interval '30 days'
     GROUP BY b.id, b.name, b.phone, b.score, b.tags, b.last_inbound_at, b.paciente_id,
              b.assigned_to, b.ultima_visita, b.cancelados_recentes
  )
  SELECT jsonb_build_object(
    'em_risco_count', (SELECT COUNT(*) FROM em_risco),
    'sumidos_count', (SELECT COUNT(*) FROM sumidos),
    'vips_count', (SELECT COUNT(*) FROM vips),
    'recem_contratados_count', (SELECT COUNT(*) FROM recem_contratados),
    'em_risco_top', (SELECT COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY t.score ASC), '[]'::jsonb)
                       FROM (SELECT id, name, phone, score, last_inbound_at FROM em_risco
                              ORDER BY score ASC LIMIT 10) t),
    'sumidos_top', (SELECT COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY t.ultima_visita ASC), '[]'::jsonb)
                       FROM (SELECT id, name, phone, score, ultima_visita FROM sumidos
                              ORDER BY ultima_visita ASC LIMIT 10) t),
    'vips_top', (SELECT COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY t.score DESC), '[]'::jsonb)
                       FROM (SELECT id, name, phone, score, last_inbound_at FROM vips
                              ORDER BY score DESC LIMIT 10) t),
    'recem_contratados_top', (SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb)
                       FROM (SELECT id, name, phone, score FROM recem_contratados LIMIT 10) t),
    'leads_total', (SELECT COUNT(*) FROM base),
    'leads_score_medio', (SELECT COALESCE(ROUND(AVG(score))::int, 0) FROM base)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- 3) Índices de performance
CREATE INDEX IF NOT EXISTS idx_crm_leads_score ON public.crm_leads (score);
CREATE INDEX IF NOT EXISTS idx_crm_leads_last_inbound_at ON public.crm_leads (last_inbound_at);
CREATE INDEX IF NOT EXISTS idx_pagamentos_data_pagamento ON public.pagamentos (data_pagamento);
CREATE INDEX IF NOT EXISTS idx_pagamentos_paciente_data ON public.pagamentos (paciente_id, data_pagamento DESC);