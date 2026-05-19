-- 1. can_access_pipeline: grant CRC same baseline as admin/gerente on pipelines without allowed_roles
CREATE OR REPLACE FUNCTION public.can_access_pipeline(_pipeline_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    public.user_override(auth.uid(), 'pipeline', _pipeline_id::text),
    has_role(auth.uid(), 'superadmin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.crm_pipelines p
      WHERE p.id = _pipeline_id
        AND (
          (p.allowed_roles IS NULL
            AND (
              has_role(auth.uid(), 'admin'::app_role)
              OR has_role(auth.uid(), 'gerente'::app_role)
              OR has_role(auth.uid(), 'crc'::app_role)
            ))
          OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = ANY(p.allowed_roles)
          )
        )
    )
  );
$function$;

-- 2. crm_tasks: CRC sees everything admins see, but exclude tasks of Pós-venda leads
DROP POLICY IF EXISTS "Tasks visible by role" ON public.crm_tasks;
CREATE POLICY "Tasks visible by role"
ON public.crm_tasks FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'superadmin'::app_role)
  OR (
    (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'gerente'::app_role)
      OR has_role(auth.uid(), 'crc'::app_role)
    )
    AND EXISTS (
      SELECT 1 FROM public.crm_leads l
      WHERE l.id = crm_tasks.lead_id
        AND public.can_access_pipeline(l.pipeline_id)
    )
  )
  OR has_role(auth.uid(), owner_role)
  OR assigned_to = auth.uid()
);

-- 3. crm_appointments: same logic
DROP POLICY IF EXISTS "Appointments visible by role" ON public.crm_appointments;
CREATE POLICY "Appointments visible by role"
ON public.crm_appointments FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'superadmin'::app_role)
  OR (
    (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'gerente'::app_role)
      OR has_role(auth.uid(), 'crc'::app_role)
    )
    AND EXISTS (
      SELECT 1 FROM public.crm_leads l
      WHERE l.id = crm_appointments.lead_id
        AND public.can_access_pipeline(l.pipeline_id)
    )
  )
  OR has_role(auth.uid(), owner_role)
);