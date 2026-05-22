-- Denormalize lead_name and lead_cidade onto crm_appointments to avoid
-- RLS issues when leads move to restricted pipelines (Pós-Venda).
-- This is bulletproof: data is stored on the appointment row itself,
-- so the calendar grid always has access regardless of RLS.

-- 1) Add snapshot columns
ALTER TABLE public.crm_appointments
  ADD COLUMN IF NOT EXISTS lead_name text,
  ADD COLUMN IF NOT EXISTS lead_cidade text;

-- 2) Backfill from current crm_leads data
UPDATE public.crm_appointments a
SET lead_name = l.name,
    lead_cidade = l.cidade
FROM public.crm_leads l
WHERE l.id = a.lead_id;

-- 3) Trigger on crm_appointments to populate on insert / lead change
CREATE OR REPLACE FUNCTION public.populate_appointment_lead_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text;
  v_cidade text;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    SELECT name, cidade INTO v_name, v_cidade
    FROM public.crm_leads
    WHERE id = NEW.lead_id;
    NEW.lead_name := v_name;
    NEW.lead_cidade := v_cidade;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS populate_appt_lead_snapshot ON public.crm_appointments;
CREATE TRIGGER populate_appt_lead_snapshot
BEFORE INSERT OR UPDATE OF lead_id ON public.crm_appointments
FOR EACH ROW
EXECUTE FUNCTION public.populate_appointment_lead_snapshot();

-- 4) Trigger on crm_leads to keep all related appointments in sync
CREATE OR REPLACE FUNCTION public.sync_appointment_lead_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.name IS DISTINCT FROM NEW.name OR OLD.cidade IS DISTINCT FROM NEW.cidade THEN
    UPDATE public.crm_appointments
    SET lead_name = NEW.name,
        lead_cidade = NEW.cidade
    WHERE lead_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_appt_lead_snapshot ON public.crm_leads;
CREATE TRIGGER sync_appt_lead_snapshot
AFTER UPDATE OF name, cidade ON public.crm_leads
FOR EACH ROW
EXECUTE FUNCTION public.sync_appointment_lead_snapshot();

-- 5) Also add a SECURITY DEFINER RPC for fetching a single lead by ID
-- (used by CrmConversa.tsx to open conversation regardless of pipeline)
CREATE OR REPLACE FUNCTION public.get_lead_for_conversation(_lead_id uuid)
RETURNS SETOF public.crm_leads
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT l.*
  FROM public.crm_leads l
  WHERE l.id = _lead_id
    AND l.tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'crc'::app_role)
      OR public.has_role(auth.uid(), 'gerente'::app_role)
      OR public.has_role(auth.uid(), 'superadmin'::app_role)
      OR public.has_role(auth.uid(), 'posvenda'::app_role)
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_lead_for_conversation(uuid) TO authenticated;
