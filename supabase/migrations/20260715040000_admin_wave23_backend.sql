-- =============================================================================
-- Admin Wave 2/3 - Backend (métricas de plataforma, branding, faturas)
-- Idempotente e seguro. Todos os nomes de coluna foram confirmados no
-- information_schema do projeto (776b814b-ba0d-4aab-a78f-ae5953dabe2a).
-- Contratos: admin_platform_metrics, admin_all_tenants_usage,
--            get_tenant_by_slug (estendida), generate_tenant_invoices + cron.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Colunas de branding em tenants + trigger de branding_version
-- -----------------------------------------------------------------------------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS logo_dark_url text;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS branding_version int NOT NULL DEFAULT 1;

-- Incrementa branding_version sempre que qualquer cor/logo/favicon mudar.
CREATE OR REPLACE FUNCTION public.bump_tenant_branding_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF (COALESCE(NEW.primary_color,'')   IS DISTINCT FROM COALESCE(OLD.primary_color,''))
  OR (COALESCE(NEW.secondary_color,'') IS DISTINCT FROM COALESCE(OLD.secondary_color,''))
  OR (COALESCE(NEW.tertiary_color,'')  IS DISTINCT FROM COALESCE(OLD.tertiary_color,''))
  OR (COALESCE(NEW.logo_url,'')        IS DISTINCT FROM COALESCE(OLD.logo_url,''))
  OR (COALESCE(NEW.logo_dark_url,'')   IS DISTINCT FROM COALESCE(OLD.logo_dark_url,''))
  OR (COALESCE(NEW.favicon_url,'')     IS DISTINCT FROM COALESCE(OLD.favicon_url,''))
  THEN
    NEW.branding_version := COALESCE(OLD.branding_version, 1) + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_tenant_branding_version ON public.tenants;
CREATE TRIGGER trg_bump_tenant_branding_version
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_tenant_branding_version();

-- -----------------------------------------------------------------------------
-- 2a) RPC admin_platform_metrics() -> jsonb  (somente superadmin)
--     MRR = soma de plans.monthly_price das assinaturas ativas
--           (tenant_subscriptions.status='active') de tenants não deletados.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_platform_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _month_start timestamptz := date_trunc('month', now());
  _result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'superadmin'::app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'mrr', (
      SELECT COALESCE(SUM(COALESCE(p.monthly_price, ts.amount, 0)), 0)
      FROM public.tenant_subscriptions ts
      JOIN public.tenants t ON t.id = ts.tenant_id
      LEFT JOIN public.plans p ON p.id = ts.plan_id
      WHERE ts.status = 'active'
        AND t.deleted_at IS NULL
    ),
    'tenants_total',   (SELECT COUNT(*) FROM public.tenants),
    'clients_active',  (SELECT COUNT(*) FROM public.tenants WHERE status = 'active' AND deleted_at IS NULL),
    'clients_paused',  (SELECT COUNT(*) FROM public.tenants WHERE status = 'paused' AND deleted_at IS NULL),
    'clients_deleted', (SELECT COUNT(*) FROM public.tenants WHERE deleted_at IS NOT NULL),
    'users_total',     (SELECT COUNT(*) FROM public.profiles),
    'users_active_30d',(SELECT COUNT(*) FROM public.profiles WHERE last_login_at >= now() - interval '30 days'),
    'leads_month',     (SELECT COUNT(*) FROM public.crm_leads WHERE created_at >= _month_start),
    'messages_month',  (SELECT COUNT(*) FROM public.messages   WHERE created_at >= _month_start)
  )
  INTO _result;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_platform_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_platform_metrics() TO authenticated;

-- -----------------------------------------------------------------------------
-- 2b) RPC admin_all_tenants_usage() -> TABLE  (somente superadmin)
--     Uso por tenant + limites do plano da assinatura ativa mais recente.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_all_tenants_usage()
RETURNS TABLE(
  tenant_id     uuid,
  name          text,
  status        text,
  plan_name     text,
  user_limit    int,
  lead_limit    int,
  message_limit int,
  users         int,
  leads_month   int,
  messages_month int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _month_start timestamptz := date_trunc('month', now());
BEGIN
  IF NOT public.has_role(auth.uid(), 'superadmin'::app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    t.id AS tenant_id,
    t.name,
    t.status,
    p.name AS plan_name,
    p.user_limit,
    p.lead_limit,
    p.message_limit,
    (SELECT COUNT(*)::int FROM public.profiles pr WHERE pr.tenant_id = t.id) AS users,
    (SELECT COUNT(*)::int FROM public.crm_leads l
       WHERE l.tenant_id = t.id AND l.created_at >= _month_start) AS leads_month,
    (SELECT COUNT(*)::int FROM public.messages m
       WHERE m.tenant_id = t.id AND m.created_at >= _month_start) AS messages_month
  FROM public.tenants t
  LEFT JOIN LATERAL (
    SELECT ts.plan_id
    FROM public.tenant_subscriptions ts
    WHERE ts.tenant_id = t.id AND ts.status = 'active'
    ORDER BY ts.started_at DESC
    LIMIT 1
  ) sub ON true
  LEFT JOIN public.plans p ON p.id = sub.plan_id
  ORDER BY t.name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_all_tenants_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_all_tenants_usage() TO authenticated;

-- -----------------------------------------------------------------------------
-- 3) get_tenant_by_slug estendida
--    Mantém colunas atuais (id, slug, name, logo_url, primary_color) e
--    acrescenta secondary_color, tertiary_color, favicon_url, logo_dark_url,
--    branding_version.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_tenant_by_slug(text);
CREATE OR REPLACE FUNCTION public.get_tenant_by_slug(_slug text)
RETURNS TABLE(
  id               uuid,
  slug             text,
  name             text,
  logo_url         text,
  primary_color    text,
  secondary_color  text,
  tertiary_color   text,
  favicon_url      text,
  logo_dark_url    text,
  branding_version int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id, slug, name, logo_url, primary_color,
         secondary_color, tertiary_color, favicon_url, logo_dark_url, branding_version
  FROM public.tenants
  WHERE slug = _slug
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_tenant_by_slug(text) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) generate_tenant_invoices() idempotente + pg_cron mensal (dia 1)
-- -----------------------------------------------------------------------------

-- Índice único parcial garante idempotência real (base) e habilita ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_invoices_tenant_month_uidx
  ON public.tenant_invoices (tenant_id, reference_month);

CREATE OR REPLACE FUNCTION public.generate_tenant_invoices()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _ref_month date := date_trunc('month', now())::date;
  _inserted  int;
BEGIN
  INSERT INTO public.tenant_invoices (tenant_id, reference_month, amount, status)
  SELECT
    ts.tenant_id,
    _ref_month,
    COALESCE(p.monthly_price, ts.amount, 0),
    'open'
  FROM public.tenant_subscriptions ts
  JOIN public.tenants t ON t.id = ts.tenant_id
  LEFT JOIN public.plans p ON p.id = ts.plan_id
  WHERE ts.status = 'active'
    AND t.deleted_at IS NULL
  ON CONFLICT (tenant_id, reference_month) DO NOTHING;

  GET DIAGNOSTICS _inserted = ROW_COUNT;
  RETURN _inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_tenant_invoices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_tenant_invoices() TO authenticated;

-- Cron mensal: todo dia 1 às 03:00 (UTC). Reagenda de forma idempotente.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate_tenant_invoices_monthly') THEN
      PERFORM cron.unschedule('generate_tenant_invoices_monthly');
    END IF;
    PERFORM cron.schedule(
      'generate_tenant_invoices_monthly',
      '0 3 1 * *',
      $$SELECT public.generate_tenant_invoices();$$
    );
  END IF;
END;
$cron$;