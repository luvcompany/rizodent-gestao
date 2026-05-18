DROP POLICY IF EXISTS "Admins and managers can delete crm_leads" ON public.crm_leads;
CREATE POLICY "Staff can delete crm_leads"
ON public.crm_leads FOR DELETE
USING (
  tenant_id = current_tenant_id() AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR has_role(auth.uid(), 'posvenda'::app_role)
    OR has_role(auth.uid(), 'crc'::app_role)
  )
);