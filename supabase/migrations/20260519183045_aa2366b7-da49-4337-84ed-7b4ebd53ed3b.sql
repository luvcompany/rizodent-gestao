
CREATE TABLE IF NOT EXISTS public.whatsapp_template_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  action text NOT NULL,
  template_name text,
  waba_id text,
  request_payload jsonb,
  response_body jsonb,
  http_status integer,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_tmpl_logs_created ON public.whatsapp_template_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_tmpl_logs_tenant ON public.whatsapp_template_logs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_wa_tmpl_logs_name ON public.whatsapp_template_logs (template_name);

ALTER TABLE public.whatsapp_template_logs ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_tenant_id_default_trg ON public.whatsapp_template_logs;
CREATE TRIGGER set_tenant_id_default_trg
BEFORE INSERT ON public.whatsapp_template_logs
FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_default();

CREATE POLICY "wa_tmpl_logs_select_privileged"
ON public.whatsapp_template_logs
FOR SELECT
TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND (
    public.has_role(auth.uid(), 'superadmin'::app_role)
    OR public.has_role(auth.uid(), 'crc'::app_role)
    OR public.has_role(auth.uid(), 'gerente'::app_role)
  )
);

CREATE POLICY "wa_tmpl_logs_insert_service"
ON public.whatsapp_template_logs
FOR INSERT
TO authenticated, service_role
WITH CHECK (true);
