-- Etapa do lead muda SÓ na entrega ao administrador — decisão do dono
-- (09/09/2026, depois do ensaio da noite):
--   "Ao marcar Compareceu o lead vai para a etapa Compareceu, que é escondida
--    da SDR — e o lead some do quadro dela justamente nas 24 horas em que ela
--    deveria continuar atendendo."
--
-- Defeito que existia: o gatilho da consulta (e a RPC da SDR) mexiam na etapa
-- NA HORA da marcação. Como as etapas de desfecho são invisíveis para o papel
-- sdr (crm_stages.visivel_para_sdr = false, policy sdr_escopo_crm_stages_visiveis),
-- o lead desaparecia do funil dela durante a carência inteira: a carência
-- servia para nada.
--
-- Regra nova, em três linhas:
--   • Durante a carência: a consulta recebe o desfecho, a entrega é agendada,
--     o lead FICA na etapa em que está e continua com a SDR; uma mensagem de
--     sistema diz o que foi marcado e quando ele passa ao administrador.
--   • Na entrega (fim da carência, ou na hora quando a carência é 0): o lead
--     passa ao administrador e SÓ ENTÃO muda de etapa — "Contratado" se a
--     consulta ficou contracted, "Não contratado" se ficou not_contracted
--     (compareceu e não fechou é do administrador, não da SDR).
--   • Lead que um humano move À MÃO para uma etapa do administrador continua
--     agendando a entrega, e a etapa já é a que o humano escolheu: ninguém
--     mexe nela.
--
-- Vêm de carona quatro defeitos achados no mesmo ensaio:
--   1. o GUC rodizio.autorizado ficava ligado até o fim da transação depois de
--      uma entrega — a trava de propriedade do lead (protege_propriedade_lead)
--      ficava aberta para os outros leads do mesmo lote/cron;
--   2. a carência continuava tirando leads das SDRs com o motor DESLIGADO
--      (o dono desliga o motor justamente para congelar tudo) — o congelamento
--      vive SÓ na varredura do cron (item 6): com o motor desligado a entrega
--      é ENFILEIRADA do mesmo jeito e fica esperando o motor voltar, porque
--      recusar o enfileiramento perdia o ciclo do comparecimento para sempre;
--   3. entrega que falhava apagava a linha da fila do mesmo jeito e o lead
--      ficava preso com a SDR para sempre — agora conta tentativas, empurra a
--      próxima tentativa (30 min × tentativa) e avisa o gestor ao desistir;
--   4. dois relatórios mentiam: a posse da SDR era fechada por uma linha de
--      'saneamento' escrita em nome dela, e "leads com 2+ faltas" somava o
--      histórico inteiro e contava o mesmo lead duas vezes no total da equipe.

-- ---------------------------------------------------------------- 0. fila de entrega: tentativas
-- Entrega que falha (sem gestor configurado, dona trocada no meio, lock) tem
-- de ser tentada de novo, não jogada fora: a coluna conta as tentativas e o
-- motor desiste depois de 5, deixando o motivo no livro.
ALTER TABLE public.crm_entregas_gestor ADD COLUMN IF NOT EXISTS tentativas integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.crm_entregas_gestor.tentativas IS
  'Quantas vezes sdr_entregas_pendentes tentou entregar este lead sem conseguir. Cada falha empurra entregar_em em 30 min × tentativa (recuo progressivo, para uma causa transitória não queimar as 5 tentativas em 30 minutos de cron). Acima de 5 a linha é descartada, o motivo vai para o livro (fase saneamento) e o gestor é notificado.';

-- ---------------------------------------------------------------- 1. a entrega ao administrador (e a etapa)
-- Mesmo corpo de 20260909190000 + 4º parâmetro opcional com a consulta que
-- motivou a entrega + movimentação de etapa + desligar o GUC no fim.
-- Assinatura muda (3 → 4 parâmetros): DROP da antiga antes.
DROP FUNCTION IF EXISTS public.sdr_entrega_lead_ao_gestor(uuid, text, text);
CREATE OR REPLACE FUNCTION public.sdr_entrega_lead_ao_gestor(
  p_lead_id uuid, p_motivo text, p_mensagem text, p_appointment_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE l public.crm_leads; v_gestor uuid; v_sdr_nome text;
        v_etapa_atual text; v_visivel boolean; v_status text; v_alvo uuid; v_alvo_nome text;
BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id = p_lead_id;
  IF NOT FOUND OR l.assigned_to IS NULL THEN RETURN false; END IF;
  IF NOT public.has_role(l.assigned_to, 'sdr'::app_role) THEN RETURN false; END IF;
  SELECT c.gestor_user_id INTO v_gestor FROM public.crm_rodizio_config c WHERE c.tenant_id = l.tenant_id;
  IF v_gestor IS NULL OR v_gestor = l.assigned_to THEN RETURN false; END IF;
  SELECT p.nome INTO v_sdr_nome FROM public.profiles p WHERE p.id = l.assigned_to;

  PERFORM set_config('rodizio.autorizado', 'sim', true);
  UPDATE public.crm_leads
     SET assigned_to = v_gestor, rodizio_reservado_para = NULL, rodizio_reservado_em = NULL, updated_at = now()
   WHERE id = l.id AND assigned_to = l.assigned_to;
  IF NOT FOUND THEN
    -- A autorização é transacional: se ela sobrevive a esta função, a trava de
    -- propriedade do lead fica aberta para todos os outros leads da mesma
    -- transação (o cron entrega em lote). Desligar é parte da entrega.
    PERFORM set_config('rodizio.autorizado', '', true);
    RETURN false;
  END IF;

  INSERT INTO public.crm_lead_atribuicoes (tenant_id, lead_id, lead_nome, lead_telefone, de_user_id, para_user_id, fase, motivo)
  VALUES (l.tenant_id, l.id, l.name, l.phone, l.assigned_to, v_gestor, 'comparecimento', p_motivo);
  INSERT INTO public.messages (lead_id, tenant_id, direction, type, content, status)
  VALUES (l.id, l.tenant_id, 'outbound', 'system',
          COALESCE(p_mensagem, '✅ Compareceu') || ' — lead passou para o administrador; crédito de agendamento continua com '
          || COALESCE(v_sdr_nome, 'a SDR'), 'system');

  -- A etapa do desfecho nasce AQUI, e só aqui: enquanto o lead era da SDR ele
  -- tinha de continuar visível para ela.
  SELECT s.name, COALESCE(s.visivel_para_sdr, true) INTO v_etapa_atual, v_visivel
    FROM public.crm_stages s WHERE s.id = l.stage_id;
  -- Lead que um humano já pôs numa etapa do administrador: a escolha dele
  -- manda. A exceção é "Compareceu", que era o destino automático do gatilho
  -- antigo (não é decisão de ninguém) — ali o desfecho ainda precisa aparecer.
  IF l.stage_id IS NULL OR COALESCE(v_visivel, true)
     OR public.normaliza_nome_etapa(v_etapa_atual) = 'compareceu' THEN
    IF p_appointment_id IS NOT NULL THEN
      SELECT a.status INTO v_status FROM public.crm_appointments a
       WHERE a.id = p_appointment_id AND a.status IN ('contracted', 'not_contracted');
    ELSE
      -- Entrega agendada pela etapa (sem consulta guardada): vale o desfecho
      -- mais recente do lead.
      SELECT a.status INTO v_status FROM public.crm_appointments a
       WHERE a.lead_id = l.id AND a.status IN ('contracted', 'not_contracted')
       ORDER BY a.scheduled_date DESC, a.updated_at DESC NULLS LAST LIMIT 1;
    END IF;
    IF v_status IS NOT NULL THEN
      -- Só uma etapa DO FUNIL DO LEAD (funis por procedimento têm as mesmas etapas).
      SELECT s.id, s.name INTO v_alvo, v_alvo_nome FROM public.crm_stages s
       WHERE s.pipeline_id = l.pipeline_id
         AND public.normaliza_nome_etapa(s.name) = CASE WHEN v_status = 'contracted' THEN 'contratado' ELSE 'nao contratado' END
       ORDER BY s.position LIMIT 1;
      IF v_alvo IS NOT NULL AND v_alvo IS DISTINCT FROM l.stage_id THEN
        UPDATE public.crm_leads SET stage_id = v_alvo, updated_at = now() WHERE id = l.id;
        PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
          '📂 Etapa: ' || v_alvo_nome || ' — '
          || CASE WHEN v_status = 'contracted' THEN 'consulta contratada' ELSE 'compareceu e não contratou' END
          || ', agora com o administrador');
      END IF;
    END IF;
  END IF;

  PERFORM set_config('rodizio.autorizado', '', true);
  RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.sdr_entrega_lead_ao_gestor(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- 2. agendar a entrega (ou entregar na hora)
-- Mesmo corpo de 20260910000000 (seção 3) com uma mudança: a entrega na hora
-- leva a consulta consigo (a etapa é responsabilidade da entrega, não mais de
-- sdr_pos_entrega_etapa).
--
-- Defeito que existia AQUI (achado pelo revisor, 10/09): a trava de "motor
-- desligado" tinha sido posta nesta função, cedo demais, e abria dois buracos:
--   (a) ela engolia também a entrega disparada pelo lead que um humano moveu À
--       MÃO para uma etapa do administrador. Nesse caminho a etapa JÁ mudou
--       antes de a função ser chamada, então recusar deixava o lead parado numa
--       etapa que a SDR não enxerga (crm_stages.visivel_para_sdr = false) e
--       ainda atribuído a ela: o lead sumia do quadro sem ninguém assumir;
--   (b) com o motor desligado NADA era enfileirado, então o comparecimento
--       marcado nesse período perdia o ciclo para sempre — a fila ficava vazia,
--       nada segurava o lead e ele voltava a ser candidato à realocação por
--       silêncio (rodizio_lead_na_fila olha crm_entregas_gestor).
-- O congelamento correto já existe no lugar certo: sdr_entregas_pendentes
-- (item 6) pula o cliente com modo 'desligado' SEM apagar a linha da fila.
-- Regra nova: esta função SEMPRE registra a entrega — enfileira, ou entrega na
-- hora quando a carência é 0 E o motor não está desligado. Com o motor
-- desligado e carência 0 ela enfileira com entregar_em = now(), para o cron
-- segurar até o motor voltar.
CREATE OR REPLACE FUNCTION public.sdr_agenda_entrega_ao_gestor(p_lead_id uuid, p_motivo text, p_mensagem text, p_appointment_id uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE l public.crm_leads; v_gestor uuid; v_min integer; v_modo text; v_quando timestamptz; v_txt text;
        v_desligado boolean;
BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id = p_lead_id;
  IF NOT FOUND OR l.assigned_to IS NULL THEN RETURN 'sem_dona'; END IF;
  IF NOT public.has_role(l.assigned_to, 'sdr'::app_role) THEN RETURN 'nao_e_sdr'; END IF;
  SELECT c.gestor_user_id, COALESCE(c.entrega_gestor_apos_min, 0), c.modo
    INTO v_gestor, v_min, v_modo FROM public.crm_rodizio_config c WHERE c.tenant_id = l.tenant_id;
  IF v_gestor IS NULL OR v_gestor = l.assigned_to THEN RETURN 'sem_gestor'; END IF;
  v_desligado := (v_modo = 'desligado');

  -- Entregar NA HORA só quando a carência é 0 e o motor está ligado. Com o
  -- motor desligado a entrega cai na fila (abaixo) com entregar_em = now(): a
  -- linha existe, o lead está contabilizado, e é o cron que segura enquanto o
  -- rodízio estiver congelado.
  IF v_min <= 0 AND NOT v_desligado THEN
    RETURN CASE WHEN public.sdr_entrega_lead_ao_gestor(p_lead_id, p_motivo, p_mensagem, p_appointment_id)
                THEN 'entregue' ELSE 'nao_entregue' END;
  END IF;

  IF EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = l.id AND e.de_user_id = l.assigned_to) THEN
    -- já agendada: só completa a consulta, se a primeira marcação veio da etapa
    UPDATE public.crm_entregas_gestor SET appointment_id = COALESCE(appointment_id, p_appointment_id)
     WHERE lead_id = l.id AND de_user_id = l.assigned_to;
    RETURN 'ja_agendada';
  END IF;

  -- Carência 0 com o motor desligado: vence agora, o cron entrega no primeiro
  -- ciclo depois de o dono religar o rodízio.
  v_quando := CASE WHEN v_min <= 0 THEN now() ELSE now() + make_interval(mins => v_min) END;
  v_txt := CASE WHEN v_min % 1440 = 0 THEN (v_min / 1440)::text || CASE WHEN v_min / 1440 = 1 THEN ' dia' ELSE ' dias' END
                WHEN v_min % 60 = 0 THEN (v_min / 60)::text || ' h'
                ELSE v_min::text || ' min' END;
  INSERT INTO public.crm_entregas_gestor (lead_id, tenant_id, de_user_id, motivo, mensagem, entregar_em, appointment_id)
  VALUES (l.id, l.tenant_id, l.assigned_to, p_motivo, p_mensagem, v_quando, p_appointment_id)
  ON CONFLICT (lead_id) DO UPDATE
    SET de_user_id = EXCLUDED.de_user_id, motivo = EXCLUDED.motivo, mensagem = EXCLUDED.mensagem,
        entregar_em = EXCLUDED.entregar_em, appointment_id = EXCLUDED.appointment_id, criado_em = now(),
        tentativas = 0;
  -- A mensagem é o que a SDR lê no chat: ela continua dona até a hora anunciada.
  -- Com o rodízio desligado não existe hora anunciada — prometer "em 24 h" seria
  -- mentira, porque o cron está congelado: o texto diz que a entrega está EM ESPERA.
  IF v_desligado THEN
    PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
      COALESCE(p_mensagem, '✅ Compareceu') || ' — a passagem para o administrador ficou EM ESPERA porque o rodízio está desligado; enquanto isso o lead continua com '
      || public.rodizio_nome(l.assigned_to));
  ELSE
    PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
      COALESCE(p_mensagem, '✅ Compareceu') || ' — o lead passa para o administrador em ' || v_txt
      || ' (' || to_char(v_quando AT TIME ZONE public.rodizio_tz(l.tenant_id), 'DD/MM HH24:MI') || '); até lá continua com '
      || public.rodizio_nome(l.assigned_to));
  END IF;
  RETURN 'agendada';
END $fn$;
REVOKE ALL ON FUNCTION public.sdr_agenda_entrega_ao_gestor(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- 3. "Compareceu" da SDR: só o desfecho
-- Mesmo corpo de 20260910001000 SEM nenhuma movimentação de etapa: o lead tem
-- de continuar no quadro da SDR durante a carência. O gatilho da consulta
-- (item 4) agenda a entrega, e a entrega move a etapa no fim.
--
-- Defeito que existia (achado pelo revisor, 10/09): esta RPC descartava o
-- resultado do agendamento da entrega — o gatilho da consulta engole qualquer
-- erro (RAISE WARNING) e a função devolvia 'ok' sempre. A tela então prometia à
-- SDR "o lead continua com você e depois passa para o administrador" mesmo
-- quando NADA foi agendado (sem gestor configurado, gestor = ela mesma, erro no
-- gatilho). Correção: depois do UPDATE a função LÊ o estado real e devolve o
-- campo 'entrega' — 'agendada', 'entregue' ou 'nenhuma' — para a tela dizer a
-- verdade. Os campos antigos continuam todos no retorno.
CREATE OR REPLACE FUNCTION public.sdr_marcar_comparecimento(p_appointment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE a public.crm_appointments; l public.crm_leads; v_nome text; n integer;
        v_dona uuid; v_entrega text;
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
  -- Comparecimento = not_contracted (contrato é dado do administrador/Dontus).
  UPDATE public.crm_appointments
     SET status = 'not_contracted', outcome_source = 'sdr', updated_at = now()
   WHERE id = a.id AND status IN ('confirmed', 'pending');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN jsonb_build_object('ok', false, 'motivo', 'ja_tem_desfecho'); END IF;

  SELECT COALESCE(NULLIF(btrim(p.nome), ''), p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  INSERT INTO public.messages (lead_id, tenant_id, direction, type, content, status)
  VALUES (l.id, l.tenant_id, 'outbound', 'system',
          '✅ Compareceu em ' || to_char(a.scheduled_date, 'DD/MM') || ' — marcado por ' || COALESCE(v_nome, 'SDR'), 'system');

  -- O que aconteceu de verdade com a entrega (o gatilho da consulta já rodou
  -- dentro do UPDATE acima). A dona é lida de novo: se ela mudou, a carência era
  -- 0 e o lead já passou ao administrador nesta mesma transação; se ainda é ela
  -- e existe linha na fila, a entrega está agendada; sem nenhuma das duas, não
  -- houve entrega nenhuma e a tela NÃO pode prometer que vai haver.
  -- (a dona é checada antes da fila porque "o lead já não é mais dela" é fato
  --  consumado — uma linha esquecida na fila não pode desmentir isso)
  SELECT l2.assigned_to INTO v_dona FROM public.crm_leads l2 WHERE l2.id = l.id;
  v_entrega := CASE
                 WHEN v_dona IS DISTINCT FROM auth.uid() THEN 'entregue'
                 WHEN EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = l.id) THEN 'agendada'
                 ELSE 'nenhuma'
               END;

  -- stage_id/stage_nome nulos de propósito: nada mudou de etapa, então o front
  -- não tem automação de entrada para disparar (era o que reenviava mensagem
  -- ao paciente quando a etapa não mudava de verdade).
  RETURN jsonb_build_object('ok', true, 'lead_id', l.id, 'stage_id', NULL::uuid,
                            'stage_nome', NULL::text, 'phone', l.phone,
                            'entrega', v_entrega);
END $fn$;
REVOKE ALL ON FUNCTION public.sdr_marcar_comparecimento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sdr_marcar_comparecimento(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------- 4. gatilho da consulta: só agenda
-- Some o bloco que movia a etapa para Compareceu/Contratado (era ele que
-- tirava o lead do quadro da SDR no primeiro minuto da carência).
CREATE OR REPLACE FUNCTION public.sdr_comparecimento_entrega()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.lead_id IS NULL OR NEW.status NOT IN ('contracted', 'not_contracted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.sdr_agenda_entrega_ao_gestor(NEW.lead_id,
      'compareceu em ' || to_char(NEW.scheduled_date, 'DD/MM') || ' (' || NEW.status || ')', '✅ Compareceu', NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Desfecho de consulta nunca pode falhar por causa do rodízio.
    RAISE WARNING 'sdr_comparecimento_entrega: % (lead %)', SQLERRM, NEW.lead_id;
  END;
  RETURN NEW;
END $fn$;
-- (o gatilho trg_zz_comparecimento_entrega continua apontando para esta função)

-- ---------------------------------------------------------------- 5. sdr_pos_entrega_etapa aposentada
-- A regra "sem contrato depois da carência → Não contratado" migrou para
-- dentro de sdr_entrega_lead_ao_gestor (item 1), que é o único lugar onde a
-- etapa muda. A função fica de pé, sem efeito, porque pode haver chamada em
-- migration antiga ou em função ainda não republicada — apagá-la quebraria a
-- chamada em tempo de execução.
CREATE OR REPLACE FUNCTION public.sdr_pos_entrega_etapa(p_lead_id uuid, p_appointment_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  RETURN false;
END $fn$;
COMMENT ON FUNCTION public.sdr_pos_entrega_etapa(uuid, uuid) IS
  'Aposentada em 10/09/2026: a etapa do desfecho passou a ser movida dentro de sdr_entrega_lead_ao_gestor. Mantida sem efeito para não quebrar chamadas antigas.';
REVOKE ALL ON FUNCTION public.sdr_pos_entrega_etapa(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- 6. o cron das entregas vencidas
-- Mesmo corpo de 20260910000000 (seção 3) com quatro mudanças:
--  (a) tenant com motor desligado nem entra na varredura — e a linha FICA na
--      fila esperando o motor voltar;
--  (b) a entrega leva a consulta (appointment_id) para a etapa sair certa;
--  (c) a linha só é apagada quando a entrega aconteceu, quando a dona mudou
--      (alguém transferiu) ou quando o ciclo deixou de estar encerrado;
--  (d) entrega que falha incrementa tentativas E EMPURRA entregar_em (recuo de
--      30 min × tentativa); acima de 5 tentativas o motor desiste, registra no
--      livro e AVISA O GESTOR. Antes a linha era apagada mesmo com a entrega
--      falhando e o lead ficava preso com a SDR para sempre; depois, com as
--      tentativas mas sem reagendar a linha, "5 tentativas" virava "desistir em
--      30 minutos" (o cron roda de 5 em 5 min e a linha voltava a cada volta):
--      uma causa transitória — lock, indisponibilidade momentânea — queimava as
--      5 tentativas antes de qualquer pessoa perceber. E desistir calado deixava
--      o lead numa etapa/dona que ninguém explicou.
CREATE OR REPLACE FUNCTION public.sdr_entregas_pendentes()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE e record; l public.crm_leads; v_n integer := 0; v_fechado boolean; v_gestor uuid;
BEGIN
  -- Cliente com o motor desligado nem entra na varredura: a linha fica na fila
  -- esperando o motor voltar (antes, a carência seguia tirando leads das SDRs
  -- com o rodízio desligado — o oposto de congelar tudo).
  FOR e IN SELECT g.* FROM public.crm_entregas_gestor g
            WHERE g.entregar_em <= now()
              AND NOT EXISTS (SELECT 1 FROM public.crm_rodizio_config c
                               WHERE c.tenant_id = g.tenant_id AND c.modo = 'desligado')
            ORDER BY g.entregar_em LIMIT 200 LOOP
    BEGIN
      SELECT * INTO l FROM public.crm_leads WHERE id = e.lead_id;
      IF NOT FOUND THEN
        -- lead apagado durante a carência: a linha não tem mais dono
        DELETE FROM public.crm_entregas_gestor WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
        CONTINUE;
      END IF;

      -- Desistência: já tentou mais de 5 vezes (com recuo de 30 min × tentativa,
      -- ou seja, no mínimo umas 7 h de janela). Sai da fila com o motivo no
      -- livro, para o gestor entender por que o lead ficou onde ficou — e com um
      -- aviso na tela dele, porque livro ninguém lê por vontade própria: sem o
      -- aviso o lead ficava calado com a SDR e ninguém sabia que a entrega
      -- desistiu.
      IF COALESCE(e.tentativas, 0) > 5 THEN
        PERFORM public.rodizio_livro(l, e.de_user_id, NULL, 'saneamento',
          'entrega ao administrador desistiu depois de 5 tentativas', NULL);
        SELECT c.gestor_user_id INTO v_gestor FROM public.crm_rodizio_config c WHERE c.tenant_id = l.tenant_id;
        PERFORM public.rodizio_notifica(v_gestor, l.id, 'Entrega de lead não concluída',
          'O lead ' || COALESCE(NULLIF(btrim(l.name), ''), l.phone, 'sem nome')
          || ' não pôde ser passado para o administrador depois de 5 tentativas e continua com '
          || public.rodizio_nome(l.assigned_to)
          || '. Verifique o administrador configurado no rodízio e passe o lead à mão se for o caso.');
        DELETE FROM public.crm_entregas_gestor WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
        CONTINUE;
      END IF;

      -- A dona ainda é quem estava na hora da marcação? Se alguém transferiu
      -- no meio da carência, quem transferiu decidiu: a entrega agendada cai.
      IF l.assigned_to IS DISTINCT FROM e.de_user_id THEN
        DELETE FROM public.crm_entregas_gestor WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
        CONTINUE;
      END IF;

      -- O ciclo continua encerrado? Etapa do administrador, ou A CONSULTA que
      -- motivou a entrega ainda com comparecimento (desfecho corrigido para
      -- falta/pendente = a SDR está reagendando, o lead é dela).
      v_fechado := EXISTS (SELECT 1 FROM public.crm_stages s WHERE s.id = l.stage_id AND NOT COALESCE(s.visivel_para_sdr, true))
                OR (e.appointment_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_appointments a
                                                              WHERE a.id = e.appointment_id AND a.status IN ('contracted', 'not_contracted')))
                OR (e.appointment_id IS NULL AND EXISTS (SELECT 1 FROM public.crm_appointments a
                                                          WHERE a.lead_id = l.id AND a.status IN ('contracted', 'not_contracted')
                                                            AND a.updated_at >= e.criado_em - interval '1 hour'));
      IF NOT v_fechado THEN
        PERFORM public.rodizio_livro(l, e.de_user_id, NULL, 'saneamento',
          'entrega ao administrador cancelada: desfecho/etapa foram corrigidos durante a carência', NULL);
        PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
          '↩️ Entrega ao administrador cancelada: o desfecho foi corrigido durante a carência; o lead continua com ' || public.rodizio_nome(l.assigned_to));
        DELETE FROM public.crm_entregas_gestor WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
        CONTINUE;
      END IF;

      -- A entrega leva a consulta: é ela que decide a etapa (Contratado / Não contratado).
      IF public.sdr_entrega_lead_ao_gestor(e.lead_id, COALESCE(e.motivo, 'comparecimento') || ' (após carência)',
                                           e.mensagem, e.appointment_id) THEN
        v_n := v_n + 1;
        DELETE FROM public.crm_entregas_gestor WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
      ELSE
        -- Entrega recusada (sem gestor configurado, corrida na dona, lock):
        -- a linha FICA e é tentada de novo — mas MAIS TARDE. Antes ela era
        -- apagada do mesmo jeito e o lead ficava preso com a SDR para sempre;
        -- depois ela ficava sem reagendar, e como o cron roda de 5 em 5 minutos
        -- as 5 tentativas queimavam em meia hora: "desistir acima de 5
        -- tentativas" virava "desistir em 30 minutos". O recuo é progressivo
        -- (30 min, 1 h, 1 h 30…), o que dá horas para um problema transitório
        -- passar ou para alguém arrumar a configuração.
        UPDATE public.crm_entregas_gestor
           SET tentativas = COALESCE(tentativas, 0) + 1,
               entregar_em = now() + make_interval(mins => 30 * (COALESCE(tentativas, 0) + 1))
         WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sdr_entregas_pendentes: % (lead %)', SQLERRM, e.lead_id;
      -- Erro também é tentativa (o bloco acima foi desfeito): sem contar, a
      -- linha que sempre estoura voltaria a cada 5 minutos para sempre. O mesmo
      -- recuo do ramo de recusa vale aqui, pelo mesmo motivo.
      -- O contador não pode derrubar a varredura das outras entregas.
      BEGIN
        UPDATE public.crm_entregas_gestor
           SET tentativas = COALESCE(tentativas, 0) + 1,
               entregar_em = now() + make_interval(mins => 30 * (COALESCE(tentativas, 0) + 1))
         WHERE lead_id = e.lead_id AND entregar_em = e.entregar_em;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;
  END LOOP;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.sdr_entregas_pendentes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sdr_entregas_pendentes() TO service_role;

-- ---------------------------------------------------------------- 7. relatório da SDR: posse fechada errado
-- Mesmo corpo de 20260909230000 (item 7) com uma correção na CTE "posse".
-- Defeito: a janela de posse da SDR terminava na primeira linha do livro em
-- que ela aparece como ORIGEM, qualquer que fosse a fase — e a linha de
-- 'saneamento' de "entrega ao administrador cancelada" tem de_user_id = ela,
-- que continua dona. Efeito: a posse fechava no momento do cancelamento, a
-- primeira resposta dela depois disso não era vista, e o lead entrava na conta
-- como "recebido e não respondido" (era ela levando bronca por atender).
-- Regra nova: só as fases de saída real fecham a posse (aplicacao, corte_9h,
-- realocacao_1h, manual, comparecimento).
CREATE OR REPLACE FUNCTION public.relatorio_sdr_calc(
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
         -- Só SAÍDA de verdade fecha a janela de posse. O filtro antigo era
         -- "fase <> 'sombra'", e a linha de 'saneamento' escrita quando a
         -- entrega ao administrador é CANCELADA tem de_user_id = ela mesma
         -- (que continua dona): o relatório fechava a posse ali e passava a
         -- contar o lead como "recebido e não respondido".
         AND a.fase IN ('aplicacao', 'corte_9h', 'realocacao_1h', 'manual', 'comparecimento')
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

-- ---------------------------------------------------------------- 8. reagendamentos e faltas repetidas
-- Mesmo corpo de 20260910000000 (seção 4) com três correções de leitura:
--  (a) "leads com 2+ faltas" só tinha limite superior (a.scheduled_date <= p_ate):
--      mostrava o acumulado histórico ao lado de colunas do período, e o número
--      não conversava com o resto da linha. Agora tem os dois limites.
--  (b) a linha "Equipe (total)" somava leads_2_faltas linha por linha e contava
--      o mesmo lead duas vezes quando as faltas dele estavam creditadas a duas
--      SDRs. O total passa a contar leads DISTINTOS, por consulta própria.
--  (c) a CTE sdrs exigia só "tem papel sdr", enquanto relatorio_sdr_calc exige
--      papel EXCLUSIVAMENTE sdr na visão do gestor: as duas abas da mesma tela
--      listavam equipes diferentes. Mesma régua agora (a SDR olhando a própria
--      linha continua isenta, como em relatorio_sdr_calc com p_user preenchido).
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
       -- régua exclusiva da aba Equipe (equipe_listar / relatorio_sdr_calc)
       AND (NOT v_gestor
            OR NOT EXISTS (SELECT 1 FROM public.user_roles ur2
                            WHERE ur2.user_id = p.id AND ur2.role <> 'sdr'::app_role))
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
            AND a.lead_id IS NOT NULL AND a.scheduled_date >= p_de AND a.scheduled_date <= p_ate
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
               AND ap.scheduled_date >= p_de AND ap.scheduled_date <= p_ate
               AND ap.responsavel_credito_id IN (SELECT s2.uid FROM sdrs s2)
             GROUP BY ap.lead_id HAVING count(*) >= 2) y)::integer,
         true
    FROM agg a HAVING v_gestor
  ORDER BY 6, 2;
END $fn$;
REVOKE ALL ON FUNCTION public.relatorio_sdr_reagendamentos(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_sdr_reagendamentos(date, date) TO authenticated, service_role;

-- ---------------------------------------------------------------- 9. régua de entrada: comparecimento tem prazo
-- Defeito: o predicado que barra o lead que "já compareceu alguma vez" não
-- tinha janela de tempo. Quem compareceu em janeiro e volta a escrever em
-- setembro não era distribuído para NINGUÉM — ficava parado com o
-- administrador, e é exatamente a base de reativação que o dono quer
-- trabalhando. Janela nova: 30 dias. Comparecimento mais antigo que isso não
-- segura mais o lead; dentro dos 30 dias o ciclo ainda é do administrador
-- (pós-consulta, orçamento em andamento).
--
-- ATENÇÃO ao republicar: esta função também é alterada em 20260910011000
-- (multi-funil). Esta migration é a de timestamp maior, então é ela que vale:
-- o corpo abaixo é a forma multi-funil (public.rodizio_funis) com o predicado
-- do comparecimento datado. Se 20260910011000 acrescentar outros predicados,
-- eles precisam ser trazidos para cá.

-- Rede de segurança: rodizio_lead_na_fila é LANGUAGE sql (corpo validado na
-- criação), então rodizio_funis tem de existir. Se a migration multi-funil
-- ainda não rodou, cria um substituto que devolve o funil único de hoje —
-- comportamento idêntico ao anterior. Se ela já rodou, nada é tocado.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'rodizio_funis'
  ) THEN
    EXECUTE $ddl$
      CREATE FUNCTION public.rodizio_funis(p_tenant uuid)
      RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
        SELECT CASE WHEN public.rodizio_funil(p_tenant) IS NULL THEN NULL::uuid[]
                    ELSE ARRAY[public.rodizio_funil(p_tenant)] END;
      $f$;
    $ddl$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.rodizio_funis(uuid) FROM PUBLIC, anon, authenticated';
    EXECUTE $c$COMMENT ON FUNCTION public.rodizio_funis(uuid) IS 'Substituto criado em 20260910012000 porque a migration multi-funil ainda não havia rodado: devolve o funil único do rodízio.'$c$;
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.rodizio_lead_na_fila(p_lead public.crm_leads, p_admin uuid, p_funil uuid, p_numero uuid, p_etapas uuid[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT (p_lead).id IS NOT NULL
     -- Multi-funil: o lead entra se o funil dele é um dos funis do rodízio.
     -- COALESCE externo porque "= ANY (ARRAY[NULL])" devolveria NULL, e quem
     -- chama faz "IF NOT rodizio_lead_na_fila(...)" — NULL ali distribuiria o
     -- lead em vez de barrá-lo.
     AND (p_lead).pipeline_id IS NOT NULL
     AND COALESCE((p_lead).pipeline_id = ANY (COALESCE(public.rodizio_funis((p_lead).tenant_id), ARRAY[p_funil])), false)
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
     -- Ciclo encerrado é do administrador: etapa que a SDR não vê, comparecimento
     -- DOS ÚLTIMOS 30 DIAS, ou entrega ao administrador agendada. Comparecimento
     -- antigo não segura mais o lead: paciente que volta meses depois é lead de
     -- reativação e precisa de dona.
     AND NOT EXISTS (SELECT 1 FROM public.crm_stages s
                      WHERE s.id = (p_lead).stage_id AND NOT COALESCE(s.visivel_para_sdr, true))
     AND NOT EXISTS (SELECT 1 FROM public.crm_appointments a
                      WHERE a.lead_id = (p_lead).id
                        AND a.status IN ('contracted', 'not_contracted')
                        AND a.scheduled_date >= (now() AT TIME ZONE 'America/Bahia')::date - 30)
     AND NOT EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = (p_lead).id);
$fn$;
REVOKE ALL ON FUNCTION public.rodizio_lead_na_fila(public.crm_leads, uuid, uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- ============================================================ VERIFICAÇÃO (só leitura)
-- 1. A coluna nova e as assinaturas:
-- SELECT column_name, data_type, column_default FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'crm_entregas_gestor' ORDER BY ordinal_position;
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND p.proname IN ('sdr_entrega_lead_ao_gestor','sdr_agenda_entrega_ao_gestor','sdr_entregas_pendentes',
--                      'sdr_marcar_comparecimento','sdr_comparecimento_entrega','sdr_pos_entrega_etapa',
--                      'relatorio_sdr_calc','relatorio_sdr_reagendamentos','rodizio_lead_na_fila','rodizio_funis')
--  ORDER BY 1, 2;   -- sdr_entrega_lead_ao_gestor tem de aparecer SÓ com 4 argumentos
--
-- 2. Ninguém além do servidor executa as internas:
-- SELECT p.proname, coalesce(array_to_string(p.proacl, ' | '), '(sem ACL = só o dono)') AS acl
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND p.proname IN ('sdr_entrega_lead_ao_gestor','sdr_agenda_entrega_ao_gestor','sdr_entregas_pendentes',
--                      'sdr_pos_entrega_etapa','rodizio_lead_na_fila','relatorio_sdr_calc');
--
-- 3. Fila de entrega e motor por cliente:
-- SELECT c.tenant_id, c.modo, c.entrega_gestor_apos_min,
--        (SELECT count(*) FROM public.crm_entregas_gestor e WHERE e.tenant_id = c.tenant_id) AS na_fila,
--        (SELECT count(*) FROM public.crm_entregas_gestor e WHERE e.tenant_id = c.tenant_id AND e.entregar_em <= now()) AS vencidas,
--        (SELECT max(e.tentativas) FROM public.crm_entregas_gestor e WHERE e.tenant_id = c.tenant_id) AS max_tentativas
--   FROM public.crm_rodizio_config c;
--
-- 4. Durante a carência o lead continua com a SDR e em etapa VISÍVEL para ela:
-- SELECT e.lead_id, e.entregar_em, e.tentativas, s.name AS etapa, s.visivel_para_sdr, p.nome AS dona
--   FROM public.crm_entregas_gestor e
--   JOIN public.crm_leads l ON l.id = e.lead_id
--   LEFT JOIN public.crm_stages s ON s.id = l.stage_id
--   LEFT JOIN public.profiles p ON p.id = l.assigned_to
--  ORDER BY e.entregar_em;   -- visivel_para_sdr deve ser true em todas
--
-- 5. Depois da entrega: etapa Contratado/Não contratado com o administrador:
-- SELECT a.criado_em, a.lead_id, a.fase, a.motivo, s.name AS etapa_agora, s.visivel_para_sdr
--   FROM public.crm_lead_atribuicoes a
--   JOIN public.crm_leads l ON l.id = a.lead_id
--   LEFT JOIN public.crm_stages s ON s.id = l.stage_id
--  WHERE a.fase = 'comparecimento' ORDER BY a.criado_em DESC LIMIT 20;
--
-- 6. Relatórios (como gestor): posse não fecha em 'saneamento' e o total não duplica:
-- SELECT nome, leads_recebidos, leads_respondidos, agendamentos, compareceram, faltas, is_total
--   FROM public.relatorio_sdr_calc(public.current_tenant_id(), current_date - 30, current_date, NULL, true);
-- SELECT * FROM public.relatorio_sdr_reagendamentos(current_date - 30, current_date);
--   -- a linha "Equipe (total)" deve ter leads_2_faltas <= soma das linhas
--
-- 7. Janela de 30 dias na régua de entrada (lead com comparecimento antigo volta a ser distribuível):
-- SELECT l.id, l.name,
--        (SELECT max(a.scheduled_date) FROM public.crm_appointments a
--          WHERE a.lead_id = l.id AND a.status IN ('contracted','not_contracted')) AS ultimo_comparecimento,
--        public.rodizio_lead_na_fila(l,
--          (SELECT c.gestor_user_id FROM public.crm_rodizio_config c WHERE c.tenant_id = l.tenant_id),
--          public.rodizio_funil(l.tenant_id), NULL, public.rodizio_etapas_entrada(l.tenant_id)) AS entra
--   FROM public.crm_leads l
--  WHERE EXISTS (SELECT 1 FROM public.crm_appointments a
--                 WHERE a.lead_id = l.id AND a.status IN ('contracted','not_contracted'))
--  LIMIT 10;   -- comparecimento com mais de 30 dias tem de voltar a dar entra = true
--
-- 8. Motor desligado: a entrega tem de estar ENFILEIRADA (não recusada). Com
--    modo = 'desligado' as linhas vencidas ficam esperando, sem nenhuma entrega:
-- SELECT c.modo, count(e.lead_id) AS na_fila,
--        count(e.lead_id) FILTER (WHERE e.entregar_em <= now()) AS esperando_o_motor
--   FROM public.crm_rodizio_config c
--   LEFT JOIN public.crm_entregas_gestor e ON e.tenant_id = c.tenant_id
--  GROUP BY c.modo;
--
-- 9. Comparecimento marcado SEM entrega registrada (é o caso em que a RPC agora
--    devolve entrega = 'nenhuma' e a tela não pode prometer a passagem):
-- SELECT a.id, a.lead_id, a.scheduled_date, a.outcome_source, l.assigned_to
--   FROM public.crm_appointments a
--   JOIN public.crm_leads l ON l.id = a.lead_id
--  WHERE a.status IN ('contracted','not_contracted')
--    AND a.outcome_at >= now() - interval '7 days'
--    AND public.has_role(l.assigned_to, 'sdr'::app_role)
--    AND NOT EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = l.id)
--  ORDER BY a.outcome_at DESC LIMIT 20;
