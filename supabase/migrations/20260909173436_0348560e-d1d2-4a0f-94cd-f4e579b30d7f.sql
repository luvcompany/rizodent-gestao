-- Correções encontradas na bateria de testes do sistema da SDR (09/09/2026,
-- ensaios no banco de produção dentro de transações desfeitas + revisão de
-- código). Cada bloco diz o defeito e o teste que o mostrou.
--
--  1. Ciclo encerrado voltava à fila: a entrega ao administrador zera
--     distribuido_em (rodizio_limpa_reserva) e a régua de entrada, com
--     entrada_todas_etapas, aceitava Contratado/Não contratado/Compareceu —
--     o paciente que compareceu virava "lead novo" de uma SDR ao dizer
--     "obrigado". Agora rodizio_lead_na_fila e rodizio_etapas_entrada excluem
--     etapa do administrador, lead com consulta com desfecho de comparecimento
--     e lead com entrega agendada.
--  2. Realocação por silêncio durante a carência levava o lead a outra SDR e
--     a entrega agendada caía. Excluídos da realocação.
--  3. Carência 0 com a SDR marcando o desfecho: trg_sdr_nao_transfere_lead
--     recusava a entrega feita pelo próprio gatilho (auth.uid() = SDR) e o
--     erro virava WARNING. O gatilho passa a honrar o GUC rodizio.autorizado.
--  4. Bloquear/tirar do rodízio deixava reservas presas (só o corte do dia
--     útil seguinte as movia). rodizio_solta_reservas + chamada nas duas RPCs.
--  5. Varredura rodizio_processar_novos distribuía lead cujo único "contato"
--     foi um toque em botão de template (o gatilho de mensagem exclui
--     button/interactive; a varredura não). Alinhada.
--  6. rodizio_msg_humana contava envio FALHADO e ligação NÃO atendida como
--     resposta humana (segurava a realocação e inflava a 1ª resposta).
--  7. relatorio_sdr_calc contava a linha 'reserva' como lead recebido (lead
--     reservado à noite = "recebido e não respondido" por uma SDR e recebido
--     de novo por quem o pegou no corte).
--  8. Entrega agendada sobrevivia à correção do desfecho/etapa; agora
--     sdr_entregas_pendentes reconfere se o ciclo continua encerrado.
--  9. Pós-venda saía como destino de transferência da SDR, mas transfer-lead
--     só aceita pós-venda em etapa Contratado — que a SDR nunca tem. Removido.
-- 10. "Compareceu" da SDR movia a etapa pelo front, que não enxerga a etapa
--     destino (RLS): o lead não mudava de etapa, o chat recebia mensagem falsa
--     e as automações de entrada da etapa ATUAL rodavam de novo (podia
--     reenviar mensagem ao paciente). Nova RPC sdr_marcar_comparecimento faz
--     tudo no servidor (status not_contracted + etapa "Compareceu").
-- 11. Lead criado à mão por um humano (gestor/CRC) era distribuído na hora
--     pelo gatilho de INSERT; a regra é "entra quando escreve". Só inserts do
--     servidor (webhook/API) distribuem na criação.

-- ---------------------------------------------------------------- 1. régua de entrada
CREATE OR REPLACE FUNCTION public.rodizio_lead_na_fila(p_lead public.crm_leads, p_admin uuid, p_funil uuid, p_numero uuid, p_etapas uuid[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT (p_lead).id IS NOT NULL
     AND p_funil IS NOT NULL AND (p_lead).pipeline_id = p_funil
     AND p_etapas IS NOT NULL AND (p_lead).stage_id = ANY (p_etapas)
     AND NOT COALESCE((p_lead).is_blocked, false)
     AND (p_lead).conversa_fechada_em IS NULL
     AND (p_lead).distribuido_em IS NULL
     AND (p_lead).rodizio_reservado_para IS NULL
     AND ((p_lead).assigned_to IS NULL OR (p_admin IS NOT NULL AND (p_lead).assigned_to = p_admin))
     AND NOT public.rodizio_fonte_excluida((p_lead).source)
     AND (p_lead).ig_account_uuid IS NULL
     AND ((p_lead).whatsapp_number_id IS NULL OR (p_numero IS NOT NULL AND (p_lead).whatsapp_number_id = p_numero))
     -- Consulta marcada só segura o lead quando a entrada é restrita.
     AND (EXISTS (SELECT 1 FROM public.crm_rodizio_config c
                   WHERE c.tenant_id = (p_lead).tenant_id AND c.entrada_todas_etapas)
          OR NOT EXISTS (SELECT 1 FROM public.crm_appointments a
                          WHERE a.lead_id = (p_lead).id AND COALESCE(a.status, '') <> 'cancelled'))
     -- Ciclo encerrado é do administrador: etapa que a SDR não vê, consulta
     -- com comparecimento registrado, ou entrega ao administrador agendada.
     AND NOT EXISTS (SELECT 1 FROM public.crm_stages s
                      WHERE s.id = (p_lead).stage_id AND NOT COALESCE(s.visivel_para_sdr, true))
     AND NOT EXISTS (SELECT 1 FROM public.crm_appointments a
                      WHERE a.lead_id = (p_lead).id AND a.status IN ('contracted', 'not_contracted'))
     AND NOT EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = (p_lead).id);
$fn$;

CREATE OR REPLACE FUNCTION public.rodizio_etapas_entrada(p_tenant uuid)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_cfg uuid[]; v_todas boolean; v_funil uuid; v_corte integer; v_ids uuid[];
BEGIN
  IF p_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT c.etapas_entrada, COALESCE(c.entrada_todas_etapas, false) INTO v_cfg, v_todas
    FROM public.crm_rodizio_config c WHERE c.tenant_id = p_tenant;
  v_funil := public.rodizio_funil(p_tenant);
  IF v_funil IS NULL THEN RETURN NULL; END IF;
  -- Todas as etapas do funil, menos as do administrador (visivel_para_sdr = false).
  IF v_todas THEN
    SELECT array_agg(s.id ORDER BY s.position) INTO v_ids FROM public.crm_stages s
     WHERE s.pipeline_id = v_funil AND COALESCE(s.visivel_para_sdr, true);
    RETURN v_ids;
  END IF;
  IF v_cfg IS NOT NULL AND array_length(v_cfg, 1) > 0 THEN RETURN v_cfg; END IF;
  SELECT min(s.position) INTO v_corte FROM public.crm_stages s
   WHERE s.pipeline_id = v_funil
     AND (COALESCE(s.is_won, false) OR COALESCE(s.is_lost, false) OR lower(s.name) LIKE '%agend%');
  SELECT array_agg(s.id ORDER BY s.position) INTO v_ids FROM public.crm_stages s
   WHERE s.pipeline_id = v_funil
     AND NOT COALESCE(s.is_won, false) AND NOT COALESCE(s.is_lost, false)
     AND (v_corte IS NULL OR s.position < v_corte);
  RETURN v_ids;
END $fn$;

-- ---------------------------------------------------------------- 2. realocação não gira ciclo encerrado
CREATE OR REPLACE FUNCTION public.rodizio_realocar_sem_resposta()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  c record; cfg public.crm_rodizio_config; r record; l public.crm_leads;
  v_funil uuid; v_etapas uuid[]; v_tz text; v_ini timestamptz; v_limite interval;
  v_ids uuid[]; v_cargas integer[]; v_ponteiro uuid; v_alvo uuid; v_ok uuid;
  v_n integer := 0; v_run uuid := gen_random_uuid(); v_min integer; v_de_nome text; v_para_nome text;
BEGIN
  -- Regra universal de propriedade: só a realocação (aqui) e a transferência
  -- autorizada trocam a dona de um lead de SDR. O gatilho trg_zz_propriedade_lead
  -- confere este GUC transacional.
  PERFORM set_config('rodizio.autorizado', 'sim', true);
  FOR c IN SELECT k.tenant_id FROM public.crm_rodizio_config k WHERE k.modo <> 'desligado' LOOP
    IF NOT pg_try_advisory_xact_lock(hashtext('rodizio:realoc:' || c.tenant_id::text)) THEN CONTINUE; END IF;
    SELECT * INTO cfg FROM public.crm_rodizio_config WHERE tenant_id = c.tenant_id FOR UPDATE;
    IF NOT FOUND OR cfg.modo = 'desligado' THEN CONTINUE; END IF;
    IF cfg.realocar_sem_resposta_min IS NULL OR cfg.realocar_sem_resposta_min <= 0 THEN CONTINUE; END IF;
    IF NOT public.rodizio_em_expediente(c.tenant_id, now()) THEN CONTINUE; END IF;
    v_funil := public.rodizio_funil(c.tenant_id);
    v_etapas := public.rodizio_etapas_entrada(c.tenant_id);
    IF v_funil IS NULL OR v_etapas IS NULL THEN CONTINUE; END IF;
    v_limite := make_interval(mins => cfg.realocar_sem_resposta_min);
    -- "hoje" da clínica: fronteira do teto de uma realocação por lead por dia
    v_tz := public.rodizio_tz(c.tenant_id);
    v_ini := ((now() AT TIME ZONE v_tz)::date)::timestamp AT TIME ZONE v_tz;

    FOR r IN
      SELECT cand.id, cand.dona, cand.last_inbound_at, cand.desde, cand.conversa_fechada_em
        FROM (
          -- ligado: a dona real, entregue pelo rodízio (distribuido_em)
          SELECT l0.id, l0.assigned_to AS dona, l0.last_inbound_at, l0.distribuido_em AS desde, l0.conversa_fechada_em
            FROM public.crm_leads l0
           WHERE cfg.modo = 'ligado'
             AND l0.tenant_id = c.tenant_id
             AND l0.pipeline_id = v_funil
             AND l0.stage_id = ANY (v_etapas)
             AND l0.distribuido_em IS NOT NULL
             AND l0.assigned_to IS NOT NULL
             -- ciclo encerrado (etapa do administrador ou entrega ao gestor agendada
             -- na carência) não gira mais: senão a realocação tira o lead da dona e
             -- a entrega agendada cai — o administrador nunca o recebe (teste 09/09).
             AND NOT EXISTS (SELECT 1 FROM public.crm_stages s WHERE s.id = l0.stage_id AND NOT COALESCE(s.visivel_para_sdr, true))
             AND NOT EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = l0.id)
             AND (cfg.gestor_user_id IS NULL OR l0.assigned_to <> cfg.gestor_user_id)
             AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = l0.assigned_to AND ur.role = 'sdr'::app_role)
             AND NOT COALESCE(l0.is_blocked, false)
             AND l0.last_inbound_at IS NOT NULL
             -- os mesmos predicados da entrada: sem agendamento não cancelado
             AND (COALESCE(cfg.entrada_todas_etapas, false)
                  OR NOT EXISTS (SELECT 1 FROM public.crm_appointments a
                                  WHERE a.lead_id = l0.id AND COALESCE(a.status, '') <> 'cancelled'))
             -- teto: uma realocação por lead por dia
             AND NOT EXISTS (SELECT 1 FROM public.crm_lead_atribuicoes a
                              WHERE a.lead_id = l0.id AND a.fase = 'realocacao_1h' AND a.criado_em >= v_ini)
          UNION ALL
          -- sombra: a dona VIRTUAL (última anotação de sombra); o lead segue
          -- com o administrador — se alguém o transferiu por fora, a simulação
          -- daquele lead termina
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
             AND l0.pipeline_id = v_funil
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
       WHERE GREATEST(cand.last_inbound_at, cand.desde) < now() - v_limite
         -- sem resposta HUMANA ao último inbound (régua única rodizio_msg_humana)
         AND NOT EXISTS (
               SELECT 1 FROM public.messages m
                WHERE m.lead_id = cand.id
                  AND m.created_at >= cand.last_inbound_at
                  AND public.rodizio_msg_humana(m))
       ORDER BY GREATEST(cand.last_inbound_at, cand.desde)
       LIMIT 100
    LOOP
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
      v_min := floor(extract(epoch FROM (now() - GREATEST(r.last_inbound_at, r.desde))) / 60)::integer;
      SELECT * INTO l FROM public.crm_leads WHERE id = r.id;
      v_de_nome := public.rodizio_nome(r.dona);
      v_para_nome := public.rodizio_nome(v_alvo);

      IF cfg.modo = 'sombra' THEN
        PERFORM public.rodizio_livro(l, r.dona, v_alvo, 'sombra',
          'realocação: iria de ' || v_de_nome || ' para ' || v_para_nome || ' (' || v_min || ' min sem resposta humana)', v_run);
        UPDATE public.crm_rodizio_config SET ponteiro_user_id = v_alvo WHERE tenant_id = c.tenant_id;
        v_n := v_n + 1;
        CONTINUE;
      END IF;

      v_ok := NULL;
      UPDATE public.crm_leads
         SET assigned_to = v_alvo, distribuido_em = now(),
             rodizio_reservado_para = NULL, rodizio_reservado_em = NULL, updated_at = now()
       WHERE id = r.id
         AND assigned_to = r.dona
         AND last_inbound_at IS NOT DISTINCT FROM r.last_inbound_at
         AND distribuido_em IS NOT DISTINCT FROM r.desde
         AND conversa_fechada_em IS NOT DISTINCT FROM r.conversa_fechada_em
       RETURNING id INTO v_ok;
      CONTINUE WHEN v_ok IS NULL;
      UPDATE public.crm_rodizio_config SET ponteiro_user_id = v_alvo WHERE tenant_id = c.tenant_id;
      PERFORM public.rodizio_livro(l, r.dona, v_alvo, 'realocacao_1h',
        v_min || ' min sem resposta humana da dona (limite ' || cfg.realocar_sem_resposta_min || ' min)', v_run);
      PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
        '🔀 Lead realocado de ' || v_de_nome || ' para ' || v_para_nome || ': ' || v_min || ' min sem resposta');
      PERFORM public.rodizio_notifica(v_alvo, l.id, 'Lead realocado para você',
        COALESCE(NULLIF(btrim(l.name), ''), 'Lead') || ' · sem resposta há ' || v_min || ' min');
      PERFORM public.rodizio_notifica(r.dona, NULL, 'Lead realocado',
        COALESCE(NULLIF(btrim(l.name), ''), 'Um lead') || ' foi para ' || v_para_nome || ' após ' || v_min || ' min sem resposta.');
      v_n := v_n + 1;
    END LOOP;
  END LOOP;
  RETURN v_n;
END $fn$;
-- ---------------------------------------------------------------- 3. gatilho da SDR honra a autorização
CREATE OR REPLACE FUNCTION public.sdr_nao_transfere_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND auth.uid() IS NOT NULL
     AND public.has_role(auth.uid(), 'sdr'::app_role)
     AND current_setting('rodizio.autorizado', true) IS DISTINCT FROM 'sim' THEN
    RAISE EXCEPTION 'SDR não transfere lead' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;

-- ---------------------------------------------------------------- 4. reservas de quem sai
-- Solta as reservas pendentes da SDR e, em modo ligado, o motor as refaz na
-- hora entre as demais (ela já está fora do pool quando isto roda).
CREATE OR REPLACE FUNCTION public.rodizio_solta_reservas(p_user_id uuid, p_motivo text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE l public.crm_leads; v_modo text; v_n integer := 0; v_run uuid := gen_random_uuid();
BEGIN
  IF p_user_id IS NULL THEN RETURN 0; END IF;
  FOR l IN SELECT * FROM public.crm_leads WHERE rodizio_reservado_para = p_user_id AND distribuido_em IS NULL LOOP
    UPDATE public.crm_leads SET rodizio_reservado_para = NULL, rodizio_reservado_em = NULL WHERE id = l.id;
    PERFORM public.rodizio_livro(l, p_user_id, NULL, 'saneamento', 'reserva desfeita: ' || COALESCE(p_motivo, 'saiu do rodízio'), v_run);
    SELECT k.modo INTO v_modo FROM public.crm_rodizio_config k WHERE k.tenant_id = l.tenant_id;
    IF v_modo = 'ligado' THEN
      BEGIN
        PERFORM public.rodizio_processar_lead(l.id, 'reserva refeita (' || COALESCE(p_motivo, 'saiu do rodízio') || ')', v_run);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'rodizio_solta_reservas: lead % não reprocessado (%)', l.id, SQLERRM;
      END;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.rodizio_solta_reservas(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.equipe_bloquear(p_user_id uuid, p_bloquear boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_email text; v_reservas integer := 0;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Não é possível bloquear a própria conta.' USING ERRCODE = '42501';
  END IF;
  v_email := public.equipe_alvo_sdr(p_user_id);
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Esta pessoa não é uma SDR desta clínica (ou tem outro papel além de SDR).' USING ERRCODE = '42501';
  END IF;

  UPDATE auth.users
     SET banned_until = CASE WHEN p_bloquear THEN now() + interval '100 years' ELSE NULL END
   WHERE id = p_user_id;

  UPDATE public.profiles
     SET is_blocked = p_bloquear,
         blocked_at = CASE WHEN p_bloquear THEN now() ELSE NULL END,
         blocked_by = CASE WHEN p_bloquear THEN auth.uid() ELSE NULL END
   WHERE id = p_user_id;

  IF p_bloquear THEN
    UPDATE public.crm_rodizio_membros SET ativo = false WHERE user_id = p_user_id;
    -- Reserva de quem foi bloqueada não pode esperar o corte do dia seguinte.
    v_reservas := public.rodizio_solta_reservas(p_user_id, public.rodizio_nome(p_user_id) || ' foi bloqueada');
  END IF;

  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), public.current_tenant_id(), 'tenant',
          CASE WHEN p_bloquear THEN 'sdr_block' ELSE 'sdr_unblock' END,
          jsonb_build_object('target', p_user_id, 'target_email', v_email, 'reservas_soltas', v_reservas));
END $fn$;

CREATE OR REPLACE FUNCTION public.equipe_rodizio(p_user_id uuid, p_ativo boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_email text; v_reservas integer := 0;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  v_email := public.equipe_alvo_sdr(p_user_id);
  IF v_email IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'Esta pessoa não é uma SDR desta clínica (ou tem outro papel além de SDR).' USING ERRCODE = '42501';
  END IF;
  IF p_ativo AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND COALESCE(p.is_blocked, false)) THEN
    RAISE EXCEPTION 'Conta bloqueada não entra no rodízio. Desbloqueie antes.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.crm_rodizio_membros (tenant_id, user_id, ativo)
  VALUES (v_tenant, p_user_id, p_ativo)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET ativo = EXCLUDED.ativo;

  IF NOT p_ativo THEN
    v_reservas := public.rodizio_solta_reservas(p_user_id, public.rodizio_nome(p_user_id) || ' saiu do rodízio');
  END IF;

  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), v_tenant, 'tenant',
          CASE WHEN p_ativo THEN 'sdr_rodizio_on' ELSE 'sdr_rodizio_off' END,
          jsonb_build_object('target', p_user_id, 'target_email', v_email, 'reservas_soltas', v_reservas));
END $fn$;

-- ---------------------------------------------------------------- 5. varredura só com mensagem de verdade
CREATE OR REPLACE FUNCTION public.rodizio_processar_novos()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE c record; r record; v_funil uuid; v_numero uuid; v_etapas uuid[]; v_n integer := 0; v_run uuid := gen_random_uuid(); v_res text; v_desde timestamptz;
BEGIN
  FOR c IN SELECT k.tenant_id, k.modo, k.modo_alterado_em, k.gestor_user_id
             FROM public.crm_rodizio_config k WHERE k.modo <> 'desligado'
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtext('rodizio:novos:' || c.tenant_id::text)) THEN CONTINUE; END IF;
    v_funil := public.rodizio_funil(c.tenant_id);
    v_numero := public.rodizio_numero_principal(c.tenant_id);
    v_etapas := public.rodizio_etapas_entrada(c.tenant_id);
    IF v_funil IS NULL OR v_etapas IS NULL OR c.modo_alterado_em IS NULL THEN CONTINUE; END IF;
    v_desde := GREATEST(c.modo_alterado_em, now() - interval '2 days');
    FOR r IN
      SELECT l.id
        FROM public.crm_leads l
       WHERE l.tenant_id = c.tenant_id
         AND l.pipeline_id = v_funil
         AND GREATEST(l.created_at, COALESCE(l.last_inbound_at, l.created_at)) >= v_desde
         -- criado depois da troca de modo OU mensagem de verdade recebida
         -- depois dela (toque em botão de template não é "o lead escreveu" —
         -- a mesma exclusão do gatilho rodizio_on_mensagem)
         AND (l.created_at >= v_desde
              OR EXISTS (SELECT 1 FROM public.messages m
                          WHERE m.lead_id = l.id AND m.direction = 'inbound'
                            AND m.created_at >= v_desde
                            AND COALESCE(m.type, 'text') NOT IN ('button', 'interactive')
                            AND m.instagram_comment_id IS NULL))
         AND l.distribuido_em IS NULL
         AND l.rodizio_reservado_para IS NULL
         AND (l.assigned_to IS NULL OR l.assigned_to = c.gestor_user_id)
         AND public.rodizio_lead_na_fila(l, c.gestor_user_id, v_funil, v_numero, v_etapas)
         AND NOT (c.modo = 'sombra' AND EXISTS (
               SELECT 1 FROM public.crm_lead_atribuicoes a
                WHERE a.lead_id = l.id AND a.fase = 'sombra' AND a.motivo LIKE 'entrada:%'))
       ORDER BY l.created_at
       LIMIT 200
    LOOP
      v_res := public.rodizio_processar_lead(r.id, 'varredura de novos', v_run);
      IF v_res IN ('aplicado', 'reservado', 'sombra') THEN v_n := v_n + 1; END IF;
    END LOOP;
  END LOOP;
  RETURN v_n;
END $fn$;

-- ---------------------------------------------------------------- 6. resposta humana: falha e ligação não atendida não contam
CREATE OR REPLACE FUNCTION public.rodizio_msg_humana(m public.messages)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
  SELECT (m).id IS NOT NULL
     AND (m).direction = 'outbound'
     AND (m).deleted_at IS NULL
     AND COALESCE((m).status, '') NOT IN ('system', 'failed')
     AND ((m).sender_id IS NOT NULL
          OR COALESCE((m).from_device, false)
          OR ((m).type = 'call' AND COALESCE((m).content, '') NOT ILIKE '%não atendida%' AND COALESCE((m).content, '') NOT ILIKE '%nao atendida%')
          OR ((m).type IN ('text', 'audio', 'image', 'document', 'video')
              AND ltrim(COALESCE((m).content, '')) NOT LIKE '*Elisa:*%'
              AND COALESCE((m).content, '') NOT LIKE '📋 Template:%'
              AND COALESCE((m).content, '') NOT LIKE 'Aguarde você será atendido%'));
$fn$;

-- ---------------------------------------------------------------- 7. relatório: reserva não é lead recebido
DROP FUNCTION IF EXISTS public.relatorio_sdr_calc(uuid, date, date, uuid, boolean);
CREATE FUNCTION public.relatorio_sdr_calc(
  p_tenant uuid,
  p_de date,
  p_ate date,
  p_user uuid,
  p_total boolean
)
RETURNS TABLE (
  user_id uuid,
  nome text,
  email text,
  no_rodizio boolean,
  bloqueada boolean,
  leads_recebidos integer,
  leads_respondidos integer,
  resp_amostra integer,
  resp_mediana_seg integer,
  resp_media_seg integer,
  agendamentos integer,
  compareceram integer,
  faltas integer,
  contratados integer,
  agend_cancelados integer,
  conversas_fechadas integer,
  pesquisa_respostas integer,
  pesquisa_nota_media numeric,
  minutos_expediente integer,
  minutos_pausa integer,
  is_total boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
WITH janela AS (
  SELECT public.ponto_fuso_do_tenant(p_tenant)                                          AS tz,
         ((p_de::timestamp) AT TIME ZONE public.ponto_fuso_do_tenant(p_tenant))          AS ini,
         (((p_ate + 1)::timestamp) AT TIME ZONE public.ponto_fuso_do_tenant(p_tenant))   AS fim   -- exclusivo
),
sdrs AS (
  -- Quem é "SDR" para o relatório: perfil do tenant com papel sdr. Quando
  -- p_user é NULL (visão do gestor) exige papel EXCLUSIVAMENTE sdr, o mesmo
  -- critério de equipe_listar/equipe_alvo_sdr — listar aqui quem a aba Equipe
  -- não lista deixaria as duas telas contando equipes diferentes.
  SELECT p.id                            AS uid,
         p.nome                          AS nome,
         p.email                         AS email,
         COALESCE(m.ativo, false)        AS no_rodizio,
         COALESCE(p.is_blocked, false)   AS bloqueada
    FROM public.profiles p
    LEFT JOIN public.crm_rodizio_membros m
           ON m.tenant_id = p_tenant AND m.user_id = p.id
   WHERE p.tenant_id = p_tenant
     AND EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = p.id AND ur.role = 'sdr'::app_role)
     AND (p_user IS NULL OR p.id = p_user)
     AND (p_user IS NOT NULL
          OR NOT EXISTS (SELECT 1 FROM public.user_roles ur2
                          WHERE ur2.user_id = p.id AND ur2.role <> 'sdr'::app_role))
),
-- ------------------------------------------------------------ leads recebidos
recebidos_bruto AS (
  SELECT l.assigned_to                                   AS uid,
         l.id                                            AS lead_id,
         COALESCE(l.distribuido_em, l.created_at)         AS recebido_em
    FROM public.crm_leads l
    JOIN sdrs s ON s.uid = l.assigned_to
    CROSS JOIN janela j
   WHERE l.tenant_id = p_tenant
     AND COALESCE(l.distribuido_em, l.created_at) >= j.ini
     AND COALESCE(l.distribuido_em, l.created_at) <  j.fim
  UNION ALL
  SELECT a.para_user_id, a.lead_id, a.criado_em
    FROM public.crm_lead_atribuicoes a
    JOIN sdrs s ON s.uid = a.para_user_id
    -- O lead tem de ser do tenant (o livro é escrito só pelo servidor, mas o
    -- cerco de cliente não depende de ninguém ter escrito certo).
    JOIN public.crm_leads l ON l.id = a.lead_id AND l.tenant_id = p_tenant
    CROSS JOIN janela j
   WHERE a.tenant_id = p_tenant
     -- 'reserva' não é entrega (o lead nunca foi dela) e 'saneamento'/'comparecimento'
     -- não dão posse a uma SDR: contavam o lead reservado à noite como "recebido e
     -- não respondido" por uma e de novo por quem o recebeu no corte (teste 09/09).
     AND a.fase IN ('aplicacao', 'corte_9h', 'realocacao_1h', 'manual')
     AND a.para_user_id IS NOT NULL
     AND a.criado_em >= j.ini
     AND a.criado_em <  j.fim
),
recebidos AS (
  SELECT rb.uid, rb.lead_id, min(rb.recebido_em) AS recebido_em
    FROM recebidos_bruto rb
   GROUP BY rb.uid, rb.lead_id
),
-- Janela em que o lead foi DELA: [recebido_em, saida_em). saida_em = primeira
-- linha do livro depois de recebido_em em que ela é a origem.
posse AS (
  SELECT r.uid, r.lead_id, r.recebido_em,
         COALESCE(sa.em, 'infinity'::timestamptz) AS saida_em
    FROM recebidos r
    LEFT JOIN LATERAL (
      SELECT min(a.criado_em) AS em
        FROM public.crm_lead_atribuicoes a
       WHERE a.lead_id = r.lead_id
         AND a.de_user_id = r.uid
         AND a.fase <> 'sombra'
         AND a.criado_em > r.recebido_em
    ) sa ON true
),
-- ------------------------------------------------------- 1ª resposta humana
-- Tudo por lead_id (o lead já é do tenant); os índices são por lead.
resposta AS (
  SELECT p.uid,
         t.t0,
         o.primeira_resposta
    FROM posse p
    -- último inbound ANTES de ela receber (para saber se havia pendência)
    LEFT JOIN LATERAL (
      SELECT m.created_at
        FROM public.messages m
       WHERE m.lead_id = p.lead_id
         AND m.direction = 'inbound'
         AND m.deleted_at IS NULL
         AND m.instagram_comment_id IS NULL
         AND m.created_at < p.recebido_em
       ORDER BY m.created_at DESC
       LIMIT 1
    ) ui ON true
    -- última resposta humana ANTES de ela receber (régua única rodizio_msg_humana)
    LEFT JOIN LATERAL (
      SELECT m.created_at
        FROM public.messages m
       WHERE m.lead_id = p.lead_id
         AND m.created_at < p.recebido_em
         AND public.rodizio_msg_humana(m)
       ORDER BY m.created_at DESC
       LIMIT 1
    ) uo ON true
    -- primeiro inbound DEPOIS de ela receber (enquanto era dela)
    LEFT JOIN LATERAL (
      SELECT min(m.created_at) AS em
        FROM public.messages m
       WHERE m.lead_id = p.lead_id
         AND m.direction = 'inbound'
         AND m.deleted_at IS NULL
         AND m.instagram_comment_id IS NULL
         AND m.created_at >= p.recebido_em
         AND m.created_at <  p.saida_em
    ) pi ON true
    -- t0: pendência na entrega → recebido_em; senão, 1º inbound depois.
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN ui.created_at IS NOT NULL
                AND (uo.created_at IS NULL OR uo.created_at < ui.created_at)
               THEN p.recebido_em
               ELSE pi.em
             END AS t0
    ) t
    -- primeira resposta humana a partir de t0 (ou de recebido_em, se não há
    -- t0: contato proativo), enquanto o lead era dela (régua única
    -- rodizio_msg_humana — a mesma da realocação do motor)
    LEFT JOIN LATERAL (
      SELECT min(m.created_at) AS primeira_resposta
        FROM public.messages m
       WHERE m.lead_id = p.lead_id
         AND m.created_at >= COALESCE(t.t0, p.recebido_em)
         AND m.created_at <  p.saida_em
         AND public.rodizio_msg_humana(m)
    ) o ON true
),
resp_agg AS (
  SELECT r.uid,
         count(*)::integer AS leads_recebidos,
         count(*) FILTER (WHERE r.primeira_resposta IS NOT NULL)::integer AS leads_respondidos,
         count(*) FILTER (WHERE r.primeira_resposta IS NOT NULL
                            AND r.t0 IS NOT NULL)::integer  AS resp_amostra,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY extract(epoch FROM (r.primeira_resposta - r.t0))::double precision
         ) FILTER (WHERE r.primeira_resposta IS NOT NULL AND r.t0 IS NOT NULL) AS mediana_seg,
         avg(extract(epoch FROM (r.primeira_resposta - r.t0)))
           FILTER (WHERE r.primeira_resposta IS NOT NULL AND r.t0 IS NOT NULL) AS media_seg
    FROM resposta r
   GROUP BY r.uid
),
resp_total AS (
  SELECT count(*)::integer AS leads_recebidos,
         count(*) FILTER (WHERE r.primeira_resposta IS NOT NULL)::integer AS leads_respondidos,
         count(*) FILTER (WHERE r.primeira_resposta IS NOT NULL
                            AND r.t0 IS NOT NULL)::integer  AS resp_amostra,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY extract(epoch FROM (r.primeira_resposta - r.t0))::double precision
         ) FILTER (WHERE r.primeira_resposta IS NOT NULL AND r.t0 IS NOT NULL) AS mediana_seg,
         avg(extract(epoch FROM (r.primeira_resposta - r.t0)))
           FILTER (WHERE r.primeira_resposta IS NOT NULL AND r.t0 IS NOT NULL) AS media_seg
    FROM resposta r
),
-- ----------------------------------------------- agendamentos (régua canônica)
agend AS (
  SELECT a.responsavel_credito_id AS uid,
         count(*) FILTER (WHERE COALESCE(a.status, '') <> 'cancelled')::integer AS agendamentos,
         count(*) FILTER (WHERE a.status IN ('contracted', 'not_contracted'))::integer AS compareceram,
         count(*) FILTER (WHERE a.status = 'no_show')::integer AS faltas,
         count(*) FILTER (WHERE a.status = 'contracted')::integer AS contratados,
         count(*) FILTER (WHERE a.status = 'cancelled')::integer AS cancelados
    FROM public.crm_appointments a
    JOIN sdrs s ON s.uid = a.responsavel_credito_id
   WHERE a.tenant_id = p_tenant
     AND a.scheduled_date BETWEEN p_de AND p_ate
   GROUP BY a.responsavel_credito_id
),
-- --------------------------------------------------------- conversas fechadas
fechadas AS (
  SELECT COALESCE(l.conversa_fechada_por, l.assigned_to) AS uid,
         count(*)::integer AS conversas_fechadas
    FROM public.crm_leads l
    CROSS JOIN janela j
   WHERE l.tenant_id = p_tenant
     AND l.conversa_fechada_em IS NOT NULL
     AND l.conversa_fechada_em >= j.ini
     AND l.conversa_fechada_em <  j.fim
     AND COALESCE(l.conversa_fechada_por, l.assigned_to) IN (SELECT s.uid FROM sdrs s)
   GROUP BY COALESCE(l.conversa_fechada_por, l.assigned_to)
),
-- ------------------------------------------------------------------- pesquisa
pesquisa AS (
  SELECT r.responsavel_credito_id AS uid,
         count(r.nota)::integer AS respostas,
         sum(r.nota)            AS soma_notas,
         count(r.nota)          AS n_notas
    FROM public.crm_pesquisa_respostas r
    JOIN sdrs s ON s.uid = r.responsavel_credito_id
    CROSS JOIN janela j
   WHERE r.tenant_id = p_tenant
     AND r.respondida_em IS NOT NULL
     AND r.respondida_em >= j.ini
     AND r.respondida_em <  j.fim
   GROUP BY r.responsavel_credito_id
),
-- --------------------------------------------------------- expediente e pausa
ponto_ev AS (
  SELECT e.user_id AS uid,
         e.tipo,
         e.em,
         lead(e.em) OVER (PARTITION BY e.user_id ORDER BY e.em, e.id) AS prox_em
    FROM public.crm_ponto_eventos e
    JOIN sdrs s ON s.uid = e.user_id
    CROSS JOIN janela j
   WHERE e.tenant_id = p_tenant
     AND e.em >= j.ini
     AND e.em <  j.fim
),
ponto_int AS (
  SELECT v.uid,
         v.tipo,
         LEAST(
           COALESCE(v.prox_em, 'infinity'::timestamptz),
           (date_trunc('day', v.em AT TIME ZONE (SELECT j2.tz FROM janela j2)) + interval '1 day')
             AT TIME ZONE (SELECT j2.tz FROM janela j2),
           now(),
           (SELECT j2.fim FROM janela j2)
         ) - v.em AS dur
    FROM ponto_ev v
   WHERE v.tipo IN ('abrir', 'retomar', 'pausar')
),
ponto AS (
  SELECT pi.uid,
         COALESCE(round(sum(extract(epoch FROM pi.dur) / 60.0)
           FILTER (WHERE pi.tipo IN ('abrir', 'retomar'))), 0)::integer AS minutos_expediente,
         COALESCE(round(sum(extract(epoch FROM pi.dur) / 60.0)
           FILTER (WHERE pi.tipo = 'pausar')), 0)::integer               AS minutos_pausa
    FROM ponto_int pi
   WHERE pi.dur > interval '0'
   GROUP BY pi.uid
)
-- ------------------------------------------------------------ uma linha por SDR
SELECT s.uid,
       s.nome,
       s.email,
       s.no_rodizio,
       s.bloqueada,
       COALESCE(ra.leads_recebidos, 0),
       COALESCE(ra.leads_respondidos, 0),
       COALESCE(ra.resp_amostra, 0),
       round(ra.mediana_seg)::integer,
       round(ra.media_seg)::integer,
       COALESCE(ag.agendamentos, 0),
       COALESCE(ag.compareceram, 0),
       COALESCE(ag.faltas, 0),
       COALESCE(ag.contratados, 0),
       COALESCE(ag.cancelados, 0),
       COALESCE(fc.conversas_fechadas, 0),
       COALESCE(pq.respostas, 0),
       CASE WHEN COALESCE(pq.n_notas, 0) > 0
            THEN round(pq.soma_notas::numeric / pq.n_notas, 2) END,
       COALESCE(pt.minutos_expediente, 0),
       COALESCE(pt.minutos_pausa, 0),
       false
  FROM sdrs s
  LEFT JOIN resp_agg ra ON ra.uid = s.uid
  LEFT JOIN agend    ag ON ag.uid = s.uid
  LEFT JOIN fechadas fc ON fc.uid = s.uid
  LEFT JOIN pesquisa pq ON pq.uid = s.uid
  LEFT JOIN ponto    pt ON pt.uid = s.uid

UNION ALL

-- ------------------------------------------------ linha de total da equipe
-- Só quando pedida E quando existe pelo menos uma SDR (zero SDRs = zero linhas).
SELECT NULL::uuid,
       'Equipe (total)'::text,
       NULL::text,
       NULL::boolean,
       NULL::boolean,
       COALESCE((SELECT rt.leads_recebidos   FROM resp_total rt), 0),
       COALESCE((SELECT rt.leads_respondidos FROM resp_total rt), 0),
       COALESCE((SELECT rt.resp_amostra      FROM resp_total rt), 0),
       (SELECT round(rt.mediana_seg)::integer FROM resp_total rt),
       (SELECT round(rt.media_seg)::integer   FROM resp_total rt),
       COALESCE((SELECT sum(ag.agendamentos) FROM agend ag), 0)::integer,
       COALESCE((SELECT sum(ag.compareceram) FROM agend ag), 0)::integer,
       COALESCE((SELECT sum(ag.faltas)       FROM agend ag), 0)::integer,
       COALESCE((SELECT sum(ag.contratados)  FROM agend ag), 0)::integer,
       COALESCE((SELECT sum(ag.cancelados)   FROM agend ag), 0)::integer,
       COALESCE((SELECT sum(fc.conversas_fechadas) FROM fechadas fc), 0)::integer,
       COALESCE((SELECT sum(pq.respostas) FROM pesquisa pq), 0)::integer,
       (SELECT CASE WHEN COALESCE(sum(pq.n_notas), 0) > 0
                    THEN round(sum(pq.soma_notas)::numeric / sum(pq.n_notas), 2) END
          FROM pesquisa pq),
       COALESCE((SELECT sum(pt.minutos_expediente) FROM ponto pt), 0)::integer,
       COALESCE((SELECT sum(pt.minutos_pausa)      FROM ponto pt), 0)::integer,
       true
 WHERE COALESCE(p_total, false) AND EXISTS (SELECT 1 FROM sdrs)

ORDER BY 21, 2;   -- is_total (total por último), depois nome
$fn$;
REVOKE ALL ON FUNCTION public.relatorio_sdr_calc(uuid, date, date, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
-- ---------------------------------------------------------------- 8. entrega agendada reconfere o ciclo
CREATE OR REPLACE FUNCTION public.sdr_entregas_pendentes()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE e record; l public.crm_leads; v_n integer := 0; v_fechado boolean;
BEGIN
  FOR e IN SELECT * FROM public.crm_entregas_gestor WHERE entregar_em <= now() ORDER BY entregar_em LIMIT 200 LOOP
    BEGIN
      SELECT * INTO l FROM public.crm_leads WHERE id = e.lead_id;
      -- A dona ainda é quem estava na hora da marcação? Se alguém transferiu
      -- no meio da carência, quem transferiu decidiu: a entrega agendada cai.
      IF FOUND AND l.assigned_to = e.de_user_id THEN
        -- O ciclo continua encerrado? (desfecho corrigido para falta/pendente e
        -- lead de volta a etapa visível = a SDR está reagendando; não entrega.)
        v_fechado := EXISTS (SELECT 1 FROM public.crm_stages s WHERE s.id = l.stage_id AND NOT COALESCE(s.visivel_para_sdr, true))
                  OR EXISTS (SELECT 1 FROM public.crm_appointments a WHERE a.lead_id = l.id AND a.status IN ('contracted', 'not_contracted'));
        IF v_fechado THEN
          IF public.sdr_entrega_lead_ao_gestor(e.lead_id, COALESCE(e.motivo, 'comparecimento') || ' (após carência)', e.mensagem) THEN
            v_n := v_n + 1;
          END IF;
        ELSE
          PERFORM public.rodizio_livro(l, e.de_user_id, NULL, 'saneamento',
            'entrega ao administrador cancelada: desfecho/etapa foram corrigidos durante a carência', NULL);
        END IF;
      END IF;
      DELETE FROM public.crm_entregas_gestor WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sdr_entregas_pendentes: % (lead %)', SQLERRM, e.lead_id;
    END;
  END LOOP;
  RETURN v_n;
END $fn$;

-- ---------------------------------------------------------------- 9. destinos de transferência da SDR (sem pós-venda)
CREATE OR REPLACE FUNCTION public.sdr_destinos_transferencia()
RETURNS TABLE(user_id uuid, nome text, papel text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  WITH eu AS (
    SELECT auth.uid() AS id, public.current_tenant_id() AS tenant
  )
  SELECT p.id, p.nome, 'sdr'::text
    FROM public.profiles p, eu
   WHERE public.has_role(eu.id, 'sdr'::app_role)
     AND p.tenant_id = eu.tenant
     AND p.id <> eu.id
     AND NOT COALESCE(p.is_blocked, false)
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'sdr'::app_role)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role <> 'sdr'::app_role)
  UNION ALL
  SELECT p.id, p.nome, 'gestor'::text
    FROM public.profiles p, eu
    JOIN public.crm_rodizio_config c ON c.tenant_id = eu.tenant
   WHERE public.has_role(eu.id, 'sdr'::app_role)
     AND p.id = c.gestor_user_id
     AND NOT COALESCE(p.is_blocked, false)
  ORDER BY 3, 2;
$fn$;

-- ---------------------------------------------------------------- 10. "Compareceu" da SDR no servidor
-- Só a dona do lead; só consulta pendente. Status not_contracted (= compareceu,
-- contrato é dado do administrador/Dontus) e etapa "Compareceu" do funil
-- (fallback "Não contratado"). Os gatilhos de comparecimento/etapa agendam a
-- entrega ao administrador após a carência. Devolve a etapa nova para o front
-- rodar as automações de entrada DELA (não da etapa antiga).
CREATE OR REPLACE FUNCTION public.sdr_marcar_comparecimento(p_appointment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE a public.crm_appointments; l public.crm_leads; v_stage uuid; v_stage_nome text; v_nome text; n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'sdr'::app_role) THEN
    RAISE EXCEPTION 'Só a SDR usa esta ação.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO a FROM public.crm_appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consulta não encontrada.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id = a.lead_id;
  IF NOT FOUND OR l.assigned_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Este lead não é seu.' USING ERRCODE = '42501';
  END IF;
  IF a.status NOT IN ('confirmed', 'pending') THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'ja_tem_desfecho', 'status', a.status);
  END IF;
  UPDATE public.crm_appointments
     SET status = 'not_contracted', outcome_source = 'sdr', updated_at = now()
   WHERE id = a.id AND status IN ('confirmed', 'pending');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN jsonb_build_object('ok', false, 'motivo', 'ja_tem_desfecho'); END IF;

  SELECT s.id, s.name INTO v_stage, v_stage_nome FROM public.crm_stages s
   WHERE s.pipeline_id = l.pipeline_id AND public.normaliza_nome_etapa(s.name) = 'compareceu'
   ORDER BY s.position LIMIT 1;
  IF v_stage IS NULL THEN
    SELECT s.id, s.name INTO v_stage, v_stage_nome FROM public.crm_stages s
     WHERE s.pipeline_id = l.pipeline_id AND public.normaliza_nome_etapa(s.name) = 'nao contratado'
     ORDER BY s.position LIMIT 1;
  END IF;
  IF v_stage IS NOT NULL AND v_stage IS DISTINCT FROM l.stage_id THEN
    UPDATE public.crm_leads SET stage_id = v_stage, updated_at = now() WHERE id = l.id;
  ELSE
    v_stage := NULL; v_stage_nome := NULL;
  END IF;
  SELECT COALESCE(NULLIF(btrim(p.nome), ''), p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  INSERT INTO public.messages (lead_id, tenant_id, direction, type, content, status)
  VALUES (l.id, l.tenant_id, 'outbound', 'system',
          '✅ Compareceu em ' || to_char(a.scheduled_date, 'DD/MM') || ' — marcado por ' || COALESCE(v_nome, 'SDR')
          || COALESCE(' · movido para ' || v_stage_nome, ''), 'system');
  RETURN jsonb_build_object('ok', true, 'lead_id', l.id, 'stage_id', v_stage, 'stage_nome', v_stage_nome, 'phone', l.phone);
END $fn$;
REVOKE ALL ON FUNCTION public.sdr_marcar_comparecimento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sdr_marcar_comparecimento(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------- 11. lead criado por humano não distribui na criação
CREATE OR REPLACE FUNCTION public.rodizio_on_lead_novo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE v_modo text; v_admin uuid;
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;
  -- Lead cadastrado à mão por alguém logado (gestor/CRC no Kanban) fica com
  -- quem criou; entra no rodízio quando o lead escrever. Webhook/API (servidor)
  -- criam o lead na primeira mensagem — aí distribui na criação.
  IF auth.uid() IS NOT NULL THEN RETURN NEW; END IF;
  SELECT k.modo, k.gestor_user_id INTO v_modo, v_admin FROM public.crm_rodizio_config k WHERE k.tenant_id = NEW.tenant_id;
  IF v_modo IS NULL OR v_modo = 'desligado' THEN RETURN NEW; END IF;
  IF NOT public.rodizio_lead_na_fila(NEW, v_admin, public.rodizio_funil(NEW.tenant_id),
                                     public.rodizio_numero_principal(NEW.tenant_id), public.rodizio_etapas_entrada(NEW.tenant_id)) THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM public.rodizio_processar_lead(NEW.id, 'lead novo (' || COALESCE(NULLIF(btrim(NEW.source), ''), 'sem origem') || ')');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rodizio_on_lead_novo: lead % não distribuído (%): %', NEW.id, SQLSTATE, SQLERRM;
  END;
  RETURN NEW;
END $fn$;
