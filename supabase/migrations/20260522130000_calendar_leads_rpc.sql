-- RPC function that returns lead name + cidade for the calendar view,
-- bypassing the crm_leads SELECT RLS (which restricts CRC users from
-- reading leads in the Pós-Venda pipeline, breaking the calendar grid).
--
-- Security: only callable by authenticated users with a staff role
-- (crc, gerente, superadmin, posvenda) within their own tenant.

CREATE OR REPLACE FUNCTION public.get_leads_for_calendar(_lead_ids uuid[])
RETURNS TABLE(
  id uuid,
  name text,
  cidade text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT l.id, l.name, l.cidade
  FROM public.crm_leads l
  WHERE l.id = ANY(_lead_ids)
    AND l.tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'crc'::app_role)
      OR public.has_role(auth.uid(), 'gerente'::app_role)
      OR public.has_role(auth.uid(), 'superadmin'::app_role)
      OR public.has_role(auth.uid(), 'posvenda'::app_role)
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_for_calendar(uuid[]) TO authenticated;
