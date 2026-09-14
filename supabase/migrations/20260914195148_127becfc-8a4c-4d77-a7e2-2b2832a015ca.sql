CREATE INDEX IF NOT EXISTS idx_messages_whatsapp_message_id
  ON public.messages (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

CREATE OR REPLACE VIEW public.crm_leads_com_pagamento
WITH (security_invoker = true)
AS
SELECT l.id AS lead_id
FROM public.crm_leads l
WHERE l.paciente_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.pagamentos p WHERE p.paciente_id = l.paciente_id)
UNION
SELECT lp.lead_id
FROM public.crm_lead_pacientes lp
WHERE EXISTS (SELECT 1 FROM public.pagamentos p WHERE p.paciente_id = lp.paciente_id);

CREATE INDEX IF NOT EXISTS idx_crm_leads_paciente_id
  ON public.crm_leads (paciente_id)
  WHERE paciente_id IS NOT NULL;