
-- Add first_inbound_at to crm_leads
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS first_inbound_at timestamptz;

-- Add from_stage_id to crm_lead_stage_history
ALTER TABLE public.crm_lead_stage_history ADD COLUMN IF NOT EXISTS from_stage_id uuid REFERENCES public.crm_stages(id);

-- Backfill first_inbound_at from existing messages
UPDATE public.crm_leads l
SET first_inbound_at = sub.first_msg
FROM (
  SELECT lead_id, MIN(created_at) as first_msg
  FROM public.messages
  WHERE direction = 'inbound'
  GROUP BY lead_id
) sub
WHERE l.id = sub.lead_id AND l.first_inbound_at IS NULL;
