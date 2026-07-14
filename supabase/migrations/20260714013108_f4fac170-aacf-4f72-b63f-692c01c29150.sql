CREATE OR REPLACE FUNCTION public.rpt_crm_message_period_count(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS bigint
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.rpt_resolve_tenant();
  v_total bigint;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Período inválido: informe p_from <= p_to';
  END IF;

  SELECT count(DISTINCT m.lead_id)::bigint
    INTO v_total
  FROM public.messages m
  WHERE m.tenant_id = v_tenant
    AND m.direction = 'inbound'
    AND m.lead_id IS NOT NULL
    AND m.created_at >= p_from
    AND m.created_at <= p_to;

  RETURN COALESCE(v_total, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.rpt_crm_message_period_count(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpt_crm_message_period_count(timestamptz, timestamptz) TO authenticated, service_role;