-- Drop the existing UPDATE policy and recreate without WITH CHECK
DROP POLICY IF EXISTS "Staff can update crm_leads" ON public.crm_leads;

CREATE POLICY "Staff can update crm_leads"
ON public.crm_leads
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR assigned_to = auth.uid()
  OR assigned_to IS NULL
)
WITH CHECK (true);