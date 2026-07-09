
ALTER TABLE public.whatsapp_calls ADD COLUMN IF NOT EXISTS recording_url text;

-- Storage policies: pasta = {tenant_id}/{wa_call_id}.webm
CREATE POLICY "call recordings insert same tenant"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'call-recordings'
  AND (storage.foldername(name))[1] = current_tenant_id()::text
);

CREATE POLICY "call recordings select same tenant"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'call-recordings'
  AND (storage.foldername(name))[1] = current_tenant_id()::text
);

CREATE POLICY "call recordings update same tenant"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'call-recordings'
  AND (storage.foldername(name))[1] = current_tenant_id()::text
);

CREATE POLICY "call recordings delete gerente/superadmin"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'call-recordings'
  AND (has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role))
);
