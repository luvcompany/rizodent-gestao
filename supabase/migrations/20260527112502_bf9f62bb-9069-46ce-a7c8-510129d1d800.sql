CREATE OR REPLACE FUNCTION public.get_crm_unread_leads_count()
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
    AND (l.last_outbound_at IS NULL OR l.last_inbound_at > l.last_outbound_at);
$$;

GRANT EXECUTE ON FUNCTION public.get_crm_unread_leads_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_crm_unread_leads_count() TO service_role;

CREATE INDEX IF NOT EXISTS idx_crm_leads_unread_badge
  ON public.crm_leads (tenant_id, last_inbound_at DESC, last_outbound_at DESC)
  WHERE is_blocked = false AND last_inbound_at IS NOT NULL;