CREATE OR REPLACE FUNCTION public.debug_audio_messages(p_lead_id uuid, p_limit integer DEFAULT 30)
 RETURNS TABLE(created_at timestamp with time zone, direction text, media_url text, message_status text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 
    m.created_at,
    m.direction,
    m.media_url,
    m.status as message_status
  FROM messages m
  WHERE m.lead_id = p_lead_id
    AND m.type = 'audio'
    AND m.media_url IS NOT NULL
  ORDER BY m.created_at DESC
  LIMIT p_limit;
$function$;