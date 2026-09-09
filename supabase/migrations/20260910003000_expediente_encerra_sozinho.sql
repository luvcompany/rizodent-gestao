-- Expediente encerra sozinho na saída da SDR (pedido do dono, 09/09/2026):
-- "programar para o expediente do sdr fechar sozinho, evitando da sdr esquecer
--  de fechar; se a sdr ainda estiver ativa na hora deve aparecer uma
--  notificação de que o expediente vai encerrar e um cronômetro de 15
--  segundos com 2 opções, encerrar agora, ou continuar por mais 5 minutos;
--  quando finalizar os 5 minutos aparece de novo a notificação."
--
-- Servidor: ponto_vigia (cron a cada 5 min) encerra a sessão aberta ANTES da
-- saída de hoje da SDR (horário dela; sem horário próprio, o comercial da
-- clínica) quando passa da saída + 1 min, salvo adiamento em vigor
-- (crm_rodizio_membros.encerramento_adiado_ate). Sessão aberta DEPOIS da saída
-- (hora extra) fica para a regra antiga das 23:59. Cartão: ponto_fim_expediente
-- diz quando encerra; ponto_adiar_encerramento(5) empurra 5 minutos.
ALTER TABLE public.crm_rodizio_membros ADD COLUMN IF NOT EXISTS encerramento_adiado_ate timestamptz;

CREATE OR REPLACE FUNCTION public.ponto_fim_expediente()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_tenant uuid := public.current_tenant_id();
  v_tz text; v_local timestamp; h record; v_saida timestamptz; v_adiado timestamptz; v_encerra timestamptz; v_abriu timestamptz;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL OR NOT public.has_role(v_uid, 'sdr'::app_role) THEN RETURN NULL; END IF;
  v_tz := public.rodizio_tz(v_tenant);
  v_local := now() AT TIME ZONE v_tz;
  SELECT * INTO h FROM public.rodizio_horario_dia(v_tenant, v_uid, v_local::date);
  SELECT m.encerramento_adiado_ate INTO v_adiado
    FROM public.crm_rodizio_membros m WHERE m.tenant_id = v_tenant AND m.user_id = v_uid;
  IF h.saida IS NOT NULL THEN
    v_saida := (v_local::date + h.saida) AT TIME ZONE v_tz;
  END IF;
  -- Sessão aberta depois da saída (hora extra): a saída de hoje não vale.
  SELECT max(e.em) INTO v_abriu FROM public.crm_ponto_eventos e
   WHERE e.tenant_id = v_tenant AND e.user_id = v_uid AND e.tipo = 'abrir';
  IF v_saida IS NOT NULL AND v_abriu IS NOT NULL AND v_abriu >= v_saida THEN v_saida := NULL; END IF;
  v_encerra := CASE WHEN v_saida IS NULL THEN NULL
                    WHEN v_adiado IS NOT NULL AND v_adiado > v_saida THEN v_adiado
                    ELSE v_saida END;
  RETURN jsonb_build_object('servidor_agora', now(), 'saida_hoje', v_saida, 'adiado_ate', v_adiado, 'encerra_em', v_encerra);
END $fn$;
REVOKE ALL ON FUNCTION public.ponto_fim_expediente() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_fim_expediente() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ponto_adiar_encerramento(p_min integer DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_uid uuid := auth.uid(); v_tenant uuid := public.current_tenant_id(); v_ate timestamptz;
BEGIN
  PERFORM public.ponto_exige_sdr();
  IF p_min IS NULL OR p_min < 1 OR p_min > 30 THEN
    RAISE EXCEPTION 'Informe entre 1 e 30 minutos.' USING ERRCODE = '22023';
  END IF;
  IF (public.ponto_meu_estado()->>'estado') NOT IN ('aberto', 'pausado') THEN
    RAISE EXCEPTION 'O expediente não está aberto.';
  END IF;
  v_ate := now() + make_interval(mins => p_min);
  INSERT INTO public.crm_rodizio_membros (tenant_id, user_id, ativo, encerramento_adiado_ate)
  VALUES (v_tenant, v_uid, false, v_ate)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET encerramento_adiado_ate = EXCLUDED.encerramento_adiado_ate;
  RETURN public.ponto_fim_expediente();
END $fn$;
REVOKE ALL ON FUNCTION public.ponto_adiar_encerramento(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_adiar_encerramento(integer) TO authenticated, service_role;

-- ponto_vigia: mesmo corpo de 20260909100100 + regra (a2) da saída da SDR.
CREATE OR REPLACE FUNCTION public.ponto_vigia()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  r record;
  s record;
  h record;
  v_cfg record;
  v_tz text;
  v_dia date;
  v_corte timestamptz;
  v_fim timestamptz;
  v_adiado timestamptz;
  v_em timestamptz;
  v_nome text;
  v_min_pausa integer;
  v_encerrados integer := 0;
  v_alertas integer := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('ponto:vigia')) THEN
    RETURN jsonb_build_object('encerrados_auto', 0, 'alertas_pausa', 0, 'pulado', true);
  END IF;
  FOR r IN
    SELECT DISTINCT ON (e.tenant_id, e.user_id) e.tenant_id, e.user_id, e.tipo
      FROM public.crm_ponto_eventos e
     ORDER BY e.tenant_id, e.user_id, e.em DESC, e.id DESC
  LOOP
    IF r.tipo = 'encerrar' THEN CONTINUE; END IF;

    SELECT x.* INTO s
      FROM public.ponto_sessoes(
             r.tenant_id, r.user_id,
             (SELECT max(e.em) FROM public.crm_ponto_eventos e
               WHERE e.tenant_id = r.tenant_id AND e.user_id = r.user_id AND e.tipo = 'abrir'),
             now()) x
     ORDER BY x.abriu_em DESC LIMIT 1;
    IF s.estado IS NULL OR s.estado = 'fechado' THEN CONTINUE; END IF;

    SELECT c.auto_encerrar, c.pausa_alerta_min, c.gestor_user_id INTO v_cfg
      FROM public.crm_rodizio_config c WHERE c.tenant_id = r.tenant_id;
    v_tz := public.ponto_fuso_do_tenant(r.tenant_id);

    -- (a) expediente esquecido: encerra no corte (auto_encerrar) do dia da
    -- clínica em que foi aberto; se abriu depois do corte, no do dia seguinte.
    v_dia := (s.abriu_em AT TIME ZONE v_tz)::date;
    v_corte := (v_dia + COALESCE(v_cfg.auto_encerrar, time '23:59')) AT TIME ZONE v_tz;
    IF s.abriu_em >= v_corte THEN
      v_corte := ((v_dia + 1) + COALESCE(v_cfg.auto_encerrar, time '23:59')) AT TIME ZONE v_tz;
    END IF;
    IF now() >= v_corte THEN
      v_em := GREATEST(v_corte, s.ultimo_evento_em);
      INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, origem, em)
      VALUES (r.tenant_id, r.user_id, 'encerrar', 'auto', v_em);
      v_encerrados := v_encerrados + 1;
      CONTINUE;
    END IF;

    -- (a2) saída do horário da SDR: sessão aberta ANTES da saída de hoje encerra
    -- sozinha depois da saída + 1 min (o cartão pergunta antes), salvo adiamento
    -- em vigor. Aberta depois da saída (hora extra) fica para a regra (a).
    SELECT * INTO h FROM public.rodizio_horario_dia(r.tenant_id, r.user_id, (now() AT TIME ZONE v_tz)::date);
    IF h.saida IS NOT NULL THEN
      v_fim := ((now() AT TIME ZONE v_tz)::date + h.saida) AT TIME ZONE v_tz;
      SELECT m.encerramento_adiado_ate INTO v_adiado
        FROM public.crm_rodizio_membros m WHERE m.tenant_id = r.tenant_id AND m.user_id = r.user_id;
      IF v_adiado IS NOT NULL AND v_adiado > v_fim THEN v_fim := v_adiado; END IF;
      IF s.abriu_em < v_fim AND now() >= v_fim + interval '1 minute' THEN
        v_em := GREATEST(v_fim, s.ultimo_evento_em);
        INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, origem, em)
        VALUES (r.tenant_id, r.user_id, 'encerrar', 'auto', v_em);
        v_encerrados := v_encerrados + 1;
        CONTINUE;
      END IF;
    END IF;

    -- (b) pausa longa: um aviso por pausa (dedupe pelo id do evento 'pausar').
    IF s.estado = 'pausado' AND v_cfg.gestor_user_id IS NOT NULL
       AND now() - s.pausa_desde >= make_interval(mins => COALESCE(v_cfg.pausa_alerta_min, 75))
       AND NOT EXISTS (SELECT 1 FROM public.crm_notifications n
                        WHERE n.user_id = v_cfg.gestor_user_id
                          AND n.dedupe_key = 'ponto_pausa_longa:' || s.ultimo_evento_id) THEN
      SELECT p.nome INTO v_nome FROM public.profiles p WHERE p.id = r.user_id;
      v_min_pausa := (EXTRACT(EPOCH FROM (now() - s.pausa_desde)) / 60)::integer;
      INSERT INTO public.crm_notifications AS n (user_id, title, body, type, dedupe_key)
      VALUES (
        v_cfg.gestor_user_id,
        'Pausa longa: ' || COALESCE(v_nome, 'SDR'),
        'Em pausa (' || CASE s.motivo_pausa WHEN 'cafe' THEN 'café' WHEN 'almoco' THEN 'almoço' ELSE 'outro' END
          || ') há ' || v_min_pausa || ' min — acima do limite de '
          || COALESCE(v_cfg.pausa_alerta_min, 75) || ' min.',
        'ponto_pausa_longa',
        'ponto_pausa_longa:' || s.ultimo_evento_id
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE
        SET user_id = EXCLUDED.user_id, lead_id = NULL, title = EXCLUDED.title, body = EXCLUDED.body,
            type = EXCLUDED.type, is_read = false, created_at = now()
        WHERE n.user_id IS DISTINCT FROM EXCLUDED.user_id;
      v_alertas := v_alertas + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('encerrados_auto', v_encerrados, 'alertas_pausa', v_alertas);
END $fn$;
