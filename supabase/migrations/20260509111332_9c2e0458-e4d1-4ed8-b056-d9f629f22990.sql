
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon;
