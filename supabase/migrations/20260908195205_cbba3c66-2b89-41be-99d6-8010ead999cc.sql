CREATE OR REPLACE FUNCTION public.apply_migration_chunk(chunk_num int, sql_text text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  EXECUTE sql_text;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_migration_chunk(int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_migration_chunk(int, text) TO service_role;