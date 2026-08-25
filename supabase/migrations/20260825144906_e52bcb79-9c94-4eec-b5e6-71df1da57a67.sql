DROP POLICY IF EXISTS "chat-media owner scoped read" ON storage.objects;

CREATE POLICY "chat-media owner scoped read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'chat-media'
  AND auth.uid() IS NOT NULL
  AND owner_id = auth.uid()::text
  AND public.current_tenant_id() IS NOT NULL
  AND name LIKE (public.current_tenant_id()::text || '/' || auth.uid()::text || '/%')
);