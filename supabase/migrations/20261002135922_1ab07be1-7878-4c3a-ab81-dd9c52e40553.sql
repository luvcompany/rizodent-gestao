CREATE OR REPLACE FUNCTION public.relatorio_agendamentos(_inicio date, _fim date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH ap AS (
  SELECT a.* FROM crm_appointments a
  WHERE a.tenant_id = current_tenant_id()
    AND a.scheduled_date BETWEEN _inicio AND _fim
    AND a.lead_id IS NOT NULL
),
ult AS ( -- última consulta de cada lead no período, por tipo
  SELECT DISTINCT ON (lead_id, is_rescheduled) lead_id, is_rescheduled, status
  FROM ap WHERE status <> 'rescheduled'
  ORDER BY lead_id, is_rescheduled, scheduled_date DESC, scheduled_time DESC NULLS LAST, created_at DESC
),
rem AS (SELECT DISTINCT lead_id FROM ap WHERE is_rescheduled),
agd AS (SELECT DISTINCT lead_id FROM ap WHERE NOT is_rescheduled AND lead_id NOT IN (SELECT lead_id FROM rem)),
geral AS (
  SELECT DISTINCT ON (lead_id) lead_id, status FROM ap WHERE status <> 'rescheduled'
  ORDER BY lead_id, scheduled_date DESC, scheduled_time DESC NULLS LAST, created_at DESC
),
chegaram AS (
  SELECT id FROM crm_leads
  WHERE tenant_id = current_tenant_id()
    AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _inicio AND _fim
)
SELECT jsonb_build_object(
  'chegaram', (SELECT count(*) FROM chegaram),
  'agendados', (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM agd),
  'compareceram', (SELECT coalesce(jsonb_agg(u.lead_id), '[]') FROM ult u JOIN agd USING (lead_id) WHERE NOT u.is_rescheduled AND u.status IN ('contracted','not_contracted')),
  'faltas', (SELECT coalesce(jsonb_agg(u.lead_id), '[]') FROM ult u JOIN agd USING (lead_id) WHERE NOT u.is_rescheduled AND u.status = 'no_show'),
  'remarcados', (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM rem),
  'rem_compareceram', (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM ult WHERE is_rescheduled AND status IN ('contracted','not_contracted')),
  'rem_faltas', (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM ult WHERE is_rescheduled AND status = 'no_show'),
  'cancelados', (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM geral WHERE status = 'cancelled'),
  'geral_agendados', (SELECT coalesce(jsonb_agg(DISTINCT lead_id), '[]') FROM ap),
  'geral_compareceram', (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM geral WHERE status IN ('contracted','not_contracted')),
  'geral_faltas', (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM geral WHERE status = 'no_show')
);
$$;
GRANT EXECUTE ON FUNCTION public.relatorio_agendamentos(date, date) TO authenticated;