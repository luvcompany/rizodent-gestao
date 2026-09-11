SET LOCAL lock_timeout = '5s';

ALTER TABLE public.crm_rodizio_config
  ADD COLUMN IF NOT EXISTS realocar_carencia_abertura_min integer NOT NULL DEFAULT 60;
COMMENT ON COLUMN public.crm_rodizio_config.realocar_carencia_abertura_min IS
  'Minutos a MAIS no limite de silêncio quando a mensagem do lead chegou fora do HORÁRIO CONTRATADO da dona (antes da entrada, depois da saída, fim de semana, feriado ou dia em que a clínica não abre). É o prazo maior da manhã: a SDR abre o dia com a fila acumulada e tem folga para responder. Pausa/almoço NÃO dão carência: ali o relógio dela já está parado. 0 desliga. Gravado por rodizio_definir_carencia_abertura.';

CREATE OR REPLACE FUNCTION public.rodizio_minutos_da_sdr(p_tenant uuid, p_user uuid, p_de timestamptz, p_ate timestamptz)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_ev record;
  v_estado text;          -- 'aberto' | 'pausado' | 'fechado' — vigente no trecho corrente
  v_marca timestamptz;    -- início do trecho corrente
  v_de timestamptz;       -- p_de, encurtado para no máximo 30 dias (ver o teto)
  v_seg numeric := 0;
  v_abertos tstzrange[] := ARRAY[]::tstzrange[];   -- os trechos com o ponto ABERTO
  v_tz text; v_d date; v_ultimo date;
  v_abre time; v_fecha time;   -- a janela da CLÍNICA naquele dia (o grampo)
  v_janela tstzrange;     -- a janela do dia, já em timestamptz
  v_trecho tstzrange; v_corte tstzrange;
BEGIN
  IF p_tenant IS NULL OR p_user IS NULL OR p_de IS NULL OR p_ate IS NULL OR p_ate <= p_de THEN RETURN 0; END IF;

  v_de := GREATEST(p_de, p_ate - interval '30 days');

  SELECT CASE e.tipo WHEN 'abrir'   THEN 'aberto'
                     WHEN 'retomar' THEN 'aberto'
                     WHEN 'pausar'  THEN 'pausado'
                     ELSE 'fechado' END
    INTO v_estado
    FROM public.crm_ponto_eventos e
   WHERE e.tenant_id = p_tenant AND e.user_id = p_user AND e.em <= v_de
   ORDER BY e.em DESC, e.id DESC
   LIMIT 1;
  v_estado := COALESCE(v_estado, 'fechado');
  v_marca := v_de;

  FOR v_ev IN
    SELECT e.tipo, e.em
      FROM public.crm_ponto_eventos e
     WHERE e.tenant_id = p_tenant AND e.user_id = p_user
       AND e.em > v_de AND e.em <= p_ate
     ORDER BY e.em, e.id
  LOOP
    IF v_estado = 'aberto' AND v_ev.em > v_marca THEN
      v_abertos := v_abertos || tstzrange(v_marca, v_ev.em, '[)');
    END IF;
    v_estado := CASE v_ev.tipo WHEN 'abrir'   THEN 'aberto'
                               WHEN 'retomar' THEN 'aberto'
                               WHEN 'pausar'  THEN 'pausado'
                               ELSE 'fechado' END;
    v_marca := v_ev.em;
  END LOOP;

  IF v_estado = 'aberto' AND p_ate > v_marca THEN
    v_abertos := v_abertos || tstzrange(v_marca, p_ate, '[)');
  END IF;

  IF array_length(v_abertos, 1) IS NULL THEN RETURN 0; END IF;

  v_tz := public.rodizio_tz(p_tenant);
  v_d := (v_de AT TIME ZONE v_tz)::date;
  v_ultimo := (p_ate AT TIME ZONE v_tz)::date;
  WHILE v_d <= v_ultimo LOOP
    BEGIN
      SELECT (t.business_hours -> (extract(dow FROM v_d)::int)::text ->> 0)::time,
             (t.business_hours -> (extract(dow FROM v_d)::int)::text ->> 1)::time
        INTO v_abre, v_fecha
        FROM public.tenants t
       WHERE t.id = p_tenant
         AND jsonb_typeof(t.business_hours -> (extract(dow FROM v_d)::int)::text) = 'array'
         AND jsonb_array_length(t.business_hours -> (extract(dow FROM v_d)::int)::text) >= 2;
    EXCEPTION WHEN OTHERS THEN
      v_abre := NULL; v_fecha := NULL;
    END;
    IF v_abre IS NOT NULL AND v_fecha IS NOT NULL AND v_fecha > v_abre
       AND NOT public.rodizio_feriado(p_tenant, v_d) THEN
      v_janela := tstzrange((v_d + v_abre)  AT TIME ZONE v_tz,
                            (v_d + v_fecha) AT TIME ZONE v_tz, '[)');
      FOREACH v_trecho IN ARRAY v_abertos LOOP
        v_corte := v_trecho * v_janela;
        IF NOT isempty(v_corte) THEN
          v_seg := v_seg + extract(epoch FROM (upper(v_corte) - lower(v_corte)));
        END IF;
      END LOOP;
    END IF;
    v_d := v_d + 1;
  END LOOP;

  RETURN floor(v_seg / 60)::integer;
END $fn$;
REVOKE ALL ON FUNCTION public.rodizio_minutos_da_sdr(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rodizio_minutos_da_sdr(uuid, uuid, timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.rodizio_fim_do_expediente(p_tenant uuid, p_data date)
RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tz text; v_dia jsonb; v_fecha time;
BEGIN
  IF p_tenant IS NULL OR p_data IS NULL THEN RETURN NULL; END IF;
  SELECT t.business_hours -> (extract(dow FROM p_data)::int)::text INTO v_dia
    FROM public.tenants t WHERE t.id = p_tenant;
  IF v_dia IS NULL OR jsonb_typeof(v_dia) <> 'array' OR jsonb_array_length(v_dia) < 2 THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_fecha := (v_dia ->> 1)::time;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  v_tz := public.rodizio_tz(p_tenant);
  RETURN (p_data + v_fecha) AT TIME ZONE v_tz;
END $fn$;
REVOKE ALL ON FUNCTION public.rodizio_fim_do_expediente(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rodizio_fim_do_expediente(uuid, date) TO service_role;


CREATE OR REPLACE FUNCTION public.rodizio_realocar_sem_resposta()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  c record; cfg public.crm_rodizio_config; r record; l public.crm_leads;
  v_funis uuid[]; v_etapas uuid[]; v_tz text; v_ini timestamptz;
  v_ids uuid[]; v_cargas integer[]; v_ponteiro uuid; v_alvo uuid; v_ok uuid;
  v_n integer := 0; v_run uuid := gen_random_uuid(); v_min integer; v_de_nome text; v_para_nome text;
  v_txt text;   -- o silêncio em texto: "N min úteis" ou "mais de 30 dias" (sentinela)
  v_limite integer;   -- o limite DESTE lead: base + carência de abertura quando cabe
  v_fora boolean;     -- a mensagem do lead chegou FORA do horário contratado da dona?
  v_hoje date;        -- "hoje" na hora da clínica (o dia do teto de ausência)
  v_ausente boolean;  -- a dona não abriu o expediente hoje?
  h record;           -- horário contratado da dona HOJE (teto de ausência)
  hin record;         -- horário contratado da dona no DIA do inbound (carência)
  v_dia_in date;      -- o dia local em que a mensagem do lead chegou
  v_calados integer;  -- quantos leads dela estão calados (vai no aviso ao gestor)
  v_avisadas uuid[];  -- donas já avisadas NESTA rodada (um aviso por dona)
BEGIN
  FOR c IN SELECT k.tenant_id FROM public.crm_rodizio_config k WHERE k.modo <> 'desligado' LOOP
    IF NOT pg_try_advisory_xact_lock(hashtext('rodizio:realoc:' || c.tenant_id::text)) THEN CONTINUE; END IF;
    SELECT * INTO cfg FROM public.crm_rodizio_config WHERE tenant_id = c.tenant_id FOR UPDATE;
    IF NOT FOUND OR cfg.modo = 'desligado' THEN CONTINUE; END IF;
    IF cfg.realocar_sem_resposta_min IS NULL OR cfg.realocar_sem_resposta_min <= 0 THEN CONTINUE; END IF;
    IF NOT public.rodizio_em_expediente(c.tenant_id, now()) THEN CONTINUE; END IF;
    v_funis := public.rodizio_funis(c.tenant_id);
    v_etapas := public.rodizio_etapas_entrada(c.tenant_id);
    IF v_funis IS NULL OR v_etapas IS NULL THEN CONTINUE; END IF;
    v_tz := public.rodizio_tz(c.tenant_id);
    v_hoje := (now() AT TIME ZONE v_tz)::date;
    v_ini := (v_hoje::timestamp) AT TIME ZONE v_tz;
    v_avisadas := ARRAY[]::uuid[];

    FOR r IN
      SELECT cand.id, cand.dona, cand.last_inbound_at, cand.desde, cand.conversa_fechada_em
        FROM (
          SELECT l0.id, l0.assigned_to AS dona, l0.last_inbound_at, l0.distribuido_em AS desde, l0.conversa_fechada_em
            FROM public.crm_leads l0
           WHERE cfg.modo = 'ligado'
             AND l0.tenant_id = c.tenant_id
             AND l0.pipeline_id = ANY (v_funis)
             AND l0.stage_id = ANY (v_etapas)
             AND l0.distribuido_em IS NOT NULL
             AND l0.assigned_to IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM public.crm_stages s WHERE s.id = l0.stage_id AND NOT COALESCE(s.visivel_para_sdr, true))
             AND NOT EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = l0.id)
             AND (cfg.gestor_user_id IS NULL OR l0.assigned_to <> cfg.gestor_user_id)
             AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = l0.assigned_to AND ur.role = 'sdr'::app_role)
             AND NOT COALESCE(l0.is_blocked, false)
             AND l0.last_inbound_at IS NOT NULL
             AND (COALESCE(cfg.entrada_todas_etapas, false)
                  OR NOT EXISTS (SELECT 1 FROM public.crm_appointments a
                                  WHERE a.lead_id = l0.id AND COALESCE(a.status, '') <> 'cancelled'))
             AND NOT EXISTS (SELECT 1 FROM public.crm_lead_atribuicoes a
                              WHERE a.lead_id = l0.id AND a.fase = 'realocacao_1h' AND a.criado_em >= v_ini)
          UNION ALL
          SELECT l0.id, sb.para_user_id, l0.last_inbound_at, sb.criado_em, l0.conversa_fechada_em
            FROM public.crm_leads l0
            JOIN LATERAL (
              SELECT a.para_user_id, a.criado_em
                FROM public.crm_lead_atribuicoes a
               WHERE a.lead_id = l0.id AND a.fase = 'sombra' AND a.para_user_id IS NOT NULL
               ORDER BY a.criado_em DESC, a.id DESC
               LIMIT 1) sb ON true
           WHERE cfg.modo = 'sombra'
             AND l0.tenant_id = c.tenant_id
             AND l0.pipeline_id = ANY (v_funis)
             AND l0.stage_id = ANY (v_etapas)
             AND (l0.assigned_to IS NULL OR l0.assigned_to = cfg.gestor_user_id)
             AND NOT COALESCE(l0.is_blocked, false)
             AND l0.last_inbound_at IS NOT NULL
             AND (COALESCE(cfg.entrada_todas_etapas, false)
                  OR NOT EXISTS (SELECT 1 FROM public.crm_appointments a
                                  WHERE a.lead_id = l0.id AND COALESCE(a.status, '') <> 'cancelled'))
             AND NOT EXISTS (SELECT 1 FROM public.crm_lead_atribuicoes a
                              WHERE a.lead_id = l0.id AND a.fase = 'sombra'
                                AND a.motivo LIKE 'realocação:%' AND a.criado_em >= v_ini)
        ) cand
       WHERE GREATEST(cand.last_inbound_at, cand.desde) < now() - make_interval(mins => cfg.realocar_sem_resposta_min)
         AND NOT EXISTS (
               SELECT 1 FROM public.messages m
                WHERE m.lead_id = cand.id
                  AND m.created_at >= cand.last_inbound_at
                  AND public.rodizio_msg_humana(m))
       ORDER BY GREATEST(cand.last_inbound_at, cand.desde)
       LIMIT 100
    LOOP
      IF cfg.modo = 'sombra' THEN
        v_fora := false;
        v_ausente := false;
        v_limite := cfg.realocar_sem_resposta_min;
        v_min := public.rodizio_minutos_uteis(c.tenant_id, GREATEST(r.last_inbound_at, r.desde), now());
        v_txt := CASE WHEN v_min >= 999999 THEN 'mais de 30 dias' ELSE v_min || ' min úteis' END;
      ELSE
        SELECT * INTO h FROM public.rodizio_horario_dia(c.tenant_id, r.dona, v_hoje);

        v_ausente := NOT EXISTS (SELECT 1 FROM public.crm_ponto_eventos e
                                  WHERE e.tenant_id = c.tenant_id
                                    AND e.user_id = r.dona
                                    AND e.tipo IN ('abrir', 'retomar')
                                    AND e.em >= v_ini)
                     AND (h.entrada IS NULL
                          OR now() >= LEAST(
                               ((v_hoje + h.entrada) AT TIME ZONE v_tz)
                                 + make_interval(mins => COALESCE(cfg.corte_tolerancia_min, 60)),
                               public.rodizio_fim_do_expediente(c.tenant_id, v_hoje) - interval '5 minutes'))
                     AND public.rodizio_minutos_da_sdr(c.tenant_id, r.dona, v_ini, now()) = 0;

        IF v_ausente THEN
          IF NOT (r.dona = ANY (v_avisadas))
             AND NOT EXISTS (SELECT 1 FROM public.crm_notifications n
                              WHERE n.user_id = cfg.gestor_user_id
                                AND n.dedupe_key = 'rodizio:dona_ausente:' || c.tenant_id::text
                                                   || ':' || r.dona::text || ':' || v_hoje::text) THEN
            v_avisadas := v_avisadas || r.dona;
            SELECT count(*) INTO v_calados
              FROM public.crm_leads x
             WHERE x.tenant_id = c.tenant_id
               AND x.assigned_to = r.dona
               AND x.pipeline_id = ANY (v_funis)
               AND x.stage_id = ANY (v_etapas)
               AND x.distribuido_em IS NOT NULL
               AND NOT COALESCE(x.is_blocked, false)
               AND x.last_inbound_at IS NOT NULL
               AND x.last_inbound_at < now() - make_interval(mins => cfg.realocar_sem_resposta_min)
               AND NOT EXISTS (SELECT 1 FROM public.messages m
                                WHERE m.lead_id = x.id
                                  AND m.created_at >= x.last_inbound_at
                                  AND public.rodizio_msg_humana(m));
            PERFORM public.rodizio_notifica(cfg.gestor_user_id, NULL,
              'Rodízio: ' || public.rodizio_nome(r.dona) || ' não abriu o expediente hoje',
              v_calados || ' lead(s) dela sem resposta humana há mais de '
                || cfg.realocar_sem_resposta_min || ' min. Enquanto ela não abrir o ponto, '
                || 'esses leads contam pelo relógio da clínica e podem ser realocados para quem está na mesa.',
              'rodizio:dona_ausente:' || c.tenant_id::text || ':' || r.dona::text || ':' || v_hoje::text);
          END IF;
          v_dia_in := (r.last_inbound_at AT TIME ZONE v_tz)::date;
          SELECT * INTO hin FROM public.rodizio_horario_dia(c.tenant_id, r.dona, v_dia_in);
          v_fora := NOT public.rodizio_dia_util(c.tenant_id, v_dia_in)
                    OR hin.entrada IS NULL OR hin.saida IS NULL
                    OR r.last_inbound_at <  ((v_dia_in + hin.entrada) AT TIME ZONE v_tz)
                    OR r.last_inbound_at >= ((v_dia_in + hin.saida)   AT TIME ZONE v_tz);
          v_limite := cfg.realocar_sem_resposta_min
                    + CASE WHEN v_fora THEN COALESCE(cfg.realocar_carencia_abertura_min, 60) ELSE 0 END;
          v_min := public.rodizio_minutos_uteis(c.tenant_id, GREATEST(r.last_inbound_at, r.desde), now());
          v_txt := CASE WHEN v_min >= 999999 THEN 'mais de 30 dias' ELSE v_min || ' min úteis' END
                || ' (relógio da clínica porque a dona não abriu o expediente hoje)';
        ELSE
          v_dia_in := (r.last_inbound_at AT TIME ZONE v_tz)::date;
          SELECT * INTO hin FROM public.rodizio_horario_dia(c.tenant_id, r.dona, v_dia_in);
          v_fora := NOT public.rodizio_dia_util(c.tenant_id, v_dia_in)
                    OR hin.entrada IS NULL OR hin.saida IS NULL
                    OR r.last_inbound_at <  ((v_dia_in + hin.entrada) AT TIME ZONE v_tz)
                    OR r.last_inbound_at >= ((v_dia_in + hin.saida)   AT TIME ZONE v_tz);
          v_limite := cfg.realocar_sem_resposta_min
                    + CASE WHEN v_fora THEN COALESCE(cfg.realocar_carencia_abertura_min, 60) ELSE 0 END;
          v_min := public.rodizio_minutos_da_sdr(c.tenant_id, r.dona, GREATEST(r.last_inbound_at, r.desde), now());
          v_txt := v_min || ' min de expediente dela'
                || CASE WHEN v_fora THEN ' (mensagem chegou fora do horário dela)' ELSE '' END;
        END IF;
      END IF;
      CONTINUE WHEN v_min < v_limite;

      SELECT array_agg(p.user_id ORDER BY p.ordem), array_agg(p.carga ORDER BY p.ordem)
        INTO v_ids, v_cargas
        FROM public.rodizio_pool(c.tenant_id) p
       WHERE p.aberta AND p.user_id <> r.dona;
      IF v_ids IS NULL THEN
        SELECT array_agg(p.user_id ORDER BY p.ordem), array_agg(p.carga ORDER BY p.ordem)
          INTO v_ids, v_cargas
          FROM public.rodizio_pool(c.tenant_id) p
         WHERE p.presente AND p.user_id <> r.dona;
      END IF;
      CONTINUE WHEN v_ids IS NULL;   -- ninguém (além da própria dona) presente: fica onde está
      SELECT k.ponteiro_user_id INTO v_ponteiro FROM public.crm_rodizio_config k WHERE k.tenant_id = c.tenant_id;
      v_alvo := public.rodizio_escolher(v_ids, v_cargas, v_ponteiro);
      CONTINUE WHEN v_alvo IS NULL;
      SELECT * INTO l FROM public.crm_leads WHERE id = r.id;
      v_de_nome := public.rodizio_nome(r.dona);
      v_para_nome := public.rodizio_nome(v_alvo);

      IF cfg.modo = 'sombra' THEN
        PERFORM public.rodizio_livro(l, r.dona, v_alvo, 'sombra',
          'realocação: iria de ' || v_de_nome || ' para ' || v_para_nome || ' (' || v_txt || ' sem resposta humana)', v_run);
        UPDATE public.crm_rodizio_config SET ponteiro_user_id = v_alvo WHERE tenant_id = c.tenant_id;
        v_n := v_n + 1;
        CONTINUE;
      END IF;

      v_ok := NULL;
      PERFORM set_config('rodizio.autorizado', 'sim', true);
      UPDATE public.crm_leads
         SET assigned_to = v_alvo, distribuido_em = now(),
             rodizio_reservado_para = NULL, rodizio_reservado_em = NULL, updated_at = now()
       WHERE id = r.id
         AND assigned_to = r.dona
         AND last_inbound_at IS NOT DISTINCT FROM r.last_inbound_at
         AND distribuido_em IS NOT DISTINCT FROM r.desde
         AND conversa_fechada_em IS NOT DISTINCT FROM r.conversa_fechada_em
       RETURNING id INTO v_ok;
      PERFORM set_config('rodizio.autorizado', '', true);
      CONTINUE WHEN v_ok IS NULL;
      UPDATE public.crm_rodizio_config SET ponteiro_user_id = v_alvo WHERE tenant_id = c.tenant_id;
      PERFORM public.rodizio_livro(l, r.dona, v_alvo, 'realocacao_1h',
        v_txt || ' sem resposta humana da dona (limite ' || v_limite || ' min'
        || CASE WHEN v_fora
                THEN ' = ' || cfg.realocar_sem_resposta_min || ' + '
                     || COALESCE(cfg.realocar_carencia_abertura_min, 60)
                     || ' de carência porque a mensagem chegou fora do horário contratado dela'
                ELSE '' END
        || CASE WHEN v_ausente THEN '' ELSE ', relógio do expediente dela' END || ')', v_run);
      PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
        '🔀 Lead realocado de ' || v_de_nome || ' para ' || v_para_nome || ': ' || v_txt || ' sem resposta');
      PERFORM public.rodizio_notifica(v_alvo, l.id, 'Lead realocado para você',
        COALESCE(NULLIF(btrim(l.name), ''), 'Lead') || ' · sem resposta há ' || v_txt);
      PERFORM public.rodizio_notifica(r.dona, NULL, 'Lead realocado',
        COALESCE(NULLIF(btrim(l.name), ''), 'Um lead') || ' foi para ' || v_para_nome || ' após ' || v_txt || ' sem resposta.');
      v_n := v_n + 1;
    END LOOP;
  END LOOP;
  RETURN v_n;
END $fn$;

CREATE OR REPLACE FUNCTION public.rodizio_definir_carencia_abertura(p_min integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id(); v_antes integer;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sem cliente ativo.' USING ERRCODE = '42501';
  END IF;
  IF p_min IS NULL OR p_min < 0 OR p_min > 480 THEN
    RAISE EXCEPTION 'Informe uma carência entre 0 (desligada) e 480 minutos.' USING ERRCODE = '22023';
  END IF;
  SELECT realocar_carencia_abertura_min INTO v_antes FROM public.crm_rodizio_config WHERE tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rodízio não configurado para este cliente.' USING ERRCODE = '22023';
  END IF;
  IF v_antes IS DISTINCT FROM p_min THEN
    UPDATE public.crm_rodizio_config SET realocar_carencia_abertura_min = p_min WHERE tenant_id = v_tenant;
    INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
    VALUES (auth.uid(), v_tenant, 'tenant', 'rodizio_carencia_abertura', jsonb_build_object('de', v_antes, 'para', p_min));
  END IF;
  RETURN jsonb_build_object('minutos', p_min, 'antes', v_antes);
END $fn$;
REVOKE ALL ON FUNCTION public.rodizio_definir_carencia_abertura(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rodizio_definir_carencia_abertura(integer) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.rodizio_estado()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id(); cfg public.crm_rodizio_config; v_tz text; v_local timestamp; v_reservas integer; v_entregas integer; v_funis uuid[];
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO cfg FROM public.crm_rodizio_config WHERE tenant_id = v_tenant;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_tz := public.rodizio_tz(v_tenant);
  v_local := now() AT TIME ZONE v_tz;
  v_funis := public.rodizio_funis(v_tenant);
  SELECT count(*) INTO v_reservas FROM public.crm_leads x
   WHERE x.tenant_id = v_tenant AND x.rodizio_reservado_para IS NOT NULL AND x.distribuido_em IS NULL;
  SELECT count(*) INTO v_entregas FROM public.crm_entregas_gestor e WHERE e.tenant_id = v_tenant;
  RETURN jsonb_build_object(
    'modo', cfg.modo,
    'modo_alterado_em', cfg.modo_alterado_em,
    'ponteiro_user_id', cfg.ponteiro_user_id,
    'preferir_em_expediente', cfg.preferir_em_expediente,
    'realocar_sem_resposta_min', cfg.realocar_sem_resposta_min,
    'realocar_carencia_abertura_min', cfg.realocar_carencia_abertura_min,
    'entrega_gestor_apos_min', cfg.entrega_gestor_apos_min,
    'entregas_pendentes', v_entregas,
    'corte_tolerancia_min', cfg.corte_tolerancia_min,
    'hora_corte', cfg.hora_corte,
    'corte_ate', cfg.corte_ate,
    'auto_encerrar', cfg.auto_encerrar,
    'funil_id', public.rodizio_funil(v_tenant),
    'funis_ids', to_jsonb(v_funis),
    'funis', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.name)
                       ORDER BY COALESCE(p.position, 1000), p.created_at)
        FROM public.crm_pipelines p
       WHERE p.tenant_id = v_tenant
         AND p.id = ANY (COALESCE(v_funis, ARRAY[]::uuid[]))), '[]'::jsonb),
    'etapas_entrada', to_jsonb(public.rodizio_etapas_entrada(v_tenant)),
    'fuso', v_tz,
    'agora_local', v_local,
    'em_expediente', public.rodizio_em_expediente(v_tenant, now()),
    'dia_util', public.rodizio_dia_util(v_tenant, v_local::date),
    'reservas_pendentes', v_reservas,
    'reservas_aviso', CASE WHEN cfg.modo <> 'ligado' AND v_reservas > 0
                           THEN 'Há ' || v_reservas || ' reserva(s) pendente(s) com o motor em modo ' || cfg.modo
                                || ': reservas só se aplicam em modo ligado.' END,
    'equipe', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', p.user_id, 'nome', p.nome, 'estado', p.estado, 'aberta', p.aberta, 'carga', p.carga,
               'reservas', (SELECT count(*) FROM public.crm_leads x
                             WHERE x.tenant_id = v_tenant AND x.rodizio_reservado_para = p.user_id AND x.distribuido_em IS NULL),
               'em_almoco', public.rodizio_em_almoco(v_tenant, p.user_id, now()),
               'entrada_hoje', (SELECT to_char(hd.entrada, 'HH24:MI') FROM public.rodizio_horario_dia(v_tenant, p.user_id, v_local::date) hd),
               'saida_hoje', (SELECT to_char(hd.saida, 'HH24:MI') FROM public.rodizio_horario_dia(v_tenant, p.user_id, v_local::date) hd))
             ORDER BY p.ordem)
        FROM public.rodizio_pool(v_tenant) p), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.rodizio_estado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rodizio_estado() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.rodizio_realocar_sem_resposta() FROM PUBLIC, anon, authenticated;