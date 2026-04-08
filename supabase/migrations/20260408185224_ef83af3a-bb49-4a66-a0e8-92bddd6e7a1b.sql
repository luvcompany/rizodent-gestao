
-- Drop existing SELECT policy
DROP POLICY IF EXISTS "Authenticated users can view crm_leads" ON public.crm_leads;

-- New SELECT policy: admins/gerentes see all, CRCs see only assigned or unassigned
CREATE POLICY "Users can view assigned or own leads"
ON public.crm_leads
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR assigned_to = auth.uid()
  OR assigned_to IS NULL
);
