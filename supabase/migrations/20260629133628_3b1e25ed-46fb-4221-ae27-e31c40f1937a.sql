CREATE OR REPLACE FUNCTION public.get_crm_unread_leads_count_by_channel(_channel text)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT count(*)::integer
  FROM public.crm_leads l
  WHERE l.is_blocked = false
    AND (
      (
        _channel = 'instagram'
        AND l.instagram_user_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.instagram_messages im
          WHERE im.lead_id = l.id AND im.is_outbound = false
        )
        AND (
          SELECT max(created_at) FROM public.instagram_messages im
          WHERE im.lead_id = l.id AND im.is_outbound = false
        ) > COALESCE(
          (SELECT max(created_at) FROM public.instagram_messages im
           WHERE im.lead_id = l.id AND im.is_outbound = true),
          '1970-01-01'::timestamptz
        )
      )
      OR (
        _channel = 'whatsapp'
        AND l.instagram_user_id IS NULL
        AND l.last_inbound_at IS NOT NULL
        AND (l.last_outbound_at IS NULL OR l.last_inbound_at > l.last_outbound_at)
      )
      OR (
        (_channel IS NULL OR _channel = 'all')
        AND l.last_inbound_at IS NOT NULL
        AND (l.last_outbound_at IS NULL OR l.last_inbound_at > l.last_outbound_at)
      )
    );
$function$;