
CREATE OR REPLACE FUNCTION public.check_duplicate_phone(p_phone text)
RETURNS TABLE(lead_id uuid, lead_name text, assigned_to uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, assigned_to
  FROM public.crm_leads
  WHERE phone = p_phone
  LIMIT 1;
$$;
