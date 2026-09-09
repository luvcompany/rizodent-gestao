-- Pedidos do dono em 09/09/2026 (noite):
--  1. Ordem dos funis ajustável (crm_pipelines.position + pipelines_definir_ordem).
--  2. Horário por SDR (entrada, saída, almoço, sábado) definido pelo gestor na
--     aba Equipe, e corte das reservas "1 hora depois da entrada de cada uma"
--     em vez de um horário fixo: quem não abriu até entrada + tolerância (ou
--     não trabalha naquele dia) tem as reservas passadas para quem está em
--     expediente. Domingo/feriado nada se move.
--  3. Fim da carência sem contrato: lead em "Compareceu" cuja consulta segue
--     not_contracted vai para "Não contratado" ao passar ao administrador.
--     E o comparecimento marcado pelo Dontus/CRC em lead de SDR passa a
--     refletir no funil (Compareceu / Contratado) para o ciclo dela fechar.
--  4. Reagendamentos e faltas repetidas por SDR (relatorio_sdr_reagendamentos).

-- ================================================================ 1. ordem dos funis
ALTER TABLE public.crm_pipelines ADD COLUMN IF NOT EXISTS position integer;
WITH n AS (
  SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn FROM public.crm_pipelines
)
UPDATE public.crm_pipelines p SET position = n.rn FROM n WHERE n.id = p.id AND p.position IS NULL;
ALTER TABLE public.crm_pipelines ALTER COLUMN position SET DEFAULT 1000;

CREATE OR REPLACE FUNCTION public.pipelines_definir_ordem(p_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id(); i integer; v_n integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role)
                                OR public.has_role(auth.uid(), 'superadmin'::app_role)) THEN
    RAISE EXCEPTION 'Só a gestão reordena os funis.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL OR p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN RETURN 0; END IF;
  FOR i IN 1..array_length(p_ids, 1) LOOP
    UPDATE public.crm_pipelines SET position = i WHERE id = p_ids[i] AND tenant_id = v_tenant;
    IF FOUND THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.pipelines_definir_ordem(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pipelines_definir_ordem(uuid[]) TO authenticated, service_role;

-- ================================================================ 2. horário por SDR e corte relativo
ALTER TABLE public.crm_rodizio_membros
  ADD COLUMN IF NOT EXISTS hora_entrada time,
  ADD COLUMN IF NOT EXISTS hora_saida time,
  ADD COLUMN IF NOT EXISTS almoco_inicio time,
  ADD COLUMN IF NOT EXISTS almoco_fim time,
  ADD COLUMN IF NOT EXISTS sabado_entrada time,
  ADD COLUMN IF NOT EXISTS sabado_saida time;
ALTER TABLE public.crm_rodizio_config ADD COLUMN IF NOT EXISTS corte_tolerancia_min integer NOT NULL DEFAULT 60;
COMMENT ON COLUMN public.crm_rodizio_config.corte_tolerancia_min IS
  'Minutos depois da entrada da SDR para o corte: reserva de quem não abriu o expediente até entrada + tolerância vai para quem abriu.';

CREATE OR REPLACE FUNCTION public.equipe_definir_horario(
  p_user_id uuid, p_entrada time, p_saida time, p_almoco_inicio time, p_almoco_fim time, p_sabado_entrada time, p_sabado_saida time)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id(); v_email text;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  v_email := public.equipe_alvo_sdr(p_user_id);
  IF v_email IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'Esta pessoa não é uma SDR desta clínica (ou tem outro papel além de SDR).' USING ERRCODE = '42501';
  END IF;
  IF (p_entrada IS NULL) <> (p_saida IS NULL) THEN
    RAISE EXCEPTION 'Informe entrada e saída (ou deixe as duas em branco).' USING ERRCODE = '22023';
  END IF;
  IF p_entrada IS NOT NULL AND p_saida <= p_entrada THEN
    RAISE EXCEPTION 'A saída precisa ser depois da entrada.' USING ERRCODE = '22023';
  END IF;
  IF (p_almoco_inicio IS NULL) <> (p_almoco_fim IS NULL) THEN
    RAISE EXCEPTION 'Informe início e fim do almoço (ou deixe os dois em branco).' USING ERRCODE = '22023';
  END IF;
  IF p_almoco_inicio IS NOT NULL THEN
    IF p_entrada IS NULL THEN RAISE EXCEPTION 'Almoço só com entrada e saída definidas.' USING ERRCODE = '22023'; END IF;
    IF p_almoco_fim <= p_almoco_inicio OR p_almoco_inicio < p_entrada OR p_almoco_fim > p_saida THEN
      RAISE EXCEPTION 'O almoço precisa caber entre a entrada e a saída.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF (p_sabado_entrada IS NULL) <> (p_sabado_saida IS NULL) THEN
    RAISE EXCEPTION 'Informe entrada e saída do sábado (ou deixe as duas em branco).' USING ERRCODE = '22023';
  END IF;
  IF p_sabado_entrada IS NOT NULL AND p_sabado_saida <= p_sabado_entrada THEN
    RAISE EXCEPTION 'No sábado, a saída precisa ser depois da entrada.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.crm_rodizio_membros (tenant_id, user_id, ativo, hora_entrada, hora_saida, almoco_inicio, almoco_fim, sabado_entrada, sabado_saida)
  VALUES (v_tenant, p_user_id, false, p_entrada, p_saida, p_almoco_inicio, p_almoco_fim, p_sabado_entrada, p_sabado_saida)
  ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET hora_entrada = EXCLUDED.hora_entrada, hora_saida = EXCLUDED.hora_saida,
        almoco_inicio = EXCLUDED.almoco_inicio, almoco_fim = EXCLUDED.almoco_fim,
        sabado_entrada = EXCLUDED.sabado_entrada, sabado_saida = EXCLUDED.sabado_saida;

  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), v_tenant, 'tenant', 'sdr_horario',
          jsonb_build_object('target', p_user_id, 'target_email', v_email, 'entrada', p_entrada, 'saida', p_saida,
                             'almoco', CASE WHEN p_almoco_inicio IS NULL THEN NULL ELSE p_almoco_inicio::text || '-' || p_almoco_fim::text END,
                             'sabado', CASE WHEN p_sabado_entrada IS NULL THEN NULL ELSE p_sabado_entrada::text || '-' || p_sabado_saida::text END));
END $fn$;
REVOKE ALL ON FUNCTION public.equipe_definir_horario(uuid, time, time, time, time, time, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipe_definir_horario(uuid, time, time, time, time, time, time) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.equipe_horarios()
RETURNS TABLE(user_id uuid, hora_entrada time, hora_saida time, almoco_inicio time, almoco_fim time, sabado_entrada time, sabado_saida time)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT m.user_id, m.hora_entrada, m.hora_saida, m.almoco_inicio, m.almoco_fim, m.sabado_entrada, m.sabado_saida
    FROM public.crm_rodizio_membros m WHERE m.tenant_id = v_tenant;
END $fn$;
REVOKE ALL ON FUNCTION public.equipe_horarios() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipe_horarios() TO authenticated, service_role;

-- Horário de uma SDR num dia: o dela (seg–sex / sábado); sem horário próprio,
-- o horário comercial do cliente naquele dia da semana. NULL = não trabalha.
CREATE OR REPLACE FUNCTION public.rodizio_horario_dia(p_tenant uuid, p_user uuid, p_data date, OUT entrada time, OUT saida time)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE m record; v_dow integer := extract(dow FROM p_data)::integer; v_bh jsonb; v_dia jsonb;
BEGIN
  entrada := NULL; saida := NULL;
  SELECT * INTO m FROM public.crm_rodizio_membros WHERE tenant_id = p_tenant AND user_id = p_user;
  IF FOUND AND m.hora_entrada IS NOT NULL THEN
    IF v_dow BETWEEN 1 AND 5 THEN entrada := m.hora_entrada; saida := m.hora_saida;
    ELSIF v_dow = 6 THEN entrada := m.sabado_entrada; saida := m.sabado_saida;
    END IF;
    RETURN;
  END IF;
  SELECT t.business_hours INTO v_bh FROM public.tenants t WHERE t.id = p_tenant;
  IF v_bh IS NULL OR jsonb_typeof(v_bh) <> 'object' THEN RETURN; END IF;
  v_dia := v_bh -> v_dow::text;
  IF v_dia IS NULL OR jsonb_typeof(v_dia) <> 'array' OR jsonb_array_length(v_dia) < 2 THEN RETURN; END IF;
  BEGIN
    entrada := (v_dia ->> 0)::time; saida := (v_dia ->> 1)::time;
  EXCEPTION WHEN OTHERS THEN
    entrada := NULL; saida := NULL;
  END;
END $fn$;
REVOKE ALL ON FUNCTION public.rodizio_horario_dia(uuid, uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rodizio_definir_tolerancia_corte(p_min integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id(); v_antes integer;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem cliente ativo.' USING ERRCODE = '42501'; END IF;
  IF p_min IS NULL OR p_min < 0 OR p_min > 480 THEN
    RAISE EXCEPTION 'Informe um tempo entre 0 e 480 minutos.' USING ERRCODE = '22023';
  END IF;
  SELECT corte_tolerancia_min INTO v_antes FROM public.crm_rodizio_config WHERE tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rodízio não configurado para este cliente.' USING ERRCODE = '22023'; END IF;
  IF v_antes IS DISTINCT FROM p_min THEN
    UPDATE public.crm_rodizio_config SET corte_tolerancia_min = p_min WHERE tenant_id = v_tenant;
    INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
    VALUES (auth.uid(), v_tenant, 'tenant', 'rodizio_tolerancia_corte', jsonb_build_object('de', v_antes, 'para', p_min));
  END IF;
  RETURN jsonb_build_object('minutos', p_min, 'antes', v_antes);
END $fn$;
REVOKE ALL ON FUNCTION public.rodizio_definir_tolerancia_corte(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rodizio_definir_tolerancia_corte(integer) TO authenticated, service_role;

-- Corte (cron a cada 5 min, mesmo job rodizio-corte-9h): por SDR, relativo ao
-- horário dela. (1) quem está presente recebe o que é dela; (2) reserva de quem
-- não abriu até entrada + tolerância, ou de quem não trabalha hoje, vai para
-- quem está presente (abertas antes das pausadas); ninguém presente → um aviso
-- por dia ao gestor. Domingo/feriado (não é dia útil do cliente) nada se move.
CREATE OR REPLACE FUNCTION public.rodizio_corte_9h()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  c record; cfg public.crm_rodizio_config; m record; r record; l public.crm_leads; u uuid; h record;
  v_tz text; v_local timestamp; v_hoje date; v_pend integer; v_limite time; v_atrasada boolean; v_motivo text;
  v_abertas uuid[]; v_ids uuid[]; v_cargas integer[]; v_ponteiro uuid; v_alvo uuid; v_ok uuid;
  v_n integer := 0; v_run uuid := gen_random_uuid(); v_por_alvo jsonb; v_k text;
BEGIN
  FOR c IN SELECT k.tenant_id FROM public.crm_rodizio_config k WHERE k.modo = 'ligado' LOOP
    IF NOT pg_try_advisory_xact_lock(hashtext('rodizio:corte:' || c.tenant_id::text)) THEN CONTINUE; END IF;
    SELECT * INTO cfg FROM public.crm_rodizio_config WHERE tenant_id = c.tenant_id FOR UPDATE;
    IF NOT FOUND OR cfg.modo <> 'ligado' THEN CONTINUE; END IF;
    v_tz := public.rodizio_tz(c.tenant_id);
    v_local := now() AT TIME ZONE v_tz;
    v_hoje := v_local::date;
    IF NOT public.rodizio_dia_util(c.tenant_id, v_hoje) THEN CONTINUE; END IF;

    SELECT count(*) INTO v_pend FROM public.crm_leads x
     WHERE x.tenant_id = c.tenant_id AND x.rodizio_reservado_para IS NOT NULL AND x.distribuido_em IS NULL;
    IF v_pend = 0 THEN CONTINUE; END IF;

    SELECT array_agg(p.user_id ORDER BY p.ordem) FILTER (WHERE p.presente) INTO v_abertas
      FROM public.rodizio_pool(c.tenant_id) p;

    -- (1) quem está presente recebe o que é dela (idempotente)
    IF v_abertas IS NOT NULL THEN
      FOREACH u IN ARRAY v_abertas LOOP
        v_n := v_n + public.rodizio_aplicar_lote_ao_abrir(u);
      END LOOP;
    END IF;

    -- (2) reservas de quem não abriu no horário dela (ou não trabalha hoje)
    v_por_alvo := '{}'::jsonb;
    FOR m IN
      SELECT DISTINCT x.rodizio_reservado_para AS uid
        FROM public.crm_leads x
       WHERE x.tenant_id = c.tenant_id AND x.rodizio_reservado_para IS NOT NULL AND x.distribuido_em IS NULL
         AND (v_abertas IS NULL OR NOT (x.rodizio_reservado_para = ANY (v_abertas)))
    LOOP
      SELECT * INTO h FROM public.rodizio_horario_dia(c.tenant_id, m.uid, v_hoje);
      IF h.entrada IS NULL THEN
        v_atrasada := true;
        v_motivo := 'não trabalha hoje';
      ELSE
        v_limite := (h.entrada + make_interval(mins => COALESCE(cfg.corte_tolerancia_min, 60)))::time;
        v_atrasada := v_local::time >= v_limite;
        v_motivo := 'não abriu o expediente até ' || to_char(v_limite, 'HH24:MI')
                    || ' (entrada ' || to_char(h.entrada, 'HH24:MI') || ' + ' || COALESCE(cfg.corte_tolerancia_min, 60) || ' min)';
      END IF;
      CONTINUE WHEN NOT v_atrasada;

      IF v_abertas IS NULL THEN
        PERFORM public.rodizio_notifica(cfg.gestor_user_id, NULL,
          'Rodízio: ninguém abriu o expediente',
          'Há ' || v_pend || ' lead(s) reservados e nenhuma SDR abriu o expediente até '
            || to_char(v_local, 'HH24:MI') || '. Nada foi movido; o corte tenta de novo a cada 5 minutos.',
          'rodizio:corte_sem_aberta:' || c.tenant_id::text || ':' || v_hoje::text);
        EXIT;
      END IF;

      FOR r IN
        SELECT x.id FROM public.crm_leads x
         WHERE x.tenant_id = c.tenant_id AND x.rodizio_reservado_para = m.uid AND x.distribuido_em IS NULL
         ORDER BY x.rodizio_reservado_em NULLS FIRST, x.created_at
      LOOP
        SELECT array_agg(p.user_id ORDER BY p.ordem), array_agg(p.carga ORDER BY p.ordem)
          INTO v_ids, v_cargas FROM public.rodizio_pool(c.tenant_id) p WHERE p.aberta;
        IF v_ids IS NULL THEN
          SELECT array_agg(p.user_id ORDER BY p.ordem), array_agg(p.carga ORDER BY p.ordem)
            INTO v_ids, v_cargas FROM public.rodizio_pool(c.tenant_id) p WHERE p.presente;
        END IF;
        EXIT WHEN v_ids IS NULL;
        SELECT k.ponteiro_user_id INTO v_ponteiro FROM public.crm_rodizio_config k WHERE k.tenant_id = c.tenant_id;
        v_alvo := public.rodizio_escolher(v_ids, v_cargas, v_ponteiro);
        EXIT WHEN v_alvo IS NULL;

        SELECT * INTO l FROM public.crm_leads WHERE id = r.id;
        v_ok := NULL;
        UPDATE public.crm_leads
           SET assigned_to = v_alvo, distribuido_em = now(),
               rodizio_reservado_para = NULL, rodizio_reservado_em = NULL, updated_at = now()
         WHERE id = r.id
           AND distribuido_em IS NULL AND rodizio_reservado_para = m.uid
           AND (assigned_to IS NULL OR assigned_to = cfg.gestor_user_id)
           AND NOT COALESCE(is_blocked, false)
         RETURNING id INTO v_ok;
        IF v_ok IS NULL THEN
          UPDATE public.crm_leads SET rodizio_reservado_para = NULL, rodizio_reservado_em = NULL
           WHERE id = r.id AND distribuido_em IS NULL;
          PERFORM public.rodizio_livro(l, m.uid, NULL, 'saneamento',
            'reserva descartada no corte: o lead já não estava com o administrador (ou está bloqueado)', v_run);
          CONTINUE;
        END IF;
        UPDATE public.crm_rodizio_config SET ponteiro_user_id = v_alvo WHERE tenant_id = c.tenant_id;
        PERFORM public.rodizio_livro(l, m.uid, v_alvo, 'corte_9h',
          'corte: estava reservado para ' || public.rodizio_nome(m.uid) || ', que ' || v_motivo, v_run);
        PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
          '🔀 Lead entregue a ' || public.rodizio_nome(v_alvo) || ' no corte (estava reservado para '
            || public.rodizio_nome(m.uid) || ', que ' || v_motivo || ')');
        v_k := v_alvo::text;
        v_por_alvo := v_por_alvo || jsonb_build_object(v_k, COALESCE((v_por_alvo ->> v_k)::integer, 0) + 1);
        v_n := v_n + 1;
      END LOOP;
    END LOOP;

    FOR v_k IN SELECT j.key FROM jsonb_each(v_por_alvo) j LOOP
      PERFORM public.rodizio_notifica(v_k::uuid, NULL, 'Corte do rodízio',
        'Você recebeu ' || (v_por_alvo ->> v_k) || ' lead(s) reservados para colegas que não abriram o expediente.');
    END LOOP;
  END LOOP;
  RETURN v_n;
END $fn$;

-- rodizio_estado: + corte_tolerancia_min e horário de hoje de cada SDR
CREATE OR REPLACE FUNCTION public.rodizio_estado()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id(); cfg public.crm_rodizio_config; v_tz text; v_local timestamp; v_reservas integer; v_entregas integer;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO cfg FROM public.crm_rodizio_config WHERE tenant_id = v_tenant;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_tz := public.rodizio_tz(v_tenant);
  v_local := now() AT TIME ZONE v_tz;
  SELECT count(*) INTO v_reservas FROM public.crm_leads x
   WHERE x.tenant_id = v_tenant AND x.rodizio_reservado_para IS NOT NULL AND x.distribuido_em IS NULL;
  SELECT count(*) INTO v_entregas FROM public.crm_entregas_gestor e WHERE e.tenant_id = v_tenant;
  RETURN jsonb_build_object(
    'modo', cfg.modo,
    'modo_alterado_em', cfg.modo_alterado_em,
    'ponteiro_user_id', cfg.ponteiro_user_id,
    'preferir_em_expediente', cfg.preferir_em_expediente,
    'realocar_sem_resposta_min', cfg.realocar_sem_resposta_min,
    'entrega_gestor_apos_min', cfg.entrega_gestor_apos_min,
    'entregas_pendentes', v_entregas,
    'corte_tolerancia_min', cfg.corte_tolerancia_min,
    'hora_corte', cfg.hora_corte,
    'corte_ate', cfg.corte_ate,
    'auto_encerrar', cfg.auto_encerrar,
    'funil_id', public.rodizio_funil(v_tenant),
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
               'entrada_hoje', (SELECT to_char(hd.entrada, 'HH24:MI') FROM public.rodizio_horario_dia(v_tenant, p.user_id, v_local::date) hd),
               'saida_hoje', (SELECT to_char(hd.saida, 'HH24:MI') FROM public.rodizio_horario_dia(v_tenant, p.user_id, v_local::date) hd))
             ORDER BY p.ordem)
        FROM public.rodizio_pool(v_tenant) p), '[]'::jsonb));
END $fn$;

-- ================================================================ 3. fim da carência sem contrato → Não contratado
CREATE OR REPLACE FUNCTION public.sdr_pos_entrega_etapa(p_lead_id uuid, p_appointment_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE l public.crm_leads; v_atual text; v_sem_contrato boolean; v_alvo uuid; v_alvo_nome text;
BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT public.normaliza_nome_etapa(s.name) INTO v_atual FROM public.crm_stages s WHERE s.id = l.stage_id;
  IF v_atual IS DISTINCT FROM 'compareceu' THEN RETURN false; END IF;
  IF p_appointment_id IS NOT NULL THEN
    v_sem_contrato := EXISTS (SELECT 1 FROM public.crm_appointments a WHERE a.id = p_appointment_id AND a.status = 'not_contracted');
  ELSE
    v_sem_contrato := EXISTS (SELECT 1 FROM public.crm_appointments a WHERE a.lead_id = l.id AND a.status = 'not_contracted')
                  AND NOT EXISTS (SELECT 1 FROM public.crm_appointments a WHERE a.lead_id = l.id AND a.status = 'contracted');
  END IF;
  IF NOT v_sem_contrato THEN RETURN false; END IF;
  SELECT s.id, s.name INTO v_alvo, v_alvo_nome FROM public.crm_stages s
   WHERE s.pipeline_id = l.pipeline_id AND public.normaliza_nome_etapa(s.name) = 'nao contratado'
   ORDER BY s.position LIMIT 1;
  IF v_alvo IS NULL OR v_alvo = l.stage_id THEN RETURN false; END IF;
  UPDATE public.crm_leads SET stage_id = v_alvo, updated_at = now() WHERE id = l.id;
  INSERT INTO public.messages (lead_id, tenant_id, direction, type, content, status)
  VALUES (l.id, l.tenant_id, 'outbound', 'system', '📂 Sem contrato registrado após a carência — movido para ' || v_alvo_nome, 'system');
  RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.sdr_pos_entrega_etapa(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sdr_entregas_pendentes()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE e record; l public.crm_leads; v_n integer := 0; v_fechado boolean;
BEGIN
  FOR e IN SELECT * FROM public.crm_entregas_gestor WHERE entregar_em <= now() ORDER BY entregar_em LIMIT 200 LOOP
    BEGIN
      SELECT * INTO l FROM public.crm_leads WHERE id = e.lead_id;
      IF FOUND AND l.assigned_to = e.de_user_id THEN
        v_fechado := EXISTS (SELECT 1 FROM public.crm_stages s WHERE s.id = l.stage_id AND NOT COALESCE(s.visivel_para_sdr, true))
                  OR (e.appointment_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_appointments a
                                                                WHERE a.id = e.appointment_id AND a.status IN ('contracted', 'not_contracted')))
                  OR (e.appointment_id IS NULL AND EXISTS (SELECT 1 FROM public.crm_appointments a
                                                            WHERE a.lead_id = l.id AND a.status IN ('contracted', 'not_contracted')
                                                              AND a.updated_at >= e.criado_em - interval '1 hour'));
        IF v_fechado THEN
          IF public.sdr_entrega_lead_ao_gestor(e.lead_id, COALESCE(e.motivo, 'comparecimento') || ' (após carência)', e.mensagem) THEN
            v_n := v_n + 1;
            -- compareceu e não contratou → Não contratado, já com o administrador
            PERFORM public.sdr_pos_entrega_etapa(e.lead_id, e.appointment_id);
          END IF;
        ELSE
          PERFORM public.rodizio_livro(l, e.de_user_id, NULL, 'saneamento',
            'entrega ao administrador cancelada: desfecho/etapa foram corrigidos durante a carência', NULL);
          PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
            '↩️ Entrega ao administrador cancelada: o desfecho foi corrigido durante a carência; o lead continua com ' || public.rodizio_nome(l.assigned_to));
        END IF;
      END IF;
      DELETE FROM public.crm_entregas_gestor WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sdr_entregas_pendentes: % (lead %)', SQLERRM, e.lead_id;
    END;
  END LOOP;
  RETURN v_n;
END $fn$;

CREATE OR REPLACE FUNCTION public.sdr_agenda_entrega_ao_gestor(p_lead_id uuid, p_motivo text, p_mensagem text, p_appointment_id uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE l public.crm_leads; v_gestor uuid; v_min integer; v_quando timestamptz; v_txt text;
BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id = p_lead_id;
  IF NOT FOUND OR l.assigned_to IS NULL THEN RETURN 'sem_dona'; END IF;
  IF NOT public.has_role(l.assigned_to, 'sdr'::app_role) THEN RETURN 'nao_e_sdr'; END IF;
  SELECT c.gestor_user_id, COALESCE(c.entrega_gestor_apos_min, 0)
    INTO v_gestor, v_min FROM public.crm_rodizio_config c WHERE c.tenant_id = l.tenant_id;
  IF v_gestor IS NULL OR v_gestor = l.assigned_to THEN RETURN 'sem_gestor'; END IF;

  IF v_min <= 0 THEN
    IF public.sdr_entrega_lead_ao_gestor(p_lead_id, p_motivo, p_mensagem) THEN
      PERFORM public.sdr_pos_entrega_etapa(p_lead_id, p_appointment_id);
      RETURN 'entregue';
    END IF;
    RETURN 'nao_entregue';
  END IF;

  IF EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = l.id AND e.de_user_id = l.assigned_to) THEN
    UPDATE public.crm_entregas_gestor SET appointment_id = COALESCE(appointment_id, p_appointment_id)
     WHERE lead_id = l.id AND de_user_id = l.assigned_to;
    RETURN 'ja_agendada';
  END IF;

  v_quando := now() + make_interval(mins => v_min);
  v_txt := CASE WHEN v_min % 1440 = 0 THEN (v_min / 1440)::text || CASE WHEN v_min / 1440 = 1 THEN ' dia' ELSE ' dias' END
                WHEN v_min % 60 = 0 THEN (v_min / 60)::text || ' h'
                ELSE v_min::text || ' min' END;
  INSERT INTO public.crm_entregas_gestor (lead_id, tenant_id, de_user_id, motivo, mensagem, entregar_em, appointment_id)
  VALUES (l.id, l.tenant_id, l.assigned_to, p_motivo, p_mensagem, v_quando, p_appointment_id)
  ON CONFLICT (lead_id) DO UPDATE
    SET de_user_id = EXCLUDED.de_user_id, motivo = EXCLUDED.motivo, mensagem = EXCLUDED.mensagem,
        entregar_em = EXCLUDED.entregar_em, appointment_id = EXCLUDED.appointment_id, criado_em = now();
  PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
    COALESCE(p_mensagem, '✅ Compareceu') || ' — o lead passa para o administrador em ' || v_txt
    || ' (' || to_char(v_quando AT TIME ZONE public.rodizio_tz(l.tenant_id), 'DD/MM HH24:MI') || '); até lá continua com '
    || public.rodizio_nome(l.assigned_to));
  RETURN 'agendada';
END $fn$;

-- Comparecimento marcado por qualquer caminho (SDR, CRC, dontus-sync) em lead
-- de SDR: agenda a entrega (com a consulta) e reflete no funil — Compareceu ou
-- Contratado — quando o lead ainda está numa etapa visível para ela.
CREATE OR REPLACE FUNCTION public.sdr_comparecimento_entrega()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE l public.crm_leads; v_stage uuid;
BEGIN
  IF NEW.lead_id IS NULL OR NEW.status NOT IN ('contracted', 'not_contracted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.sdr_agenda_entrega_ao_gestor(NEW.lead_id,
      'compareceu em ' || to_char(NEW.scheduled_date, 'DD/MM') || ' (' || NEW.status || ')', '✅ Compareceu', NEW.id);
    SELECT * INTO l FROM public.crm_leads WHERE id = NEW.lead_id;
    IF FOUND AND l.assigned_to IS NOT NULL AND public.has_role(l.assigned_to, 'sdr'::app_role)
       AND EXISTS (SELECT 1 FROM public.crm_stages s WHERE s.id = l.stage_id AND COALESCE(s.visivel_para_sdr, true)) THEN
      SELECT s.id INTO v_stage FROM public.crm_stages s
       WHERE s.pipeline_id = l.pipeline_id
         AND public.normaliza_nome_etapa(s.name) = CASE WHEN NEW.status = 'contracted' THEN 'contratado' ELSE 'compareceu' END
       ORDER BY s.position LIMIT 1;
      IF v_stage IS NOT NULL AND v_stage IS DISTINCT FROM l.stage_id THEN
        UPDATE public.crm_leads SET stage_id = v_stage, updated_at = now() WHERE id = l.id;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sdr_comparecimento_entrega: % (lead %)', SQLERRM, NEW.lead_id;
  END;
  RETURN NEW;
END $fn$;

-- ================================================================ 4. reagendamentos e faltas repetidas
-- Reagendamento = consulta nova ligada à anterior (rescheduled_from_id), por
-- data agendada e crédito. "Faltou de novo" = falta (no_show) numa consulta
-- que já era reagendamento. "Leads com 2+ faltas" = leads do crédito dela com
-- duas ou mais faltas até o fim do período. SDR vê só a própria linha.
CREATE OR REPLACE FUNCTION public.relatorio_sdr_reagendamentos(p_de date, p_ate date)
RETURNS TABLE(user_id uuid, nome text, reagendamentos integer, faltas_apos_reagendar integer, leads_2_faltas integer, is_total boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id(); v_sdr boolean; v_gestor boolean;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN RETURN; END IF;
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
  ), agg AS (
    SELECT s.uid, s.pnome,
      (SELECT count(*) FROM public.crm_appointments a
        WHERE a.responsavel_credito_id = s.uid AND a.tenant_id = v_tenant AND a.rescheduled_from_id IS NOT NULL
          AND a.scheduled_date BETWEEN p_de AND p_ate)::integer AS reag,
      (SELECT count(*) FROM public.crm_appointments a
        WHERE a.responsavel_credito_id = s.uid AND a.tenant_id = v_tenant AND a.rescheduled_from_id IS NOT NULL
          AND a.status = 'no_show' AND a.scheduled_date BETWEEN p_de AND p_ate)::integer AS falt_reag,
      (SELECT count(*) FROM (
         SELECT a.lead_id FROM public.crm_appointments a
          WHERE a.responsavel_credito_id = s.uid AND a.tenant_id = v_tenant AND a.status = 'no_show'
            AND a.lead_id IS NOT NULL AND a.scheduled_date <= p_ate
          GROUP BY a.lead_id HAVING count(*) >= 2) x)::integer AS l2
      FROM sdrs s
  )
  SELECT a.uid, a.pnome, a.reag, a.falt_reag, a.l2, false FROM agg a
  UNION ALL
  SELECT NULL::uuid, 'Equipe (total)'::text, sum(a.reag)::integer, sum(a.falt_reag)::integer, sum(a.l2)::integer, true
    FROM agg a HAVING v_gestor
  ORDER BY 6, 2;
END $fn$;
REVOKE ALL ON FUNCTION public.relatorio_sdr_reagendamentos(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_sdr_reagendamentos(date, date) TO authenticated, service_role;

-- ================================================================ 5. etapas padrão em todo funil novo
CREATE OR REPLACE FUNCTION public.pipeline_clonar_etapas_padrao(p_pipeline_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE p public.crm_pipelines; v_origem uuid; v_n integer := 0; s record;
BEGIN
  SELECT * INTO p FROM public.crm_pipelines WHERE id = p_pipeline_id;
  IF NOT FOUND OR p.tenant_id IS NULL THEN RETURN 0; END IF;
  IF COALESCE(p.is_instagram, false) OR COALESCE(p.is_posvenda, false) THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.crm_stages s0 WHERE s0.pipeline_id = p.id) THEN RETURN 0; END IF;
  v_origem := public.rodizio_funil(p.tenant_id);
  IF v_origem IS NULL OR v_origem = p.id THEN RETURN 0; END IF;
  PERFORM set_config('app.clonando_etapas', 'sim', true);
  FOR s IN SELECT * FROM public.crm_stages s1 WHERE s1.pipeline_id = v_origem ORDER BY s1.position, s1.created_at LOOP
    INSERT INTO public.crm_stages (pipeline_id, tenant_id, name, color, position, is_won, is_lost, visivel_para_sdr)
    VALUES (p.id, p.tenant_id, s.name, s.color, s.position, s.is_won, s.is_lost, s.visivel_para_sdr);
    v_n := v_n + 1;
  END LOOP;
  PERFORM set_config('app.clonando_etapas', '', true);
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.pipeline_clonar_etapas_padrao(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pipeline_etapas_padrao_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  BEGIN
    PERFORM public.pipeline_clonar_etapas_padrao(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pipeline_etapas_padrao_trg: % (funil %)', SQLERRM, NEW.id;
  END;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_zz_pipeline_etapas_padrao ON public.crm_pipelines;
CREATE TRIGGER trg_zz_pipeline_etapas_padrao
  AFTER INSERT ON public.crm_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.pipeline_etapas_padrao_trg();

CREATE OR REPLACE FUNCTION public.stage_regras_padrao_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF TG_OP = 'INSERT' AND current_setting('app.clonando_etapas', true) IS DISTINCT FROM 'sim' THEN
    IF EXISTS (SELECT 1 FROM public.crm_stages s
                WHERE s.pipeline_id = NEW.pipeline_id
                  AND public.normaliza_nome_etapa(s.name) = public.normaliza_nome_etapa(NEW.name)) THEN
      RETURN NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM public.crm_pipelines p
                WHERE p.id = NEW.pipeline_id AND p.created_at > now() - interval '60 seconds')
       AND EXISTS (SELECT 1 FROM public.crm_stages s WHERE s.pipeline_id = NEW.pipeline_id) THEN
      RETURN NULL;
    END IF;
  END IF;
  IF public.normaliza_nome_etapa(NEW.name) IN ('contratado', 'nao contratado', 'compareceu', 'compareceu e agendou') THEN
    NEW.visivel_para_sdr := false;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_zz_stage_regras_padrao ON public.crm_stages;
CREATE TRIGGER trg_zz_stage_regras_padrao
  BEFORE INSERT OR UPDATE OF name ON public.crm_stages
  FOR EACH ROW EXECUTE FUNCTION public.stage_regras_padrao_trg();