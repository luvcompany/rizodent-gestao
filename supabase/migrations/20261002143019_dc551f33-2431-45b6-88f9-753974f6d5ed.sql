CREATE OR REPLACE FUNCTION public.relatorio_agendamentos(_inicio date, _fim date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
-- Regra única: cada lead conta uma vez por bloco; o resultado é o status final
-- do lead naquele bloco (prioridade: compareceu > falta > cancelou > pendente).
-- Consulta com status 'rescheduled' foi movida: não vale no período dela, vale
-- no período da nova consulta.
WITH todas AS (
  SELECT a.* FROM crm_appointments a
  WHERE a.tenant_id = current_tenant_id() AND a.lead_id IS NOT NULL
),
-- 1) Primeiro agendamento de cada lead (o mais antigo que não é remarcação).
primeiro AS (
  SELECT DISTINCT ON (lead_id) lead_id, status, scheduled_date, scheduled_time, created_at
  FROM todas WHERE NOT is_rescheduled
  ORDER BY lead_id, scheduled_date, scheduled_time NULLS LAST, created_at
),
agd AS (
  SELECT p.lead_id,
    CASE
      WHEN p.status IN ('contracted','not_contracted') THEN 'compareceu'
      WHEN p.status = 'no_show' THEN 'falta'
      WHEN p.status = 'cancelled' AND NOT EXISTS (
        SELECT 1 FROM todas t WHERE t.lead_id = p.lead_id AND t.is_rescheduled
          AND (t.scheduled_date, t.created_at) > (p.scheduled_date, p.created_at)) THEN 'cancelou'
      ELSE 'pendente'
    END AS res
  FROM primeiro p WHERE p.scheduled_date BETWEEN _inicio AND _fim
),
-- Consultas que valem no período (as movidas para outra data não contam aqui).
ap AS (SELECT * FROM todas WHERE scheduled_date BETWEEN _inicio AND _fim AND status <> 'rescheduled'),
final_de AS (
  SELECT lead_id, is_rem,
    CASE
      WHEN bool_or(status IN ('contracted','not_contracted')) THEN 'compareceu'
      WHEN (array_agg(status ORDER BY scheduled_date DESC, scheduled_time DESC NULLS LAST, created_at DESC))[1] = 'no_show' THEN 'falta'
      WHEN (array_agg(status ORDER BY scheduled_date DESC, scheduled_time DESC NULLS LAST, created_at DESC))[1] = 'cancelled' THEN 'cancelou'
      ELSE 'pendente'
    END AS res
  FROM (SELECT lead_id, status, scheduled_date, scheduled_time, created_at, is_rescheduled AS is_rem FROM ap WHERE is_rescheduled
        UNION ALL
        SELECT lead_id, status, scheduled_date, scheduled_time, created_at, NULL::boolean FROM ap) x
  GROUP BY lead_id, is_rem
),
rem AS (SELECT lead_id, res FROM final_de WHERE is_rem IS TRUE),
geral AS (SELECT lead_id, res FROM final_de WHERE is_rem IS NULL),
chegaram AS (
  SELECT id FROM crm_leads
  WHERE tenant_id = current_tenant_id()
    AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _inicio AND _fim
)
SELECT jsonb_build_object(
  'chegaram', (SELECT count(*) FROM chegaram),
  'agendados',          (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM agd),
  'compareceram',       (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM agd WHERE res = 'compareceu'),
  'faltas',             (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM agd WHERE res = 'falta'),
  'agd_cancelados',     (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM agd WHERE res = 'cancelou'),
  'agd_pendentes',      (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM agd WHERE res = 'pendente'),
  'remarcados',         (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM rem),
  'rem_compareceram',   (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM rem WHERE res = 'compareceu'),
  'rem_faltas',         (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM rem WHERE res = 'falta'),
  'rem_cancelados',     (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM rem WHERE res = 'cancelou'),
  'rem_pendentes',      (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM rem WHERE res = 'pendente'),
  'geral_agendados',    (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM geral),
  'geral_compareceram', (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM geral WHERE res = 'compareceu'),
  'geral_faltas',       (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM geral WHERE res = 'falta'),
  'cancelados',         (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM geral WHERE res = 'cancelou'),
  'geral_pendentes',    (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM geral WHERE res = 'pendente')
);
$$;
GRANT EXECUTE ON FUNCTION public.relatorio_agendamentos(date, date) TO authenticated;