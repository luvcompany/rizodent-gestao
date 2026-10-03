ALTER TABLE public._bkp_distribuido_em_20261003 ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        JOIN pg_extension e ON e.oid = d.refobjid
        WHERE d.objid = p.oid
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.oid::regprocedure);
  END LOOP;
END $$;

-- Telas públicas (login da clínica / marca) precisam destas duas sem login:
GRANT EXECUTE ON FUNCTION public.get_tenant_by_slug(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_branding(text) TO anon;