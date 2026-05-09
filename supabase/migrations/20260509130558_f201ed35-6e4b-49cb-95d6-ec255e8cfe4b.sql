ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS secondary_color text NOT NULL DEFAULT '#fb923c',
  ADD COLUMN IF NOT EXISTS tertiary_color text NOT NULL DEFAULT '#fed7aa';