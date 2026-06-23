
-- 1) check_duplicate_phone: filtra por tenant do chamador
CREATE OR REPLACE FUNCTION public.check_duplicate_phone(p_phone text)
RETURNS TABLE(lead_id uuid, lead_name text, assigned_to uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, assigned_to
  FROM public.crm_leads
  WHERE phone = p_phone
    AND (
      tenant_id = public.current_tenant_id()
      OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
    )
  LIMIT 1;
$$;

-- 2) crm_notifications INSERT: destinatário deve ser do mesmo tenant
DROP POLICY IF EXISTS "Authenticated can insert notifications" ON public.crm_notifications;

CREATE POLICY "Tenant members can insert notifications"
ON public.crm_notifications
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR user_id IN (
      SELECT id FROM public.profiles
      WHERE tenant_id = public.current_tenant_id()
    )
  )
);
