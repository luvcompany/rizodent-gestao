DROP POLICY IF EXISTS "Tasks visible by role" ON public.crm_tasks;

CREATE POLICY "Tasks visible by role"
ON public.crm_tasks FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR has_role(auth.uid(), 'superadmin'::app_role)
  OR has_role(auth.uid(), owner_role)
  OR assigned_to = auth.uid()
);

UPDATE public.crm_tasks SET owner_role = 'admin' WHERE owner_role IS NULL;