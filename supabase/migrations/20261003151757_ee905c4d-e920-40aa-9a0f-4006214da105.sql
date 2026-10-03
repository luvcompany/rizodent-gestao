DO $$ DECLARE r record; BEGIN
FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prorettype='trigger'::regtype LOOP
EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.f);
END LOOP; END $$;