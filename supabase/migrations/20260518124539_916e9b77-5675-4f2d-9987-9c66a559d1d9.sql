
-- 1) Access functions FIRST
CREATE OR REPLACE FUNCTION public.can_access_whatsapp_number(_number_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _number_id IS NULL
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR COALESCE(
      public.user_override(auth.uid(), 'whatsapp_number', _number_id::text),
      true
    );
$$;

CREATE OR REPLACE FUNCTION public.can_access_instagram_account(_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _account_id IS NULL
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR COALESCE(
      public.user_override(auth.uid(), 'instagram_account', _account_id::text),
      true
    );
$$;

-- 2) whatsapp_numbers table
CREATE TABLE public.whatsapp_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  phone_number_id text UNIQUE NOT NULL,
  display_name text,
  phone_e164 text,
  waba_id text,
  token text,
  app_id text,
  app_secret text,
  verify_token text,
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_numbers_tenant ON public.whatsapp_numbers(tenant_id);

ALTER TABLE public.whatsapp_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant select whatsapp_numbers"
ON public.whatsapp_numbers FOR SELECT TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND public.can_access_whatsapp_number(id)
);

CREATE POLICY "admin insert whatsapp_numbers"
ON public.whatsapp_numbers FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = current_tenant_id()
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role))
);

CREATE POLICY "admin update whatsapp_numbers"
ON public.whatsapp_numbers FOR UPDATE TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role))
);

CREATE POLICY "admin delete whatsapp_numbers"
ON public.whatsapp_numbers FOR DELETE TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role))
);

CREATE TRIGGER whatsapp_numbers_set_tenant
BEFORE INSERT ON public.whatsapp_numbers
FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_default();

CREATE TRIGGER whatsapp_numbers_updated_at
BEFORE UPDATE ON public.whatsapp_numbers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Add channel-routing columns
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS whatsapp_number_id uuid REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_whatsapp_number ON public.messages(whatsapp_number_id);

ALTER TABLE public.instagram_messages ADD COLUMN IF NOT EXISTS ig_account_uuid uuid REFERENCES public.ig_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_instagram_messages_ig_account_uuid ON public.instagram_messages(ig_account_uuid);

ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS whatsapp_number_id uuid REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS ig_account_uuid uuid REFERENCES public.ig_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_crm_leads_whatsapp_number ON public.crm_leads(whatsapp_number_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_ig_account_uuid ON public.crm_leads(ig_account_uuid);

-- 4) Backfill
UPDATE public.instagram_messages im
   SET ig_account_uuid = ia.id
  FROM public.ig_accounts ia
 WHERE im.ig_account_uuid IS NULL
   AND im.instagram_account_id = ia.ig_user_id;

UPDATE public.crm_leads l
   SET ig_account_uuid = sub.acc_id
  FROM (
    SELECT DISTINCT ON (im.lead_id) im.lead_id, ia.id AS acc_id
      FROM public.instagram_messages im
      JOIN public.ig_accounts ia ON ia.ig_user_id = im.instagram_account_id
     ORDER BY im.lead_id, im.created_at ASC
  ) sub
 WHERE l.ig_account_uuid IS NULL
   AND l.id = sub.lead_id;

-- 5) SELECT policies enforce channel access
DROP POLICY IF EXISTS "Authenticated users can view messages" ON public.messages;
CREATE POLICY "Authenticated users can view messages"
ON public.messages FOR SELECT TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND public.can_access_whatsapp_number(whatsapp_number_id)
);

DROP POLICY IF EXISTS "tenant view instagram_messages" ON public.instagram_messages;
CREATE POLICY "tenant view instagram_messages"
ON public.instagram_messages FOR SELECT TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND public.can_access_instagram_account(ig_account_uuid)
);

DROP POLICY IF EXISTS "Users can view assigned or own leads in allowed pipelines" ON public.crm_leads;
CREATE POLICY "Users can view assigned or own leads in allowed pipelines"
ON public.crm_leads FOR SELECT TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND public.can_access_pipeline(pipeline_id)
  AND public.can_access_whatsapp_number(whatsapp_number_id)
  AND public.can_access_instagram_account(ig_account_uuid)
);
