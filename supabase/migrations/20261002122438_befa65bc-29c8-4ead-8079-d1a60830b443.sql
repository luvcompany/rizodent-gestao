ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS action_color text;

CREATE OR REPLACE FUNCTION public.bump_tenant_branding_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF (COALESCE(NEW.primary_color,'')   IS DISTINCT FROM COALESCE(OLD.primary_color,''))
  OR (COALESCE(NEW.secondary_color,'') IS DISTINCT FROM COALESCE(OLD.secondary_color,''))
  OR (COALESCE(NEW.tertiary_color,'')  IS DISTINCT FROM COALESCE(OLD.tertiary_color,''))
  OR (COALESCE(NEW.action_color,'')    IS DISTINCT FROM COALESCE(OLD.action_color,''))
  OR (COALESCE(NEW.logo_url,'')        IS DISTINCT FROM COALESCE(OLD.logo_url,''))
  OR (COALESCE(NEW.logo_dark_url,'')   IS DISTINCT FROM COALESCE(OLD.logo_dark_url,''))
  OR (COALESCE(NEW.favicon_url,'')     IS DISTINCT FROM COALESCE(OLD.favicon_url,''))
  THEN
    NEW.branding_version := COALESCE(OLD.branding_version, 1) + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_branding(_slug text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'system', NULL,
    'tenant', (
      SELECT jsonb_build_object(
               'id',                 t.id,
               'slug',               t.slug,
               'status',             COALESCE(t.status, 'active'),
               'name',               t.name,
               'logo_url',           t.logo_url,
               'logo_dark_url',      t.logo_dark_url,
               'favicon_url',        t.favicon_url,
               'primary_color',      t.primary_color,
               'primary_color_dark', NULL,
               'secondary_color',    t.secondary_color,
               'action_color',       t.action_color,
               'font_family',        NULL,
               'radius_px',          NULL,
               'login_title',        NULL,
               'login_subtitle',     NULL,
               'login_footer',       NULL,
               'login_bg_url',       NULL,
               'hide_system_brand',  true,
               'version',            COALESCE(t.branding_version, 1))
        FROM public.tenants t
       WHERE (_slug IS NULL OR t.slug = _slug)
       ORDER BY (t.slug = COALESCE(_slug, t.slug)) DESC
       LIMIT 1
    ));
$function$;

REVOKE ALL ON FUNCTION public.get_public_branding(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_branding(text) TO anon, authenticated, service_role;

COMMENT ON COLUMN public.tenants.action_color IS
  'Cor específica dos botões de ação e abas ativas; NULL herda primary_color.';