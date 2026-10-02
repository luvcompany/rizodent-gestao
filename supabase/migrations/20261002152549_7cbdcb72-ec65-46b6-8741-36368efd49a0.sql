CREATE OR REPLACE FUNCTION public.relatorio_agendamentos(_inicio date, _fim date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH todas AS (
  SELECT a.* FROM crm_appointments a
  WHERE a.tenant_id = current_tenant_id() AND a.lead_id IS NOT NULL
),
primeiro AS (
  SELECT DISTINCT ON (lead_id) lead_id, id, status, scheduled_date
  FROM todas
  ORDER BY lead_id, scheduled_date, scheduled_time NULLS LAST, created_at
),
agd AS (
  SELECT lead_id, CASE
      WHEN status IN ('contracted','not_contracted') THEN 'compareceu'
      WHEN status = 'no_show' THEN 'falta'
      WHEN status = 'cancelled' THEN 'cancelou'
      ELSE 'pendente' END AS res
  FROM primeiro WHERE scheduled_date BETWEEN _inicio AND _fim
),
ap AS (SELECT * FROM todas WHERE scheduled_date BETWEEN _inicio AND _fim AND status <> 'rescheduled'),
-- Auditoria: remarcações criadas à mão (sem a função de remarcar); já contam em Remarcados.
outros AS (SELECT DISTINCT a.lead_id FROM ap a JOIN primeiro p ON p.lead_id = a.lead_id
           WHERE a.id <> p.id AND NOT a.is_rescheduled),
res_geral AS (
  SELECT j.lead_id,
    CASE WHEN bool_or(j.status IN ('contracted','not_contracted')) THEN 'compareceu'
      ELSE CASE (array_agg(j.status ORDER BY j.scheduled_date DESC, j.scheduled_time DESC NULLS LAST, j.created_at DESC))[1]
        WHEN 'no_show' THEN 'falta' WHEN 'cancelled' THEN 'cancelou' ELSE 'pendente' END
    END AS res,
    (array_agg(j.scheduled_date ORDER BY j.scheduled_date DESC, j.scheduled_time DESC NULLS LAST, j.created_at DESC))[1] AS ult_data,
    (array_agg(j.id <> p.id ORDER BY j.scheduled_date DESC, j.scheduled_time DESC NULLS LAST, j.created_at DESC))[1] AS ult_rem
  FROM ap j JOIN primeiro p ON p.lead_id = j.lead_id
  GROUP BY j.lead_id
),
res_rem AS (
  SELECT j.lead_id,
    CASE WHEN bool_or(j.status IN ('contracted','not_contracted')) THEN 'compareceu'
      ELSE CASE (array_agg(j.status ORDER BY j.scheduled_date DESC, j.scheduled_time DESC NULLS LAST, j.created_at DESC))[1]
        WHEN 'no_show' THEN 'falta' WHEN 'cancelled' THEN 'cancelou' ELSE 'pendente' END
    END AS res
  FROM ap j JOIN primeiro p ON p.lead_id = j.lead_id WHERE j.id <> p.id
  GROUP BY j.lead_id
),
faltas_det AS (
  SELECT g.lead_id, CASE
      WHEN NOT EXISTS (SELECT 1 FROM ap t WHERE t.lead_id = g.lead_id AND t.id <> p.id) THEN 'sem_remarcacao'
      WHEN p.scheduled_date < _inicio THEN 'periodo_anterior'
      ELSE 'faltou_novamente' END AS cat
  FROM res_geral g LEFT JOIN primeiro p ON p.lead_id = g.lead_id
  WHERE g.res = 'falta'
),
pend_det AS (
  SELECT lead_id, CASE
      WHEN ult_data > (now() AT TIME ZONE 'America/Sao_Paulo')::date AND ult_rem THEN 'remarcacao_futura'
      WHEN ult_data > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'agendamento_futuro'
      WHEN ult_data = (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'hoje'
      ELSE 'sem_resultado' END AS cat
  FROM res_geral WHERE res = 'pendente'
)
SELECT jsonb_build_object(
  'chegaram', (SELECT count(*) FROM crm_leads WHERE tenant_id = current_tenant_id()
                 AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _inicio AND _fim),
  'agendados',          (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM agd),
  'compareceram',       (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM agd WHERE res = 'compareceu'),
  'faltas',             (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM agd WHERE res = 'falta'),
  'agd_cancelados',     (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM agd WHERE res = 'cancelou'),
  'agd_pendentes',      (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM agd WHERE res = 'pendente'),
  'remarcados',         (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM res_rem),
  'rem_compareceram',   (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM res_rem WHERE res = 'compareceu'),
  'rem_faltas',         (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM res_rem WHERE res = 'falta'),
  'rem_cancelados',     (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM res_rem WHERE res = 'cancelou'),
  'rem_pendentes',      (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM res_rem WHERE res = 'pendente'),
  'geral_agendados',    (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM res_geral),
  'geral_compareceram', (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM res_geral WHERE res = 'compareceu'),
  'geral_faltas',       (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM res_geral WHERE res = 'falta'),
  'cancelados',         (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM res_geral WHERE res = 'cancelou'),
  'geral_pendentes',    (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM res_geral WHERE res = 'pendente'),
  'falta_sem_remarcacao',   (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM faltas_det WHERE cat = 'sem_remarcacao'),
  'falta_novamente',        (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM faltas_det WHERE cat = 'faltou_novamente'),
  'falta_periodo_anterior', (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM faltas_det WHERE cat = 'periodo_anterior'),
  'pend_agendamento_futuro', (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM pend_det WHERE cat = 'agendamento_futuro'),
  'pend_remarcacao_futura',  (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM pend_det WHERE cat = 'remarcacao_futura'),
  'pend_hoje',               (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM pend_det WHERE cat = 'hoje'),
  'outros_agendamentos', (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM outros),
  'pend_sem_resultado',      (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM pend_det WHERE cat = 'sem_resultado')
);
$function$;