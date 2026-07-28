CREATE TABLE IF NOT EXISTS public.dontus_pagamentos_removidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dontus_key text NOT NULL,
  pagamento_id uuid,
  paciente_id uuid,
  paciente_nome text,
  clinica_id uuid,
  valor numeric,
  data_pagamento date,
  motivo text NOT NULL DEFAULT 'ausente_no_dontus',
  removido_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.dontus_pagamentos_removidos TO authenticated;
GRANT ALL ON public.dontus_pagamentos_removidos TO service_role;
ALTER TABLE public.dontus_pagamentos_removidos ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_dontus_removidos_data ON public.dontus_pagamentos_removidos (data_pagamento DESC, removido_em DESC);