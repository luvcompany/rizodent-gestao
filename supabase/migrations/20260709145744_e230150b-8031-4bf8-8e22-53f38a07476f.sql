ALTER TABLE public.whatsapp_calls
  ADD COLUMN IF NOT EXISTS recording_url_agent TEXT,
  ADD COLUMN IF NOT EXISTS recording_url_lead TEXT;