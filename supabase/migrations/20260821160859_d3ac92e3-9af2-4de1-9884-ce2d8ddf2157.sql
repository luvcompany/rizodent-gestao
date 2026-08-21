-- 20260821180000_chat_media_insert_tenant.sql
-- Endurece o INSERT no bucket chat-media: exige tenant resolvido.
-- current_tenant_id() retorna NULL para usuário bloqueado / tenant inativo,
-- logo conta bloqueada também perde o upload.
-- SELECT/UPDATE/DELETE permanecem intactos (há upsert legítimo do front).
DROP POLICY IF EXISTS "chat-media tenant-scoped upload" ON storage.objects;

CREATE POLICY "chat-media tenant-scoped upload"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'chat-media'
  AND auth.uid() IS NOT NULL
  AND (
    public.current_tenant_id() IS NOT NULL
    OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
  )
);