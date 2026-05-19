create or replace function public.crm_unread_leads_count()
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::integer
  from public.crm_leads
  where tenant_id = public.current_tenant_id()
    and is_blocked = false
    and pipeline_id is distinct from 'c2d3e4f5-0001-4000-8000-000000000002'::uuid
    and last_inbound_at >= now() - interval '60 days'
    and (last_outbound_at is null or last_inbound_at > last_outbound_at);
$$;