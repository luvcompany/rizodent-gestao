CREATE TABLE IF NOT EXISTS public.dontus_seen_coverage (
  clinica_id UUID PRIMARY KEY REFERENCES public.clinicas(id) ON DELETE CASCADE,
  coberto_de DATE,
  coberto_ate DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.dontus_seen_coverage TO authenticated;
GRANT ALL ON public.dontus_seen_coverage TO service_role;
ALTER TABLE public.dontus_seen_coverage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coverage superadmin read" ON public.dontus_seen_coverage
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'superadmin'::app_role));