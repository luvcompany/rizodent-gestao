
-- Create storage bucket for chat media
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-media', 'chat-media', true);

-- Allow authenticated users to upload to chat-media bucket
CREATE POLICY "Authenticated users can upload chat media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'chat-media');

-- Allow anyone to view chat media (public bucket)
CREATE POLICY "Public can view chat media"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'chat-media');

-- Allow authenticated users to delete their uploads
CREATE POLICY "Authenticated users can delete chat media"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'chat-media');
