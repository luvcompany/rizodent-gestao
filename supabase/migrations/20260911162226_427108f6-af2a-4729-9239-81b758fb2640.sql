CREATE OR REPLACE FUNCTION public.aplicar_migracao_texto(p_sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  EXECUTE p_sql;
END $fn$;

REVOKE ALL ON FUNCTION public.aplicar_migracao_texto(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_migracao_texto(text) TO sandbox_exec;