-- =============================================================================
-- "Reagendamentos" passa a contar pela data em que a SDR REMARCOU.
--
-- Complemento obrigatório de 20260911160000, que mudou "Agendamentos" para a
-- data em que a SDR agendou. Sem esta, a MESMA LINHA da tela somaria duas contas
-- diferentes: agendamentos pelo dia em que ela marcou e reagendamentos pelo dia
-- da consulta remarcada. Foi justamente esse tipo de mistura que fez o dono
-- perguntar por que 10 no mês e 3 no dia.
--
-- Mudam as quatro contagens da função, todas de scheduled_date para created_at
-- dentro da janela do período (no fuso do cliente, via ponto_fuso_do_tenant):
--   reag        — consultas remarcadas no período
--   falt_reag   — dessas, as que viraram falta
--   l2          — leads com duas ou mais faltas
--   o total da equipe, que repete a conta de l2 sem contar o mesmo lead duas vezes
--
-- v_tz, v_ini e v_fim são declarados aqui porque a função não os tinha — ela
-- comparava datas cruas. Resto do corpo copiado de
-- 20260910012000_ciclo_carencia_e_relatorios.sql.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.relatorio_sdr_reagendamentos(p_de date, p_ate date)
RETURNS TABLE(user_id uuid, nome text, reagendamentos integer, faltas_apos_reagendar integer, leads_2_faltas integer, is_total boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id(); v_sdr boolean; v_gestor boolean;
        v_tz text; v_ini timestamptz; v_fim timestamptz;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN RETURN; END IF;
  -- Janela do período no fuso do CLIENTE, igual à de relatorio_sdr_calc. É o que
  -- faz as duas telas concordarem: as duas passaram a contar pelo dia em que a
  -- SDR marcou (ou remarcou) a consulta, não pelo dia da consulta.
  v_tz := public.ponto_fuso_do_tenant(v_tenant);
  v_ini := (p_de::timestamp) AT TIME ZONE v_tz;
  v_fim := ((p_ate + 1)::timestamp) AT TIME ZONE v_tz;   -- fim exclusivo
  v_sdr := public.has_role(auth.uid(), 'sdr'::app_role);
  v_gestor := public.is_gestor_equipe();
  IF NOT (v_sdr OR v_gestor) THEN
    RAISE EXCEPTION 'Sem permissão para este relatório.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH sdrs AS (
    SELECT p.id AS uid, COALESCE(NULLIF(btrim(p.nome), ''), p.email) AS pnome
      FROM public.profiles p
     WHERE p.tenant_id = v_tenant
       AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'sdr'::app_role)
       AND (v_gestor OR p.id = auth.uid())
       -- régua exclusiva da aba Equipe (equipe_listar / relatorio_sdr_calc)
       AND (NOT v_gestor
            OR NOT EXISTS (SELECT 1 FROM public.user_roles ur2
                            WHERE ur2.user_id = p.id AND ur2.role <> 'sdr'::app_role))
  ), agg AS (
    SELECT s.uid, s.pnome,
      (SELECT count(*) FROM public.crm_appointments a
        WHERE a.responsavel_credito_id = s.uid AND a.tenant_id = v_tenant AND a.rescheduled_from_id IS NOT NULL
          -- 11/09: mesma régua de "Agendamentos" — o dia em que a SDR REMARCOU,
          -- não o dia da consulta nova. Sem isto a mesma linha da tela somaria
          -- duas contas diferentes.
          AND a.created_at >= v_ini AND a.created_at < v_fim)::integer AS reag,
      (SELECT count(*) FROM public.crm_appointments a
        WHERE a.responsavel_credito_id = s.uid AND a.tenant_id = v_tenant AND a.rescheduled_from_id IS NOT NULL
          AND a.status = 'no_show'
          AND a.created_at >= v_ini AND a.created_at < v_fim)::integer AS falt_reag,
      (SELECT count(*) FROM (
         SELECT a.lead_id FROM public.crm_appointments a
          WHERE a.responsavel_credito_id = s.uid AND a.tenant_id = v_tenant AND a.status = 'no_show'
            AND a.lead_id IS NOT NULL
            AND a.created_at >= v_ini AND a.created_at < v_fim
          GROUP BY a.lead_id HAVING count(*) >= 2) x)::integer AS l2
      FROM sdrs s
  )
  SELECT a.uid, a.pnome, a.reag, a.falt_reag, a.l2, false FROM agg a
  UNION ALL
  SELECT NULL::uuid, 'Equipe (total)'::text, sum(a.reag)::integer, sum(a.falt_reag)::integer,
         -- leads distintos da equipe com 2+ faltas no período (somar as linhas
         -- contava duas vezes o lead que faltou para duas SDRs diferentes)
         (SELECT count(*) FROM (
            SELECT ap.lead_id FROM public.crm_appointments ap
             WHERE ap.tenant_id = v_tenant AND ap.status = 'no_show' AND ap.lead_id IS NOT NULL
               AND ap.created_at >= v_ini AND ap.created_at < v_fim
               AND ap.responsavel_credito_id IN (SELECT s2.uid FROM sdrs s2)
             GROUP BY ap.lead_id HAVING count(*) >= 2) y)::integer,
         true
    FROM agg a HAVING v_gestor
  ORDER BY 6, 2;
END $fn$;REVOKE ALL ON FUNCTION public.relatorio_sdr_reagendamentos(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_sdr_reagendamentos(date, date) TO authenticated, service_role;
