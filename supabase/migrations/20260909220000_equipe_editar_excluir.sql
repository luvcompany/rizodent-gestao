-- Equipe (aba do gestor): editar nome/e-mail da SDR e excluir SDR com
-- redistribuição automática dos leads — decisão do dono (09/09/2026):
--   "Permita que o crc (usuário principal) consiga editar os dados do login
--    do sdr, e-mail, nome, e também poder excluir o sdr, fazendo a
--    redistribuição automática dos leads que estavam com aquele sdr. Mas o
--    ideal é que se trocar de sdr é só trocar o e-mail e o nome do usuário."
--
-- Divisão de trabalho (a mesma da Fase 1): o que é do Auth (e-mail, senha,
-- apagar a conta) fica na edge function admin-manage-user, que passa a aceitar
-- set_email e delete do gestor (alvo do próprio tenant, papel exclusivamente
-- sdr); o que é do banco vira RPC:
--   equipe_editar_nome(p_user_id, p_nome)         gestor renomeia (profiles + metadata do Auth)
--   equipe_encerrar_sessoes(p_user_id)            derruba sessões/refresh tokens (trocou a pessoa)
--   equipe_excluir_previa(p_user_id)              o que acontece com os leads se excluir (diálogo)
--   equipe_redistribuir_leads(p_user_id, p_destino, p_motivo)
--                                                 move TODOS os leads dela; a function chama
--                                                 ANTES de apagar a conta (também serve ao gestor)
--
-- Redistribuição — regra:
--   • lead cujo ciclo já terminou (etapa do administrador, ou entrega ao
--     administrador pendente na carência) → administrador (gestor), sempre;
--   • os demais: modo 'ligado' e há outra SDR elegível (ativa no rodízio,
--     desbloqueada) → revezam entre elas (menor carga, depois o ponteiro),
--     distribuido_em = now(); senão → administrador com distribuido_em = NULL,
--     para entrarem de novo no rodízio quando escreverem (régua de entrada);
--   • reservas pendentes para ela são desfeitas (e refeitas pelo motor em modo
--     ligado); ela sai do rodízio; o ponteiro zera se apontava para ela;
--   • tarefas abertas do lead que estavam com ela seguem o lead;
--   • tudo no livro (fase 'manual'), mensagem de sistema no chat e notificação
--     a quem recebeu. É caminho autorizado da regra universal de propriedade
--     (GUC rodizio.autorizado): sem isto, o FK ON DELETE SET NULL deixaria os
--     leads sem dona e o gatilho trg_zz_propriedade_lead nem os deixaria sair.
--
-- O histórico (livro, responsavel_credito_id das consultas, ligações) não tem
-- FK para auth.users: sobrevive à exclusão, mas perde o NOME (profiles é
-- CASCADE). Por isso trocar de pessoa = Editar (nome + e-mail + senha nova),
-- e o diálogo de exclusão diz isso.

-- ---------------------------------------------------------------- 0. alvo SDR sem depender do tenant da sessão
-- equipe_alvo_sdr usa current_tenant_id() (humano logado). O servidor
-- (service_role, auth.uid() nulo) precisa do mesmo critério lendo o tenant do
-- perfil da própria SDR. Devolve o tenant dela, ou NULL.
CREATE OR REPLACE FUNCTION public.equipe_sdr_exclusiva(p_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT p.tenant_id
    FROM public.profiles p
   WHERE p.id = p_user_id
     AND p.tenant_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'sdr'::app_role)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role <> 'sdr'::app_role);
$fn$;
REVOKE ALL ON FUNCTION public.equipe_sdr_exclusiva(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- 1. renomear
CREATE OR REPLACE FUNCTION public.equipe_editar_nome(p_user_id uuid, p_nome text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_email text; v_nome text := NULLIF(btrim(p_nome), ''); v_antes text;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Para mudar o próprio nome use o seu perfil.' USING ERRCODE = '42501';
  END IF;
  v_email := public.equipe_alvo_sdr(p_user_id);
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Esta pessoa não é uma SDR desta clínica (ou tem outro papel além de SDR).' USING ERRCODE = '42501';
  END IF;
  IF v_nome IS NULL OR length(v_nome) > 120 THEN
    RAISE EXCEPTION 'Informe um nome com até 120 caracteres.' USING ERRCODE = '22023';
  END IF;
  SELECT nome INTO v_antes FROM public.profiles WHERE id = p_user_id;
  UPDATE public.profiles SET nome = v_nome WHERE id = p_user_id;
  UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('nome', v_nome),
         updated_at = now()
   WHERE id = p_user_id;
  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), public.current_tenant_id(), 'tenant', 'sdr_set_nome',
          jsonb_build_object('target', p_user_id, 'target_email', v_email, 'de', v_antes, 'para', v_nome));
END $fn$;
REVOKE ALL ON FUNCTION public.equipe_editar_nome(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipe_editar_nome(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------- 2. encerrar sessões
-- Trocou o e-mail (outra pessoa assume o login): a anterior não pode seguir
-- logada com o refresh token antigo. Humano: só o gestor do tenant dela.
CREATE OR REPLACE FUNCTION public.equipe_encerrar_sessoes(p_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_n integer := 0; v_tenant uuid;
BEGIN
  IF p_user_id IS NULL THEN RETURN 0; END IF;
  v_tenant := public.equipe_sdr_exclusiva(p_user_id);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Esta pessoa não é uma SDR (ou tem outro papel além de SDR).' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL THEN
    IF p_user_id = auth.uid() OR NOT public.is_gestor_equipe() OR public.current_tenant_id() IS DISTINCT FROM v_tenant THEN
      RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
    END IF;
  END IF;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), v_tenant, CASE WHEN auth.uid() IS NULL THEN 'admin' ELSE 'tenant' END, 'sdr_sessoes_encerradas',
          jsonb_build_object('target', p_user_id, 'sessoes', v_n));
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.equipe_encerrar_sessoes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipe_encerrar_sessoes(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------- 3. prévia da exclusão (diálogo)
CREATE OR REPLACE FUNCTION public.equipe_excluir_previa(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id(); v_email text; cfg public.crm_rodizio_config; v_modo text;
  v_leads integer; v_fechados integer; v_reservas integer; v_agend integer; v_eleg jsonb; v_n_eleg integer;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  v_email := public.equipe_alvo_sdr(p_user_id);
  IF v_email IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'Esta pessoa não é uma SDR desta clínica (ou tem outro papel além de SDR).' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO cfg FROM public.crm_rodizio_config WHERE tenant_id = v_tenant;
  v_modo := COALESCE(cfg.modo, 'desligado');

  SELECT count(*),
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.crm_stages s WHERE s.id = l.stage_id AND NOT COALESCE(s.visivel_para_sdr, true))
                             OR EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = l.id))
    INTO v_leads, v_fechados
    FROM public.crm_leads l
   WHERE l.tenant_id = v_tenant AND l.assigned_to = p_user_id;
  SELECT count(*) INTO v_reservas FROM public.crm_leads l
   WHERE l.tenant_id = v_tenant AND l.rodizio_reservado_para = p_user_id AND l.distribuido_em IS NULL;
  SELECT count(*) INTO v_agend FROM public.crm_appointments a WHERE a.responsavel_credito_id = p_user_id;
  SELECT COALESCE(jsonb_agg(p.nome ORDER BY p.ordem), '[]'::jsonb), count(*)
    INTO v_eleg, v_n_eleg
    FROM public.rodizio_pool(v_tenant) p WHERE p.user_id <> p_user_id;

  RETURN jsonb_build_object(
    'email', v_email,
    'leads', v_leads,
    'leads_ciclo_fechado', v_fechados,
    'reservas', v_reservas,
    'agendamentos_credito', v_agend,
    'modo', v_modo,
    'elegiveis', v_eleg,
    'n_elegiveis', v_n_eleg,
    'destino_auto', CASE WHEN v_modo = 'ligado' AND v_n_eleg > 0 THEN 'rodizio' ELSE 'gestor' END,
    'gestor_nome', CASE WHEN cfg.gestor_user_id IS NULL THEN NULL ELSE public.rodizio_nome(cfg.gestor_user_id) END);
END $fn$;
REVOKE ALL ON FUNCTION public.equipe_excluir_previa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipe_excluir_previa(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------- 4. redistribuir os leads dela
CREATE OR REPLACE FUNCTION public.equipe_redistribuir_leads(p_user_id uuid, p_destino text DEFAULT 'auto', p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  v_tenant uuid; cfg public.crm_rodizio_config; v_gestor uuid; v_nome text; v_quem text; v_extra text;
  v_ids uuid[]; v_cargas integer[]; v_ponteiro uuid; v_alvo uuid; v_alvo_nome text; v_i integer;
  l public.crm_leads; v_run uuid := gen_random_uuid(); v_lead_nome text;
  v_rodizio boolean; v_fechado boolean; v_moveu_rodizio boolean := false;
  v_n_rod integer := 0; v_n_gestor integer := 0; v_reservas integer := 0; v_destinos jsonb := '{}'::jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Informe a SDR.' USING ERRCODE = '22023';
  END IF;
  v_tenant := public.equipe_sdr_exclusiva(p_user_id);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Esta pessoa não é uma SDR (ou tem outro papel além de SDR).' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL THEN
    IF p_user_id = auth.uid() OR NOT public.is_gestor_equipe() OR public.current_tenant_id() IS DISTINCT FROM v_tenant THEN
      RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_destino IS NULL OR p_destino NOT IN ('auto', 'rodizio', 'gestor') THEN
    RAISE EXCEPTION 'Destino inválido: use auto, rodizio ou gestor.' USING ERRCODE = '22023';
  END IF;

  -- Mutex do motor: a mesma linha que rodizio_processar_lead trava.
  SELECT * INTO cfg FROM public.crm_rodizio_config WHERE tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR cfg.gestor_user_id IS NULL THEN
    RAISE EXCEPTION 'Rodízio sem gestor nomeado nesta clínica: não há para quem devolver os leads.' USING ERRCODE = '22023';
  END IF;
  v_gestor := cfg.gestor_user_id;
  v_nome := public.rodizio_nome(p_user_id);
  v_quem := CASE WHEN auth.uid() IS NULL THEN 'pelo administrador' ELSE 'por ' || public.rodizio_nome(auth.uid()) END;
  v_extra := COALESCE(' — ' || NULLIF(btrim(p_motivo), ''), '');

  SELECT array_agg(p.user_id ORDER BY p.ordem), array_agg(p.carga ORDER BY p.ordem)
    INTO v_ids, v_cargas
    FROM public.rodizio_pool(v_tenant) p WHERE p.user_id <> p_user_id;
  v_rodizio := v_ids IS NOT NULL AND (p_destino = 'rodizio' OR (p_destino = 'auto' AND cfg.modo = 'ligado'));
  IF p_destino = 'rodizio' AND NOT v_rodizio THEN
    RAISE EXCEPTION 'Nenhuma outra SDR elegível no rodízio (ativa e desbloqueada).' USING ERRCODE = '22023';
  END IF;
  v_ponteiro := CASE WHEN cfg.ponteiro_user_id = p_user_id THEN NULL ELSE cfg.ponteiro_user_id END;

  -- Caminho autorizado da regra universal de propriedade (trg_zz_propriedade_lead).
  PERFORM set_config('rodizio.autorizado', 'sim', true);

  -- 1. Ela sai do rodízio antes de qualquer movimento (nada novo cai nela no meio).
  UPDATE public.crm_rodizio_membros SET ativo = false WHERE tenant_id = v_tenant AND user_id = p_user_id;
  UPDATE public.crm_rodizio_config SET ponteiro_user_id = NULL WHERE tenant_id = v_tenant AND ponteiro_user_id = p_user_id;

  -- 2. Reservas pendentes para ela: desfaz; em modo ligado o motor refaz entre as demais.
  FOR l IN
    SELECT * FROM public.crm_leads
     WHERE tenant_id = v_tenant AND rodizio_reservado_para = p_user_id AND distribuido_em IS NULL
  LOOP
    UPDATE public.crm_leads SET rodizio_reservado_para = NULL, rodizio_reservado_em = NULL WHERE id = l.id;
    PERFORM public.rodizio_livro(l, p_user_id, NULL, 'manual', 'reserva desfeita: ' || v_nome || ' saiu da equipe ' || v_quem, v_run);
    IF cfg.modo = 'ligado' THEN
      PERFORM public.rodizio_processar_lead(l.id, 'reserva refeita (' || v_nome || ' saiu da equipe)', v_run);
    END IF;
    v_reservas := v_reservas + 1;
  END LOOP;

  -- 3. Os leads de que ela é dona.
  FOR l IN
    SELECT * FROM public.crm_leads
     WHERE tenant_id = v_tenant AND assigned_to = p_user_id
     ORDER BY last_inbound_at DESC NULLS LAST, created_at
  LOOP
    v_lead_nome := COALESCE(NULLIF(btrim(l.name), ''), 'Lead');
    -- Ciclo já encerrado (etapa do administrador, ou entrega pendente na carência) → administrador, sempre.
    v_fechado := EXISTS (SELECT 1 FROM public.crm_stages s WHERE s.id = l.stage_id AND NOT COALESCE(s.visivel_para_sdr, true))
              OR EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = l.id);
    v_alvo := NULL;
    IF v_rodizio AND NOT v_fechado THEN
      v_alvo := public.rodizio_escolher(v_ids, v_cargas, v_ponteiro);
    END IF;

    IF v_alvo IS NOT NULL THEN
      SELECT i INTO v_i FROM generate_subscripts(v_ids, 1) AS i WHERE v_ids[i] = v_alvo LIMIT 1;
      v_cargas[v_i] := COALESCE(v_cargas[v_i], 0) + 1;   -- reveza dentro desta operação
      v_ponteiro := v_alvo; v_moveu_rodizio := true;
      v_alvo_nome := public.rodizio_nome(v_alvo);
      UPDATE public.crm_leads
         SET assigned_to = v_alvo, distribuido_em = now(),
             rodizio_reservado_para = NULL, rodizio_reservado_em = NULL, updated_at = now()
       WHERE id = l.id AND assigned_to = p_user_id;
      BEGIN
        UPDATE public.crm_tasks SET assigned_to = v_alvo WHERE lead_id = l.id AND assigned_to = p_user_id;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'equipe_redistribuir_leads: tarefas do lead % não seguiram (%)', l.id, SQLERRM;
      END;
      PERFORM public.rodizio_livro(l, p_user_id, v_alvo, 'manual',
        'redistribuição: ' || v_nome || ' saiu da equipe ' || v_quem || ' → ' || v_alvo_nome || v_extra, v_run);
      PERFORM public.rodizio_msg_sistema(l.id, v_tenant,
        '🔀 Lead passou de ' || v_nome || ' para ' || v_alvo_nome || ' (' || v_nome || ' saiu da equipe)');
      PERFORM public.rodizio_notifica(v_alvo, l.id, 'Lead recebido', v_lead_nome || ' era de ' || v_nome || ', que saiu da equipe.');
      v_destinos := v_destinos || jsonb_build_object(v_alvo_nome, COALESCE((v_destinos->>v_alvo_nome)::integer, 0) + 1);
      v_n_rod := v_n_rod + 1;
    ELSE
      UPDATE public.crm_leads
         SET assigned_to = v_gestor, distribuido_em = NULL,
             rodizio_reservado_para = NULL, rodizio_reservado_em = NULL, updated_at = now()
       WHERE id = l.id AND assigned_to = p_user_id;
      BEGIN
        UPDATE public.crm_tasks SET assigned_to = v_gestor WHERE lead_id = l.id AND assigned_to = p_user_id;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'equipe_redistribuir_leads: tarefas do lead % não seguiram (%)', l.id, SQLERRM;
      END;
      DELETE FROM public.crm_entregas_gestor WHERE lead_id = l.id;
      PERFORM public.rodizio_livro(l, p_user_id, v_gestor, 'manual',
        'redistribuição: ' || v_nome || ' saiu da equipe ' || v_quem || ' → administrador'
        || CASE WHEN v_fechado THEN ' (ciclo já encerrado)' ELSE '' END || v_extra, v_run);
      PERFORM public.rodizio_msg_sistema(l.id, v_tenant,
        '🔀 Lead passou de ' || v_nome || ' para o administrador (' || v_nome || ' saiu da equipe)');
      v_n_gestor := v_n_gestor + 1;
    END IF;
  END LOOP;
  IF v_moveu_rodizio THEN
    UPDATE public.crm_rodizio_config SET ponteiro_user_id = v_ponteiro WHERE tenant_id = v_tenant;
  END IF;

  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), v_tenant, CASE WHEN auth.uid() IS NULL THEN 'admin' ELSE 'tenant' END, 'sdr_redistribuir_leads',
          jsonb_build_object('target', p_user_id, 'target_nome', v_nome, 'destino', p_destino,
                             'para_rodizio', v_n_rod, 'para_gestor', v_n_gestor, 'reservas', v_reservas, 'run_id', v_run));
  RETURN jsonb_build_object('leads', v_n_rod + v_n_gestor, 'para_rodizio', v_n_rod, 'para_gestor', v_n_gestor,
                            'reservas_refeitas', v_reservas, 'destinos', v_destinos, 'run_id', v_run);
END $fn$;
REVOKE ALL ON FUNCTION public.equipe_redistribuir_leads(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipe_redistribuir_leads(uuid, text, text) TO authenticated, service_role;

-- ============================================================ VERIFICAÇÃO (só leitura)
-- SELECT proname FROM pg_proc WHERE proname IN ('equipe_sdr_exclusiva','equipe_editar_nome','equipe_encerrar_sessoes','equipe_excluir_previa','equipe_redistribuir_leads');
-- Como o gestor (set_config request.jwt.claims):
--   SELECT public.equipe_excluir_previa('<uuid da SDR>');   -- leads, modo, elegíveis, destino_auto
-- Ensaio sem efeito (o RAISE no fim desfaz tudo e devolve o resultado na mensagem):
--   DO $t$ DECLARE r jsonb; BEGIN
--     r := public.equipe_redistribuir_leads('<uuid da SDR>', 'auto', 'ensaio');
--     RAISE EXCEPTION 'ENSAIO (desfeito): %', r;
--   END $t$;
