
CREATE OR REPLACE FUNCTION public.get_lead_stage_history_names(_lead_id uuid)
RETURNS TABLE(id uuid, name text, color text, pipeline_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT s.id, s.name, s.color, s.pipeline_id
  FROM crm_stages s
  WHERE s.id IN (
    SELECT h.stage_id FROM crm_lead_stage_history h WHERE h.lead_id = _lead_id
    UNION
    SELECT h.from_stage_id FROM crm_lead_stage_history h WHERE h.lead_id = _lead_id AND h.from_stage_id IS NOT NULL
  )
  AND EXISTS (
    SELECT 1 FROM crm_leads l
    WHERE l.id = _lead_id AND l.tenant_id = current_tenant_id()
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_lead_stage_history_names(uuid) TO authenticated;
