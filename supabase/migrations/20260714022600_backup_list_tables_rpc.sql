-- ==========================================================================
-- RPC de apoio ao backup lógico diário (edge function daily-backup).
-- Lista as tabelas base do schema public + uma coluna estável de ordenação
-- (id > created_at > nenhuma) para paginação consistente do export.
-- Restrita ao service_role (a edge function roda com service key).
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.backup_list_tables()
RETURNS TABLE(table_name text, order_col text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.relname::text AS table_name,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns col
         WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'id'
      ) THEN 'id'
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns col
         WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'created_at'
      ) THEN 'created_at'
      ELSE NULL
    END AS order_col
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r';
$$;

REVOKE ALL ON FUNCTION public.backup_list_tables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backup_list_tables() TO service_role;
