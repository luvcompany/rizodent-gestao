ALTER TABLE public.instagram_messages ADD COLUMN IF NOT EXISTS sender_profile_pic text;
ALTER TABLE public.instagram_messages REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'instagram_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.instagram_messages';
  END IF;
END $$;