
-- Internal secrets store (used by edge functions for service-to-service auth)
CREATE TABLE IF NOT EXISTS public._internal_secrets (
  name text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public._internal_secrets FROM PUBLIC;
REVOKE ALL ON public._internal_secrets FROM anon, authenticated;
GRANT ALL ON public._internal_secrets TO service_role;
ALTER TABLE public._internal_secrets ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (bypass RLS) and SECURITY DEFINER functions can read.

INSERT INTO public._internal_secrets(name, value)
VALUES
  ('automation_cron_token', encode(gen_random_bytes(32), 'hex')),
  ('bot_engine_api_key', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;

CREATE OR REPLACE FUNCTION public.verify_internal_secret(_name text, _token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public._internal_secrets
    WHERE name = _name AND value = _token AND _token IS NOT NULL AND _token <> ''
  );
$$;
REVOKE ALL ON FUNCTION public.verify_internal_secret(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_internal_secret(text, text) TO service_role;

-- Updated check_duplicate_phone to also return pipeline_name and stage_name
DROP FUNCTION IF EXISTS public.check_duplicate_phone(text);
CREATE OR REPLACE FUNCTION public.check_duplicate_phone(p_phone text)
RETURNS TABLE(lead_id uuid, lead_name text, assigned_to uuid, pipeline_name text, stage_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.name, l.assigned_to,
         p.name AS pipeline_name,
         s.name AS stage_name
  FROM public.crm_leads l
  LEFT JOIN public.crm_pipelines p ON p.id = l.pipeline_id
  LEFT JOIN public.crm_stages s ON s.id = l.stage_id
  WHERE l.phone = p_phone
    AND (
      l.tenant_id = public.current_tenant_id()
      OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
    )
  LIMIT 1;
$$;

-- Tighten crm_lead_label_assignments: also require the lead to belong to the caller's tenant.
DROP POLICY IF EXISTS "Users see own label assignments" ON public.crm_lead_label_assignments;
DROP POLICY IF EXISTS "Users insert own label assignments" ON public.crm_lead_label_assignments;
DROP POLICY IF EXISTS "Users delete own label assignments" ON public.crm_lead_label_assignments;

CREATE POLICY "Users see own label assignments (tenant scoped)"
ON public.crm_lead_label_assignments
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'superadmin'::public.app_role)
  OR (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.crm_leads l
      WHERE l.id = crm_lead_label_assignments.lead_id
        AND l.tenant_id = public.current_tenant_id()
    )
  )
);

CREATE POLICY "Users insert own label assignments (tenant scoped)"
ON public.crm_lead_label_assignments
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.crm_user_labels lbl
    WHERE lbl.id = crm_lead_label_assignments.label_id
      AND lbl.user_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM public.crm_leads l
    WHERE l.id = crm_lead_label_assignments.lead_id
      AND l.tenant_id = public.current_tenant_id()
  )
);

CREATE POLICY "Users delete own label assignments (tenant scoped)"
ON public.crm_lead_label_assignments
FOR DELETE
TO authenticated
USING (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.crm_leads l
    WHERE l.id = crm_lead_label_assignments.lead_id
      AND l.tenant_id = public.current_tenant_id()
  )
);
