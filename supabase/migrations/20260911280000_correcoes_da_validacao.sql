-- =============================================================================
-- Correções achadas pela validação da entrega de 10-11/09, conferidas uma a uma
-- contra o banco de produção e passadas por um revisor cético.
--
-- O dono disse, e é a régua desta migration: "Eu preciso que esses relatórios
-- sejam confiáveis, pelo amor de Deus não erre com os dados". Quatro dos cinco
-- consertos abaixo são número errado em relatório.
--
-- ------------------------------------------------------------------ (1) CRÉDITO
-- DOIS buracos na mesma função, os dois medidos em produção:
--
--  (a) INSTAGRAM — o lead da caixa comum não tem dona POR DESENHO (é o pedido
--      do dono: "não precisa fazer distribuição neles apenas deixar aparecer pra
--      todo mundo"). carimba_credito_agendamento tira o crédito de
--      crm_leads.assigned_to, então o agendamento nasce com
--      responsavel_credito_id NULL, e relatorio_sdr_calc faz JOIN por essa
--      coluna — o trabalho de Instagram some do relatório da SDR e do total da
--      equipe. Provado por ensaio desfeito: a Bia criou dois agendamentos, um em
--      lead do Instagram e um em lead dela; o relatório foi de 7 para 8, não
--      para 9. Pior: o cabeçalho da migration 20260911010000 AFIRMA por escrito
--      que "a SDR que marcar a consulta de um lead do Instagram leva o
--      comparecimento dela no relatório". Documentava o oposto do que o código
--      fazia.
--
--  (b) REMARCAÇÃO — a linha nova herda o crédito da consulta anterior
--      ('herdado_remarcacao'). A herança foi desenhada quando a coluna contava
--      por scheduled_date ("as consultas dela"); em 11/09 a régua virou
--      created_at ("o trabalho que ela fez hoje"), e as duas deixaram de casar.
--      Medido hoje: a Bia remarcou o lead LUCIANO SILVA PESSOA às 11:48; como a
--      consulta de origem era do CRC, o crédito foi para o CRC, que não é SDR —
--      o relatório mostrou Bia 7 quando ela criou 8, e "Reagendamentos" mostrou
--      0 num dia em que houve 1. Exposição: 36 agendamentos ativos de leads de
--      SDR cujo crédito é de não-SDR.
--
-- A precedência nova é: herdar SÓ de SDR > dona do lead > quem marcou (caixa
-- comum) > sem dona. Quem marca leva o crédito quando não há dona — que é o que
-- a migration do Instagram já prometia.
--
-- ------------------------------------------------ (2) DUPLA CONTAGEM NA REMARCAÇÃO
-- 'rescheduled' não é 'cancelled', então a linha substituída continuava somando
-- ao lado da substituta. Medido em setembro: 6 pares na mesma janela, 5,5% de
-- inflação — hoje invisível só porque os pares são do CRC. Com o botão
-- Reagendar virando o caminho padrão, isso passaria a inflar o número da SDR.
--
-- ------------------------------------ (3) A SDR NÃO FECHAVA O CICLO DO INSTAGRAM
-- As três RPCs de desfecho exigem assigned_to = auth.uid(), condição IMPOSSÍVEL
-- de satisfazer no Instagram (protege_caixa_do_instagram impede a SDR de virar
-- dona). Ela marcava a consulta e o botão "Compareceu" respondia "Este lead não
-- é seu". E o efeito era pior do que travar: o agendamento nasce 'confirmed', e
-- 3 h depois do horário o cron do Dontus o carimba 'no_show_por_tempo' — o
-- comparecimento real do Instagram virava FALTA automática no relatório.
-- Junto: a etapa "Compareceu" não existia no funil Instagram nem no Nutrição, e
-- o dono pediu essa etapa "para todos os funis".
--
-- ------------------------------- (4) A SDR REVERTIA O CARIMBO DO DONTUS NO PRÓPRIO NÚMERO
-- sdr_corrigir_desfecho só protegia 'contracted'. Qualquer outro desfecho vindo
-- do dontus-sync podia ser trocado pela própria pessoa medida pelo número.
-- A correção separa as duas coisas: o que o Dontus CONFIRMOU fica com a gestão;
-- a INFERÊNCIA POR TEMPO ('no_show_por_tempo', 53 das 89 faltas de hoje)
-- continua corrigível pela SDR — corrigir inferência errada é exatamente o que
-- o dono pediu quando disse que ela precisa poder corrigir o desfecho.
--
-- ------------------------------------------- (5) O SIGILO DO CONTRATO ESTAVA SÓ NO FRONT
-- get_lead_stage_history_names devolvia o nome cru das etapas ocultas para
-- qualquer autenticado. A tela deixou de montar o painel para a SDR, mas a RPC
-- continuava aberta — e o dono foi explícito: a SDR nunca lê "Contratado".
-- Agora quem esconde é o banco.
-- =============================================================================


-- ============================================================ (1) o crédito certo
CREATE OR REPLACE FUNCTION public.carimba_credito_agendamento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_dono uuid;
  v_origem text;
  v_confiavel boolean := (auth.uid() IS NULL)
    OR public.has_role(auth.uid(), 'gerente'::app_role)
    OR public.has_role(auth.uid(), 'superadmin'::app_role);
BEGIN
  -- Valor vindo de fora só é honrado do servidor ou da gerência. Qualquer
  -- outro chamador tem o carimbo recalculado — a policy de INSERT deixa
  -- qualquer autenticado inserir, e o crédito não pode ser escolhido.
  IF NEW.responsavel_credito_id IS NOT NULL AND v_confiavel THEN
    NEW.credito_origem := COALESCE(NEW.credito_origem, 'informado_pelo_servidor');
    RETURN NEW;
  END IF;
  NEW.responsavel_credito_id := NULL;
  NEW.credito_origem := NULL;

  -- 1º degrau: herdar da consulta remarcada, MAS só quando o crédito de origem
  -- é de uma SDR. Herdar de um não-SDR fazia o trabalho da SDR desaparecer do
  -- relatório dela e do total da equipe, porque relatorio_sdr_calc só lista
  -- perfis com papel sdr (medido em 11/09: Bia criou 8, apareceu com 7).
  IF NEW.rescheduled_from_id IS NOT NULL THEN
    SELECT responsavel_credito_id INTO v_dono
      FROM public.crm_appointments WHERE id = NEW.rescheduled_from_id;
    IF v_dono IS NOT NULL AND public.has_role(v_dono, 'sdr'::app_role) THEN
      v_origem := 'herdado_remarcacao';
    ELSE
      v_dono := NULL;   -- cai para os degraus seguintes
    END IF;
  END IF;

  -- 2º degrau: a dona do lead no instante da criação (o caso comum).
  IF v_dono IS NULL THEN
    SELECT assigned_to INTO v_dono FROM public.crm_leads WHERE id = NEW.lead_id;
    IF v_dono IS NOT NULL THEN v_origem := 'dona_do_lead_na_criacao'; END IF;
  END IF;

  -- 3º degrau: caixa comum. Lead sem dona (o Instagram é assim por desenho)
  -- credita QUEM MARCOU. Sem isto, todo agendamento de Instagram nascia sem
  -- crédito e sumia do relatório — contrariando o que a migration
  -- 20260911010000 já prometia por escrito.
  IF v_dono IS NULL AND auth.uid() IS NOT NULL THEN
    v_dono := auth.uid();
    v_origem := 'quem_agendou_caixa_comum';
  END IF;

  IF v_dono IS NULL THEN v_origem := 'sem_dona_na_criacao'; END IF;

  NEW.responsavel_credito_id := v_dono;
  NEW.credito_origem := v_origem;
  RETURN NEW;
END $fn$;

COMMENT ON FUNCTION public.carimba_credito_agendamento() IS
  'Carimba responsavel_credito_id na criação da consulta. Precedência: herda da remarcação SÓ quando o crédito de origem é de uma SDR > dona do lead > quem marcou (caixa comum, como o Instagram) > sem dona. A herança é restrita a SDR desde 11/09/2026, quando o relatório passou a contar pela data em que a SDR marcou: herdar de não-SDR fazia o trabalho dela sumir do relatório.';


-- ================================================= (5) o sigilo passa a ser do banco
-- Corpo idêntico ao de produção, com uma cláusula a mais: etapa invisível para a
-- SDR não sai daqui. Para todo papel que não é sdr o resultado é bit a bit o
-- mesmo.
CREATE OR REPLACE FUNCTION public.get_lead_stage_history_names(_lead_id uuid)
RETURNS TABLE(id uuid, name text, color text, pipeline_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT DISTINCT s.id, s.name, s.color, s.pipeline_id
  FROM crm_stages s
  WHERE s.id IN (
    SELECT h.stage_id FROM crm_lead_stage_history h WHERE h.lead_id = _lead_id
    UNION
    SELECT h.from_stage_id FROM crm_lead_stage_history h WHERE h.lead_id = _lead_id AND h.from_stage_id IS NOT NULL
  )
  AND EXISTS (
    SELECT 1 FROM crm_leads l
    WHERE l.id = _lead_id AND l.tenant_id = current_tenant_id()
  )
  AND (
    NOT public.has_role(auth.uid(), 'sdr'::public.app_role)
    OR public.sdr_pode_ver_lead(_lead_id)
  )
  -- A SDR nunca lê "Contratado"/"Não contratado", nem pelo histórico. Antes
  -- disto o sigilo estava só no componente da tela, e a RPC continuava aberta a
  -- qualquer chamada com o token dela.
  AND (
    NOT public.has_role(auth.uid(), 'sdr'::public.app_role)
    OR COALESCE(s.visivel_para_sdr, true)
  );
$fn$;


-- ========================== (3b) a etapa "Compareceu" onde a SDR trabalha e faltava
-- O dono pediu a etapa "para todos os funis". Faltava no Instagram (onde ela
-- agora agenda) e no Nutrição. Padrão Closer e Pós-venda ficam de fora de
-- propósito: são o mundo de outros papéis, e o ciclo da SDR não passa por lá.
INSERT INTO public.crm_stages (pipeline_id, name, color, position, visivel_para_sdr)
SELECT p.id,
       'Compareceu',
       COALESCE((SELECT s2.color FROM public.crm_stages s2
                  JOIN public.crm_pipelines p2 ON p2.id = s2.pipeline_id
                 WHERE p2.tenant_id = p.tenant_id
                   AND public.normaliza_nome_etapa(s2.name) = 'compareceu'
                 ORDER BY s2.position LIMIT 1), '#22c55e'),
       COALESCE((SELECT max(s3.position) FROM public.crm_stages s3 WHERE s3.pipeline_id = p.id), 0) + 1,
       true
  FROM public.crm_pipelines p
 WHERE p.name IN ('Instagram', 'Nutrição')
   AND NOT EXISTS (SELECT 1 FROM public.crm_stages s
                    WHERE s.pipeline_id = p.id
                      AND public.normaliza_nome_etapa(s.name) = 'compareceu');

-- ================ (3) as RPCs de desfecho aceitam a caixa do Instagram
-- ================     e (4) o carimbo confirmado do Dontus fica com a gestão
-- Corpos idênticos aos de 20260910130000, com 7 substituições cirúrgicas.

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
  IF NOT FOUND OR (l.assigned_to IS DISTINCT FROM auth.uid() AND NOT public.lead_da_caixa_do_instagram(l.id)) THEN
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

  -- Lead da caixa comum do Instagram não tem dona por desenho: quem marcou
  -- o comparecimento é quem move a etapa.
  IF v_dona IS NOT DISTINCT FROM auth.uid() OR public.lead_da_caixa_do_instagram(l.id) THEN
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
                 WHEN v_dona IS DISTINCT FROM auth.uid()
                      AND NOT public.lead_da_caixa_do_instagram(l.id) THEN 'entregue'
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

CREATE OR REPLACE FUNCTION public.sdr_corrigir_desfecho(p_appointment_id uuid, p_compareceu boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE a public.crm_appointments; l public.crm_leads; v_tenant uuid;
        v_gestao boolean; v_antes text; v_novo text; n integer;
        v_alvo uuid; v_alvo_nome text; v_movido boolean := false;
        v_quem text; v_entrega text; v_dona uuid; v_removidas integer := 0;
        v_outra uuid; v_repontadas integer := 0;
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
    IF (l.assigned_to IS DISTINCT FROM auth.uid() AND NOT public.lead_da_caixa_do_instagram(l.id)) THEN
      RAISE EXCEPTION 'Este lead não é seu — quem corrige é quem está com ele, ou o administrador.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Desfecho que veio do pagamento não se discute na tela do atendimento.
  IF a.status = 'contracted' AND COALESCE(a.outcome_source, '') <> 'sdr' THEN
    RAISE EXCEPTION 'Esta consulta está marcada como CONTRATADA pelo sistema de pagamentos — quem decide isso é o pagamento, não a marcação de presença. Fale com o administrador da clínica.' USING ERRCODE = '42501';
  END IF;
  -- Desfecho CONFIRMADO pelo Dontus também não se corrige aqui: quem marcou foi
  -- a clínica, no sistema de prontuário. A INFERÊNCIA POR TEMPO continua
  -- corrigível pela SDR — é justamente o pedido do dono (a consulta some do
  -- Dontus e o sync a declara falta 3 h depois do horário, mas o paciente pode
  -- ter comparecido). A gestão passa por cima das duas.
  IF NOT v_gestao
     AND COALESCE(a.outcome_source, '') LIKE 'dontus-sync%'
     AND COALESCE(a.outcome_source, '') NOT LIKE '%no_show_por_tempo%' THEN
    RAISE EXCEPTION 'Este desfecho foi confirmado no Dontus. Se estiver errado, fale com o administrador da clínica.' USING ERRCODE = '42501';
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
  -- A ENTREGA AO ADMINISTRADOR NÃO É DO LEAD, É DA CONSULTA QUE A MOTIVOU —
  -- mas crm_entregas_gestor tem UMA linha por lead (lead_id é a chave), e
  -- sdr_agenda_entrega_ao_gestor devolve 'ja_agendada' sem repontar quando já
  -- existe linha. Então a linha viva costuma apontar para a PRIMEIRA consulta
  -- comparecida. Um DELETE por lead_id, sem recorte, produzia os dois estragos
  -- opostos que a revisão achou:
  --   • mexendo na consulta B, matava a entrega da consulta A, que compareceu de
  --     verdade: o lead ficava em "Compareceu", com a SDR, para sempre — o
  --     administrador nunca recebia e a venda não era trabalhada por ninguém;
  --   • recortando só por appointment_id, o mesmo acontecia quando a linha
  --     apontava para a consulta que está sendo mexida e havia outra comparecida.
  -- A regra que fecha os dois: se AINDA existe outra consulta comparecida do
  -- lead, a entrega não morre — ela é REPONTADA para essa consulta (e criada, se
  -- não havia nenhuma). Só quando não sobra comparecimento nenhum é que a
  -- passagem ao administrador deixa de fazer sentido e a linha sai.
  SELECT a2.id INTO v_outra
    FROM public.crm_appointments a2
   WHERE a2.lead_id = l.id AND a2.id <> a.id
     AND a2.status IN ('contracted', 'not_contracted')
   ORDER BY a2.scheduled_date DESC, a2.scheduled_time DESC NULLS LAST
   LIMIT 1;

  IF v_outra IS NULL THEN
    DELETE FROM public.crm_entregas_gestor WHERE lead_id = l.id;
    GET DIAGNOSTICS v_removidas = ROW_COUNT;
  ELSE
    UPDATE public.crm_entregas_gestor
       SET appointment_id = v_outra
     WHERE lead_id = l.id;
    GET DIAGNOSTICS v_repontadas = ROW_COUNT;
    v_removidas := 0;
    IF v_repontadas = 0 THEN
      PERFORM public.sdr_agenda_entrega_ao_gestor(
        l.id, 'comparecimento em outra consulta (após ajuste da SDR)', NULL, v_outra);
    END IF;
  END IF;
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

CREATE OR REPLACE FUNCTION public.sdr_excluir_agendamento(p_appointment_id uuid, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE a public.crm_appointments; l public.crm_leads; v_tenant uuid;
        v_gestao boolean; v_antes text; n integer; v_motivo text;
        v_etapa_atual text; v_alvo uuid; v_alvo_nome text; v_movido boolean := false;
        v_quem text; v_removidas integer := 0; v_tem_viva boolean;
        v_outra uuid; v_repontadas integer := 0;
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
    IF (l.assigned_to IS DISTINCT FROM auth.uid() AND NOT public.lead_da_caixa_do_instagram(l.id)) THEN
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

  -- A ENTREGA AO ADMINISTRADOR NÃO É DO LEAD, É DA CONSULTA QUE A MOTIVOU —
  -- mas crm_entregas_gestor tem UMA linha por lead (lead_id é a chave), e
  -- sdr_agenda_entrega_ao_gestor devolve 'ja_agendada' sem repontar quando já
  -- existe linha. Então a linha viva costuma apontar para a PRIMEIRA consulta
  -- comparecida. Um DELETE por lead_id, sem recorte, produzia os dois estragos
  -- opostos que a revisão achou:
  --   • mexendo na consulta B, matava a entrega da consulta A, que compareceu de
  --     verdade: o lead ficava em "Compareceu", com a SDR, para sempre — o
  --     administrador nunca recebia e a venda não era trabalhada por ninguém;
  --   • recortando só por appointment_id, o mesmo acontecia quando a linha
  --     apontava para a consulta que está sendo mexida e havia outra comparecida.
  -- A regra que fecha os dois: se AINDA existe outra consulta comparecida do
  -- lead, a entrega não morre — ela é REPONTADA para essa consulta (e criada, se
  -- não havia nenhuma). Só quando não sobra comparecimento nenhum é que a
  -- passagem ao administrador deixa de fazer sentido e a linha sai.
  SELECT a2.id INTO v_outra
    FROM public.crm_appointments a2
   WHERE a2.lead_id = l.id AND a2.id <> a.id
     AND a2.status IN ('contracted', 'not_contracted')
   ORDER BY a2.scheduled_date DESC, a2.scheduled_time DESC NULLS LAST
   LIMIT 1;

  IF v_outra IS NULL THEN
    DELETE FROM public.crm_entregas_gestor WHERE lead_id = l.id;
    GET DIAGNOSTICS v_removidas = ROW_COUNT;
  ELSE
    UPDATE public.crm_entregas_gestor
       SET appointment_id = v_outra
     WHERE lead_id = l.id;
    GET DIAGNOSTICS v_repontadas = ROW_COUNT;
    v_removidas := 0;
    IF v_repontadas = 0 THEN
      PERFORM public.sdr_agenda_entrega_ao_gestor(
        l.id, 'comparecimento em outra consulta (após ajuste da SDR)', NULL, v_outra);
    END IF;
  END IF;


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
  -- Duas razões para NÃO mover: outra consulta viva (a etapa de agendamento está
  -- certa por causa dela) ou outra consulta COMPARECIDA — v_outra, lida acima. O
  -- segundo caso faltava: o lead que compareceu na consulta A e teve a consulta B
  -- excluída era arrastado de "Compareceu" para "Conversando", ficando com etapa
  -- que contradiz o desfecho de A e sem ciclo nenhum para fechar.
  v_tem_viva := EXISTS (SELECT 1 FROM public.crm_appointments a2
                         WHERE a2.lead_id = l.id AND a2.id <> a.id
                           AND a2.status IN ('confirmed', 'pending'));
  IF NOT v_tem_viva AND v_outra IS NULL
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

-- ====================== (2) a remarcação deixa de contar duas vezes
-- Corpo idêntico ao de 20260911160000, com UMA mudança: o FILTER da coluna
-- agendamentos. Nenhuma outra CTE, coluna ou régua foi tocada.

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
         count(*) FILTER (
             WHERE COALESCE(a.status, '') <> 'cancelled'
               -- A MESMA consulta não conta duas vezes. Remarcar deixa a linha
               -- antiga com status 'rescheduled' (que não é 'cancelled') e cria
               -- uma linha nova; quando as duas caem na MESMA janela, o número
               -- da SDR inflava. Tiramos só a linha SUBSTITUÍDA cujo substituto
               -- está na mesma leitura — assim um mês já fechado não encolhe
               -- retroativamente quando o paciente remarcar no mês seguinte.
               AND NOT (
                     COALESCE(a.status, '') = 'rescheduled'
                 AND EXISTS (SELECT 1 FROM public.crm_appointments nova
                              WHERE nova.rescheduled_from_id = a.id
                                AND nova.created_at >= (SELECT j.ini FROM janela j)
                                AND nova.created_at <  (SELECT j.fim FROM janela j))
               )
           )::integer AS agendamentos,
         count(*) FILTER (WHERE a.status IN ('contracted', 'not_contracted'))::integer AS compareceram,
         count(*) FILTER (WHERE a.status = 'no_show')::integer AS faltas,
         count(*) FILTER (WHERE a.status = 'contracted')::integer AS contratados,
         count(*) FILTER (WHERE a.status = 'cancelled')::integer AS cancelados
    FROM public.crm_appointments a
    JOIN sdrs s ON s.uid = a.responsavel_credito_id
   WHERE a.tenant_id = p_tenant
     -- RÉGUA: a data em que a SDR AGENDOU, não a data da consulta.
     -- Decisão do dono em 11/09/2026, depois de ver 10 no mês e 3 no dia: "está
     -- errado, tem que contar pela data que a sdr agendou". Ele tem razão sobre o
     -- que a coluna deve medir — o trabalho dela acontece no dia em que ela marca
     -- a consulta, e sete das dez marcadas naquela manhã eram para 12, 14, 16 e
     -- 21 de setembro. Pela régua antiga, o esforço do dia aparecia espalhado
     -- pelas semanas seguintes e o dia de hoje parecia vazio.
     --
     -- As COLUNAS DE DESFECHO (compareceram, faltas, contratados, cancelados)
     -- passam a andar junto, de propósito: a linha vira uma COORTE coerente —
     -- "do que ela agendou neste período, isto aconteceu". Deixar agendamentos
     -- por criação e desfechos por data da consulta faria a mesma linha somar
     -- coisas de conjuntos diferentes: "10 agendamentos, 5 compareceram" em que
     -- os 5 seriam de agendamentos de outro período. Isso é pior do que o
     -- problema original.
     --
     -- Efeito que a tela precisa explicar: no filtro de HOJE os desfechos ficam
     -- baixos ou zerados, porque a consulta que ela marcou hoje ainda não
     -- aconteceu. Não é número faltando; é a coorte amadurecendo.
     AND a.created_at >= (SELECT j.ini FROM janela j)
     AND a.created_at <  (SELECT j.fim FROM janela j)
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

-- =============================================================================
-- VERIFICAÇÃO (só leitura, depois de aplicar)
--
-- 1) O crédito da remarcação de hoje foi para a SDR certa?
-- SELECT public.rodizio_nome(a.responsavel_credito_id) AS credito, a.credito_origem, count(*)
--   FROM public.crm_appointments a
--  WHERE a.created_at >= date_trunc('day', now() AT TIME ZONE 'America/Bahia') AT TIME ZONE 'America/Bahia'
--  GROUP BY 1,2 ORDER BY 3 DESC;
--
-- 2) O relatório passou a fechar com o livro de auditoria?
-- SELECT COALESCE(p.nome,'(servidor)') AS quem, count(*) AS criou_hoje
--   FROM public.crm_appointments_audit a LEFT JOIN public.profiles p ON p.id = a.changed_by
--  WHERE a.action='INSERT'
--    AND a.changed_at >= date_trunc('day', now() AT TIME ZONE 'America/Bahia') AT TIME ZONE 'America/Bahia'
--  GROUP BY 1;   -- compare com relatorio_sdr_calc(tenant, hoje, hoje, NULL, true)
--
-- 3) A etapa "Compareceu" existe em todos os funis da SDR?
-- SELECT p.name, bool_or(public.normaliza_nome_etapa(s.name)='compareceu') AS tem
--   FROM public.crm_pipelines p JOIN public.crm_stages s ON s.pipeline_id=p.id
--  WHERE p.tenant_id='00000000-0000-0000-0000-000000000010'
--  GROUP BY 1 ORDER BY 2, 1;
--
-- 4) A SDR deixou de ler "Contratado" no histórico? (ensaio desfeito)
-- DO $t$
-- DECLARE rep text := E'\n'; r record;
-- BEGIN
--   PERFORM set_config('request.jwt.claims',
--     json_build_object('sub','9c32408d-d852-4c55-9637-b30a59a16c13','role','authenticated')::text, true);
--   EXECUTE 'SET LOCAL ROLE authenticated';
--   FOR r IN SELECT name FROM public.get_lead_stage_history_names(
--       (SELECT lead_id FROM public.crm_lead_stage_history h
--         JOIN public.crm_stages s ON s.id=h.stage_id
--        WHERE COALESCE(s.visivel_para_sdr,true)=false LIMIT 1)) LOOP
--     rep := rep || ' - ' || r.name || E'\n';
--   END LOOP;
--   EXECUTE 'RESET ROLE';
--   RAISE EXCEPTION 'etapas que a SDR le: %', rep;   -- nenhuma pode ser Contratado
-- END $t$;
-- =============================================================================
