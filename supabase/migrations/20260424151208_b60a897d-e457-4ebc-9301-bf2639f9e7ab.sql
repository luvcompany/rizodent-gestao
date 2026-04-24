-- Add especialidade column to pagamentos for specialty-based payment tracking
ALTER TABLE public.pagamentos ADD COLUMN IF NOT EXISTS especialidade text;

-- Make tratamento_id optional so payments can be registered by specialty without a procedure
ALTER TABLE public.pagamentos ALTER COLUMN tratamento_id DROP NOT NULL;

-- Backfill especialidade from linked tratamento for historical payments
UPDATE public.pagamentos p
   SET especialidade = t.especialidade
  FROM public.tratamentos t
 WHERE p.tratamento_id = t.id
   AND p.especialidade IS NULL
   AND t.especialidade IS NOT NULL;

-- Index for fast aggregation by specialty
CREATE INDEX IF NOT EXISTS idx_pagamentos_especialidade ON public.pagamentos(especialidade);
CREATE INDEX IF NOT EXISTS idx_pagamentos_paciente_especialidade ON public.pagamentos(paciente_id, especialidade);