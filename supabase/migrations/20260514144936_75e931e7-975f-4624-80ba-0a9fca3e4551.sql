-- Trigger: auto-inherit tenant_id from the parent lead when inserting a message
-- This is a safety net — application code should still pass tenant_id explicitly.
CREATE OR REPLACE FUNCTION public.set_message_tenant_from_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead_tenant uuid;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    SELECT tenant_id INTO v_lead_tenant FROM public.crm_leads WHERE id = NEW.lead_id;
    IF v_lead_tenant IS NOT NULL THEN
      NEW.tenant_id := v_lead_tenant;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_set_message_tenant_from_lead ON public.messages;
CREATE TRIGGER trg_set_message_tenant_from_lead
BEFORE INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.set_message_tenant_from_lead();

-- Backfill: fix any messages whose tenant_id doesn't match their lead
UPDATE public.messages m
   SET tenant_id = l.tenant_id
  FROM public.crm_leads l
 WHERE m.lead_id = l.id
   AND m.tenant_id IS DISTINCT FROM l.tenant_id;