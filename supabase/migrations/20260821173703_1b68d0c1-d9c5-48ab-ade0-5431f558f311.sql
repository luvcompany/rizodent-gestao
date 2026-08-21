REVOKE ALL ON FUNCTION public.user_role_cria_funil_padrao() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_role_cria_funil_padrao() TO service_role;