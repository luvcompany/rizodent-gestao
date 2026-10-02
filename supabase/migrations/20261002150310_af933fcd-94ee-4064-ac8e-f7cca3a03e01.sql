ALTER FUNCTION public.relatorio_agendamentos_detalhe(uuid[]) SECURITY DEFINER;
REVOKE EXECUTE ON FUNCTION public.relatorio_agendamentos_detalhe(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_agendamentos_detalhe(uuid[]) TO authenticated;