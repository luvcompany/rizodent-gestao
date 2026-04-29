-- Trigger para manter pipeline_id sincronizado com stage_id automaticamente
CREATE OR REPLACE FUNCTION public.sync_lead_pipeline_with_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stage_pipeline_id uuid;
BEGIN
  IF NEW.stage_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id) THEN
    SELECT pipeline_id INTO v_stage_pipeline_id FROM public.crm_stages WHERE id = NEW.stage_id;
    IF v_stage_pipeline_id IS NOT NULL AND v_stage_pipeline_id IS DISTINCT FROM NEW.pipeline_id THEN
      NEW.pipeline_id := v_stage_pipeline_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_lead_pipeline_with_stage ON public.crm_leads;
CREATE TRIGGER trg_sync_lead_pipeline_with_stage
BEFORE INSERT OR UPDATE OF stage_id ON public.crm_leads
FOR EACH ROW
EXECUTE FUNCTION public.sync_lead_pipeline_with_stage();