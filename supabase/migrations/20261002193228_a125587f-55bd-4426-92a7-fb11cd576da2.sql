CREATE OR REPLACE FUNCTION public.relatorio_sdr_diario(p_de date, p_ate date)
RETURNS TABLE(appointment_id uuid, user_id uuid, nome text, lead_id uuid, dia_marcou date, dia_consulta date, situacao text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_gestor boolean := public.is_gestor_equipe();
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  RETURN QUERY
  SELECT a.id, a.responsavel_credito_id, COALESCE(p.nome, '')::text, a.lead_id,
         (a.created_at AT TIME ZONE 'America/Bahia')::date, a.scheduled_date,
         CASE
           WHEN a.status IN ('contracted','not_contracted') THEN 'compareceu'
           WHEN a.status = 'no_show' THEN 'falta'
           WHEN a.status = 'rescheduled' THEN 'remarcado'
           WHEN a.status = 'cancelled' AND EXISTS (
             SELECT 1 FROM public.crm_appointments b
             WHERE b.lead_id = a.lead_id AND b.tenant_id = a.tenant_id AND b.id <> a.id
               AND (b.scheduled_date, COALESCE(b.scheduled_time,'00:00'::time), b.created_at)
                 > (a.scheduled_date, COALESCE(a.scheduled_time,'00:00'::time), a.created_at)
           ) THEN 'remarcado'
           WHEN a.status = 'cancelled' THEN 'cancelado'
           ELSE 'pendente'
         END
  FROM public.crm_appointments a
  JOIN public.profiles p ON p.id = a.responsavel_credito_id
  WHERE a.tenant_id = v_tenant
    AND public.has_role(a.responsavel_credito_id, 'sdr'::app_role)
    AND (v_gestor OR a.responsavel_credito_id = auth.uid())
    AND ((a.created_at AT TIME ZONE 'America/Bahia')::date BETWEEN p_de AND p_ate
         OR a.scheduled_date BETWEEN p_de AND p_ate);
END $fn$;
REVOKE ALL ON FUNCTION public.relatorio_sdr_diario(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_sdr_diario(date, date) TO authenticated;