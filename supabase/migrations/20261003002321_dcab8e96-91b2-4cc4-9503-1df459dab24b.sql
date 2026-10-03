CREATE TABLE IF NOT EXISTS public._bkp_evellin_appointments_20261003 AS
SELECT * FROM public.crm_appointments
WHERE lead_id = '77359265-6f39-454a-8841-1278e0663aa2';

ALTER TABLE public.crm_appointments DISABLE TRIGGER USER;

UPDATE public.crm_appointments
SET status = 'not_contracted',
    outcome_at = '2026-10-02 17:30:55.341258+00',
    outcome_source = 'sdr',
    updated_at = now()
WHERE id = '8f0a3861-ca50-4bde-bfe8-389a6cb92cb3';

DELETE FROM public.crm_appointments
WHERE id = 'ccedf2e2-4d94-400b-9791-23f132c1fd55';

ALTER TABLE public.crm_appointments ENABLE TRIGGER USER;