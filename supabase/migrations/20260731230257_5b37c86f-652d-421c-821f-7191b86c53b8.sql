-- ============================================================================
-- HARDENING 3/3 — Isolamento entre CLIENTES garantido por baixo, de uma vez.
-- ============================================================================
UPDATE public.crm_user_labels l
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE l.tenant_id IS NULL AND p.id = l.user_id;

UPDATE public.access_logs a
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE a.tenant_id IS NULL AND p.id = a.user_id;

UPDATE public.instagram_messages m
   SET tenant_id = l.tenant_id
  FROM public.crm_leads l
 WHERE m.tenant_id IS NULL AND l.id = m.lead_id;

ALTER TABLE public.crm_user_labels ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();

DO $$
DECLARE
  r record;
  pol text;
BEGIN
  FOR r IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema
       AND t.table_name = c.table_name
       AND t.table_type = 'BASE TABLE'
     WHERE c.column_name = 'tenant_id'
       AND c.table_schema = 'public'
       AND c.table_name NOT IN ('tenants', 'profiles')
  LOOP
    pol := 'tenant_hard_isolation_' || r.table_name;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, r.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (tenant_id = (SELECT public.current_tenant_id()) '
      || '       OR (SELECT public.has_role(auth.uid(), ''superadmin''::app_role))) '
      || 'WITH CHECK (tenant_id = (SELECT public.current_tenant_id()) '
      || '       OR (SELECT public.has_role(auth.uid(), ''superadmin''::app_role)))',
      pol, r.table_name);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='ig_accounts' AND column_name='access_token') THEN
    EXECUTE 'REVOKE SELECT ON public.ig_accounts FROM anon, authenticated';
    EXECUTE 'GRANT SELECT (id, tenant_id, ig_user_id, username, active, cidade, created_at, updated_at) ON public.ig_accounts TO authenticated';
  END IF;
END $$;

DROP POLICY IF EXISTS integrations_sem_segredo_no_app ON public.integrations;
CREATE POLICY integrations_sem_segredo_no_app ON public.integrations
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::app_role)
         OR public.has_role(auth.uid(), 'crc'::app_role));