CREATE OR REPLACE FUNCTION public.get_crm_unread_leads_count()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT count(*)::integer
  FROM public.crm_leads l
  WHERE l.is_blocked = false
    AND l.tenant_id = public.current_tenant_id()
    AND public.can_access_whatsapp_number(l.whatsapp_number_id)
    AND l.last_inbound_at IS NOT NULL
    AND l.last_inbound_at >= now() - interval '60 days'
    AND (l.last_outbound_at IS NULL OR l.last_inbound_at > l.last_outbound_at)
    AND (l.conversa_fechada_em IS NULL OR l.last_inbound_at > l.conversa_fechada_em);
$function$;