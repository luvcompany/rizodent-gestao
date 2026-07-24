CREATE TABLE public.dontus_dedup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  date_de date NOT NULL,
  date_ate date NOT NULL,
  dry_run boolean NOT NULL DEFAULT true,
  pares_encontrados int NOT NULL DEFAULT 0,
  fundidos int NOT NULL DEFAULT 0,
  ambiguos int NOT NULL DEFAULT 0,
  erros int NOT NULL DEFAULT 0,
  detalhes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.dontus_dedup_runs TO authenticated;
GRANT ALL ON public.dontus_dedup_runs TO service_role;

ALTER TABLE public.dontus_dedup_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Superadmins can view dedup runs"
ON public.dontus_dedup_runs FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'superadmin'));

CREATE INDEX idx_dontus_dedup_runs_created ON public.dontus_dedup_runs (created_at DESC);