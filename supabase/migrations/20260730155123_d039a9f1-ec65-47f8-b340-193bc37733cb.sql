CREATE OR REPLACE FUNCTION public.pagamento_conta_marketing(p_paciente_id uuid, p_recorrencia_orto boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT NOT COALESCE(p_recorrencia_orto, false); $$;