ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS instagram_comment_id text,
  ADD COLUMN IF NOT EXISTS instagram_post_id text;

CREATE INDEX IF NOT EXISTS idx_messages_ig_comment_id
  ON public.messages (instagram_comment_id)
  WHERE instagram_comment_id IS NOT NULL;