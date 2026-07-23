-- Cache de pacientes Dontus vistos por clínica (histórico anterior a hoje).
-- Usado para classificar tipo (primeiro/recorrente) sem depender do CRClin.
CREATE TABLE IF NOT EXISTS public.dontus_paciente_seen (
  id BIGSERIAL PRIMARY KEY,
  id_paciente_dontus INTEGER NOT NULL,
  clinica_id UUID NOT NULL,
  primeira_data DATE NOT NULL,
  refreshed_on DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id_paciente_dontus, clinica_id)
);

GRANT ALL ON public.dontus_paciente_seen TO service_role;

ALTER TABLE public.dontus_paciente_seen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role manages dontus_paciente_seen"
  ON public.dontus_paciente_seen
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_dontus_paciente_seen_clinica_refreshed
  ON public.dontus_paciente_seen (clinica_id, refreshed_on);
