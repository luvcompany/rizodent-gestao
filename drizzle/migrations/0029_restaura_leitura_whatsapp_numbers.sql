GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_numbers TO authenticated;
GRANT ALL ON public.whatsapp_numbers TO service_role;
REVOKE ALL ON public.whatsapp_numbers FROM anon;