
-- Helper: verifica se um pipeline é de pós-venda, ignorando RLS
CREATE OR REPLACE FUNCTION public.is_posvenda_pipeline(_pipeline_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_posvenda FROM public.crm_pipelines WHERE id = _pipeline_id), false);
$$;

-- Helper: verifica se um lead pertence a um pipeline de pós-venda, ignorando RLS
CREATE OR REPLACE FUNCTION public.is_posvenda_lead(_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.is_posvenda
       FROM public.crm_leads l
       JOIN public.crm_pipelines p ON p.id = l.pipeline_id
      WHERE l.id = _lead_id),
    false
  );
$$;

-- Recria as RESTRICTIVE usando os helpers SECURITY DEFINER

DROP POLICY IF EXISTS hide_posvenda_pipelines ON public.crm_pipelines;
CREATE POLICY hide_posvenda_pipelines ON public.crm_pipelines
  AS RESTRICTIVE
  FOR SELECT
  USING (
    COALESCE(is_posvenda, false) = false
    OR has_role(auth.uid(), 'posvenda'::app_role)
    OR has_role(auth.uid(), 'superadmin'::app_role)
  );

DROP POLICY IF EXISTS hide_posvenda_stages ON public.crm_stages;
CREATE POLICY hide_posvenda_stages ON public.crm_stages
  AS RESTRICTIVE
  FOR SELECT
  USING (
    has_role(auth.uid(), 'posvenda'::app_role)
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR NOT public.is_posvenda_pipeline(pipeline_id)
  );

DROP POLICY IF EXISTS hide_posvenda_leads ON public.crm_leads;
CREATE POLICY hide_posvenda_leads ON public.crm_leads
  AS RESTRICTIVE
  FOR SELECT
  USING (
    has_role(auth.uid(), 'posvenda'::app_role)
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR pipeline_id IS NULL
    OR NOT public.is_posvenda_pipeline(pipeline_id)
  );

DROP POLICY IF EXISTS hide_posvenda_messages ON public.messages;
CREATE POLICY hide_posvenda_messages ON public.messages
  AS RESTRICTIVE
  FOR SELECT
  USING (
    has_role(auth.uid(), 'posvenda'::app_role)
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR lead_id IS NULL
    OR NOT public.is_posvenda_lead(lead_id)
  );
