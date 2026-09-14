REVOKE EXECUTE ON FUNCTION public.cleanup_system_logs() FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_system_logs() TO service_role;