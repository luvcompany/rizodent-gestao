ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS health_status text,
  ADD COLUMN IF NOT EXISTS health_reason text,
  ADD COLUMN IF NOT EXISTS health_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS meta_status text,
  ADD COLUMN IF NOT EXISTS quality_rating text;