-- Multi-tenant Meta credentials table
CREATE TABLE IF NOT EXISTS public.tenant_meta_credentials (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- WhatsApp
  whatsapp_app_id text,
  whatsapp_app_secret text,
  whatsapp_token text,
  whatsapp_phone_number_id text,
  whatsapp_waba_id text,
  whatsapp_verify_token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  whatsapp_enabled boolean NOT NULL DEFAULT false,
  -- Instagram / Meta
  meta_app_id text,
  meta_app_secret text,
  instagram_app_secret text,
  instagram_verify_token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  instagram_redirect_uri text,
  instagram_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_meta_credentials ENABLE ROW LEVEL SECURITY;

-- Lookup indexes for resolving tenant from webhook payload
CREATE INDEX IF NOT EXISTS idx_tenant_meta_creds_phone_number_id
  ON public.tenant_meta_credentials(whatsapp_phone_number_id)
  WHERE whatsapp_phone_number_id IS NOT NULL;

-- RLS: only tenant admin or superadmin can read/write
DROP POLICY IF EXISTS "tmc_admin_select" ON public.tenant_meta_credentials;
CREATE POLICY "tmc_admin_select"
ON public.tenant_meta_credentials
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'superadmin')
  OR (
    tenant_id = public.current_tenant_id()
    AND public.has_role(auth.uid(), 'admin')
  )
);

DROP POLICY IF EXISTS "tmc_admin_insert" ON public.tenant_meta_credentials;
CREATE POLICY "tmc_admin_insert"
ON public.tenant_meta_credentials
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'superadmin')
  OR (
    tenant_id = public.current_tenant_id()
    AND public.has_role(auth.uid(), 'admin')
  )
);

DROP POLICY IF EXISTS "tmc_admin_update" ON public.tenant_meta_credentials;
CREATE POLICY "tmc_admin_update"
ON public.tenant_meta_credentials
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'superadmin')
  OR (
    tenant_id = public.current_tenant_id()
    AND public.has_role(auth.uid(), 'admin')
  )
);

DROP POLICY IF EXISTS "tmc_admin_delete" ON public.tenant_meta_credentials;
CREATE POLICY "tmc_admin_delete"
ON public.tenant_meta_credentials
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'superadmin')
  OR (
    tenant_id = public.current_tenant_id()
    AND public.has_role(auth.uid(), 'admin')
  )
);

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_tenant_meta_credentials_updated_at ON public.tenant_meta_credentials;
CREATE TRIGGER trg_tenant_meta_credentials_updated_at
BEFORE UPDATE ON public.tenant_meta_credentials
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helper for edge functions: resolve tenant by slug (already exists as get_tenant_by_slug)
-- Add helper to resolve tenant by WhatsApp phone_number_id
CREATE OR REPLACE FUNCTION public.get_tenant_by_whatsapp_phone_number_id(_phone_number_id text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.tenant_meta_credentials
   WHERE whatsapp_phone_number_id = _phone_number_id
     AND whatsapp_enabled = true
   LIMIT 1
$$;