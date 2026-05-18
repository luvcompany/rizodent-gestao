DROP POLICY IF EXISTS "Templates visible by role" ON public.crm_whatsapp_templates;

CREATE POLICY "Templates visible by role"
ON public.crm_whatsapp_templates FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR has_role(auth.uid(), 'superadmin'::app_role)
  OR has_role(auth.uid(), 'crc'::app_role)
  OR owner_role IS NULL
  OR has_role(auth.uid(), owner_role)
);