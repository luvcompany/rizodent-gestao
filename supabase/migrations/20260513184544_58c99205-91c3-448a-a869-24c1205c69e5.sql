ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS instagram_post_thumbnail text,
  ADD COLUMN IF NOT EXISTS instagram_post_permalink text;