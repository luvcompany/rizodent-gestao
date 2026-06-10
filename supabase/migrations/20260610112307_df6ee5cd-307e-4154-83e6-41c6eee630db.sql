CREATE OR REPLACE FUNCTION public.set_crm_tenant_id_from_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'crm_stages' THEN
    SELECT tenant_id INTO v_tenant_id
    FROM public.crm_pipelines
    WHERE id = NEW.pipeline_id;
  ELSIF TG_TABLE_NAME = 'crm_automations' THEN
    SELECT tenant_id INTO v_tenant_id
    FROM public.crm_stages
    WHERE id = NEW.stage_id;
  ELSIF TG_TABLE_NAME = 'funnel_channels' THEN
    SELECT tenant_id INTO v_tenant_id
    FROM public.crm_pipelines
    WHERE id = NEW.pipeline_id;
  ELSE
    v_tenant_id := public.current_tenant_id();
  END IF;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := v_tenant_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_crm_pipelines_tenant_id ON public.crm_pipelines;
CREATE TRIGGER set_crm_pipelines_tenant_id
  BEFORE INSERT OR UPDATE ON public.crm_pipelines
  FOR EACH ROW
  EXECUTE FUNCTION public.set_crm_tenant_id_from_context();

DROP TRIGGER IF EXISTS set_crm_stages_tenant_id ON public.crm_stages;
CREATE TRIGGER set_crm_stages_tenant_id
  BEFORE INSERT OR UPDATE ON public.crm_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_crm_tenant_id_from_context();

DROP TRIGGER IF EXISTS set_crm_automations_tenant_id ON public.crm_automations;
CREATE TRIGGER set_crm_automations_tenant_id
  BEFORE INSERT OR UPDATE ON public.crm_automations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_crm_tenant_id_from_context();

DROP TRIGGER IF EXISTS set_funnel_channels_tenant_id ON public.funnel_channels;
CREATE TRIGGER set_funnel_channels_tenant_id
  BEFORE INSERT OR UPDATE ON public.funnel_channels
  FOR EACH ROW
  EXECUTE FUNCTION public.set_crm_tenant_id_from_context();