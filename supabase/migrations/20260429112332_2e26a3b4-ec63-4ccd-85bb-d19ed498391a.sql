ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS blocked_by uuid;

CREATE INDEX IF NOT EXISTS idx_crm_leads_is_blocked ON public.crm_leads (is_blocked) WHERE is_blocked = true;