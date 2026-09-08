UPDATE public.crm_appointments a
   SET status = CASE WHEN public.normaliza_nome_etapa(s.name) = 'contratado' THEN 'contracted' ELSE 'not_contracted' END,
       outcome_source = 'folha-sdr',
       outcome_at = coalesce(a.outcome_at, now()),
       notes = concat_ws(E'\n', a.notes, 'Compareceu segundo a folha das SDRs (agosto/2026); o sistema marcava falta.'),
       updated_at = now()
  FROM public.crm_leads l
  JOIN public.crm_stages s ON s.id = l.stage_id
 WHERE a.lead_id = l.id
   AND a.status = 'no_show'
   AND a.id IN (
     '7b742bd6-6f87-4614-ad0b-42dcef2a2849',
     '72dc2ce8-81c7-4eca-af62-bfd740fb3268',
     'ccb36590-69d1-41c1-9a11-d5b87a831633',
     'ea5dc9b2-9039-4493-8c79-1aaf7966f31f',
     '95ff2d36-ad67-49c3-94eb-e899820b11dd',
     'ad3e97f2-0be5-4973-ab4d-ae652eb2a7e1'
   );

INSERT INTO public.crm_appointments
  (lead_id, tenant_id, scheduled_date, scheduled_time, status, outcome_source, outcome_at, confirmed_at, notes)
SELECT 'fd57eb56-2b28-4c00-a57e-ef9057b6ee5f', '00000000-0000-0000-0000-000000000010',
       '2026-08-24', '00:00:00', 'not_contracted', 'folha-sdr', now(), now(),
       'Criado a partir da folha das SDRs: compareceu em 24/08 (a consulta não existia no CRM); hora desconhecida.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.crm_appointments
  WHERE lead_id = 'fd57eb56-2b28-4c00-a57e-ef9057b6ee5f' AND scheduled_date = '2026-08-24'
);