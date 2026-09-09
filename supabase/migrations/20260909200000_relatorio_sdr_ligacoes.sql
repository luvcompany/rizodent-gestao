-- Relatório de ligações por SDR (pedido do dono, 09/09/2026): ligações feitas,
-- atendidas pelo lead e duração média. Fontes: api4com_calls (originadas pelo
-- CRM levam metadata.userId no raw_payload) e whatsapp_calls (initiated_by).
-- SDR só vê a si mesma; gestor vê qualquer SDR (p_user_id) ou todas (NULL).
CREATE OR REPLACE FUNCTION public.relatorio_sdr_ligacoes(p_de date, p_ate date, p_user_id uuid DEFAULT NULL)
RETURNS TABLE(user_id uuid, ligacoes_feitas integer, ligacoes_atendidas integer, duracao_media_seg integer,
              telefonia_feitas integer, whatsapp_feitas integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id(); v_ini timestamptz; v_fim timestamptz; v_tz text;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN RETURN; END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_de > p_ate OR (p_ate - p_de) > 400 THEN
    RAISE EXCEPTION 'Período inválido.' USING ERRCODE = '22007';
  END IF;
  IF public.has_role(auth.uid(), 'sdr'::app_role) THEN
    p_user_id := auth.uid();                      -- a SDR só vê a si mesma
  ELSIF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  v_tz := public.rodizio_tz(v_tenant);
  v_ini := (p_de::timestamp) AT TIME ZONE v_tz;
  v_fim := ((p_ate + 1)::timestamp) AT TIME ZONE v_tz;

  RETURN QUERY
  WITH tel AS (
    SELECT NULLIF(c.raw_payload->'metadata'->>'userId', '')::uuid AS uid,
           (c.status = 'answered') AS atendida, c.duration_seconds AS dur
      FROM public.api4com_calls c
     WHERE c.tenant_id = v_tenant AND c.direction = 'outbound'
       AND COALESCE(c.started_at, c.created_at) >= v_ini AND COALESCE(c.started_at, c.created_at) < v_fim
       AND c.raw_payload->'metadata'->>'userId' IS NOT NULL
  ), wa AS (
    SELECT w.initiated_by AS uid,
           (w.connected_at IS NOT NULL OR w.status IN ('accepted', 'completed')) AS atendida, w.duration_seconds AS dur
      FROM public.whatsapp_calls w
     WHERE w.tenant_id = v_tenant AND w.direction = 'outbound' AND w.initiated_by IS NOT NULL
       AND COALESCE(w.started_at, w.created_at) >= v_ini AND COALESCE(w.started_at, w.created_at) < v_fim
  ), tudo AS (
    SELECT uid, atendida, dur, 'tel' AS origem FROM tel
    UNION ALL
    SELECT uid, atendida, dur, 'wa' FROM wa
  )
  SELECT t.uid,
         count(*)::integer,
         count(*) FILTER (WHERE t.atendida)::integer,
         COALESCE(avg(t.dur) FILTER (WHERE t.atendida AND t.dur > 0), 0)::integer,
         count(*) FILTER (WHERE t.origem = 'tel')::integer,
         count(*) FILTER (WHERE t.origem = 'wa')::integer
    FROM tudo t
   WHERE t.uid IS NOT NULL
     AND (p_user_id IS NULL OR t.uid = p_user_id)
     AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = t.uid AND ur.role = 'sdr'::app_role)
   GROUP BY t.uid;
END $fn$;
REVOKE ALL ON FUNCTION public.relatorio_sdr_ligacoes(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_sdr_ligacoes(date, date, uuid) TO authenticated, service_role;
