
ALTER TABLE public.messages
  ADD COLUMN ad_headline text,
  ADD COLUMN ad_body text,
  ADD COLUMN ad_image_url text,
  ADD COLUMN ad_source_url text,
  ADD COLUMN ad_source_id text;
