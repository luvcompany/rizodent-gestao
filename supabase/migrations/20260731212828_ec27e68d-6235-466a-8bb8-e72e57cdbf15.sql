DROP POLICY IF EXISTS "superadmin select whatsapp_numbers" ON public.whatsapp_numbers;
CREATE POLICY "superadmin select whatsapp_numbers"
ON public.whatsapp_numbers FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'superadmin'::app_role));