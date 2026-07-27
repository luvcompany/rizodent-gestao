CREATE TABLE IF NOT EXISTS public.crm_stickers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  media_url text NOT NULL,
  label text,
  origem text NOT NULL DEFAULT 'recebida',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, media_url)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_stickers TO authenticated;
GRANT ALL ON public.crm_stickers TO service_role;

ALTER TABLE public.crm_stickers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='crm_stickers' AND policyname='crm_stickers_select') THEN
    CREATE POLICY crm_stickers_select ON public.crm_stickers FOR SELECT USING (tenant_id = current_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='crm_stickers' AND policyname='crm_stickers_insert') THEN
    CREATE POLICY crm_stickers_insert ON public.crm_stickers FOR INSERT WITH CHECK (tenant_id = current_tenant_id() AND auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='crm_stickers' AND policyname='crm_stickers_delete') THEN
    CREATE POLICY crm_stickers_delete ON public.crm_stickers FOR DELETE USING (tenant_id = current_tenant_id() AND auth.uid() IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_stickers_tenant ON public.crm_stickers (tenant_id, created_at DESC);