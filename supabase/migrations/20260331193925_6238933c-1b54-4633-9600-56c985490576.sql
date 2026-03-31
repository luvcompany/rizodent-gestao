
-- 1. Restrict integrations SELECT to admin only
DROP POLICY IF EXISTS "Authenticated users can view integrations" ON public.integrations;

CREATE POLICY "Admins can view integrations"
  ON public.integrations FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2. Make chat-media bucket private
UPDATE storage.buckets SET public = false WHERE id = 'chat-media';

-- 3. Drop public access policy and add authenticated-only policy
DROP POLICY IF EXISTS "Public can view chat media" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view chat-media" ON storage.objects;
DROP POLICY IF EXISTS "public_select_chat_media" ON storage.objects;

-- Add authenticated-only read policy
CREATE POLICY "Authenticated users can view chat media"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'chat-media');

-- Ensure authenticated users can upload
DROP POLICY IF EXISTS "Authenticated users can upload chat media" ON storage.objects;
CREATE POLICY "Authenticated users can upload chat media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'chat-media');
