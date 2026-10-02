CREATE OR REPLACE FUNCTION public.rodizio_fonte_excluida(p_source text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public
AS $function$
  -- Exclui o Direct/Instagram Lite. Lead de anúncio do Instagram que chega
  -- pelo WhatsApp (instagram_ad) entra no rodízio normalmente.
  SELECT p_source IS NOT NULL AND (
    (lower(btrim(p_source)) LIKE 'instagram%' AND lower(btrim(p_source)) <> 'instagram_ad')
    OR lower(btrim(p_source)) IN ('kommo', 'import', 'importacao', 'importação', 'dontus_agenda', 'retroativo'));
$function$;