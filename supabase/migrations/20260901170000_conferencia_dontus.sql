-- Conferência CRClin × Dontus (pedido do dono, 01/09/2026): cruzar, dia a
-- dia, agendamento, reagendamento e comparecimento dos DOIS sistemas — para a
-- divergência aparecer com nome e telefone, e não como um total que não fecha.
--
-- A tabela guarda o retrato do último cruzamento de cada dia (o modo
-- `conferencia` da função dontus-sync apaga e regrava o intervalo que roda).
-- Quem escreve é só o servidor; o superadmin pode ler.
CREATE TABLE IF NOT EXISTS public.dontus_conferencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  executado_em timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid NOT NULL,
  dia date NOT NULL,
  -- 'ambos' (casou), 'so_crm' (consulta sem par no Dontus), 'so_dontus'
  -- (agendamento do Dontus sem par no CRClin)
  origem text NOT NULL CHECK (origem IN ('ambos','so_crm','so_dontus')),
  -- como casou: telefone+nome, ou só telefone (nome divergente)
  casamento text CHECK (casamento IN ('telefone_nome','telefone_nome_divergente')),
  lead_id uuid,
  appointment_id uuid,
  nome_crm text,
  telefone_crm text,
  status_crm text,
  is_rescheduled boolean,
  nome_dontus text,
  telefone_dontus text,
  status_dontus text,
  unidade_dontus text
);

CREATE INDEX IF NOT EXISTS dontus_conferencia_dia_idx ON public.dontus_conferencia (tenant_id, dia);

ALTER TABLE public.dontus_conferencia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS superadmin_le_conferencia ON public.dontus_conferencia;
CREATE POLICY superadmin_le_conferencia ON public.dontus_conferencia
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::app_role));
