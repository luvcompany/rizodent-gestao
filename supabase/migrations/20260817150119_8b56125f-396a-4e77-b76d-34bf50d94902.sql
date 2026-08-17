DROP FUNCTION public.rpt_kpis_agendamentos(date, date);

CREATE FUNCTION public.rpt_kpis_agendamentos(
  p_from date,
  p_to date
)
RETURNS TABLE (
  contracted bigint,
  not_contracted bigint,
  no_show bigint,
  rescheduled bigint,
  cancelled bigint,
  pending bigint,
  pending_vencidos bigint,
  total bigint,
  reagendados_flag bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.rpt_resolve_tenant();
  v_hoje date := (now() AT TIME ZONE 'America/Bahia')::date;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Período inválido: informe p_from <= p_to';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE a.status = 'contracted')::bigint      AS contracted,
    COUNT(*) FILTER (WHERE a.status = 'not_contracted')::bigint  AS not_contracted,
    COUNT(*) FILTER (WHERE a.status = 'no_show')::bigint         AS no_show,
    COUNT(*) FILTER (WHERE a.status = 'rescheduled')::bigint     AS rescheduled,
    COUNT(*) FILTER (WHERE a.status = 'cancelled')::bigint       AS cancelled,
    COUNT(*) FILTER (
      WHERE a.status NOT IN ('contracted','not_contracted','no_show','rescheduled','cancelled')
    )::bigint                                                    AS pending,
    COUNT(*) FILTER (
      WHERE a.status NOT IN ('contracted','not_contracted','no_show','rescheduled','cancelled')
        AND a.scheduled_date < v_hoje
    )::bigint                                                    AS pending_vencidos,
    COUNT(*)::bigint                                             AS total,
    COUNT(*) FILTER (WHERE a.is_rescheduled)::bigint             AS reagendados_flag
  FROM public.crm_appointments a
  WHERE a.tenant_id = v_tenant
    AND a.scheduled_date BETWEEN p_from AND p_to;
END;
$$;

REVOKE ALL ON FUNCTION public.rpt_kpis_agendamentos(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpt_kpis_agendamentos(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpt_kpis_agendamentos(date, date) TO authenticated, service_role;