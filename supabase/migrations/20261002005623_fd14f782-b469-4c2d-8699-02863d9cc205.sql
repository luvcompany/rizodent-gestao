-- =============================================================================
-- MARCA DO CRCLIN PARA O CÓDIGO NOVO (01/10/2026)
--
-- O redesign trouxe do v2 o BrandContext, que lê a marca por
-- `get_public_branding` e INJETA um <style id="brand-theme"> em cima dos
-- tokens do CSS. Sem essa função aqui, o front caía no padrão de fábrica do
-- v2: azul (#2563eb) e a logo do CRClin no lugar da logo do cliente — foi o
-- que apareceu na tela ("ficou azul", "tirou até a logo da Rizo").
--
-- Os dados corretos JÁ estavam no banco: tenants.primary_color = #f97316 (o
-- laranja da Rizodent), secondary_color = #fb923c e a logo em
-- tenant-logos/.../logo-rizodent.webp. Faltava só quem os servisse.
--
-- Esta versão é enxuta de propósito: o v2 é multi-cliente e lê `system_settings`
-- e uma dúzia de colunas de personalização que aqui não existem. O CRClin tem
-- um cliente, então `system` volta nulo (o front usa o padrão CRClin no que
-- faltar) e `tenant` traz o que a tabela realmente tem; o resto vai nulo, e o
-- front já sabe cair no padrão.
-- =============================================================================

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
               'font_family',        NULL,
               'radius_px',          NULL,
               'login_title',        NULL,
               'login_subtitle',     NULL,
               'login_footer',       NULL,
               'login_bg_url',       NULL,
               -- Sem "Powered by": aqui o produto é o próprio CRClin.
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

COMMENT ON FUNCTION public.get_public_branding(text) IS
  'Marca servida ao front (logo e cores do cliente). Sem ela o tema cai no padrão azul do v2.';