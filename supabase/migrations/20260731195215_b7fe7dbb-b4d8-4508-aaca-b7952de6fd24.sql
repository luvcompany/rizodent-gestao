ALTER TABLE public.whatsapp_oauth_states
  ADD COLUMN IF NOT EXISTS coexistence boolean NOT NULL DEFAULT false;

ALTER TABLE public.whatsapp_numbers
  ADD COLUMN IF NOT EXISTS is_coexistence boolean NOT NULL DEFAULT false;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS from_device boolean NOT NULL DEFAULT false;

GRANT SELECT (id, tenant_id, phone_number_id, display_name, phone_e164, waba_id, app_id, is_active, is_default, is_coexistence, created_at, updated_at)
  ON public.whatsapp_numbers TO authenticated;