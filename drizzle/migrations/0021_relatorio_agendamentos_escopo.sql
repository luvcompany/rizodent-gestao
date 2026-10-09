-- Relatório de agendamentos no escopo de quem vê (09/10/2026).
--
-- relatorio_agendamentos e relatorio_agendamentos_detalhe são SECURITY
-- DEFINER e filtravam só pelo cliente: a SDR e a pós-venda recebiam o
-- relatório da clínica inteira e, pelo detalhe, nome e telefone de qualquer
-- lead (conferido: Bia e Neiriane recebiam exatamente o mesmo resultado da
-- CRC). Agora a gestão (superadmin, gerente, CRC) continua vendo o cliente
-- inteiro e os demais papéis só o próprio recorte (SDR: os leads dela;
-- pós-venda: funis de pós-venda; closer/recepção: números da equipe). No
-- detalhe, nome e telefone só de lead que quem chama enxerga
-- (conversa_lead_visivel). Continua DEFINER porque, como INVOKER, a RLS linha
-- a linha levava de 3 a 6,5 s.

CREATE OR REPLACE FUNCTION public.relatorio_agendamentos(_inicio date, _fim date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH escopo AS (
  -- Gestão (superadmin, gerente, CRC) vê o cliente inteiro; os demais papéis
  -- só os leads do seu recorte, a mesma régua da RLS em versão barata (a RLS
  -- linha a linha levava segundos): SDR = os leads dela; pós-venda = funis de
  -- pós-venda; closer/recepção = leads dos números da equipe dela.
  SELECT auth.uid() AS uid,
         public.has_role(auth.uid(), 'superadmin'::app_role)
      OR public.has_role(auth.uid(), 'gerente'::app_role)
      OR public.has_role(auth.uid(), 'crc'::app_role)
      OR public.has_role(auth.uid(), 'crc_legacy'::app_role) AS tudo,
         public.has_role(auth.uid(), 'sdr'::app_role) AS sdr,
         public.has_role(auth.uid(), 'posvenda'::app_role) AS posvenda,
         (public.has_role(auth.uid(), 'closer'::app_role) OR public.has_role(auth.uid(), 'recepcao'::app_role)) AS do_numero,
         ARRAY(SELECT w.id FROM public.whatsapp_numbers w
                WHERE w.tenant_id = public.current_tenant_id() AND public.can_access_whatsapp_number(w.id)) AS numeros
),
lv AS (
  SELECT l.id
    FROM crm_leads l, escopo e
   WHERE l.tenant_id = current_tenant_id()
     AND NOT e.tudo
     AND ((e.sdr AND l.assigned_to = e.uid)
       OR (e.posvenda AND l.pipeline_id IN (SELECT p.id FROM crm_pipelines p
                                             WHERE p.tenant_id = current_tenant_id() AND p.is_posvenda))
       OR (e.do_numero AND l.whatsapp_number_id = ANY (e.numeros)))
),
base AS (
  SELECT a.* FROM crm_appointments a
  WHERE a.tenant_id = current_tenant_id() AND a.lead_id IS NOT NULL
    AND ((SELECT tudo FROM escopo) OR a.lead_id IN (SELECT id FROM lv))
),
todas AS (
  SELECT b.id, b.lead_id, b.scheduled_date, b.scheduled_time, b.created_at, b.is_rescheduled,
    CASE WHEN b.status = 'cancelled' AND EXISTS (
      SELECT 1 FROM base x WHERE x.lead_id = b.lead_id AND x.id <> b.id AND x.status <> 'rescheduled'
        AND (x.scheduled_date, coalesce(x.scheduled_time,'00:00'::time), x.created_at)
          > (b.scheduled_date, coalesce(b.scheduled_time,'00:00'::time), b.created_at))
    THEN 'rescheduled' ELSE b.status END AS status
  FROM base b
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
      WHEN status = 'rescheduled' THEN 'remarcou'
      ELSE 'pendente' END AS res
  FROM primeiro WHERE scheduled_date BETWEEN _inicio AND _fim AND status <> 'rescheduled'
),
ap AS (SELECT * FROM todas WHERE scheduled_date BETWEEN _inicio AND _fim AND status <> 'rescheduled'),
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
  'chegaram', (SELECT count(*) FROM crm_leads l WHERE l.tenant_id = current_tenant_id()
                 AND (l.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _inicio AND _fim
                 AND ((SELECT tudo FROM escopo) OR l.id IN (SELECT id FROM lv))),
  'agendados',          (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM agd),
  'compareceram',       (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM agd WHERE res = 'compareceu'),
  'faltas',             (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM agd WHERE res = 'falta'),
  'agd_cancelados',     (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM agd WHERE res = 'cancelou'),
  'agd_remarcados',     (SELECT coalesce(jsonb_agg(lead_id), '[]') FROM agd WHERE res = 'remarcou'),
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

CREATE OR REPLACE FUNCTION public.relatorio_agendamentos_detalhe(_ids uuid[])
 RETURNS TABLE(lead_id uuid, nome text, telefone text, cidade text, servico text, origem text, responsavel text,
               primeiro date, ultima_remarcacao date, ultimo date, ultimo_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
    -- Nome e telefone só de lead que quem chama enxerga (gestão vê todos).
    AND (public.has_role(auth.uid(), 'superadmin'::app_role)
         OR public.has_role(auth.uid(), 'gerente'::app_role)
         OR public.has_role(auth.uid(), 'crc'::app_role)
         OR public.has_role(auth.uid(), 'crc_legacy'::app_role)
         OR public.conversa_lead_visivel(l))
  ORDER BY l.name;
$function$;
