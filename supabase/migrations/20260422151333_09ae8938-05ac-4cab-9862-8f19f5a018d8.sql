CREATE TABLE IF NOT EXISTS public.ad_id_mapping (
  ad_id text PRIMARY KEY,
  ad_account_id text,
  ad_account_name text,
  ad_name text,
  ad_headline text,
  ad_body text,
  cidade text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ad_id_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view ad_id_mapping"
  ON public.ad_id_mapping FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert ad_id_mapping"
  ON public.ad_id_mapping FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can update ad_id_mapping"
  ON public.ad_id_mapping FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_ad_id_mapping_account_id ON public.ad_id_mapping(ad_account_id);