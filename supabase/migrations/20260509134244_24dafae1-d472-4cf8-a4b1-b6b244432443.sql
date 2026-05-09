
-- 1) Tenant isolation for integrations
ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000010'::uuid;

UPDATE public.integrations SET tenant_id = '00000000-0000-0000-0000-000000000010'::uuid WHERE tenant_id IS NULL;

-- Drop global unique on key, recreate per-tenant
ALTER TABLE public.integrations DROP CONSTRAINT IF EXISTS integrations_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS integrations_tenant_key_uniq ON public.integrations (tenant_id, key);

DROP TRIGGER IF EXISTS trg_set_tenant_id ON public.integrations;
CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_default();

DROP POLICY IF EXISTS tenant_isolation ON public.integrations;
CREATE POLICY tenant_isolation ON public.integrations
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((tenant_id = current_tenant_id()) OR has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK ((tenant_id = current_tenant_id()) OR has_role(auth.uid(), 'superadmin'::app_role));

-- 2) Tenant isolation for tipos_procedimento
ALTER TABLE public.tipos_procedimento
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000010'::uuid;

UPDATE public.tipos_procedimento SET tenant_id = '00000000-0000-0000-0000-000000000010'::uuid WHERE tenant_id IS NULL;

DROP TRIGGER IF EXISTS trg_set_tenant_id ON public.tipos_procedimento;
CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.tipos_procedimento
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_default();

DROP POLICY IF EXISTS tenant_isolation ON public.tipos_procedimento;
CREATE POLICY tenant_isolation ON public.tipos_procedimento
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((tenant_id = current_tenant_id()) OR has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK ((tenant_id = current_tenant_id()) OR has_role(auth.uid(), 'superadmin'::app_role));
