ALTER TABLE public.crm_whatsapp_templates
  ADD COLUMN IF NOT EXISTS whatsapp_number_id uuid NULL REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS waba_id text NULL;

-- Backfill: tudo que existe hoje é da WABA legada (integração 'whatsapp_config')
UPDATE public.crm_whatsapp_templates t
SET whatsapp_number_id = NULL,
    waba_id = COALESCE(t.waba_id, i.config->>'waba_id')
FROM public.integrations i
WHERE i.tenant_id = t.tenant_id
  AND i.key = 'whatsapp_config';

CREATE UNIQUE INDEX IF NOT EXISTS crm_whatsapp_templates_tenant_number_name_uniq
  ON public.crm_whatsapp_templates (
    tenant_id,
    COALESCE(whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid),
    name
  );

CREATE INDEX IF NOT EXISTS idx_crm_whatsapp_templates_waba
  ON public.crm_whatsapp_templates (tenant_id, waba_id);