-- Deduplicate WhatsApp templates by meta_template_id+tenant_id, keeping latest updated row
DELETE FROM public.crm_whatsapp_templates t
USING public.crm_whatsapp_templates t2
WHERE t.meta_template_id IS NOT NULL
  AND t.meta_template_id = t2.meta_template_id
  AND COALESCE(t.tenant_id, '00000000-0000-0000-0000-000000000000') = COALESCE(t2.tenant_id, '00000000-0000-0000-0000-000000000000')
  AND (t.updated_at < t2.updated_at OR (t.updated_at = t2.updated_at AND t.id < t2.id));

-- Add unique constraint to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS crm_whatsapp_templates_meta_tenant_uniq
  ON public.crm_whatsapp_templates (meta_template_id, tenant_id)
  WHERE meta_template_id IS NOT NULL;