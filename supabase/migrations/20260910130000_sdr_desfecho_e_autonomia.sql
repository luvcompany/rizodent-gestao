-- Correção de desfecho, exclusão de agendamento e autonomia da SDR
-- (10/09/2026 — pedido do dono, em cima do ensaio do ciclo da SDR):
--
--   1. "depois que o sdr ou crc marca um agendamento como compareceu ou não
--      compareceu ele não consegue editar para corrigir caso ela marque errado"
--      — e, quando ela marca "não compareceu" por engano, o comparecimento
--      (que é o que paga a SDR) some do relatório dela.
--   2. "e também não consegue excluir caso tenha agendado errado ou marcado errado".
--   3. "O certo é ter a etapa de compareceu para o sdr. Isso para todos os funis.
--      O lead vai ficar lá por algumas horas e depois vai ter o desfecho…"
--   5. "O sdr também deve poder criar etapas, gatilhos, disparos e funis".
--   6. "não precisa aparecer para o sdr se o lead é contratado ou não".
--
-- O ciclo passa a ser, para todo funil:
--   Agendado → (SDR marca) Compareceu → carência de 24 h → Contratado / Não
--   contratado, já com o administrador. A SDR enxerga até "Compareceu"; o
--   desfecho de venda continua invisível para ela.
--
-- O que este arquivo NÃO faz (fica para o front, fora desta migration):
--   • o item 4 do dono (o botão AUTOMATIZE do funil da SDR caía em "/crm/sdr")
--     é rota, não banco: a correção é "/crm/automacoes" entrar em SDR_PREFIXES,
--     em src/components/ProtectedRoute.tsx. Sem a permissão de escrita deste
--     arquivo (item 5), porém, a tela abriria só para ela olhar;
--   • a tela ainda escreve "Não contratado" no card da consulta da SDR e o
--     toast de sdr_marcar_comparecimento ainda diz "a etapa não muda agora"
--     (src/components/chat/AppointmentConfirmBar.tsx) — item 6 e o texto do
--     item 3 são de interface.
--
-- COMO DESFAZER (se precisar): as quatro funções trocadas por CREATE OR REPLACE
-- (stage_regras_padrao_trg, sdr_etapa_oculta_entrega, sdr_marcar_comparecimento,
-- stamp_appointment_update) voltam pelo corpo da migration anterior de cada
-- uma; as policies novas saem por DROP POLICY (todas têm nome próprio
-- sdr_ins_/sdr_upd_/sdr_del_); o UPDATE do item 1 se desfaz pondo
-- visivel_para_sdr = false de novo nas etapas "Compareceu". Nenhuma policy
-- existente foi tocada.

SET LOCAL lock_timeout = '5s';

-- ============================================================ 1. (D1) a etapa "Compareceu" é da SDR
-- Decisão do dono: "o certo é ter a etapa de compareceu para o sdr, isso para
-- todos os funis". Só ela muda de lado: "Compareceu e agendou", "Contratado" e
-- "Não contratado" continuam invisíveis (são desfecho de venda, assunto do
-- administrador — item 6 do pedido).

-- 1.1 O gatilho que decide como uma etapa NASCE.
-- Corpo idêntico ao vigente (20260910013000, seção 2) com uma única mudança:
-- 'compareceu' sai da lista de etapas que nascem ocultas para a SDR. Sem isso,
-- o UPDATE de 1.2 valeria só para as etapas de hoje: todo funil novo clona as
-- etapas do Funil Principal (pipeline_clonar_etapas_padrao) e este gatilho, que
-- é BEFORE INSERT, voltaria a marcar "Compareceu" como invisível — e a etapa
-- criada pela própria SDR (item 5) nasceria escondida dela.
CREATE OR REPLACE FUNCTION public.stage_regras_padrao_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF TG_OP = 'INSERT' AND current_setting('app.clonando_etapas', true) IS DISTINCT FROM 'sim' THEN
    IF EXISTS (SELECT 1 FROM public.crm_stages s
                WHERE s.pipeline_id = NEW.pipeline_id
                  AND public.normaliza_nome_etapa(s.name) = public.normaliza_nome_etapa(NEW.name)) THEN
      RETURN NULL;
    END IF;
  END IF;
  -- 'compareceu' saiu desta lista em 10/09/2026: comparecimento é o fim do
  -- ciclo da SDR, não o começo do ciclo do administrador.
  IF public.normaliza_nome_etapa(NEW.name) IN ('contratado', 'nao contratado', 'compareceu e agendou') THEN
    NEW.visivel_para_sdr := false;
  END IF;
  RETURN NEW;
END $fn$;
COMMENT ON FUNCTION public.stage_regras_padrao_trg() IS
  'Gatilho BEFORE INSERT OR UPDATE OF name de crm_stages: recusa nome de etapa repetido no mesmo funil e marca as etapas de desfecho de venda (Contratado, Não contratado, Compareceu e agendou) como invisíveis para a SDR. Desde 10/09/2026 "Compareceu" NÃO é mais escondida: é a etapa onde o lead espera a carência antes de passar ao administrador.';
-- Função de gatilho: ninguém chama direto por RPC.
REVOKE ALL ON FUNCTION public.stage_regras_padrao_trg() FROM PUBLIC, anon, authenticated;

-- 1.2 As etapas que já existem.
-- crm_stages tem tenant_id (preenchido pelo gatilho set_crm_stages_tenant_id),
-- mas o dono da etapa é o FUNIL: o recorte por cliente vai pelo JOIN com
-- crm_pipelines, que é a fonte da verdade se um dia as duas colunas divergirem.
-- Só o cliente Rizodent (o único com rodízio de SDR em produção) — outro
-- cliente recebe o mesmo tratamento quando ligar o rodízio, e funil novo já
-- nasce certo por causa de 1.1.
-- O gatilho trg_zz_stage_regras_padrao é BEFORE INSERT OR UPDATE **OF name**:
-- este UPDATE mexe só em visivel_para_sdr, então não dispara nada.
UPDATE public.crm_stages s
   SET visivel_para_sdr = true
  FROM public.crm_pipelines p
 WHERE p.id = s.pipeline_id
   AND p.tenant_id = '00000000-0000-0000-0000-000000000010'
   AND public.normaliza_nome_etapa(s.name) = 'compareceu'
   AND COALESCE(s.visivel_para_sdr, true) = false;

-- 1.3 Buraco que o item 1.2 abre, e o tampão.
-- sdr_etapa_oculta_entrega existe para isto: lead de SDR que cai numa etapa
-- INVISÍVEL para ela é lead que virou assunto do administrador, então a entrega
-- é agendada. Com "Compareceu" visível, quem arrastasse o lead para lá à mão
-- não agendaria entrega nenhuma — o lead ficaria com a SDR para sempre, numa
-- etapa que promete 24 h e não cumpre. Corpo igual ao vigente
-- (20260909210000, seção 5) com uma condição a mais: "Compareceu" agenda a
-- entrega mesmo sendo visível. Agendar duas vezes não é problema —
-- sdr_agenda_entrega_ao_gestor devolve 'ja_agendada' e não duplica a linha.
CREATE OR REPLACE FUNCTION public.sdr_etapa_oculta_entrega()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_nome text; v_visivel boolean;
BEGIN
  IF NEW.stage_id IS NULL OR NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN RETURN NEW; END IF;
  SELECT s.name, s.visivel_para_sdr INTO v_nome, v_visivel FROM public.crm_stages s WHERE s.id = NEW.stage_id;
  IF COALESCE(v_visivel, true) AND public.normaliza_nome_etapa(v_nome) IS DISTINCT FROM 'compareceu' THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM public.sdr_agenda_entrega_ao_gestor(NEW.id, 'etapa "' || v_nome || '" fecha o ciclo da SDR', '📂 Etapa ' || v_nome);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sdr_etapa_oculta_entrega: % (lead %)', SQLERRM, NEW.id;
  END;
  RETURN NEW;
END $fn$;
COMMENT ON FUNCTION public.sdr_etapa_oculta_entrega() IS
  'Gatilho de crm_leads: lead de SDR que entra em etapa invisível para ela — ou na etapa "Compareceu", desde 10/09/2026 — agenda a passagem para o administrador (com a carência configurada).';
REVOKE ALL ON FUNCTION public.sdr_etapa_oculta_entrega() FROM PUBLIC, anon, authenticated;

-- ============================================================ 2. (D2) marcar "Compareceu" volta a mover o lead
-- Corpo de 20260910012000 (seção 3) com UMA mudança de comportamento: depois de
-- gravar o desfecho, o lead vai para a etapa "Compareceu" do funil dele. Tudo o
-- mais fica de pé — exige papel sdr, exige que o lead seja dela, grava
-- not_contracted + outcome_source 'sdr', a entrega (carência) continua vindo do
-- gatilho da consulta, e o campo 'entrega' continua dizendo a verdade à tela.
--
-- POR QUE 'stage_id' CONTINUA NULL NO RETORNO (decisão consciente):
--   src/lib/appointmentOutcome.ts (applySdrComparecimento) dispara
--   executeStageAutomations({triggerTypes:['on_enter']}) quando a RPC devolve
--   stage_id — e executeStageAutomations EXECUTA a ação na hora (invoca
--   send-whatsapp-message / bot-engine). Só que o banco já tem o gatilho
--   trg_enqueue_stage_entry_automations (20260514204232): quando stage_id do
--   lead muda, ele ENFILEIRA as automações on_enter da etapa nova em
--   crm_automation_queue, e o automation-engine executa. Nenhum dos dois
--   caminhos confere o outro. Devolver stage_id aqui, agora que a etapa muda de
--   verdade DENTRO do banco, faria o paciente receber a mensagem de entrada de
--   "Compareceu" DUAS VEZES. Então a etapa muda no banco (uma execução, pela
--   fila) e o retorno traz o nome para a tela mostrar, mais 'etapa_id' — um
--   campo com nome diferente, que nenhum código do front usa para disparar
--   automação. Se um dia o front parar de executar automação por conta própria,
--   basta renomear 'etapa_id' para 'stage_id'.
CREATE OR REPLACE FUNCTION public.sdr_marcar_comparecimento(p_appointment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE a public.crm_appointments; l public.crm_leads; v_nome text; n integer;
        v_dona uuid; v_entrega text; v_alvo uuid; v_alvo_nome text;
        v_etapa_atual text; v_movido boolean := false;
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

  -- O gatilho da consulta já rodou dentro do UPDATE acima (agendou a entrega
  -- ou, com carência 0, entregou o lead ao administrador E já pôs a etapa de
  -- desfecho). Por isso o lead é LIDO DE NOVO antes de qualquer movimento: com
  -- o lead já entregue, mover para "Compareceu" desfaria a entrega.
  SELECT * INTO l FROM public.crm_leads WHERE id = a.lead_id;
  v_dona := l.assigned_to;

  IF v_dona IS NOT DISTINCT FROM auth.uid() THEN
    SELECT s.id, s.name INTO v_alvo, v_alvo_nome
      FROM public.crm_stages s
     WHERE s.pipeline_id = l.pipeline_id
       AND public.normaliza_nome_etapa(s.name) = 'compareceu'
     ORDER BY s.position LIMIT 1;
    IF v_alvo IS NOT NULL AND v_alvo IS DISTINCT FROM l.stage_id THEN
      UPDATE public.crm_leads SET stage_id = v_alvo, updated_at = now() WHERE id = l.id;
      v_movido := true;
    END IF;
  END IF;

  -- Nome da etapa em que o lead REALMENTE está no fim (movido ou não).
  SELECT s.name INTO v_etapa_atual
    FROM public.crm_leads l2 JOIN public.crm_stages s ON s.id = l2.stage_id
   WHERE l2.id = l.id;

  SELECT COALESCE(NULLIF(btrim(p.nome), ''), p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  INSERT INTO public.messages (lead_id, tenant_id, direction, type, content, status)
  VALUES (l.id, l.tenant_id, 'outbound', 'system',
          '✅ Compareceu em ' || to_char(a.scheduled_date, 'DD/MM') || ' — marcado por ' || COALESCE(v_nome, 'SDR')
          || CASE WHEN v_movido THEN ' · etapa ' || v_alvo_nome ELSE '' END, 'system');

  -- O que aconteceu de verdade com a entrega. A dona é checada antes da fila
  -- porque "o lead já não é mais dela" é fato consumado — uma linha esquecida
  -- na fila não pode desmentir isso.
  v_entrega := CASE
                 WHEN v_dona IS DISTINCT FROM auth.uid() THEN 'entregue'
                 WHEN EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = l.id) THEN 'agendada'
                 ELSE 'nenhuma'
               END;

  -- stage_id NULL de propósito (ver o comentário do bloco): quem executa as
  -- automações de entrada de "Compareceu" é a fila do banco, uma vez só.
  RETURN jsonb_build_object('ok', true, 'lead_id', l.id, 'stage_id', NULL::uuid,
                            'stage_nome', v_etapa_atual, 'etapa_id', CASE WHEN v_movido THEN v_alvo ELSE NULL END,
                            'etapa_mudou', v_movido, 'phone', l.phone,
                            'entrega', v_entrega);
END $fn$;
COMMENT ON FUNCTION public.sdr_marcar_comparecimento(uuid) IS
  'RPC da SDR: marca a consulta como comparecida (status not_contracted, outcome_source ''sdr''), move o lead para a etapa "Compareceu" do funil dele (desde 10/09/2026) e deixa a entrega ao administrador agendada pela carência. Devolve stage_id NULL de propósito — a automação de entrada da etapa é executada pela fila do banco, não pelo front.';
REVOKE ALL ON FUNCTION public.sdr_marcar_comparecimento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sdr_marcar_comparecimento(uuid) TO authenticated, service_role;

-- ============================================================ 3. (D4) corrigir o desfecho
-- 3.1 A porta autorizada no gatilho do desfecho.
-- stamp_appointment_update trava a REABERTURA de desfecho fora de gerente e
-- serviço — foi ela que deixou a SDR (e o crc) sem conserto quando marcava
-- errado. SECURITY DEFINER não ajuda aqui: auth.uid() continua sendo a pessoa,
-- então a RPC bateria na mesma trava. Mesma solução já usada na propriedade do
-- lead (protege_propriedade_lead / GUC rodizio.autorizado): um GUC TRANSACIONAL
-- que só as duas RPCs abaixo ligam, por uma instrução, e desligam em seguida.
-- Ninguém de fora consegue ligá-lo: set_config vive em pg_catalog e o PostgREST
-- só expõe função de schema exposto.
-- Corpo IDÊNTICO ao vigente (20260910013000, seção 1) com duas mudanças:
--   (a) a correção autorizada passa pela trava de reabertura, e SÓ para os três
--       destinos que as RPCs usam ('no_show', 'not_contracted', 'cancelled') —
--       'contracted' continua sendo dado do pagamento, ninguém carimba na mão;
--   (b) a fonte 'sdr' também é preservada quando a correção vem pela RPC, para
--       o crc corrigindo um comparecimento não virar "o humano decidiu que não
--       contratou" ('ui' + outcome_by) — que é o que faz o dontus-sync parar de
--       promover a consulta quando o pagamento aparecer depois.
CREATE OR REPLACE FUNCTION public.stamp_appointment_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  terminais text[] := ARRAY['contracted','not_contracted','no_show','rescheduled','cancelled'];
  is_service boolean := (auth.uid() IS NULL);
  is_manager boolean := (auth.uid() IS NOT NULL AND (has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'superadmin'::app_role)));
  -- Correção pedida por sdr_corrigir_desfecho / sdr_excluir_agendamento.
  is_correcao boolean := (COALESCE(current_setting('sdr.correcao_desfecho', true), '') = 'sim');
BEGIN
  -- (a) carimbo do desfecho
  IF OLD.status IN ('confirmed','pending') AND NEW.status = ANY(terminais) THEN
    NEW.outcome_at := now();
    IF NOT is_service THEN
      NEW.outcome_by := auth.uid();
      -- Comparecimento marcado pela SDR: a fonte 'sdr' é o dado, não enfeite.
      -- Antes ela era sobrescrita por 'ui' aqui mesmo e o Dontus não sabia mais
      -- se o not_contracted era "compareceu, contrato em aberto" (SDR) ou
      -- "compareceu e não fechou" (decisão do gerente).
      IF NEW.outcome_source = 'sdr' AND (public.has_role(auth.uid(), 'sdr'::app_role) OR is_correcao) THEN
        NULL;   -- preserva a marca da SDR (e a da correção feita pela RPC)
      ELSIF pg_trigger_depth() > 1 AND NEW.outcome_source = 'auto_stage_contratado' THEN
        NULL;
      ELSE
        NEW.outcome_source := 'ui';
      END IF;
    ELSE
      NEW.outcome_by := NULL;
      NEW.outcome_source := COALESCE(NEW.outcome_source, 'service');
    END IF;
  END IF;

  -- (b) reabrir bloqueado
  IF OLD.status = ANY(terminais) AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (is_service OR is_manager
            OR (is_correcao AND NEW.status IN ('no_show','not_contracted','cancelled'))) THEN
      RAISE EXCEPTION 'Desfecho já registrado — reabertura é ação de gerente';
    END IF;
    IF NEW.status = 'confirmed' THEN
      NEW.outcome_by := NULL;
      NEW.outcome_at := NULL;
      NEW.outcome_source := NULL;
    END IF;
  END IF;

  -- (c) imutabilidade
  IF NOT is_service THEN
    IF NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by THEN
      RAISE EXCEPTION 'confirmed_by é imutável';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'created_at é imutável';
    END IF;
    IF OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
      RAISE EXCEPTION 'confirmed_at é imutável';
    END IF;
    IF OLD.rescheduled_from_id IS NOT NULL AND NEW.rescheduled_from_id IS DISTINCT FROM OLD.rescheduled_from_id THEN
      RAISE EXCEPTION 'rescheduled_from_id é imutável';
    END IF;
  END IF;

  NEW.is_rescheduled := (NEW.rescheduled_from_id IS NOT NULL);

  IF OLD.status = ANY(terminais)
     AND (NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
          OR NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time)
     AND NOT (is_service OR is_manager) THEN
    RAISE EXCEPTION 'Data/hora não podem ser alteradas após o desfecho';
  END IF;

  RETURN NEW;
END;
$fn$;
COMMENT ON FUNCTION public.stamp_appointment_update() IS
  'Gatilho BEFORE UPDATE de crm_appointments: carimba o desfecho, trava reabertura fora de gerente/serviço e protege campos imutáveis. Preserva outcome_source = ''sdr''. Desde 10/09/2026 aceita a correção pedida pelas RPCs sdr_corrigir_desfecho / sdr_excluir_agendamento (GUC transacional sdr.correcao_desfecho), e só para os destinos no_show, not_contracted e cancelled — ''contracted'' continua sendo dado do pagamento.';
-- Função de gatilho: ninguém chama direto por RPC.
REVOKE ALL ON FUNCTION public.stamp_appointment_update() FROM PUBLIC, anon, authenticated;

-- 3.2 A RPC da correção.
-- p_compareceu = true  → 'not_contracted' (= compareceu, contrato em aberto),
--                        lead para "Compareceu" e entrega ao administrador
--                        (re)agendada pela carência;
-- p_compareceu = false → 'no_show', lead para "Não compareceu" e a entrega
--                        pendente é REMOVIDA: o lead volta a ser da SDR, que
--                        reagenda.
-- Quem pode: a SDR dona do lead (assigned_to = auth.uid()) e a gestão (crc,
-- gerente, superadmin) em qualquer lead do próprio cliente.
-- O relatório da SDR não precisa saber de nada: ele conta comparecimento por
-- crm_appointments.status com responsavel_credito_id (que é imutável), então
-- trocar o status já corrige o número dela — inclusive para trás.
CREATE OR REPLACE FUNCTION public.sdr_corrigir_desfecho(p_appointment_id uuid, p_compareceu boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE a public.crm_appointments; l public.crm_leads; v_tenant uuid;
        v_gestao boolean; v_antes text; v_novo text; n integer;
        v_alvo uuid; v_alvo_nome text; v_movido boolean := false;
        v_quem text; v_entrega text; v_dona uuid; v_removidas integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login para corrigir o desfecho de uma consulta.' USING ERRCODE = '42501';
  END IF;
  IF p_compareceu IS NULL THEN
    RAISE EXCEPTION 'Diga se o paciente compareceu ou não.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO a FROM public.crm_appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consulta não encontrada.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id = a.lead_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'O lead desta consulta não existe mais.' USING ERRCODE = '42501'; END IF;

  -- Isolamento por cliente: nem a gestão sai do próprio tenant.
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL OR l.tenant_id IS DISTINCT FROM v_tenant
     OR (a.tenant_id IS NOT NULL AND a.tenant_id IS DISTINCT FROM v_tenant) THEN
    RAISE EXCEPTION 'Esta consulta é de outra clínica.' USING ERRCODE = '42501';
  END IF;

  v_gestao := public.has_role(auth.uid(), 'crc'::app_role)
           OR public.has_role(auth.uid(), 'gerente'::app_role)
           OR public.has_role(auth.uid(), 'superadmin'::app_role);
  IF NOT v_gestao THEN
    IF NOT public.has_role(auth.uid(), 'sdr'::app_role) THEN
      RAISE EXCEPTION 'Seu perfil não corrige desfecho de consulta. Peça ao administrador da clínica.' USING ERRCODE = '42501';
    END IF;
    IF l.assigned_to IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Este lead não é seu — quem corrige é quem está com ele, ou o administrador.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Desfecho que veio do pagamento não se discute na tela do atendimento.
  IF a.status = 'contracted' AND COALESCE(a.outcome_source, '') <> 'sdr' THEN
    RAISE EXCEPTION 'Esta consulta está marcada como CONTRATADA pelo sistema de pagamentos — quem decide isso é o pagamento, não a marcação de presença. Fale com o administrador da clínica.' USING ERRCODE = '42501';
  END IF;
  IF a.status = 'rescheduled' THEN
    RAISE EXCEPTION 'Esta consulta foi remarcada — corrija a consulta NOVA, que é a que vale.' USING ERRCODE = '42501';
  END IF;
  IF a.status = 'cancelled' THEN
    RAISE EXCEPTION 'Esta consulta foi excluída. Crie um agendamento novo em vez de corrigir este.' USING ERRCODE = '42501';
  END IF;

  v_antes := a.status;
  v_novo  := CASE WHEN p_compareceu THEN 'not_contracted' ELSE 'no_show' END;
  IF v_antes = v_novo THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_mudanca', 'status', v_antes,
                              'mensagem', CASE WHEN p_compareceu THEN 'A consulta já está marcada como Compareceu.'
                                               ELSE 'A consulta já está marcada como Não compareceu.' END);
  END IF;
  v_quem := public.rodizio_nome(auth.uid());

  -- "Não compareceu" desfaz a passagem ao administrador ANTES de mexer no
  -- desfecho: o lead é da SDR de novo, para ela reagendar.
  IF NOT p_compareceu THEN
    DELETE FROM public.crm_entregas_gestor WHERE lead_id = l.id;
    GET DIAGNOSTICS v_removidas = ROW_COUNT;
  END IF;

  -- A trava de reabertura de stamp_appointment_update é aberta por UMA
  -- instrução e fechada em seguida (GUC transacional, item 3.1).
  PERFORM set_config('sdr.correcao_desfecho', 'sim', true);
  UPDATE public.crm_appointments
     SET status = v_novo,
         outcome_source = 'sdr',
         outcome_at = now(),
         outcome_by = auth.uid(),
         updated_at = now()
   WHERE id = a.id AND status = v_antes;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('sdr.correcao_desfecho', '', true);
  IF n = 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'corrida',
                              'mensagem', 'O desfecho desta consulta mudou enquanto você corrigia — recarregue a tela.');
  END IF;

  -- Estado real depois do gatilho da consulta (que, com carência 0, pode ter
  -- entregado o lead ao administrador dentro do UPDATE acima).
  SELECT * INTO l FROM public.crm_leads WHERE id = a.lead_id;
  v_dona := l.assigned_to;

  IF p_compareceu THEN
    -- Rede de segurança: se o gatilho não agendou nada (por exemplo porque a
    -- consulta já estava 'not_contracted' antes e só a etapa estava errada), a
    -- entrega é agendada aqui. Idempotente: devolve 'ja_agendada' se já existe.
    IF v_dona IS NOT NULL AND public.has_role(v_dona, 'sdr'::app_role)
       AND NOT EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = l.id) THEN
      BEGIN
        -- PERFORM, não atribuição: o estado da entrega é lido do banco no fim
        -- da função (uma leitura, uma verdade só).
        PERFORM public.sdr_agenda_entrega_ao_gestor(l.id,
          'desfecho corrigido para comparecimento em ' || to_char(a.scheduled_date, 'DD/MM'),
          '✅ Compareceu (corrigido)', a.id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'sdr_corrigir_desfecho: entrega não agendada (lead %): %', l.id, SQLERRM;
      END;
      SELECT * INTO l FROM public.crm_leads WHERE id = a.lead_id;
      v_dona := l.assigned_to;
    END IF;
  END IF;

  -- Etapa: "Compareceu" quando compareceu (só enquanto o lead ainda é da SDR —
  -- entregue, quem manda na etapa é a entrega), "Não compareceu" quando não.
  IF p_compareceu THEN
    IF v_dona IS NOT NULL AND public.has_role(v_dona, 'sdr'::app_role) THEN
      SELECT s.id, s.name INTO v_alvo, v_alvo_nome FROM public.crm_stages s
       WHERE s.pipeline_id = l.pipeline_id
         AND public.normaliza_nome_etapa(s.name) = 'compareceu'
       ORDER BY s.position LIMIT 1;
    END IF;
  ELSE
    SELECT s.id, s.name INTO v_alvo, v_alvo_nome FROM public.crm_stages s
     WHERE s.pipeline_id = l.pipeline_id
       AND public.normaliza_nome_etapa(s.name) = 'nao compareceu'
     ORDER BY s.position LIMIT 1;
  END IF;
  IF v_alvo IS NOT NULL AND v_alvo IS DISTINCT FROM l.stage_id THEN
    UPDATE public.crm_leads SET stage_id = v_alvo, updated_at = now() WHERE id = l.id;
    v_movido := true;
  END IF;

  -- O livro (quem mexeu, no quê e por quê) e o chat do lead. Fase 'saneamento':
  -- não é distribuição de lead, é conserto — e o relatório de rodízio, que
  -- conta só aplicacao/corte_9h/realocacao_1h/manual, não é poluído por isso.
  PERFORM public.rodizio_livro(l, l.assigned_to, l.assigned_to, 'saneamento',
    'desfecho corrigido de ' || v_antes || ' para ' || v_novo || ' por ' || COALESCE(v_quem, 'usuário'), NULL);
  PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
    CASE WHEN p_compareceu
         THEN '✏️ Correção: o paciente COMPARECEU em ' || to_char(a.scheduled_date, 'DD/MM')
         ELSE '✏️ Correção: o paciente NÃO compareceu em ' || to_char(a.scheduled_date, 'DD/MM') END
    || ' — corrigido por ' || COALESCE(v_quem, 'usuário')
    || CASE WHEN v_movido THEN ' · etapa ' || v_alvo_nome ELSE '' END
    || CASE WHEN NOT p_compareceu AND v_removidas > 0
            THEN ' · a passagem para o administrador foi cancelada; o lead continua com '
                 || COALESCE(public.rodizio_nome(l.assigned_to), 'a SDR')
            ELSE '' END);

  v_entrega := CASE
                 WHEN NOT p_compareceu THEN 'removida'
                 WHEN v_dona IS NULL OR NOT public.has_role(v_dona, 'sdr'::app_role) THEN 'entregue'
                 WHEN EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = l.id) THEN 'agendada'
                 ELSE 'nenhuma'
               END;

  -- 'stage_id' NULL pelo mesmo motivo do item 2: a automação de entrada da
  -- etapa é executada pela fila do banco, e devolver stage_id faria o front
  -- executá-la de novo (mensagem repetida para o paciente).
  RETURN jsonb_build_object('ok', true, 'lead_id', l.id, 'appointment_id', a.id,
                            'status_antes', v_antes, 'status', v_novo,
                            'compareceu', p_compareceu,
                            'stage_id', NULL::uuid, 'etapa_id', CASE WHEN v_movido THEN v_alvo ELSE NULL END,
                            'stage_nome', v_alvo_nome, 'etapa_mudou', v_movido,
                            'entrega', v_entrega, 'phone', l.phone);
END $fn$;
COMMENT ON FUNCTION public.sdr_corrigir_desfecho(uuid, boolean) IS
  'Corrige a marcação de presença de uma consulta (compareceu ↔ não compareceu) para a SDR dona do lead e para a gestão (crc/gerente/superadmin) do próprio cliente. Recusa consulta contratada pelo pagamento (Dontus). Registra no livro e no chat; o relatório da SDR acompanha sozinho porque conta pelo status da consulta.';
REVOKE ALL ON FUNCTION public.sdr_corrigir_desfecho(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sdr_corrigir_desfecho(uuid, boolean) TO authenticated, service_role;

-- ============================================================ 4. (D5) excluir o agendamento
-- "Excluir" aqui NÃO apaga a linha: grava status 'cancelled'. Três motivos:
--   • todo relatório do sistema já ignora 'cancelled' (relatorio_sdr / relatorio_sdr_minha
--     contam agendamentos com status <> 'cancelled'), então o número da SDR corrige
--     sozinho e a trilha continua no banco;
--   • DELETE de consulta com desfecho é proibido por trg_protege_desfecho_no_delete
--     (é apagar histórico de indicador);
--   • quem exclui deixa motivo, e o motivo fica gravado em cancelled_reason.
CREATE OR REPLACE FUNCTION public.sdr_excluir_agendamento(p_appointment_id uuid, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE a public.crm_appointments; l public.crm_leads; v_tenant uuid;
        v_gestao boolean; v_antes text; n integer; v_motivo text;
        v_etapa_atual text; v_alvo uuid; v_alvo_nome text; v_movido boolean := false;
        v_quem text; v_removidas integer := 0; v_tem_viva boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login para excluir um agendamento.' USING ERRCODE = '42501';
  END IF;
  v_motivo := btrim(COALESCE(p_motivo, ''));
  IF length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'Escreva o motivo da exclusão (pelo menos 3 letras) — ele fica no histórico do paciente.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO a FROM public.crm_appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consulta não encontrada.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id = a.lead_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'O lead desta consulta não existe mais.' USING ERRCODE = '42501'; END IF;

  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL OR l.tenant_id IS DISTINCT FROM v_tenant
     OR (a.tenant_id IS NOT NULL AND a.tenant_id IS DISTINCT FROM v_tenant) THEN
    RAISE EXCEPTION 'Esta consulta é de outra clínica.' USING ERRCODE = '42501';
  END IF;

  v_gestao := public.has_role(auth.uid(), 'crc'::app_role)
           OR public.has_role(auth.uid(), 'gerente'::app_role)
           OR public.has_role(auth.uid(), 'superadmin'::app_role);
  IF NOT v_gestao THEN
    IF NOT public.has_role(auth.uid(), 'sdr'::app_role) THEN
      RAISE EXCEPTION 'Seu perfil não exclui agendamento. Peça ao administrador da clínica.' USING ERRCODE = '42501';
    END IF;
    IF l.assigned_to IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Este lead não é seu — quem exclui é quem está com ele, ou o administrador.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Mesma recusa da correção: contrato é dado do pagamento.
  IF a.status = 'contracted' AND COALESCE(a.outcome_source, '') <> 'sdr' THEN
    RAISE EXCEPTION 'Esta consulta está marcada como CONTRATADA pelo sistema de pagamentos e não pode ser excluída aqui. Fale com o administrador da clínica.' USING ERRCODE = '42501';
  END IF;
  IF a.status = 'rescheduled' THEN
    RAISE EXCEPTION 'Esta consulta foi remarcada — ela é o histórico da remarcação. Exclua a consulta NOVA, que é a que vale.' USING ERRCODE = '42501';
  END IF;
  IF a.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'ja_excluido', 'status', a.status,
                              'mensagem', 'Este agendamento já estava excluído.');
  END IF;

  v_antes := a.status;
  v_quem := public.rodizio_nome(auth.uid());

  -- Some o agendamento, some a passagem ao administrador que ele motivou.
  DELETE FROM public.crm_entregas_gestor WHERE lead_id = l.id;
  GET DIAGNOSTICS v_removidas = ROW_COUNT;

  PERFORM set_config('sdr.correcao_desfecho', 'sim', true);
  UPDATE public.crm_appointments
     SET status = 'cancelled',
         cancelled_reason = v_motivo,
         outcome_source = 'sdr',
         outcome_at = now(),
         outcome_by = auth.uid(),
         updated_at = now()
   WHERE id = a.id AND status = v_antes;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('sdr.correcao_desfecho', '', true);
  IF n = 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'corrida',
                              'mensagem', 'O estado desta consulta mudou enquanto você excluía — recarregue a tela.');
  END IF;

  -- Etapa: o lead não pode ficar parado numa etapa que promete uma consulta que
  -- não existe mais. Volta para "Conversando" — e SÓ se ele não tiver outra
  -- consulta viva (senão a etapa de agendamento está certa por causa dela).
  SELECT * INTO l FROM public.crm_leads WHERE id = a.lead_id;
  SELECT s.name INTO v_etapa_atual FROM public.crm_stages s WHERE s.id = l.stage_id;
  v_tem_viva := EXISTS (SELECT 1 FROM public.crm_appointments a2
                         WHERE a2.lead_id = l.id AND a2.id <> a.id
                           AND a2.status IN ('confirmed', 'pending'));
  IF NOT v_tem_viva
     AND public.normaliza_nome_etapa(v_etapa_atual) IN
         ('agendado', 'reagendado', 'reagendar', 'compareceu', 'compareceu e agendou', 'nao compareceu') THEN
    SELECT s.id, s.name INTO v_alvo, v_alvo_nome FROM public.crm_stages s
     WHERE s.pipeline_id = l.pipeline_id
       AND public.normaliza_nome_etapa(s.name) = 'conversando'
     ORDER BY s.position LIMIT 1;
    IF v_alvo IS NOT NULL AND v_alvo IS DISTINCT FROM l.stage_id THEN
      UPDATE public.crm_leads SET stage_id = v_alvo, updated_at = now() WHERE id = l.id;
      v_movido := true;
    END IF;
  END IF;

  PERFORM public.rodizio_livro(l, l.assigned_to, l.assigned_to, 'saneamento',
    'agendamento de ' || to_char(a.scheduled_date, 'DD/MM') || ' (' || v_antes || ') excluído por '
    || COALESCE(v_quem, 'usuário') || ': ' || v_motivo, NULL);
  PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
    '🗑️ Agendamento de ' || to_char(a.scheduled_date, 'DD/MM') || ' excluído por ' || COALESCE(v_quem, 'usuário')
    || ' — ' || v_motivo
    || CASE WHEN v_movido THEN ' · etapa ' || v_alvo_nome ELSE '' END
    || CASE WHEN v_removidas > 0 THEN ' · a passagem para o administrador foi cancelada' ELSE '' END);

  -- 'stage_id' NULL pelo mesmo motivo dos itens 2 e 3.
  RETURN jsonb_build_object('ok', true, 'lead_id', l.id, 'appointment_id', a.id,
                            'status_antes', v_antes, 'status', 'cancelled', 'motivo_texto', v_motivo,
                            'stage_id', NULL::uuid, 'etapa_id', CASE WHEN v_movido THEN v_alvo ELSE NULL END,
                            'stage_nome', v_alvo_nome, 'etapa_mudou', v_movido,
                            'entrega_removida', (v_removidas > 0), 'phone', l.phone);
END $fn$;
COMMENT ON FUNCTION public.sdr_excluir_agendamento(uuid, text) IS
  'Exclui um agendamento marcando status ''cancelled'' com motivo (a linha fica, os relatórios já ignoram cancelled). Cancela a passagem pendente ao administrador e devolve o lead para "Conversando" quando ele não tem outra consulta viva. Aberta para a SDR dona do lead e para a gestão do próprio cliente; recusa consulta contratada pelo pagamento (Dontus).';
REVOKE ALL ON FUNCTION public.sdr_excluir_agendamento(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sdr_excluir_agendamento(uuid, text) TO authenticated, service_role;

-- ============================================================ 5. (D7) a SDR cria funil, etapa e automação
-- Pedido do dono: "O sdr também deve poder criar etapas, gatilhos, disparos e
-- funis". Hoje as policies "Staff can insert/update/delete" de crm_stages,
-- crm_pipelines e crm_automations listam só superadmin, gerente, crc e posvenda.
-- Nada aqui é editado: as policies novas são PERMISSIVE com nome próprio
-- (sdr_ins_/sdr_upd_/sdr_del_), somam-se às existentes, e as RESTRICTIVE que
-- fazem o isolamento (tenant_isolation em crm_pipelines/crm_stages,
-- hide_posvenda_*, sdr_escopo_crm_stages_visiveis) continuam valendo por cima.

-- 5.1 O alcance: funil do próprio cliente que ela já pode abrir.
-- can_access_pipeline resolve o override por usuário (é assim que a SDR enxerga
-- os funis gerais); o pós-venda fica de fora por decisão de produto.
CREATE OR REPLACE FUNCTION public.sdr_pode_editar_funil(_pipeline_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT _pipeline_id IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND (SELECT public.has_role(auth.uid(), 'sdr'::app_role))
     AND EXISTS (
       SELECT 1 FROM public.crm_pipelines p
        WHERE p.id = _pipeline_id
          AND p.tenant_id = public.current_tenant_id()
          AND COALESCE(p.is_posvenda, false) = false
     )
     AND public.can_access_pipeline(_pipeline_id);
$fn$;
COMMENT ON FUNCTION public.sdr_pode_editar_funil(uuid) IS
  'true quando quem chama tem papel sdr e o funil é do cliente atual, não é de pós-venda e ela já pode abri-lo (can_access_pipeline). Usada só pelas policies sdr_ins_/sdr_upd_/sdr_del_.';
REVOKE ALL ON FUNCTION public.sdr_pode_editar_funil(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sdr_pode_editar_funil(uuid) TO authenticated, service_role;

-- "Este funil tem lead?" — precisa ser SECURITY DEFINER: dentro de uma policy,
-- um SELECT em crm_leads roda com a RLS de quem chama, e a SDR só enxerga os
-- leads DELA. Sem isso, "funil vazio" seria "funil sem lead meu" e ela poderia
-- apagar um funil cheio de leads das colegas.
CREATE OR REPLACE FUNCTION public.funil_tem_lead(_pipeline_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.pipeline_id = _pipeline_id);
$fn$;
COMMENT ON FUNCTION public.funil_tem_lead(uuid) IS
  'true quando o funil tem pelo menos um lead, ignorando a RLS de quem pergunta. Usada pela policy sdr_del_crm_pipelines.';
REVOKE ALL ON FUNCTION public.funil_tem_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.funil_tem_lead(uuid) TO authenticated, service_role;

-- crm_automations pendura na ETAPA; o funil vem por crm_stages (mesmo desenho
-- de funil_do_papel_do_usuario_por_etapa, de 25/08).
CREATE OR REPLACE FUNCTION public.sdr_pode_editar_funil_por_etapa(_stage_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_stages s
     WHERE s.id = _stage_id AND public.sdr_pode_editar_funil(s.pipeline_id)
  );
$fn$;
REVOKE ALL ON FUNCTION public.sdr_pode_editar_funil_por_etapa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sdr_pode_editar_funil_por_etapa(uuid) TO authenticated, service_role;

-- 5.2 Funil criado pela SDR precisa nascer visível PARA ELA.
-- Os dois gatilhos que já existem quase resolvem:
--   • sdr_concede_funil_novo (AFTER INSERT em crm_pipelines, 20260908150000) dá
--     o override 'pipeline' a todas as SDRs do cliente — MAS só quando
--     allowed_roles IS NULL e o funil não é de pós-venda/Instagram;
--   • stage_regras_padrao_trg (item 1.1) já deixa etapa nova visível por padrão
--     (a coluna visivel_para_sdr é NOT NULL DEFAULT true) — nada a duplicar.
-- Falta a garantia de que o funil dela caia nesse caminho: can_access_pipeline,
-- com allowed_roles preenchido, só olha os papéis da lista, e 'sdr' não entra
-- em lista nenhuma hoje. Este gatilho novo (nome próprio, não mexe em nenhum
-- outro) força o formato certo quando quem cria tem papel sdr. O prefixo "zz"
-- garante que ele rode DEPOIS dos outros BEFORE INSERT do mesmo gatilho
-- (set_crm_pipelines_tenant_id, trg_pipeline_inclui_papel_do_criador).
CREATE OR REPLACE FUNCTION public.sdr_funil_novo_padrao_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'sdr'::app_role) THEN RETURN NEW; END IF;
  NEW.allowed_roles := NULL;     -- funil geral: é o formato que sdr_concede_funil_novo enxerga
  NEW.is_posvenda   := false;
  NEW.is_instagram  := false;
  RETURN NEW;
END $fn$;
COMMENT ON FUNCTION public.sdr_funil_novo_padrao_trg() IS
  'Gatilho BEFORE INSERT de crm_pipelines: funil criado por quem tem papel sdr nasce geral (allowed_roles NULL, sem pós-venda/Instagram), que é a única forma de o gatilho sdr_concede_funil_novo dar a ela o acesso ao próprio funil.';
REVOKE ALL ON FUNCTION public.sdr_funil_novo_padrao_trg() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_zz_sdr_funil_novo_padrao ON public.crm_pipelines;
CREATE TRIGGER trg_zz_sdr_funil_novo_padrao
  BEFORE INSERT ON public.crm_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.sdr_funil_novo_padrao_trg();

-- 5.3 As policies novas (PERMISSIVE). Postgres não tem CREATE POLICY IF NOT
-- EXISTS: cada uma é criada só se ainda não existir, para a migration poder
-- rodar duas vezes sem derrubar nada que já esteja no ar.
DO $do$
BEGIN
  -- ---------------- crm_stages: etapa dentro de funil que ela já usa
  -- Sem filtro por visivel_para_sdr de propósito: "Duplicar funil" copia TODAS
  -- as etapas, inclusive as de desfecho (que ela não enxerga), e sem elas o
  -- funil novo nasceria sem para onde mandar Contratado/Não contratado. Ler
  -- continua barrado pela RESTRICTIVE sdr_escopo_crm_stages_visiveis.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'crm_stages' AND policyname = 'sdr_ins_crm_stages') THEN
    EXECUTE $sql$
      CREATE POLICY sdr_ins_crm_stages ON public.crm_stages
        FOR INSERT TO authenticated
        WITH CHECK (public.sdr_pode_editar_funil(pipeline_id))
    $sql$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'crm_stages' AND policyname = 'sdr_upd_crm_stages') THEN
    EXECUTE $sql$
      CREATE POLICY sdr_upd_crm_stages ON public.crm_stages
        FOR UPDATE TO authenticated
        USING (public.sdr_pode_editar_funil(pipeline_id))
        WITH CHECK (public.sdr_pode_editar_funil(pipeline_id))
    $sql$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'crm_stages' AND policyname = 'sdr_del_crm_stages') THEN
    EXECUTE $sql$
      CREATE POLICY sdr_del_crm_stages ON public.crm_stages
        FOR DELETE TO authenticated
        USING (public.sdr_pode_editar_funil(pipeline_id))
    $sql$;
  END IF;

  -- ---------------- crm_pipelines
  -- INSERT: o formato é o mesmo que o gatilho 5.2 força — a policy é a segunda
  -- fechadura, para funil de SDR nunca nascer num formato que ela não enxerga.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'crm_pipelines' AND policyname = 'sdr_ins_crm_pipelines') THEN
    EXECUTE $sql$
      CREATE POLICY sdr_ins_crm_pipelines ON public.crm_pipelines
        FOR INSERT TO authenticated
        WITH CHECK (
          (SELECT public.has_role(auth.uid(), 'sdr'::app_role))
          AND tenant_id = public.current_tenant_id()
          AND allowed_roles IS NULL
          AND COALESCE(is_posvenda, false) = false
          AND COALESCE(is_instagram, false) = false
        )
    $sql$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'crm_pipelines' AND policyname = 'sdr_upd_crm_pipelines') THEN
    EXECUTE $sql$
      CREATE POLICY sdr_upd_crm_pipelines ON public.crm_pipelines
        FOR UPDATE TO authenticated
        USING (public.sdr_pode_editar_funil(id))
        WITH CHECK (
          public.sdr_pode_editar_funil(id)
          AND allowed_roles IS NULL
          AND COALESCE(is_posvenda, false) = false
        )
    $sql$;
  END IF;
  -- DELETE: só funil VAZIO. Apagar funil arrasta as etapas e deixa lead sem
  -- lugar — o dono pediu que ela possa criar, não que possa apagar o Funil
  -- Principal da clínica com 30 mil leads dentro. Funil com lead segue sendo
  -- assunto do administrador (as policies "Staff can delete" continuam de pé).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'crm_pipelines' AND policyname = 'sdr_del_crm_pipelines') THEN
    EXECUTE $sql$
      CREATE POLICY sdr_del_crm_pipelines ON public.crm_pipelines
        FOR DELETE TO authenticated
        USING (
          public.sdr_pode_editar_funil(id)
          AND NOT public.funil_tem_lead(id)
        )
    $sql$;
  END IF;

  -- ---------------- crm_automations (os "gatilhos e disparos" do pedido)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'crm_automations' AND policyname = 'sdr_ins_crm_automations') THEN
    EXECUTE $sql$
      CREATE POLICY sdr_ins_crm_automations ON public.crm_automations
        FOR INSERT TO authenticated
        WITH CHECK (
          public.sdr_pode_editar_funil_por_etapa(stage_id)
          AND tenant_id = public.current_tenant_id()
        )
    $sql$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'crm_automations' AND policyname = 'sdr_upd_crm_automations') THEN
    EXECUTE $sql$
      CREATE POLICY sdr_upd_crm_automations ON public.crm_automations
        FOR UPDATE TO authenticated
        USING (
          public.sdr_pode_editar_funil_por_etapa(stage_id)
          AND tenant_id = public.current_tenant_id()
        )
        WITH CHECK (
          public.sdr_pode_editar_funil_por_etapa(stage_id)
          AND tenant_id = public.current_tenant_id()
        )
    $sql$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'crm_automations' AND policyname = 'sdr_del_crm_automations') THEN
    EXECUTE $sql$
      CREATE POLICY sdr_del_crm_automations ON public.crm_automations
        FOR DELETE TO authenticated
        USING (
          public.sdr_pode_editar_funil_por_etapa(stage_id)
          AND tenant_id = public.current_tenant_id()
        )
    $sql$;
  END IF;
END $do$;

-- O PostgREST precisa enxergar as duas RPCs novas.
NOTIFY pgrst, 'reload schema';

-- ============================================================ VERIFICAÇÃO (só leitura, rodar depois do deploy)
-- 1. A etapa "Compareceu" ficou visível em TODOS os funis do cliente, e só ela:
-- SELECT pl.name AS funil, s.name AS etapa, s.visivel_para_sdr
--   FROM public.crm_stages s JOIN public.crm_pipelines pl ON pl.id = s.pipeline_id
--  WHERE pl.tenant_id = '00000000-0000-0000-0000-000000000010'
--    AND public.normaliza_nome_etapa(s.name) IN ('compareceu','compareceu e agendou','contratado','nao contratado')
--  ORDER BY 1, s.position;
--   -- "Compareceu" = true; as outras três = false.
--
-- 2. Funil sem a etapa "Compareceu" (ali a marcação não move ninguém):
-- SELECT pl.id, pl.name FROM public.crm_pipelines pl
--  WHERE pl.tenant_id = '00000000-0000-0000-0000-000000000010'
--    AND COALESCE(pl.is_posvenda,false) = false
--    AND NOT EXISTS (SELECT 1 FROM public.crm_stages s
--                     WHERE s.pipeline_id = pl.id AND public.normaliza_nome_etapa(s.name) = 'compareceu');
--
-- 3. As funções novas existem, são SECURITY DEFINER e com search_path fixo:
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef,
--        coalesce(array_to_string(p.proconfig, ' | '), '(sem search_path!)') AS config
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND p.proname IN ('sdr_corrigir_desfecho','sdr_excluir_agendamento','sdr_marcar_comparecimento',
--                      'sdr_pode_editar_funil','sdr_pode_editar_funil_por_etapa','sdr_funil_novo_padrao_trg',
--                      'funil_tem_lead','stamp_appointment_update','stage_regras_padrao_trg','sdr_etapa_oculta_entrega')
--  ORDER BY 1;
--
-- 4. Quem pode executar (anon NUNCA pode; gatilho não é RPC):
-- SELECT p.proname, coalesce(array_to_string(p.proacl, ' | '), '(sem ACL = só o dono)') AS acl
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND p.proname IN ('sdr_corrigir_desfecho','sdr_excluir_agendamento','sdr_pode_editar_funil',
--                      'sdr_pode_editar_funil_por_etapa','sdr_funil_novo_padrao_trg','stamp_appointment_update');
--
-- 5. As nove policies novas entraram como PERMISSIVE e nenhuma antiga sumiu:
-- SELECT tablename, policyname, permissive, cmd
--   FROM pg_policies
--  WHERE schemaname = 'public' AND tablename IN ('crm_stages','crm_pipelines','crm_automations')
--  ORDER BY tablename, policyname;
--
-- 6. Os gatilhos continuam ligados (tgenabled = 'O'):
-- SELECT c.relname AS tabela, t.tgname, t.tgenabled, p.proname AS funcao
--   FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
--  WHERE NOT t.tgisinternal
--    AND t.tgname IN ('trg_stamp_appointment_update','trg_zz_stage_regras_padrao','trg_zz_etapa_oculta_entrega',
--                     'trg_zz_comparecimento_entrega','trg_zz_sdr_funil_novo_padrao','trg_sdr_concede_funil_novo')
--  ORDER BY 1, 2;
--
-- 7. Ensaio da correção (com um agendamento de teste, logada como a SDR dona):
-- SELECT public.sdr_marcar_comparecimento('<appointment>');            -- etapa vai para Compareceu
-- SELECT public.sdr_corrigir_desfecho('<appointment>', false);         -- vira falta, entrega cai
-- SELECT public.sdr_corrigir_desfecho('<appointment>', true);          -- volta a comparecimento, entrega volta
-- SELECT public.sdr_excluir_agendamento('<appointment>', 'agendei no lead errado');
-- SELECT id, status, outcome_source, outcome_by, cancelled_reason FROM public.crm_appointments WHERE id = '<appointment>';
-- SELECT lead_id, entregar_em FROM public.crm_entregas_gestor WHERE lead_id = '<lead>';
-- SELECT fase, motivo, criado_em FROM public.crm_lead_atribuicoes WHERE lead_id = '<lead>' ORDER BY criado_em DESC LIMIT 5;
-- SELECT content, created_at FROM public.messages WHERE lead_id = '<lead>' AND type = 'system' ORDER BY created_at DESC LIMIT 5;
--
-- 8. O relatório da SDR acompanha a correção (D6 — nada foi alterado nele):
-- SELECT * FROM public.relatorio_sdr(current_date - 7, current_date);        -- visão do gestor
-- SELECT * FROM public.relatorio_sdr_minha(current_date - 7, current_date);  -- visão da própria SDR
