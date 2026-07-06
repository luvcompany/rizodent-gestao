
CREATE TABLE public.tenant_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  api_key text NOT NULL UNIQUE,
  name text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_api_keys TO authenticated;
GRANT ALL ON public.tenant_api_keys TO service_role;

ALTER TABLE public.tenant_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Superadmins can select tenant_api_keys"
  ON public.tenant_api_keys FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

CREATE POLICY "Superadmins can insert tenant_api_keys"
  ON public.tenant_api_keys FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'));

CREATE POLICY "Superadmins can update tenant_api_keys"
  ON public.tenant_api_keys FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'));

CREATE POLICY "Superadmins can delete tenant_api_keys"
  ON public.tenant_api_keys FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

CREATE INDEX idx_tenant_api_keys_tenant ON public.tenant_api_keys(tenant_id);
CREATE INDEX idx_tenant_api_keys_active ON public.tenant_api_keys(api_key) WHERE active = true;
