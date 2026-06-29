CREATE OR REPLACE FUNCTION public.get_crm_unread_leads_count_by_channel(_channel text)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT count(*)::integer
  FROM public.crm_leads l
  WHERE l.is_blocked = false
    AND l.last_inbound_at IS NOT NULL
    AND (l.last_outbound_at IS NULL OR l.last_inbound_at > l.last_outbound_at)
    AND (
      (_channel = 'instagram' AND l.instagram_user_id IS NOT NULL)
      OR (_channel = 'whatsapp' AND l.instagram_user_id IS NULL)
      OR (_channel IS NULL OR _channel = 'all')
    );
$function$;