CREATE OR REPLACE FUNCTION public.crm_unread_leads_count()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select count(*)::integer
  from public.crm_leads
  where tenant_id = public.current_tenant_id()
    and is_blocked = false
    and pipeline_id is distinct from 'c2d3e4f5-0001-4000-8000-000000000002'::uuid
    and last_inbound_at >= now() - interval '60 days'
    and (last_outbound_at is null or last_inbound_at > last_outbound_at)
    and (conversa_fechada_em is null or last_inbound_at > conversa_fechada_em);
$function$;