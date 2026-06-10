CREATE POLICY "chat-media owner read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-media' AND owner_id = auth.uid()::text);