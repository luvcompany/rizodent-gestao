DROP POLICY IF EXISTS "chat-media tenant-scoped upload" ON storage.objects;
DROP POLICY IF EXISTS "chat-media authenticated upload" ON storage.objects;

CREATE POLICY "chat-media tenant-user scoped upload"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'chat-media'
  AND auth.uid() IS NOT NULL
  AND (
    name LIKE (public.current_tenant_id()::text || '/' || auth.uid()::text || '/%')
    OR (
      public.has_role(auth.uid(), 'superadmin'::public.app_role)
      AND name LIKE ('superadmin/' || auth.uid()::text || '/%')
    )
  )
);