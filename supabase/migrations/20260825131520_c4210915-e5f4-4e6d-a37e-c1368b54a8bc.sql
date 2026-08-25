ALTER TABLE public.clinicas
  ADD COLUMN IF NOT EXISTS id_clinica_dontus integer;

CREATE UNIQUE INDEX IF NOT EXISTS clinicas_tenant_dontus_uniq
  ON public.clinicas (tenant_id, id_clinica_dontus)
  WHERE id_clinica_dontus IS NOT NULL;