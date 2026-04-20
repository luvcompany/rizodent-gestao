
CREATE TABLE public.instagram_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  instagram_account_id text UNIQUE,
  page_id text,
  page_access_token text,
  long_lived_token_expires_at timestamp with time zone,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.instagram_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_account_id text,
  sender_id text,
  sender_name text,
  message_text text,
  message_type text CHECK (message_type IN ('dm','comment')),
  post_id text,
  comment_id text,
  is_read boolean NOT NULL DEFAULT false,
  is_outbound boolean NOT NULL DEFAULT false,
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_instagram_messages_account ON public.instagram_messages(instagram_account_id);
CREATE INDEX idx_instagram_messages_sender ON public.instagram_messages(sender_id);
CREATE INDEX idx_instagram_messages_created ON public.instagram_messages(created_at DESC);

ALTER TABLE public.instagram_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view instagram_accounts"
  ON public.instagram_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert instagram_accounts"
  ON public.instagram_accounts FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can update instagram_accounts"
  ON public.instagram_accounts FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can delete instagram_accounts"
  ON public.instagram_accounts FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can view instagram_messages"
  ON public.instagram_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert instagram_messages"
  ON public.instagram_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can update instagram_messages"
  ON public.instagram_messages FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can delete instagram_messages"
  ON public.instagram_messages FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
