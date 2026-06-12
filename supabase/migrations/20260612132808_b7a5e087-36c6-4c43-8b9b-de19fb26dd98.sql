DROP POLICY IF EXISTS "chat-media tenant-scoped upload" ON storage.objects;

CREATE POLICY "chat-media tenant-scoped upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'chat-media'
  AND auth.uid() IS NOT NULL
);