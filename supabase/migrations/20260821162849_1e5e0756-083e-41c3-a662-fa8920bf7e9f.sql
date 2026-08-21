-- Reverte a policy de INSERT do chat-media para a versão de 12/06 (20260612132808),
-- que funcionou por 2 meses. A versão de hoje (current_tenant_id()) coincidiu com a
-- quebra do envio de áudio em produção.
DROP POLICY IF EXISTS "chat-media tenant-scoped upload" ON storage.objects;
CREATE POLICY "chat-media tenant-scoped upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'chat-media'
  AND auth.uid() IS NOT NULL
);