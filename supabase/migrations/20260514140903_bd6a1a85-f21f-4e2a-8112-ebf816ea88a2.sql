
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS meta_app_version text NOT NULL DEFAULT 'v2';

-- Rizodent permanece no app antigo (v1)
UPDATE public.tenants
   SET meta_app_version = 'v1'
 WHERE id = '00000000-0000-0000-0000-000000000010';

-- Helper para edge functions descobrirem rapidamente a versão do app
CREATE OR REPLACE FUNCTION public.get_tenant_meta_app_version(_tenant_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(meta_app_version, 'v2') FROM public.tenants WHERE id = _tenant_id LIMIT 1
$$;
