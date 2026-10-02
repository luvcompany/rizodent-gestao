CREATE POLICY "chat-media ad thumbnails read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-media' AND name LIKE 'ads/%');