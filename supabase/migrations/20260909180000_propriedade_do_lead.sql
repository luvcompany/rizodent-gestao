-- Regra universal de propriedade do lead — decisão do dono (09/09/2026):
-- "os leads que contrataram, agendaram, não compareceram, ou qualquer um que
--  já esteja em um usuário SDR, não pode ser redistribuído a não ser que fique
--  muito tempo sem resposta. Blinde problemas como esse."
--
-- A REGRA, em uma frase: lead que tem uma SDR como dona só muda de dona por
-- (1) realocação automática por silêncio (rodizio_realocar_sem_resposta), ou
-- (2) transferência explícita pelo seletor "Responsável" (transfer-lead → RPC
-- lead_transferir_autorizado). Nada mais — nem mensagem recebida, nem mudança
-- de etapa, nem agendamento, nem automação, nem webhook, nem API — troca a
-- dona. Lead do administrador continua entrando no rodízio ao escrever
-- (todas as etapas, decisão do mesmo dia).
--
-- Como é blindado: gatilho BEFORE UPDATE OF assigned_to em crm_leads. Se a
-- dona atual é SDR e a troca não veio de um caminho autorizado (GUC
-- transacional rodizio.autorizado = 'sim'), a troca é recusada: erro claro
-- para um humano logado; preservação silenciosa (com WARNING) para caminhos
-- de servidor, que nunca podem quebrar por causa disso. A realocação por
-- silêncio passa a valer em qualquer etapa (mesmo com consulta marcada)
-- quando entrada_todas_etapas está ligada — é a única exceção prevista.

-- ---------------------------------------------------------------- 1. o gatilho
CREATE OR REPLACE FUNCTION public.protege_propriedade_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN RETURN NEW; END IF;
  IF OLD.assigned_to IS NULL THEN RETURN NEW; END IF;
  IF NOT public.has_role(OLD.assigned_to, 'sdr'::app_role) THEN RETURN NEW; END IF;
  IF current_setting('rodizio.autorizado', true) = 'sim' THEN RETURN NEW; END IF;
  -- Dona apagada do sistema (FK ON DELETE SET NULL): deixa soltar.
  IF NEW.assigned_to IS NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.assigned_to) THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Lead de SDR só muda de responsável pelo seletor "Responsável" (transferência) ou pela realocação automática por silêncio.'
      USING ERRCODE = '42501';
  END IF;
  RAISE WARNING 'propriedade do lead % preservada: tentativa de trocar % por % sem autorização', OLD.id, OLD.assigned_to, NEW.assigned_to;
  NEW.assigned_to := OLD.assigned_to;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_zz_propriedade_lead ON public.crm_leads;
CREATE TRIGGER trg_zz_propriedade_lead
  BEFORE UPDATE OF assigned_to ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.protege_propriedade_lead();

-- ---------------------------------------------------------------- 2. a porta autorizada da transferência
-- Só o servidor (transfer-lead, com service role) chama. A function já validou
-- quem pede, se o lead é dele e o destino; aqui é só aplicar com autorização.
CREATE OR REPLACE FUNCTION public.lead_transferir_autorizado(p_lead_id uuid, p_payload jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_n integer;
BEGIN
  IF p_lead_id IS NULL OR p_payload IS NULL THEN RETURN 0; END IF;
  PERFORM set_config('rodizio.autorizado', 'sim', true);
  UPDATE public.crm_leads
     SET assigned_to    = CASE WHEN p_payload ? 'assigned_to'    THEN NULLIF(p_payload->>'assigned_to', '')::uuid ELSE assigned_to END,
         distribuido_em = CASE WHEN p_payload ? 'distribuido_em' THEN (p_payload->>'distribuido_em')::timestamptz ELSE distribuido_em END,
         pipeline_id    = CASE WHEN p_payload ? 'pipeline_id'    THEN (p_payload->>'pipeline_id')::uuid ELSE pipeline_id END,
         stage_id       = CASE WHEN p_payload ? 'stage_id'       THEN (p_payload->>'stage_id')::uuid ELSE stage_id END,
         updated_at     = now()
   WHERE id = p_lead_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.lead_transferir_autorizado(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_transferir_autorizado(uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------- 3. realocação: única exceção automática
-- Mesmo corpo de 20260909100000, com duas mudanças: autoriza a própria troca
-- (GUC) e, com entrada_todas_etapas ligada, deixa de excluir lead com consulta
-- marcada — "a não ser que fique muito tempo sem resposta" vale para todos.
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
