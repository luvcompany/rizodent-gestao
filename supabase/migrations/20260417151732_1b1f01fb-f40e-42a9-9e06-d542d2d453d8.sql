DROP POLICY IF EXISTS "Staff can update crm_leads" ON public.crm_leads;

CREATE POLICY "Staff can update crm_leads"
ON public.crm_leads
FOR UPDATE
TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);