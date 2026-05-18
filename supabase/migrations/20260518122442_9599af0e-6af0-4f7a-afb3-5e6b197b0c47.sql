
-- 1. Coluna de restrição por role
ALTER TABLE public.crm_pipelines
  ADD COLUMN IF NOT EXISTS allowed_roles public.app_role[] NULL;

-- 2. Helper que decide se o usuário atual pode ver o pipeline
CREATE OR REPLACE FUNCTION public.can_access_pipeline(_pipeline_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    has_role(auth.uid(), 'superadmin'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR EXISTS (
      SELECT 1
        FROM public.crm_pipelines p
       WHERE p.id = _pipeline_id
         AND (
           p.allowed_roles IS NULL
           OR EXISTS (
             SELECT 1 FROM public.user_roles ur
              WHERE ur.user_id = auth.uid()
                AND ur.role = ANY(p.allowed_roles)
           )
         )
    );
$$;

-- 3. Atualiza policies de SELECT para crm_pipelines
DROP POLICY IF EXISTS "Authenticated users can view crm_pipelines" ON public.crm_pipelines;
CREATE POLICY "Users can view allowed pipelines"
ON public.crm_pipelines
FOR SELECT
TO authenticated
USING (public.can_access_pipeline(id));

-- 4. Atualiza policies de SELECT para crm_stages
DROP POLICY IF EXISTS "Authenticated users can view crm_stages" ON public.crm_stages;
CREATE POLICY "Users can view stages of allowed pipelines"
ON public.crm_stages
FOR SELECT
TO authenticated
USING (public.can_access_pipeline(pipeline_id));

-- 5. Atualiza policies de crm_leads para impedir acesso a pipelines restritos
DROP POLICY IF EXISTS "Users can view assigned or own leads" ON public.crm_leads;
CREATE POLICY "Users can view assigned or own leads in allowed pipelines"
ON public.crm_leads
FOR SELECT
TO authenticated
USING (
  public.can_access_pipeline(pipeline_id)
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR assigned_to = auth.uid()
    OR assigned_to IS NULL
  )
);

DROP POLICY IF EXISTS "Staff can insert crm_leads" ON public.crm_leads;
CREATE POLICY "Staff can insert crm_leads in allowed pipelines"
ON public.crm_leads
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND public.can_access_pipeline(pipeline_id)
);

DROP POLICY IF EXISTS "Staff can update crm_leads" ON public.crm_leads;
CREATE POLICY "Staff can update crm_leads in allowed pipelines"
ON public.crm_leads
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND public.can_access_pipeline(pipeline_id)
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND public.can_access_pipeline(pipeline_id)
);
