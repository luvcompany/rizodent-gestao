-- =============================================================================
-- LEITURAS QUE AS TELAS DO REDESIGN PEDEM (01/10/2026)
--
-- O redesign trouxe do CRM v2 telas que leem por duas funções que o banco do
-- CRClin não tinha. As duas são SÓ LEITURA, sobre o que o CRClin já guarda —
-- nenhuma regra, nenhum dado novo:
--
--   get_my_tenant_config()  — fuso e horário comercial do cliente
--                              (tenants.timezone / tenants.business_hours).
--                              Vocabulário e módulos voltam vazios: a tela usa
--                              os termos neutros e mostra todos os módulos.
--   kanban_contadores(funil) — os 5 selos do topo do Kanban. SECURITY INVOKER:
--                              conta com as permissões de quem chama, então a
--                              SDR conta só os leads que ela já enxerga — o
--                              mesmo recorte do quadro. "Lead novo" segue a
--                              régua do CRClin (source <> 'kommo', a conciliação
--                              não é lead novo — pedido da Julia em 22/09).
--
-- Sem kanban_contadores, os selos do topo ficavam em "—" para sempre: o v2, de
-- propósito, não conta só os 20 cards carregados por coluna.
--
-- Ensaio desfeito em produção (01/10): funil Outros, gestor total=414 (=contagem
-- direta), SDR Bia total=152 (=leads dela no funil), 475 ms sob RLS.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_my_tenant_config()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
           'tenant_id',                 t.id,
           'segment',                   NULL,
           'vocabulary',                '{}'::jsonb,
           'timezone',                  t.timezone,
           'business_hours',            t.business_hours,
           'business_hours_confirmado', t.business_hours IS NOT NULL,
           'modules',                   '{}'::jsonb)
    FROM public.tenants t
   WHERE t.id = public.current_tenant_id();
$function$;

REVOKE ALL ON FUNCTION public.get_my_tenant_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_tenant_config() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.kanban_contadores(p_pipeline uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  WITH fuso AS (
    -- rodizio_tz não é executável por usuário comum: o fuso vem da config.
    SELECT COALESCE(public.get_my_tenant_config()->>'timezone', 'America/Bahia') AS tz
  ),
  dia AS (
    SELECT (now() AT TIME ZONE fuso.tz)::date AS hoje, fuso.tz FROM fuso
  ),
  limites AS (
    SELECT (dia.hoje::timestamp AT TIME ZONE dia.tz)                       AS ini_hoje,
           ((dia.hoje + 1)::timestamp AT TIME ZONE dia.tz)                 AS ini_amanha,
           ((dia.hoje - 1)::timestamp AT TIME ZONE dia.tz)                 AS ini_ontem
      FROM dia
  ),
  l AS (
    SELECT id, stage_id, created_at, source
      FROM public.crm_leads
     WHERE pipeline_id = p_pipeline
  ),
  t AS (
    SELECT k.lead_id,
           (k.due_date < lim.ini_hoje)                                     AS atrasada,
           (k.due_date >= lim.ini_hoje AND k.due_date < lim.ini_amanha)    AS hoje
      FROM public.crm_tasks k, limites lim
     WHERE k.status <> 'done'
       AND k.lead_id IN (SELECT id FROM l)
  )
  SELECT jsonb_build_object(
    'por_etapa',       COALESCE((SELECT jsonb_object_agg(stage_id, n) FROM (SELECT stage_id, count(*) AS n FROM l GROUP BY stage_id) x), '{}'::jsonb),
    'total',           (SELECT count(*) FROM l),
    'com_tarefa_hoje', (SELECT count(DISTINCT lead_id) FROM t WHERE t.hoje),
    'tarefa_atrasada', (SELECT count(DISTINCT lead_id) FROM t WHERE t.atrasada),
    'sem_tarefa',      (SELECT count(*) FROM l WHERE NOT EXISTS (SELECT 1 FROM t WHERE t.lead_id = l.id)),
    'novos_hoje',      (SELECT count(*) FROM l, limites lim
                         WHERE l.created_at >= lim.ini_hoje AND l.created_at < lim.ini_amanha
                           AND (l.source IS NULL OR l.source <> 'kommo')),
    'novos_ontem',     (SELECT count(*) FROM l, limites lim
                         WHERE l.created_at >= lim.ini_ontem AND l.created_at < lim.ini_hoje
                           AND (l.source IS NULL OR l.source <> 'kommo'))
  );
$function$;

REVOKE ALL ON FUNCTION public.kanban_contadores(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kanban_contadores(uuid) TO authenticated, service_role;