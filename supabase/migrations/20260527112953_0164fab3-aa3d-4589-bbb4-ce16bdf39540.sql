CREATE OR REPLACE FUNCTION public.get_crm_unread_leads_count_by_channel(_channel text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION public.get_crm_unread_leads_count_by_channel(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_crm_unread_leads_count_by_channel(text) TO service_role;

CREATE INDEX IF NOT EXISTS idx_crm_leads_unread_channel_badge
  ON public.crm_leads (tenant_id, instagram_user_id, last_inbound_at DESC, last_outbound_at DESC)
  WHERE is_blocked = false AND last_inbound_at IS NOT NULL;