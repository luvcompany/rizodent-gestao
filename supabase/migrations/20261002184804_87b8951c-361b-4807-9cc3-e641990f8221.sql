CREATE TABLE IF NOT EXISTS public._bkp_messages_ad_20261002 AS
SELECT id, ad_headline, ad_body, ad_source_url, ad_image_url, ad_account_name
FROM public.messages
WHERE direction='inbound' AND ad_source_id IS NULL
  AND (ad_headline IS NOT NULL OR ad_body IS NOT NULL OR ad_source_url IS NOT NULL OR ad_image_url IS NOT NULL OR ad_account_name IS NOT NULL);
ALTER TABLE public._bkp_messages_ad_20261002 ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public._bkp_messages_ad_20261002 TO service_role;

UPDATE public.messages m
SET ad_headline=NULL, ad_body=NULL, ad_source_url=NULL, ad_image_url=NULL, ad_account_name=NULL
FROM public._bkp_messages_ad_20261002 b WHERE b.id=m.id;