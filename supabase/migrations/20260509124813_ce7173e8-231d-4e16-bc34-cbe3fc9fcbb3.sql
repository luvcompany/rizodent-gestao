
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS favicon_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_login_at timestamp with time zone;

-- Helper for admin metrics: count messages in/out per tenant in date range
CREATE OR REPLACE FUNCTION public.admin_tenant_metrics(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_month_start date := date_trunc('month', now())::date;
BEGIN
  IF NOT has_role(auth.uid(), 'superadmin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'leads_total', (SELECT count(*) FROM crm_leads WHERE tenant_id = _tenant_id),
    'leads_month', (SELECT count(*) FROM crm_leads WHERE tenant_id = _tenant_id AND created_at >= v_month_start),
    'messages_in_month', (SELECT count(*) FROM messages WHERE tenant_id = _tenant_id AND direction = 'inbound' AND created_at >= v_month_start),
    'messages_out_month', (SELECT count(*) FROM messages WHERE tenant_id = _tenant_id AND direction = 'outbound' AND created_at >= v_month_start),
    'users_total', (SELECT count(*) FROM profiles WHERE tenant_id = _tenant_id),
    'users_active_30d', (SELECT count(*) FROM profiles WHERE tenant_id = _tenant_id AND last_login_at >= now() - interval '30 days'),
    'ai_calls_month', (SELECT count(*) FROM ai_conversation_analysis a
                       JOIN crm_leads l ON l.id = a.lead_id
                       WHERE l.tenant_id = _tenant_id AND a.created_at >= v_month_start)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
