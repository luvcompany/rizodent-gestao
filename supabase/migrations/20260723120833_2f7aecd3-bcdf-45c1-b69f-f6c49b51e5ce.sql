
CREATE INDEX IF NOT EXISTS idx_messages_inbound_no_comment
  ON public.messages (lead_id, created_at DESC)
  WHERE direction = 'inbound' AND deleted_at IS NULL AND instagram_comment_id IS NULL;

CREATE OR REPLACE FUNCTION public.admin_api_unread_leads_base(_tenant uuid)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  last_message_at timestamptz,
  last_relevant_inbound timestamptz,
  last_outbound_at timestamptz,
  stage_id uuid,
  assigned_to uuid,
  instagram_user_id text,
  cidade text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.name, l.phone, l.last_message_at, r.last_rel, l.last_outbound_at,
         l.stage_id, l.assigned_to, l.instagram_user_id, l.cidade
  FROM public.crm_leads l
  JOIN LATERAL (
    SELECT MAX(m.created_at) AS last_rel
    FROM public.messages m
    WHERE m.lead_id = l.id
      AND m.direction = 'inbound'
      AND m.deleted_at IS NULL
      AND m.instagram_comment_id IS NULL
      AND m.created_at >= now() - interval '60 days'
  ) r ON r.last_rel IS NOT NULL
  WHERE l.tenant_id = _tenant
    AND l.is_blocked = false
    AND (l.last_outbound_at IS NULL OR r.last_rel > l.last_outbound_at);
$$;

GRANT EXECUTE ON FUNCTION public.admin_api_unread_leads_base(uuid) TO service_role;
