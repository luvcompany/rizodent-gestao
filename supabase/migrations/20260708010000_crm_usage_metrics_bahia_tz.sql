-- ============================================================================
-- crm_usage_metrics: correções da auditoria de relatórios (defeitos #4 e #8)
-- ============================================================================
-- Defeito #4 (timezone): a versão anterior interpretava p_from/p_to no fuso da
-- sessão (UTC) e agrupava com date_trunc(v_trunc, <timestamptz>) também em UTC.
-- Resultado: bordas do período deslocadas 3h e ~5% das execuções agrupadas no
-- dia local errado. Decisão canônica: datas SEMPRE em America/Bahia (UTC-3,
-- sem horário de verão) — fronteiras do período e buckets calculados no dia
-- local, com o último dia incluído por inteiro.
--   * Fronteiras: [p_from 00:00, (p_to + 1) 00:00) no horário da Bahia.
--   * Buckets: date_trunc(v_trunc, <coluna> AT TIME ZONE 'America/Bahia'),
--     que produz timestamp local SEM offset (ex.: "2026-07-01T00:00:00" no
--     JSON). O front (bucketDia em CrmMetricas.tsx) já aceita esse formato.
--
-- Defeito #8 (filtro de tenant frouxo): bot_data e ia_good filtravam com
-- (X.tenant_id = v_tenant OR l.tenant_id = v_tenant), permitindo que linhas
-- de outro tenant entrassem via lead. Agora o filtro é estrito pela própria
-- tabela (b.tenant_id / g.tenant_id) e os LEFT JOINs em crm_leads, que só
-- existiam para o OR, foram removidos.
--
-- A assinatura, o shape do retorno e o contrato de erro ({"error":"no_tenant"})
-- permanecem os mesmos — nenhuma mudança é necessária nos chamadores.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crm_usage_metrics(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  -- Período inclusivo no fuso America/Bahia: [p_from 00:00 -03, (p_to + 1) 00:00 -03)
  v_from timestamptz := p_from::timestamp AT TIME ZONE 'America/Bahia';
  v_to   timestamptz := (p_to + 1)::timestamp AT TIME ZONE 'America/Bahia';
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
           date_trunc(v_trunc, be.started_at AT TIME ZONE 'America/Bahia') AS mes,
           count(*) AS total,
           count(*) FILTER (WHERE be.status='completed') AS concluidos
    FROM public.bot_executions be
    JOIN public.bots b ON b.id = be.bot_id
    WHERE be.started_at >= v_from AND be.started_at < v_to
      AND b.tenant_id = v_tenant
    GROUP BY 1,2
    ORDER BY 2,1
  ),
  ia_analysis AS (
    SELECT date_trunc(v_trunc, a.created_at AT TIME ZONE 'America/Bahia') AS mes,
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
    SELECT date_trunc(v_trunc, s.created_at AT TIME ZONE 'America/Bahia') AS mes,
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
    SELECT date_trunc(v_trunc, m.created_at AT TIME ZONE 'America/Bahia') AS mes,
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
    SELECT date_trunc(v_trunc, g.created_at AT TIME ZONE 'America/Bahia') AS mes,
           'good_example'::text AS mode,
           count(*) AS total,
           count(DISTINCT g.lead_id) AS leads
    FROM public.ai_good_examples g
    WHERE g.created_at >= v_from AND g.created_at < v_to
      AND g.tenant_id = v_tenant
    GROUP BY 1
  ),
  ia_data AS (
    SELECT * FROM ia_analysis
    UNION ALL SELECT * FROM ia_suggestions
    UNION ALL SELECT * FROM ia_transcriptions
    UNION ALL SELECT * FROM ia_good
  ),
  auto_data AS (
    SELECT date_trunc(v_trunc, q.created_at AT TIME ZONE 'America/Bahia') AS mes,
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
    SELECT date_trunc(v_trunc, created_at AT TIME ZONE 'America/Bahia') AS mes,
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
