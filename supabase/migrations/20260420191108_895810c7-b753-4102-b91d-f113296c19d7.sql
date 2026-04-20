-- Drop existing tables to recreate from scratch
DROP TABLE IF EXISTS public.instagram_messages CASCADE;
DROP TABLE IF EXISTS public.instagram_accounts CASCADE;

-- Table: instagram_accounts
CREATE TABLE public.instagram_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  instagram_account_id text NOT NULL UNIQUE,
  page_access_token text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.instagram_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view instagram_accounts"
  ON public.instagram_accounts FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can insert instagram_accounts"
  ON public.instagram_accounts FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can update instagram_accounts"
  ON public.instagram_accounts FOR UPDATE
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can delete instagram_accounts"
  ON public.instagram_accounts FOR DELETE
  TO authenticated USING (auth.uid() IS NOT NULL);

-- Table: instagram_messages
CREATE TABLE public.instagram_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_account_id text,
  instagram_account_config_id uuid REFERENCES public.instagram_accounts(id) ON DELETE SET NULL,
  sender_id text,
  sender_name text,
  sender_profile_pic text,
  message_text text,
  message_type text,
  post_id text,
  comment_id text,
  lead_id uuid,
  is_outbound boolean NOT NULL DEFAULT false,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_instagram_messages_sender ON public.instagram_messages(sender_id);
CREATE INDEX idx_instagram_messages_created ON public.instagram_messages(created_at DESC);
CREATE INDEX idx_instagram_messages_account ON public.instagram_messages(instagram_account_id);

ALTER TABLE public.instagram_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view instagram_messages"
  ON public.instagram_messages FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can insert instagram_messages"
  ON public.instagram_messages FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can update instagram_messages"
  ON public.instagram_messages FOR UPDATE
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can delete instagram_messages"
  ON public.instagram_messages FOR DELETE
  TO authenticated USING (auth.uid() IS NOT NULL);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.instagram_messages;
ALTER TABLE public.instagram_messages REPLICA IDENTITY FULL;