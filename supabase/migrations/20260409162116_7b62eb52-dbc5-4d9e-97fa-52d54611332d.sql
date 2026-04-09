
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS ad_account_id text,
  ADD COLUMN IF NOT EXISTS ad_account_name text;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS ad_account_id text,
  ADD COLUMN IF NOT EXISTS ad_account_name text;
