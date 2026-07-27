CREATE TABLE IF NOT EXISTS public.dontus_paciente_telefone (
  id_paciente_dontus integer PRIMARY KEY,
  telefone text NOT NULL,
  nome text,
  clinica_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.dontus_paciente_telefone TO service_role;
ALTER TABLE public.dontus_paciente_telefone ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.dontus_telefone_coverage (
  clinica_id uuid PRIMARY KEY,
  coberto_de date,
  coberto_ate date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.dontus_telefone_coverage TO service_role;
ALTER TABLE public.dontus_telefone_coverage ENABLE ROW LEVEL SECURITY;