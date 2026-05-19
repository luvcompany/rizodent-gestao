
-- ============================================================
-- RENAME ROLE: admin -> crc (merge antigo crc para o mesmo papel)
-- ============================================================

-- 1) Liberar o nome 'crc' e renomear 'admin' -> 'crc'
ALTER TYPE public.app_role RENAME VALUE 'crc' TO 'crc_legacy';
ALTER TYPE public.app_role RENAME VALUE 'admin' TO 'crc';

-- 2) Recriar funções cujo corpo cita literal 'admin'/'crc' (parser re-executa o body a cada call)

CREATE OR REPLACE FUNCTION public.can_access_instagram_account(_account_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    _account_id IS NULL
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR has_role(auth.uid(), 'crc'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR COALESCE(
      public.user_override(auth.uid(), 'instagram_account', _account_id::text),
      true
    );
$function$;

CREATE OR REPLACE FUNCTION public.can_access_whatsapp_number(_number_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    _number_id IS NULL
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR has_role(auth.uid(), 'crc'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR COALESCE(
      public.user_override(auth.uid(), 'whatsapp_number', _number_id::text),
      true
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_user_primary_role(_user_id uuid)
 RETURNS app_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role FROM public.user_roles
   WHERE user_id = _user_id
   ORDER BY CASE role
     WHEN 'superadmin'  THEN 1
     WHEN 'crc'         THEN 2
     WHEN 'gerente'     THEN 3
     WHEN 'posvenda'    THEN 4
     WHEN 'crc_legacy'  THEN 5
     ELSE 99
   END
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.set_owner_role_from_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role public.app_role;
BEGIN
  IF NEW.owner_role IS NULL AND auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role
    FROM public.user_roles
    WHERE user_id = auth.uid()
    ORDER BY CASE role
      WHEN 'superadmin' THEN 1
      WHEN 'crc'        THEN 2
      WHEN 'gerente'    THEN 3
      WHEN 'posvenda'   THEN 4
      WHEN 'crc_legacy' THEN 5
      ELSE 99
    END
    LIMIT 1;
    NEW.owner_role := v_role;
  END IF;
  RETURN NEW;
END;
$function$;

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
    OR has_role(auth.uid(), 'crc'::app_role)
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

CREATE OR REPLACE FUNCTION public.can_access_pipeline(_pipeline_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    public.user_override(auth.uid(), 'pipeline', _pipeline_id::text),
    has_role(auth.uid(), 'superadmin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.crm_pipelines p
      WHERE p.id = _pipeline_id
        AND (
          (p.allowed_roles IS NULL
            AND (
              has_role(auth.uid(), 'crc'::app_role)
              OR has_role(auth.uid(), 'gerente'::app_role)
            ))
          OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = ANY(p.allowed_roles)
          )
        )
    )
  );
$function$;

-- 3) Atualizar policies que ainda referenciam 'crc_legacy' (eram refs ao antigo papel 'crc',
--    que agora foi mesclado com o admin → tudo passa a apontar para 'crc')
DO $$
DECLARE
  r RECORD;
  new_qual TEXT;
  new_check TEXT;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE qual LIKE '%crc_legacy%' OR with_check LIKE '%crc_legacy%'
  LOOP
    new_qual  := REPLACE(COALESCE(r.qual, ''),       'crc_legacy', 'crc');
    new_check := REPLACE(COALESCE(r.with_check, ''), 'crc_legacy', 'crc');

    IF r.qual IS NOT NULL AND r.with_check IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)',
                     r.policyname, r.schemaname, r.tablename, new_qual, new_check);
    ELSIF r.qual IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)',
                     r.policyname, r.schemaname, r.tablename, new_qual);
    ELSIF r.with_check IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)',
                     r.policyname, r.schemaname, r.tablename, new_check);
    END IF;
  END LOOP;
END $$;

-- 4) Atualizar valores armazenados em colunas tipadas com app_role:
--    qualquer linha que tivesse role='crc' (antigo) foi renomeada para 'crc_legacy'.
--    Mesclamos com o novo 'crc' (antigo admin).
UPDATE public.user_roles    SET role = 'crc' WHERE role = 'crc_legacy';
UPDATE public.bots          SET owner_role = 'crc' WHERE owner_role = 'crc_legacy';
UPDATE public.crm_broadcasts SET owner_role = 'crc' WHERE owner_role = 'crc_legacy';
UPDATE public.crm_appointments SET owner_role = 'crc' WHERE owner_role = 'crc_legacy';

-- crm_pipelines.allowed_roles é app_role[]; trocar 'crc_legacy' por 'crc' se existir
UPDATE public.crm_pipelines
   SET allowed_roles = (
     SELECT array_agg(DISTINCT CASE WHEN r = 'crc_legacy'::app_role THEN 'crc'::app_role ELSE r END)
     FROM unnest(allowed_roles) AS r
   )
 WHERE 'crc_legacy'::app_role = ANY(allowed_roles);
