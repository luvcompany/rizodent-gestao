-- 1) Trigger function: keep crm_lead_stage_history in sync with crm_leads.stage_id
CREATE OR REPLACE FUNCTION public.sync_lead_stage_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act when stage_id actually changed
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    -- Close the currently-open history row for this lead (if any)
    UPDATE public.crm_lead_stage_history
       SET exited_at = now()
     WHERE lead_id = NEW.id
       AND exited_at IS NULL;

    -- Insert new open history row
    INSERT INTO public.crm_lead_stage_history (lead_id, stage_id, from_stage_id, entered_at)
    VALUES (NEW.id, NEW.stage_id, OLD.stage_id, now());
  END IF;
  RETURN NEW;
END;
$$;

-- 2) Trigger
DROP TRIGGER IF EXISTS crm_leads_stage_history_trg ON public.crm_leads;
CREATE TRIGGER crm_leads_stage_history_trg
AFTER UPDATE OF stage_id ON public.crm_leads
FOR EACH ROW
EXECUTE FUNCTION public.sync_lead_stage_history();

-- 3) Backfill: for leads with no open history row matching current stage, insert one
INSERT INTO public.crm_lead_stage_history (lead_id, stage_id, from_stage_id, entered_at)
SELECT l.id, l.stage_id, NULL, COALESCE(l.updated_at, l.created_at, now())
FROM public.crm_leads l
WHERE NOT EXISTS (
  SELECT 1
  FROM public.crm_lead_stage_history h
  WHERE h.lead_id = l.id
    AND h.stage_id = l.stage_id
    AND h.exited_at IS NULL
);

-- 4) Close any stale open rows that don't match current stage (data hygiene)
UPDATE public.crm_lead_stage_history h
   SET exited_at = now()
  FROM public.crm_leads l
 WHERE h.lead_id = l.id
   AND h.exited_at IS NULL
   AND h.stage_id <> l.stage_id;