CREATE OR REPLACE FUNCTION public.relatorio_sdr_blocos(p_de date, p_ate date)
RETURNS TABLE(user_id uuid, blocos jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
WITH base AS (
  SELECT a.* FROM crm_appointments a
  WHERE a.tenant_id = current_tenant_id() AND a.lead_id IS NOT NULL
),
todas AS (
  SELECT b.id, b.lead_id, b.scheduled_date, b.scheduled_time, b.created_at, b.responsavel_credito_id AS sdr,
    CASE WHEN b.status = 'cancelled' AND EXISTS (
      SELECT 1 FROM base x WHERE x.lead_id = b.lead_id AND x.id <> b.id AND x.status <> 'rescheduled'
        AND (x.scheduled_date, coalesce(x.scheduled_time,'00:00'::time), x.created_at)
          > (b.scheduled_date, coalesce(b.scheduled_time,'00:00'::time), b.created_at))
    THEN 'rescheduled' ELSE b.status END AS status
  FROM base b
),
primeiro AS (
  SELECT DISTINCT ON (lead_id) lead_id, id, status, scheduled_date, sdr
  FROM todas ORDER BY lead_id, scheduled_date, scheduled_time NULLS LAST, created_at
),
sdrs AS (
  SELECT DISTINCT r.user_id FROM user_roles r
  WHERE r.role = 'sdr' AND (is_gestor_equipe() OR r.user_id = auth.uid())
),
agd AS (
  SELECT sdr, lead_id, CASE
    WHEN status IN ('contracted','not_contracted') THEN 'compareceu'
    WHEN status = 'no_show' THEN 'falta'
    WHEN status = 'cancelled' THEN 'cancelou'
    WHEN status = 'rescheduled' THEN 'remarcou'
    ELSE 'pendente' END AS res
  FROM primeiro WHERE scheduled_date BETWEEN p_de AND p_ate AND sdr IN (SELECT user_id FROM sdrs)
),
ap AS (
  SELECT * FROM todas WHERE scheduled_date BETWEEN p_de AND p_ate AND status <> 'rescheduled'
    AND sdr IN (SELECT user_id FROM sdrs)
),
fim AS (
  SELECT j.sdr, j.lead_id, (j.id <> p.id) AS eh_rem,
    j.status, j.scheduled_date, j.scheduled_time, j.created_at
  FROM ap j JOIN primeiro p ON p.lead_id = j.lead_id
),
res_geral AS (
  SELECT sdr, lead_id,
    CASE WHEN bool_or(status IN ('contracted','not_contracted')) THEN 'compareceu'
      ELSE CASE (array_agg(status ORDER BY scheduled_date DESC, scheduled_time DESC NULLS LAST, created_at DESC))[1]
        WHEN 'no_show' THEN 'falta' WHEN 'cancelled' THEN 'cancelou' ELSE 'pendente' END END AS res,
    bool_or(status = 'contracted') AS contratou
  FROM fim GROUP BY sdr, lead_id
),
res_rem AS (
  SELECT sdr, lead_id,
    CASE WHEN bool_or(status IN ('contracted','not_contracted')) THEN 'compareceu'
      ELSE CASE (array_agg(status ORDER BY scheduled_date DESC, scheduled_time DESC NULLS LAST, created_at DESC))[1]
        WHEN 'no_show' THEN 'falta' WHEN 'cancelled' THEN 'cancelou' ELSE 'pendente' END END AS res
  FROM fim WHERE eh_rem GROUP BY sdr, lead_id
)
SELECT s.user_id, jsonb_build_object(
  'agd',            (SELECT coalesce(jsonb_agg(lead_id),'[]') FROM agd WHERE sdr = s.user_id),
  'agd_compareceu', (SELECT coalesce(jsonb_agg(lead_id),'[]') FROM agd WHERE sdr = s.user_id AND res='compareceu'),
  'agd_falta',      (SELECT coalesce(jsonb_agg(lead_id),'[]') FROM agd WHERE sdr = s.user_id AND res='falta'),
  'agd_cancelou',   (SELECT coalesce(jsonb_agg(lead_id),'[]') FROM agd WHERE sdr = s.user_id AND res='cancelou'),
  'agd_pendente',   (SELECT coalesce(jsonb_agg(lead_id),'[]') FROM agd WHERE sdr = s.user_id AND res='pendente'),
  'agd_remarcou',   (SELECT coalesce(jsonb_agg(lead_id),'[]') FROM agd WHERE sdr = s.user_id AND res='remarcou'),
  'rem',            (SELECT coalesce(jsonb_agg(lead_id),'[]') FROM res_rem WHERE sdr = s.user_id),
  'rem_compareceu', (SELECT coalesce(jsonb_agg(lead_id),'[]') FROM res_rem WHERE sdr = s.user_id AND res='compareceu'),
  'rem_falta',      (SELECT coalesce(jsonb_agg(lead_id),'[]') FROM res_rem WHERE sdr = s.user_id AND res='falta'),
  'rem_cancelou',   (SELECT coalesce(jsonb_agg(lead_id),'[]') FROM res_rem WHERE sdr = s.user_id AND res='cancelou'),
  'rem_pendente',   (SELECT coalesce(jsonb_agg(lead_id),'[]') FROM res_rem WHERE sdr = s.user_id AND res='pendente'),
  'ger',            (SELECT coalesce(jsonb_agg(lead_id),'[]') FROM res_geral WHERE sdr = s.user_id),
  'ger_compareceu', (SELECT coalesce(jsonb_agg(lead_id),'[]') FROM res_geral WHERE sdr = s.user_id AND res='compareceu'),
  'ger_falta',      (SELECT coalesce(jsonb_agg(lead_id),'[]') FROM res_geral WHERE sdr = s.user_id AND res='falta'),
  'ger_cancelou',   (SELECT coalesce(jsonb_agg(lead_id),'[]') FROM res_geral WHERE sdr = s.user_id AND res='cancelou'),
  'ger_pendente',   (SELECT coalesce(jsonb_agg(lead_id),'[]') FROM res_geral WHERE sdr = s.user_id AND res='pendente'),
  'contratados',    (SELECT coalesce(jsonb_agg(lead_id),'[]') FROM res_geral WHERE sdr = s.user_id AND contratou)
) FROM sdrs s;
$f$;
REVOKE ALL ON FUNCTION public.relatorio_sdr_blocos(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_sdr_blocos(date,date) TO authenticated;