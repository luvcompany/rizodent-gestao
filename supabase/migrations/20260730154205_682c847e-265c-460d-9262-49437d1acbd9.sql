CREATE OR REPLACE FUNCTION public.pacientes_whatsapp_direto(p_paciente_ids uuid[])
RETURNS TABLE(paciente_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT pid
  FROM unnest(COALESCE(p_paciente_ids, '{}'::uuid[])) AS pid
  WHERE NOT public.pagamento_conta_marketing(pid, false);
$$;

GRANT EXECUTE ON FUNCTION public.pacientes_whatsapp_direto(uuid[]) TO authenticated, service_role;