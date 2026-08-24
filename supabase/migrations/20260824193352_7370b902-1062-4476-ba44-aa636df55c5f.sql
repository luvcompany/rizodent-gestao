DROP INDEX IF EXISTS public.crm_leads_tenant_phone_uniq;
CREATE UNIQUE INDEX crm_leads_tenant_phone_uniq_por_numero
  ON public.crm_leads (tenant_id, phone, COALESCE(whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE phone IS NOT NULL AND phone <> '';