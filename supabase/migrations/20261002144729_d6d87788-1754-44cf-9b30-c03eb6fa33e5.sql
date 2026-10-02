CREATE OR REPLACE FUNCTION public.relatorio_agendamentos(_inicio date, _fim date)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
WITH todas AS (
  SELECT a.* FROM crm_appointments a
  WHERE a.tenant_id = current_tenant_id() AND a.lead_id IS NOT NULL
),
-- Primeiro agendamento cronológico de cada lead.
primeiro AS (
  SELECT DISTINCT ON (lead_id) lead_id, status, scheduled_date
  FROM todas WHERE NOT is_rescheduled
  ORDER BY lead_id, scheduled_date, scheduled_time NULLS LAST, created_at
),
-- Bloco 1: só o resultado do primeiro agendamento.
agd AS (
  SELECT lead_id, CASE
      WHEN status IN ('contracted','not_contracted') THEN 'compareceu'
      WHEN status = 'no_show' THEN 'falta'
      WHEN status = 'cancelled' THEN 'cancelou'
      ELSE 'pendente' END AS res
  FROM primeiro WHERE scheduled_date BETWEEN _inicio AND _fim
),
-- Consultas que valem no período (as movidas para outra data não contam aqui).
ap AS (SELECT * FROM todas WHERE scheduled_date BETWEEN _inicio AND _fim AND status <> 'rescheduled'),
-- Jornada a partir do início do período (inclui consultas futuras, depois do período).
jor AS (SELECT * FROM todas WHERE scheduled_date >= _inicio AND status <> 'rescheduled'),
res_geral AS (
  SELECT j.lead_id,
    CASE WHEN bool_or(j.status IN ('contracted','not_contracted')) THEN 'compareceu'
      ELSE CASE (array_agg(j.status ORDER BY j.scheduled_date DESC, j.scheduled_time DESC NULLS LAST, j.created_at DESC))[1]
        WHEN 'no_show' THEN 'falta' WHEN 'cancelled' THEN 'cancelou' ELSE 'pendente' END
    END AS res,
    (array_agg(j.scheduled_date ORDER BY j.scheduled_date DESC, j.scheduled_time DESC NULLS LAST, j.created_at DESC))[1] AS ult_data,
    (array_agg(j.is_rescheduled ORDER BY j.scheduled_date DESC, j.scheduled_time DESC NULLS LAST, j.created_at DESC))[1] AS ult_rem
  FROM jor j WHERE j.lead_id IN (SELECT lead_id FROM ap)
  GROUP BY j.lead_id
),
res_rem AS (
  SELECT j.lead_id,
    CASE WHEN bool_or(j.status IN ('contracted','not_contracted')) THEN 'compareceu'
      ELSE CASE (array_agg(j.status ORDER BY j.scheduled_date DESC, j.scheduled_time DESC NULLS LAST, j.created_at DESC))[1]
        WHEN 'no_show' THEN 'falta' WHEN 'cancelled' THEN 'cancelou' ELSE 'pendente' END
    END AS res
  FROM jor j WHERE j.is_rescheduled AND j.lead_id IN (SELECT lead_id FROM ap WHERE is_rescheduled)
  GROUP BY j.lead_id
),
-- Detalhe das faltas do Geral.
faltas_det AS (
  SELECT g.lead_id, CASE
      WHEN NOT EXISTS (SELECT 1 FROM todas t WHERE t.lead_id = g.lead_id AND t.is_rescheduled) THEN 'sem_remarcacao'
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
  'pend_sem_resultado',      (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM pend_det WHERE cat = 'sem_resultado')
);
$function$;

CREATE OR REPLACE FUNCTION public.relatorio_agendamentos_detalhe(_ids uuid[])
 RETURNS TABLE(lead_id uuid, nome text, telefone text, cidade text, servico text, origem text, responsavel text,
               primeiro date, ultima_remarcacao date, ultimo date, ultimo_status text)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT l.id, l.name, l.phone, l.cidade, l.servico_interesse, l.source, pr.nome,
    (SELECT min(a.scheduled_date) FROM crm_appointments a WHERE a.lead_id = l.id AND NOT a.is_rescheduled),
    (SELECT max(a.scheduled_date) FROM crm_appointments a WHERE a.lead_id = l.id AND a.is_rescheduled AND a.status <> 'rescheduled'),
    u.scheduled_date, u.status
  FROM crm_leads l
  LEFT JOIN profiles pr ON pr.id = l.assigned_to
  LEFT JOIN LATERAL (
    SELECT a.scheduled_date, a.status FROM crm_appointments a
    WHERE a.lead_id = l.id AND a.status <> 'rescheduled'
    ORDER BY a.scheduled_date DESC, a.scheduled_time DESC NULLS LAST, a.created_at DESC LIMIT 1
  ) u ON true
  WHERE l.id = ANY(_ids) AND l.tenant_id = current_tenant_id()
  ORDER BY l.name;
$function$;
GRANT EXECUTE ON FUNCTION public.relatorio_agendamentos_detalhe(uuid[]) TO authenticated;