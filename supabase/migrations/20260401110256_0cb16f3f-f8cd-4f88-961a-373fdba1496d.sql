
-- Restrict chat-media DELETE to admin only
DROP POLICY IF EXISTS "Authenticated users can delete chat media" ON storage.objects;
CREATE POLICY "Admins can delete chat media" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'chat-media' AND public.has_role(auth.uid(), 'admin'));
