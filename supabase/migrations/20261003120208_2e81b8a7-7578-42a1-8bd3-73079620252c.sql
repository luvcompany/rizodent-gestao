CREATE TABLE public._bkp_orto_pacientes_20261003 AS
 SELECT p.* FROM public.pacientes p WHERE p.id IN (SELECT paciente_id FROM public.pagamentos GROUP BY 1 HAVING bool_and(recorrencia_orto));
CREATE TABLE public._bkp_orto_pagamentos_20261003 AS
 SELECT * FROM public.pagamentos WHERE paciente_id IN (SELECT id FROM public._bkp_orto_pacientes_20261003);
CREATE TABLE public._bkp_orto_leads_20261003 AS
 SELECT l.* FROM public.crm_leads l WHERE l.id IN (SELECT lead_id FROM public.crm_lead_pacientes WHERE paciente_id IN (SELECT id FROM public._bkp_orto_pacientes_20261003))
   AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.lead_id = l.id);
ALTER TABLE public._bkp_orto_pacientes_20261003 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_orto_pagamentos_20261003 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_orto_leads_20261003 ENABLE ROW LEVEL SECURITY;

DELETE FROM public.crm_lead_pacientes WHERE paciente_id IN (SELECT id FROM public._bkp_orto_pacientes_20261003);
DELETE FROM public.pagamentos WHERE id IN (SELECT id FROM public._bkp_orto_pagamentos_20261003);
DELETE FROM public.pacientes WHERE id IN (SELECT id FROM public._bkp_orto_pacientes_20261003);
DELETE FROM public.crm_leads WHERE id IN (SELECT id FROM public._bkp_orto_leads_20261003);