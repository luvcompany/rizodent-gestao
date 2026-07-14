-- ==========================================================================
-- Performance: agregados de mensagens para Relatórios do CRM + índices
-- ==========================================================================

-- Índices usados pelas telas de relatório e calendário/conversas.
CREATE INDEX IF NOT EXISTS idx_messages_tenant_created_id
  ON public.messages (tenant_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_messages_tenant_direction_created_lead
  ON public.messages (tenant_id, direction, created_at, lead_id);

CREATE INDEX IF NOT EXISTS idx_crm_appointments_tenant_created_id
  ON public.crm_appointments (tenant_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_crm_leads_tenant_created_id
  ON public.crm_leads (tenant_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_crm_leads_tenant_last_inbound_id
  ON public.crm_leads (tenant_id, last_inbound_at, id)
  WHERE last_inbound_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_lead_stage_history_open_lookup
  ON public.crm_lead_stage_history (lead_id, stage_id, exited_at, entered_at DESC);

-- Conversas inbound distintas por dia (America/Bahia) para a aba Relatórios.
CREATE OR REPLACE FUNCTION public.rpt_crm_message_activity(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  dia date,
  conversaram bigint
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
    (m.created_at AT TIME ZONE 'America/Bahia')::date AS dia,
    count(DISTINCT m.lead_id)::bigint AS conversaram
  FROM public.messages m
  WHERE m.tenant_id = v_tenant
    AND m.direction = 'inbound'
    AND m.lead_id IS NOT NULL
    AND m.created_at >= p_from
    AND m.created_at <= p_to
  GROUP BY 1
  ORDER BY 1;
END;
$$;

-- Tempo médio de resposta sem enviar todas as mensagens ao navegador.
-- Espelha a regra antiga do front: pares consecutivos por lead, dentro do período,
-- ignorando intervalos maiores que 7 dias.
CREATE OR REPLACE FUNCTION public.rpt_crm_response_times(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  lead_ms numeric,
  crc_ms numeric,
  n_lead bigint,
  n_crc bigint
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
  WITH ordered AS (
    SELECT
      m.lead_id,
      m.direction,
      m.created_at,
      lag(m.direction) OVER (PARTITION BY m.lead_id ORDER BY m.created_at, m.id) AS prev_direction,
      lag(m.created_at) OVER (PARTITION BY m.lead_id ORDER BY m.created_at, m.id) AS prev_created_at
    FROM public.messages m
    WHERE m.tenant_id = v_tenant
      AND m.lead_id IS NOT NULL
      AND m.direction IN ('inbound', 'outbound')
      AND m.created_at >= p_from
      AND m.created_at <= p_to
  ), pairs AS (
    SELECT
      direction,
      prev_direction,
      extract(epoch FROM (created_at - prev_created_at)) * 1000 AS diff_ms
    FROM ordered
    WHERE prev_direction IS NOT NULL
      AND prev_direction <> direction
      AND created_at > prev_created_at
      AND created_at - prev_created_at <= interval '7 days'
  )
  SELECT
    COALESCE(avg(diff_ms) FILTER (WHERE prev_direction = 'outbound' AND direction = 'inbound'), 0)::numeric AS lead_ms,
    COALESCE(avg(diff_ms) FILTER (WHERE prev_direction = 'inbound' AND direction = 'outbound'), 0)::numeric AS crc_ms,
    count(*) FILTER (WHERE prev_direction = 'outbound' AND direction = 'inbound')::bigint AS n_lead,
    count(*) FILTER (WHERE prev_direction = 'inbound' AND direction = 'outbound')::bigint AS n_crc
  FROM pairs;
END;
$$;

REVOKE ALL ON FUNCTION public.rpt_crm_message_activity(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpt_crm_response_times(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpt_crm_message_activity(timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpt_crm_response_times(timestamptz, timestamptz) TO authenticated, service_role;