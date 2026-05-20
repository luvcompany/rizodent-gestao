-- View que retorna lead_ids que possuem ao menos um pagamento registrado.
-- Usa SECURITY INVOKER para que as políticas RLS do usuário sejam respeitadas.
-- Evita arrays grandes no .in() do frontend que causam falhas silenciosas.

CREATE OR REPLACE VIEW public.crm_leads_com_pagamento
WITH (security_invoker = true)
AS
SELECT DISTINCT l.id AS lead_id
FROM public.crm_leads l
WHERE
  -- Vínculo direto via crm_leads.paciente_id
  (l.paciente_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pagamentos p WHERE p.paciente_id = l.paciente_id
  ))
  OR
  -- Vínculo via tabela crm_lead_pacientes
  EXISTS (
    SELECT 1
    FROM public.crm_lead_pacientes lp
    JOIN public.pagamentos p ON p.paciente_id = lp.paciente_id
    WHERE lp.lead_id = l.id
  );
