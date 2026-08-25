REVOKE ALL ON FUNCTION public.stamp_crm_lead_whatsapp_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_crm_lead_whatsapp_number() TO service_role;