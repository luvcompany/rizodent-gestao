
-- Drop listing policies on public buckets entirely.
DROP POLICY IF EXISTS "Authenticated can list avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can list tenant-logos" ON storage.objects;

-- Sweep: revoke EXECUTE on all SECURITY DEFINER functions in public schema.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated;',
                   r.nspname, r.proname, r.args);
  END LOOP;
END $$;

-- Re-grant only the branding lookup function (used by anonymous landing pages).
GRANT EXECUTE ON FUNCTION public.get_tenant_by_slug(text) TO anon, authenticated;
