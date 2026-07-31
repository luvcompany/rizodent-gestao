CREATE OR REPLACE FUNCTION public.tenant_set_user_role(_user_id uuid, _role app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_super boolean := public.has_role(auth.uid(), 'superadmin'::app_role);
  v_tenant uuid;
BEGIN
  IF NOT (v_super OR public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = _user_id;
  IF v_tenant IS NULL OR (NOT v_super AND v_tenant <> public.current_tenant_id()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT v_super AND _role NOT IN ('crc'::app_role, 'posvenda'::app_role, 'recepcao'::app_role) THEN
    RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id AND tenant_id = v_tenant;
  INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES (_user_id, _role, v_tenant);
END $$;

REVOKE ALL ON FUNCTION public.tenant_set_user_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_set_user_role(uuid, app_role) TO authenticated;

DROP POLICY IF EXISTS "Tenant admins view roles in tenant" ON public.user_roles;
CREATE POLICY "Tenant admins view roles in tenant"
ON public.user_roles FOR SELECT TO authenticated
USING (
  (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role))
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = user_roles.user_id AND p.tenant_id = public.current_tenant_id()
  )
);