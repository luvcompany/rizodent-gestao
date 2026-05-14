UPDATE public.messages m
SET instagram_account_id = sub.instagram_account_id
FROM (
  SELECT DISTINCT ON (m2.id) m2.id, im.instagram_account_id
  FROM public.messages m2
  JOIN public.instagram_messages im
    ON im.lead_id = m2.lead_id
   AND im.instagram_account_id IS NOT NULL
  WHERE m2.channel = 'instagram'
    AND m2.direction = 'outbound'
    AND m2.instagram_account_id IS NULL
  ORDER BY m2.id, ABS(EXTRACT(EPOCH FROM (im.created_at - m2.created_at)))
) sub
WHERE m.id = sub.id;