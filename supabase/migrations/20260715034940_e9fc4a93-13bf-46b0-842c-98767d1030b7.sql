
CREATE TABLE IF NOT EXISTS public.ad_account_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  ad_account_id text,
  ad_id_suffix text,
  page_id text,
  cidade text NOT NULL,
  clinica_id uuid REFERENCES public.clinicas(id),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_account_map_key_chk CHECK (ad_account_id IS NOT NULL OR ad_id_suffix IS NOT NULL OR page_id IS NOT NULL)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_account_map TO authenticated;
GRANT ALL ON public.ad_account_map TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS ad_account_map_acct_uq   ON public.ad_account_map(tenant_id, ad_account_id) WHERE ad_account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ad_account_map_suffix_uq ON public.ad_account_map(tenant_id, ad_id_suffix)  WHERE ad_id_suffix  IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ad_account_map_page_uq   ON public.ad_account_map(tenant_id, page_id)       WHERE page_id       IS NOT NULL;

ALTER TABLE public.ad_account_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ad_account_map_tenant_select" ON public.ad_account_map
  FOR SELECT
  USING (has_role(auth.uid(), 'superadmin'::app_role) OR (tenant_id = current_tenant_id()));

CREATE POLICY "tenant_isolation" ON public.ad_account_map
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

INSERT INTO public.ad_account_map (tenant_id, ad_id_suffix, cidade, clinica_id) VALUES
 ('00000000-0000-0000-0000-000000000010','0159','Vitória da Conquista',(SELECT id FROM public.clinicas WHERE tenant_id='00000000-0000-0000-0000-000000000010' AND nome='Rizodent VCA' LIMIT 1)),
 ('00000000-0000-0000-0000-000000000010','0541','Vitória da Conquista',(SELECT id FROM public.clinicas WHERE tenant_id='00000000-0000-0000-0000-000000000010' AND nome='Rizodent VCA' LIMIT 1)),
 ('00000000-0000-0000-0000-000000000010','0059','Ipiaú',              (SELECT id FROM public.clinicas WHERE tenant_id='00000000-0000-0000-0000-000000000010' AND nome='Rizodent Ipiaú' LIMIT 1)),
 ('00000000-0000-0000-0000-000000000010','0779','Itabuna',            (SELECT id FROM public.clinicas WHERE tenant_id='00000000-0000-0000-0000-000000000010' AND nome='Rizodent Itabuna' LIMIT 1)),
 ('00000000-0000-0000-0000-000000000010','0369','Guanambi',           (SELECT id FROM public.clinicas WHERE tenant_id='00000000-0000-0000-0000-000000000010' AND nome='Rizodent Guanambi' LIMIT 1)),
 ('00000000-0000-0000-0000-000000000010','0473','Guanambi',           (SELECT id FROM public.clinicas WHERE tenant_id='00000000-0000-0000-0000-000000000010' AND nome='Rizodent Guanambi' LIMIT 1))
ON CONFLICT DO NOTHING;

INSERT INTO public.ad_account_map (tenant_id, ad_account_id, cidade, clinica_id) VALUES
 ('00000000-0000-0000-0000-000000000010','1358661539637686','Vitória da Conquista',(SELECT id FROM public.clinicas WHERE tenant_id='00000000-0000-0000-0000-000000000010' AND nome='Rizodent VCA' LIMIT 1)),
 ('00000000-0000-0000-0000-000000000010','1078101193860950','Ipiaú',              (SELECT id FROM public.clinicas WHERE tenant_id='00000000-0000-0000-0000-000000000010' AND nome='Rizodent Ipiaú' LIMIT 1)),
 ('00000000-0000-0000-0000-000000000010','1372211167251754','Itabuna',            (SELECT id FROM public.clinicas WHERE tenant_id='00000000-0000-0000-0000-000000000010' AND nome='Rizodent Itabuna' LIMIT 1)),
 ('00000000-0000-0000-0000-000000000010','1812068386252657','Guanambi',           (SELECT id FROM public.clinicas WHERE tenant_id='00000000-0000-0000-0000-000000000010' AND nome='Rizodent Guanambi' LIMIT 1)),
 ('00000000-0000-0000-0000-000000000010','26704040889199708','Guanambi',          (SELECT id FROM public.clinicas WHERE tenant_id='00000000-0000-0000-0000-000000000010' AND nome='Rizodent Guanambi' LIMIT 1))
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.map_source_to_origem(src text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN src IS NULL OR btrim(src) = '' THEN 'Outros'
    WHEN lower(src) ~ '(facebook_ad|instagram_ad|fb_ad|_ad$|^ad$|an[uú]ncio)' THEN 'Anúncio'
    WHEN lower(src) ~ 'instagram' THEN 'Instagram'
    WHEN lower(src) ~ '(whatsapp|organic|orgânic|ligacao|ligação)' THEN 'Outros'
    WHEN lower(src) ~ '(^site|website)' THEN 'Site'
    WHEN lower(src) ~ 'indica' THEN 'Indicação'
    WHEN lower(src) ~ 'google' THEN 'Google Ads'
    ELSE COALESCE(NULLIF(btrim(src),''),'Outros')
  END;
$$;

UPDATE public.clinicas SET cidade='Vitória da Conquista'
 WHERE tenant_id='00000000-0000-0000-0000-000000000010' AND cidade IN ('VCA','Vca','vca');
