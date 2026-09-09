CREATE OR REPLACE FUNCTION public.__aplica_migration_sdr(p_sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  EXECUTE p_sql;
END;
$fn$;
REVOKE ALL ON FUNCTION public.__aplica_migration_sdr(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.__aplica_migration_sdr(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.__aplica_migration_sdr(text) TO service_role;