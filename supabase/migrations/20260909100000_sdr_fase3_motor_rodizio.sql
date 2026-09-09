-- Rodízio de SDRs — Fases 3 e 4: o MOTOR de distribuição, inteiro no banco.
--
-- NASCE DESLIGADO. Esta migration NÃO muda crm_rodizio_config.modo (continua
-- 'desligado') e nenhuma função abaixo move lead algum enquanto o modo for
-- 'desligado': toda entrada do motor lê o modo na primeira linha e sai. Ligar é
-- decisão do dono, por rodizio_definir_modo('sombra'|'ligado') (gestor da
-- equipe) ou por UPDATE direto na tabela.
--
-- POR QUE NO BANCO: 93% dos leads novos nascem no whatsapp-webhook (que não se
-- toca), o resto vem de generic-lead-webhook, admin-api, Kanban, importação e
-- dontus-sync. Um gatilho AFTER INSERT em crm_leads cobre todos os caminhos de
-- uma vez; um gatilho AFTER INSERT em messages (inbound) cobre "lead antigo do
-- administrador que mandou mensagem"; pg_cron cobre o que depende de relógio
-- (corte das 9h, realocação por silêncio, varredura de segurança, auto-encerrar).
--
-- MODOS (crm_rodizio_config.modo):
--   desligado  nada acontece (estado atual e default).
--   sombra     só grava em crm_lead_atribuicoes (fase='sombra') quem TERIA
--              recebido; assigned_to não muda; o ponteiro avança (é estado do
--              motor, não do lead) para a sombra revezar como o real revezaria.
--              Corte das 9h e lote-ao-abrir não anotam nada em sombra (não há
--              reserva gravada em sombra). A realocação por silêncio anota
--              sobre uma DONA VIRTUAL: a para_user_id da última anotação de
--              sombra do lead (entrada ou realocação) — sem isso a sombra
--              nunca produziria uma linha 'realocação:' (o lead continua com
--              o administrador, que a régua real exclui de propósito).
--   ligado     distribui de verdade.
--
-- REGRAS DO DONO (fechadas) COMO FICARAM NO CÓDIGO:
--   • Entram no rodízio: leads do funil do rodízio (crm_rodizio_config.funil_id;
--     Rizodent = Funil Principal) cuja origem NÃO seja Instagram nem importação
--     (kommo/import/dontus_agenda/Retroativo) — ver rodizio_fonte_excluida —,
--     sem dona ou com o administrador (gestor_user_id) como dono, ainda não
--     distribuídos (distribuido_em IS NULL), não bloqueados, no número
--     principal (mundo legado ou o número is_default) e sem conta de Instagram.
--     E SÓ NAS ETAPAS DE ENTRADA (crm_rodizio_config.etapas_entrada; Rizodent
--     = Novo Lead, Conversando, Relacionamento, Follow - Up e Recuperado — as
--     etapas antes de 'Pré - Agendado'), SEM agendamento não cancelado e com a
--     conversa aberta (conversa_fechada_em IS NULL). Medido em 08/09/2026 na
--     régua sem etapa: entrariam 560 'Não compareceu', 332 'Contratado', 285
--     'Não contratado', 23 'Agendado', 9 'Reagendado' e 1.639 'Desqualificado'
--     do administrador — pacientes da recepção/closer/pós-venda que mandam
--     centenas de mensagens por quinzena (lembretes, confirmações) e virariam
--     "lead novo" das SDRs. Com o filtro: 510 leads do administrador na régua
--     (7+89+298+123+1 por etapa, menos 8 com agendamento). Resposta a template
--     (messages.type button/interactive) e nota numérica de pesquisa pendente
--     não contam como "lead mandou mensagem". etapas_entrada NULL = régua
--     derivada (rodizio_etapas_entrada: as etapas antes da primeira de
--     agendamento/ganho/perda do funil).
--     O whatsapp-webhook e o generic-lead-webhook gravam assigned_to = admin
--     ao criar; o motor SOBRESCREVE esse dono padrão e registra no livro.
--   • Em expediente (alguém com o ponto aberto): o lead vai NA HORA para a SDR
--     aberta com menos leads no ciclo; empate → revezamento pelo ponteiro.
--     "Leads no ciclo" = entregas do RODÍZIO a ela hoje (dia da clínica) no
--     livro — fases aplicacao/corte_9h/realocacao_1h — mais as reservas
--     pendentes dela; lead que ela mesma criou à mão no Kanban NÃO conta
--     (senão criar lead à mão a tiraria da vez). Em sombra: anotações
--     'sombra' de hoje em nome dela.
--     Ninguém aberta mas alguém pausada → vai na hora para a pausada.
--   • Ninguém aberta (noite, fim de semana, feriado, antes de abrirem): o lead é
--     RESERVADO (crm_leads.rodizio_reservado_para) em rodízio igual entre as
--     elegíveis; o dono visível continua o administrador. Abrir/retomar o
--     expediente APLICA o lote reservado dela (rodizio_aplicar_lote_ao_abrir —
--     chamada pelo gatilho em crm_ponto_eventos e exposta para ponto_abrir).
--   • Corte das 9h (hora_corte, hora da clínica, só dia útil): as reservas de
--     quem não abriu vão para quem abriu, pela mesma régua "menos leads no
--     ciclo" (= partes iguais quando as abertas estão empatadas); tenta a cada
--     5 min até corte_ate; se ninguém abriu, não move nada e avisa o gestor.
--   • Válvula: havendo alguém aberta, só quem está aberta recebe
--     (preferir_em_expediente = true; false = havendo alguém presente, o lote
--     considera todas as elegíveis, mantido por contrato da Fase 0).
--   • Realocação por silêncio: em horário comercial do cliente
--     (tenants.business_hours + dashboard_holidays), lead JÁ DISTRIBUÍDO pelo
--     rodízio (distribuido_em IS NOT NULL — o que zera o efeito retroativo
--     sobre os 3.213 leads históricos "sem resposta humana"), AINDA NA FILA
--     DE ENTRADA (etapa de entrada e sem agendamento não cancelado — os
--     mesmos predicados da entrada: lead agendado é da recepção/closer e não
--     volta a girar), cuja última mensagem é do lead há mais de
--     realocar_sem_resposta_min (60) sem resposta HUMANA vai para uma SDR
--     aberta naquele momento (menos leads no ciclo). Resposta humana =
--     rodizio_msg_humana(messages): outbound não apagada com sender_id ou
--     from_device, ou LIGAÇÃO (type='call' — api4com não grava sender_id;
--     ligar conta como contato, decisão a confirmar com o dono: reverter é
--     uma linha), ou CONTEÚDO (text/audio/image/document/video) que não seja
--     a saudação do bot ("*Elisa:*"), template ("📋 Template:"), a espera
--     automática ("Aguarde você será atendido") nem status 'system'. É a
--     régua do relatório e do admin-api: medido em 08/09/2026, das 10.316
--     mensagens de texto enviadas em 14 dias só 326 têm sender_id — pela
--     régua antiga (sender_id/from_device/call) só 174 leads contavam como
--     respondidos e 503 leads JÁ RESPONDIDOS seriam realocados ao ligar; pela
--     régua nova, 677 (número principal, 14 dias). TETO: no máximo UMA
--     realocação por lead por dia da clínica (linha 'realocacao_1h' de hoje
--     no livro) — nunca há pingue-pongue. Conversa fechada
--     (conversa_fechada_em) só tira o lead da realocação quando houve
--     resposta humana ao último inbound — que é exatamente o NOT EXISTS da
--     régua; fechar sem responder não livra a dona. Fase 'realocacao_1h'.
--     0 desliga a régua. O relógio começa no MAIOR entre última mensagem do
--     lead e distribuido_em, para a nova dona ter os 60 minutos inteiros.
--   • Distribuição inicial: rodizio_distribuir_sem_resposta_agora(p_dry_run)
--     pega SÓ os leads do administrador aguardando resposta AGORA (última
--     mensagem é do lead: last_inbound_at > last_outbound_at — a régua da tela
--     Conversas, 20 leads em 08/09/2026 às 22h, ANTES do filtro de etapa —
--     rodar o dry-run de novo) e os trata como lead novo. Os demais entram
--     quando mandarem qualquer mensagem (gatilho de messages).
--   • O administrador NÃO recebe fatia; SDR bloqueada ou fora do rodízio nunca
--     recebe (rodizio_pool só devolve papel sdr + profiles.is_blocked=false +
--     crm_rodizio_membros.ativo=true). Zero SDRs elegíveis = lead fica com o
--     administrador e o gestor recebe UM aviso por dia.
--   • Lead distribuído que volta para o administrador (ou fica sem dona) por
--     fora — transfer-lead, crc, admin-api: o gatilho trg_zz_rodizio_limpa_
--     reserva zera distribuido_em (linha 'saneamento' no livro) e o lead volta
--     à fila de entrada, entrando de novo na próxima mensagem. Sem isso,
--     devolver = sair do rodízio para sempre (nada mais zera a coluna).
--   • Trocar o modo para 'sombra' ou 'desligado' cancela as reservas pendentes
--     (linha 'saneamento'): em sombra nada aplica nem corta reserva, e deixá-las
--     congeladas esconderia leads do teste do dono.
--
-- CONCORRÊNCIA (a escolha, explicada):
--   1. Mutex por cliente = SELECT ... FROM crm_rodizio_config WHERE tenant_id
--      FOR UPDATE. A tabela já é "uma linha por cliente" e guarda o ponteiro:
--      travar a linha serializa a decisão inteira (ler cargas → escolher →
--      gravar) sem trava global, solta sozinha no commit, aparece em pg_locks.
--      Escolhido em vez de advisory lock de sessão porque não há como vazar.
--   2. Reserva/entrega atômica = UPDATE condicional com RETURNING
--      (distribuido_em IS NULL AND rodizio_reservado_para IS NULL AND
--      assigned_to ainda é o administrador). Se duas rodadas passarem pelo
--      mutex, a segunda não muda linha nenhuma e não escreve no livro — o livro
--      só é escrito DEPOIS do claim. "Duas donas" é estruturalmente impossível
--      (assigned_to é uma coluna só); o risco real era o livro duplicar, e essa
--      ordem fecha. Por isso não há UNIQUE novo: não há segunda linha a proteger.
--   3. Crons = pg_try_advisory_xact_lock por função e por cliente: rodada que
--      encontra outra em andamento sai sem esperar (lock de transação, solta no
--      commit/erro). Primeiro uso de advisory lock no projeto, de propósito
--      _xact_ para não sobrar trava de sessão.
--   4. lock_timeout = '5s' em toda função do motor (SET no nível da função, que
--      volta ao sair) e gatilhos com BEGIN/EXCEPTION: o INSERT do webhook NUNCA
--      falha por causa do rodízio — se o motor não conseguir a trava, o lead
--      fica com o administrador e a varredura (rodizio_processar_novos, a cada
--      5 min) o pega depois.
--   5. Aplicar o lote ao abrir roda com o JWT da própria SDR (ponto_abrir):
--      os gatilhos trg_sdr_nao_transfere_lead / trg_sdr_nao_altera_distribuicao
--      recusariam o UPDATE. A função limpa as claims do JWT SÓ durante o seu
--      UPDATE (set_config transacional, restaurado antes de sair), porque o
--      motor É o servidor: ela não escolhe lead — só recebe o que o motor
--      reservou para ela. Nenhum gatilho ou policy foi afrouxado. A função é
--      INTERNA (sem EXECUTE para authenticated — quem a chama é ponto_abrir,
--      o gatilho do ponto e o corte das 9h, todos como dono) e, com sessão,
--      exige a SDR PRESENTE no ponto (senão ela puxaria o lote de casa às 7h
--      e o corte das 9h não acharia reserva para passar às colegas) e gestor
--      do mesmo cliente (v_tenant sai do perfil do alvo).
--
-- FUSO: tenants.timezone (Rizodent = America/Bahia); o banco e os crons rodam
-- em UTC. Toda comparação de hora/dia converte explicitamente. Feriado = linha
-- de dashboard_holidays do cliente com clinica_id IS NULL (vale para a clínica
-- inteira); feriado de uma unidade só não para o rodízio do cliente.
--
-- CRONS (todos a cada 5 min, deslocados 1 min entre si, idempotentes):
--   rodizio-processar-novos   */5           varredura de segurança (leads criados
--                                           OU que mandaram mensagem depois da
--                                           troca de modo, últimos 2 dias, que o
--                                           gatilho não tratou — trava/sem elegível)
--   rodizio-corte-9h          1,6,11,...    janela [hora_corte, corte_ate] local
--   rodizio-realocacao        2,7,12,...    só em horário comercial do cliente
--   O auto-encerrar do expediente (23:59) NÃO está aqui: é do ponto
--   (ponto_vigia, migration 20260909100100), um escritor só para o evento.
--
-- PAUSA (ponto 'pausar'): a SDR pausada NÃO recebe enquanto houver alguém
-- aberta. Se ninguém está aberta mas há alguém pausada (a única do turno saiu
-- 15 min para o café), o lead vai na hora para a pausada — melhor do que ficar
-- reservado no limbo para quem nem veio trabalhar. Só com ninguém presente o
-- lead é reservado. Para o corte das 9h, "abriu" = aberta ou pausada.
--
-- OBJETOS NOVOS: colunas crm_rodizio_config.funil_id / modo_alterado_em /
-- etapas_entrada, crm_leads.rodizio_reservado_para / rodizio_reservado_em
-- (+2 índices); 29 funções rodizio_* (uma delas, rodizio_msg_humana, é a
-- régua ÚNICA de "resposta humana": realocação do motor, 1ª resposta do
-- relatório da Fase 5 e a mesma do admin-api); 5 gatilhos (trg_zz_rodizio_lead_novo,
-- trg_zz_rodizio_mensagem, trg_zz_rodizio_ponto_abrir,
-- trg_zz_rodizio_limpa_reserva, trg_rodizio_config_carimba); 3 crons; UMA
-- policy nova, RESTRICTIVE, em crm_lead_atribuicoes
-- (sdr_escopo_crm_lead_atribuicoes: a SDR só lê linhas de lead que é dela
-- HOJE — o livro anota nome/telefone/id de leads que ela NÃO recebeu em
-- sombra, reserva e corte, e a permissiva atribuicoes_le_gestao liberava por
-- de_user_id/para_user_id = auth.uid(), fora do cerco da Fase 1). Nenhuma
-- policy editada ou removida. Nenhuma função existente substituída. Nenhum
-- papel passa a poder mais ou menos: os únicos objetos chamáveis por usuário
-- (rodizio_definir_modo, rodizio_estado, rodizio_distribuir_sem_resposta_agora)
-- exigem is_gestor_equipe() — a mesma porta das RPCs equipe_* da Fase 1;
-- rodizio_aplicar_lote_ao_abrir é interna (sem EXECUTE para authenticated).
--
-- ROLLBACK: desagendar os 3 crons; DROP dos 5 gatilhos; DROP da policy
-- sdr_escopo_crm_lead_atribuicoes; DROP das funções rodizio_*; DROP das 5
-- colunas e dos 2 índices. Reservas pendentes somem com a coluna (nenhum lead
-- muda de dono). O livro fica.
--
-- PRÉ-REQUISITOS: 20260901220000, 20260901220100 (Fase 0) e 20260908150000
-- (Fase 1). Independente de 20260909100100 (ponto) e 20260909100200
-- (relatórios): usa só a tabela crm_ponto_eventos da Fase 0.

SET LOCAL lock_timeout = '5s';

-- ============================================================ 1. colunas e índices
-- funil_id: qual funil o rodízio distribui (NULL → o funil geral padrão do
-- cliente, ver rodizio_funil). modo_alterado_em: quando o modo mudou pela última
-- vez — a varredura só olha leads criados DEPOIS disso (nunca o acervo).
ALTER TABLE public.crm_rodizio_config
  ADD COLUMN IF NOT EXISTS funil_id uuid REFERENCES public.crm_pipelines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS modo_alterado_em timestamptz;
-- etapas_entrada: etapas do funil em que um lead ainda é "lead novo" para o
-- rodízio (NULL → régua derivada, ver rodizio_etapas_entrada). Lead em etapa
-- de agendamento/pós-consulta é da recepção/closer/pós-venda, não do rodízio.
ALTER TABLE public.crm_rodizio_config
  ADD COLUMN IF NOT EXISTS etapas_entrada uuid[];

-- Reserva fora do expediente: para quem o lead está guardado (o dono visível
-- continua o administrador). Some ao aplicar, ao mover no corte, ao desligar o
-- motor ou se alguém trocar o dono por fora (gatilho trg_zz_rodizio_limpa_reserva).
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS rodizio_reservado_para uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rodizio_reservado_em timestamptz;

CREATE INDEX IF NOT EXISTS crm_leads_rodizio_reserva_idx
  ON public.crm_leads (tenant_id, rodizio_reservado_para, rodizio_reservado_em)
  WHERE rodizio_reservado_para IS NOT NULL;
-- Realocação por silêncio varre só o que o rodízio entregou.
CREATE INDEX IF NOT EXISTS crm_leads_rodizio_distribuido_idx
  ON public.crm_leads (tenant_id, pipeline_id, distribuido_em)
  WHERE distribuido_em IS NOT NULL;

-- Rizodent: o rodízio é do Funil Principal (decisão do dono). Só se ainda não
-- houver funil configurado e o funil existir neste cliente.
UPDATE public.crm_rodizio_config c
   SET funil_id = 'a1b2c3d4-0001-4000-8000-000000000001'
 WHERE c.tenant_id = '00000000-0000-0000-0000-000000000010'
   AND c.funil_id IS NULL
   AND EXISTS (SELECT 1 FROM public.crm_pipelines p
                WHERE p.id = 'a1b2c3d4-0001-4000-8000-000000000001'
                  AND p.tenant_id = c.tenant_id);

-- Rizodent: etapas de entrada = as anteriores a 'Pré - Agendado' no Funil
-- Principal (Novo Lead, Conversando, Relacionamento, Follow - Up, Recuperado
-- — posições 0 a 4 em 08/09/2026). Só se ainda não houver etapas configuradas.
UPDATE public.crm_rodizio_config c
   SET etapas_entrada = sub.ids
  FROM (SELECT array_agg(s.id ORDER BY s.position) AS ids
          FROM public.crm_stages s
         WHERE s.pipeline_id = 'a1b2c3d4-0001-4000-8000-000000000001'
           AND s.position < (SELECT min(s2.position) FROM public.crm_stages s2
                              WHERE s2.pipeline_id = s.pipeline_id
                                AND btrim(s2.name) IN ('Pré - Agendado', 'Agendado'))) sub
 WHERE c.tenant_id = '00000000-0000-0000-0000-000000000010'
   AND c.etapas_entrada IS NULL
   AND sub.ids IS NOT NULL;

-- ============================================================ 2. helpers de leitura
-- Fuso da clínica (o banco roda em UTC).
CREATE OR REPLACE FUNCTION public.rodizio_tz(p_tenant uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT COALESCE((SELECT NULLIF(btrim(t.timezone), '') FROM public.tenants t WHERE t.id = p_tenant), 'America/Bahia');
$fn$;

-- Feriado da clínica inteira (clinica_id IS NULL). Feriado de uma unidade só
-- não para o rodízio do cliente.
CREATE OR REPLACE FUNCTION public.rodizio_feriado(p_tenant uuid, p_data date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.dashboard_holidays h
     WHERE h.tenant_id = p_tenant AND h.data = p_data AND h.clinica_id IS NULL);
$fn$;

-- Dia útil = tenants.business_hours tem o dia da semana (0=domingo … 6=sábado)
-- e não é feriado. Sem horário cadastrado (business_hours NULL) = nunca é dia
-- útil, como manda o contrato ("tratar como fora do expediente").
CREATE OR REPLACE FUNCTION public.rodizio_dia_util(p_tenant uuid, p_data date)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_bh jsonb; v_dia jsonb;
BEGIN
  IF p_tenant IS NULL OR p_data IS NULL THEN RETURN false; END IF;
  SELECT t.business_hours INTO v_bh FROM public.tenants t WHERE t.id = p_tenant;
  IF v_bh IS NULL OR jsonb_typeof(v_bh) <> 'object' THEN RETURN false; END IF;
  v_dia := v_bh -> (extract(dow FROM p_data)::int)::text;
  IF v_dia IS NULL OR jsonb_typeof(v_dia) <> 'array' OR jsonb_array_length(v_dia) < 2 THEN RETURN false; END IF;
  RETURN NOT public.rodizio_feriado(p_tenant, p_data);
END $fn$;

-- Horário comercial do cliente naquele instante (hora local dentro de
-- ["HH:MM","HH:MM"] do dia da semana, e não feriado).
CREATE OR REPLACE FUNCTION public.rodizio_em_expediente(p_tenant uuid, p_quando timestamptz DEFAULT now())
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_bh jsonb; v_dia jsonb; v_local timestamp; v_abre time; v_fecha time;
BEGIN
  IF p_tenant IS NULL THEN RETURN false; END IF;
  SELECT t.business_hours INTO v_bh FROM public.tenants t WHERE t.id = p_tenant;
  IF v_bh IS NULL OR jsonb_typeof(v_bh) <> 'object' THEN RETURN false; END IF;
  v_local := COALESCE(p_quando, now()) AT TIME ZONE public.rodizio_tz(p_tenant);
  v_dia := v_bh -> (extract(dow FROM v_local)::int)::text;
  IF v_dia IS NULL OR jsonb_typeof(v_dia) <> 'array' OR jsonb_array_length(v_dia) < 2 THEN RETURN false; END IF;
  BEGIN
    v_abre := (v_dia ->> 0)::time;
    v_fecha := (v_dia ->> 1)::time;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  IF v_abre IS NULL OR v_fecha IS NULL THEN RETURN false; END IF;
  IF public.rodizio_feriado(p_tenant, v_local::date) THEN RETURN false; END IF;
  RETURN v_local::time >= v_abre AND v_local::time < v_fecha;
END $fn$;

-- Funil do rodízio: o configurado; senão o funil geral padrão do cliente
-- (allowed_roles NULL, não Instagram, não pós-venda; is_default primeiro, o
-- mais antigo depois — o mesmo desempate do whatsapp-webhook).
CREATE OR REPLACE FUNCTION public.rodizio_funil(p_tenant uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT COALESCE(
    (SELECT c.funil_id FROM public.crm_rodizio_config c WHERE c.tenant_id = p_tenant),
    (SELECT p.id FROM public.crm_pipelines p
      WHERE p.tenant_id = p_tenant
        AND p.allowed_roles IS NULL
        AND NOT COALESCE(p.is_instagram, false)
        AND NOT COALESCE(p.is_posvenda, false)
      ORDER BY p.is_default DESC, p.created_at ASC
      LIMIT 1));
$fn$;

-- Etapas de entrada do rodízio: as configuradas (crm_rodizio_config
-- .etapas_entrada); senão, derivadas do funil do rodízio — todas as etapas
-- ANTES da primeira etapa de agendamento (nome contendo "agend"), ganho
-- (is_won) ou perda (is_lost), na ordem de position. Funil sem etapa desse
-- tipo → todas as não ganhas/perdidas. Sem funil → NULL (ninguém entra).
CREATE OR REPLACE FUNCTION public.rodizio_etapas_entrada(p_tenant uuid)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_cfg uuid[]; v_funil uuid; v_corte integer; v_ids uuid[];
BEGIN
  IF p_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT c.etapas_entrada INTO v_cfg FROM public.crm_rodizio_config c WHERE c.tenant_id = p_tenant;
  IF v_cfg IS NOT NULL AND array_length(v_cfg, 1) > 0 THEN RETURN v_cfg; END IF;
  v_funil := public.rodizio_funil(p_tenant);
  IF v_funil IS NULL THEN RETURN NULL; END IF;
  SELECT min(s.position) INTO v_corte FROM public.crm_stages s
   WHERE s.pipeline_id = v_funil
     AND (COALESCE(s.is_won, false) OR COALESCE(s.is_lost, false) OR lower(s.name) LIKE '%agend%');
  SELECT array_agg(s.id ORDER BY s.position) INTO v_ids FROM public.crm_stages s
   WHERE s.pipeline_id = v_funil
     AND NOT COALESCE(s.is_won, false) AND NOT COALESCE(s.is_lost, false)
     AND (v_corte IS NULL OR s.position < v_corte);
  RETURN v_ids;
END $fn$;

-- Número principal ativo do cliente (o único que a SDR alcança, além do mundo
-- legado whatsapp_number_id IS NULL). Hoje a Rizodent não tem is_default.
CREATE OR REPLACE FUNCTION public.rodizio_numero_principal(p_tenant uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT w.id FROM public.whatsapp_numbers w
   WHERE w.tenant_id = p_tenant AND w.is_default AND w.is_active
   ORDER BY w.created_at LIMIT 1;
$fn$;

-- Origens que ficam com o administrador (decisão do dono): Instagram (qualquer
-- grafia, inclusive "Instagram Lite (@conta)" e "instagram_ad") e importações
-- (Kommo/dontus-sync, CSV, agenda do Dontus, retroativo). Origem vazia entra.
CREATE OR REPLACE FUNCTION public.rodizio_fonte_excluida(p_source text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
  SELECT p_source IS NOT NULL AND (
    lower(btrim(p_source)) LIKE 'instagram%'
    OR lower(btrim(p_source)) IN ('kommo', 'import', 'importacao', 'importação', 'dontus_agenda', 'retroativo'));
$fn$;

-- "Esta mensagem é uma resposta HUMANA?" — a régua ÚNICA de resposta humana:
-- da realocação por silêncio (abaixo), do relatório por SDR (Fase 5, 1ª
-- resposta) e a mesma do admin-api. Outbound não apagada que
--   • tem sender_id ou from_device (alguém do CRM / do aparelho); ou
--   • é LIGAÇÃO (type='call' — api4com não grava sender_id; ligar conta como
--     contato, decisão a confirmar com o dono: reverter é esta linha); ou
--   • é CONTEÚDO (text/audio/image/document/video) que não seja a saudação
--     automática do bot ("*Elisa:*"), template ("📋 Template:"), a espera
--     automática ("Aguarde você será atendido") nem status 'system'.
-- Medido em 08/09/2026: só 326 das 10.316 mensagens de texto enviadas em 14
-- dias têm sender_id — sem o ramo de conteúdo, 503 leads já respondidos
-- seriam realocados ao ligar. Só olha a linha (IMMUTABLE); content NULL
-- (mídia sem legenda) conta como conteúdo. Quem chama passa o alias da
-- tabela: public.rodizio_msg_humana(m).
CREATE OR REPLACE FUNCTION public.rodizio_msg_humana(m public.messages)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
  SELECT (m).id IS NOT NULL
     AND (m).direction = 'outbound'
     AND (m).deleted_at IS NULL
     AND ((m).sender_id IS NOT NULL
          OR COALESCE((m).from_device, false)
          OR (m).type = 'call'
          OR ((m).type IN ('text', 'audio', 'image', 'document', 'video')
              AND ltrim(COALESCE((m).content, '')) NOT LIKE '*Elisa:*%'
              AND COALESCE((m).content, '') NOT LIKE '📋 Template:%'
              AND COALESCE((m).content, '') NOT LIKE 'Aguarde você será atendido%'
              AND COALESCE((m).status, '') <> 'system'));
$fn$;

-- "Este lead está na fila de entrada do rodízio?" — a régua ÚNICA usada pelo
-- gatilho de lead novo, pelo de mensagem, pela varredura e pela distribuição
-- inicial (as duas últimas a chamam no WHERE: não há cópia da régua em SQL).
-- p_admin = crm_rodizio_config.gestor_user_id (NULL → só lead sem dona);
-- p_etapas = rodizio_etapas_entrada (NULL → ninguém entra). Lead com
-- agendamento não cancelado é da recepção/closer/pós-venda, não é lead novo;
-- conversa fechada (conversa_fechada_em) não entra — a nota da pesquisa de
-- satisfação chegaria como "mensagem recebida" e distribuiria o lead.
-- STABLE (consulta crm_appointments), SECURITY DEFINER.
DROP FUNCTION IF EXISTS public.rodizio_lead_na_fila(public.crm_leads, uuid, uuid, uuid);
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
     AND NOT EXISTS (SELECT 1 FROM public.crm_appointments a
                      WHERE a.lead_id = (p_lead).id AND COALESCE(a.status, '') <> 'cancelled');
$fn$;

-- Quem pode receber AGORA, com ordem fixa (para o revezamento), o estado do
-- ponto e quantos leads já tem no ciclo (o dia, na hora da clínica).
--   elegível  = papel sdr + perfil do cliente + não bloqueada + ativa no rodízio
--   estado    = último evento de ponto de HOJE: abrir/retomar → 'aberta',
--               pausar → 'pausada', encerrar ou nenhum → 'fechada'
--   aberta    = estado 'aberta'; presente = aberta ou pausada ("abriu hoje")
--   carga     = ligado: entregas do RODÍZIO a ela hoje no livro (fases
--               aplicacao/corte_9h/realocacao_1h com para_user_id = ela) +
--               reservas pendentes (rodizio_reservado_para = ela, ainda não
--               distribuídas). Lead criado à mão pela própria SDR (Kanban,
--               sdr_carimba_dona) NÃO conta — criar lead não a tira da vez.
--               É diferente do "leads hoje" da aba Equipe (posse), de
--               propósito: aqui é o que o motor lhe deu no ciclo.
--               sombra: anotações de sombra de hoje em nome dela.
-- peso (crm_rodizio_membros.peso) continua sem uso — decisão do dono: "menos
-- leads no ciclo, empate → revezamento".
CREATE OR REPLACE FUNCTION public.rodizio_pool(p_tenant uuid)
RETURNS TABLE(user_id uuid, nome text, ordem integer, estado text, aberta boolean, presente boolean, carga integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tz text; v_ini timestamptz; v_modo text;
BEGIN
  IF p_tenant IS NULL THEN RETURN; END IF;
  v_tz := public.rodizio_tz(p_tenant);
  v_ini := ((now() AT TIME ZONE v_tz)::date)::timestamp AT TIME ZONE v_tz;
  SELECT c.modo INTO v_modo FROM public.crm_rodizio_config c WHERE c.tenant_id = p_tenant;

  RETURN QUERY
  WITH base AS (
    SELECT m.user_id AS uid, m.criado_em,
           COALESCE(NULLIF(btrim(p.nome), ''), p.email) AS pnome,
           COALESCE((SELECT CASE e.tipo WHEN 'abrir' THEN 'aberta' WHEN 'retomar' THEN 'aberta'
                                        WHEN 'pausar' THEN 'pausada' ELSE 'fechada' END
                       FROM public.crm_ponto_eventos e
                      WHERE e.tenant_id = p_tenant AND e.user_id = m.user_id AND e.em >= v_ini
                      ORDER BY e.em DESC, e.id DESC
                      LIMIT 1), 'fechada') AS pestado
      FROM public.crm_rodizio_membros m
      JOIN public.profiles p ON p.id = m.user_id
     WHERE m.tenant_id = p_tenant
       AND m.ativo
       AND p.tenant_id = p_tenant
       AND NOT COALESCE(p.is_blocked, false)
       AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = m.user_id AND ur.role = 'sdr'::app_role)
  )
  SELECT b.uid,
         b.pnome,
         (row_number() OVER (ORDER BY b.criado_em, b.uid))::integer,
         b.pestado,
         b.pestado = 'aberta',
         b.pestado IN ('aberta', 'pausada'),
         CASE WHEN v_modo = 'sombra' THEN
           (SELECT count(*) FROM public.crm_lead_atribuicoes a
             WHERE a.tenant_id = p_tenant AND a.fase = 'sombra'
               AND a.para_user_id = b.uid AND a.criado_em >= v_ini)
         ELSE
           (SELECT count(*) FROM public.crm_lead_atribuicoes a
             WHERE a.tenant_id = p_tenant AND a.para_user_id = b.uid
               AND a.fase IN ('aplicacao', 'corte_9h', 'realocacao_1h')
               AND a.criado_em >= v_ini)
           + (SELECT count(*) FROM public.crm_leads l
               WHERE l.tenant_id = p_tenant AND l.rodizio_reservado_para = b.uid
                 AND l.distribuido_em IS NULL)
         END::integer
    FROM base b
   ORDER BY 3;
END $fn$;

-- A escolha, pura: menor carga; empate → a próxima depois do ponteiro na ordem
-- fixa (cíclico); ponteiro fora da lista → a primeira. NULL se a lista é vazia.
CREATE OR REPLACE FUNCTION public.rodizio_escolher(p_ids uuid[], p_cargas integer[], p_ponteiro uuid)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$
  WITH c AS (
    SELECT t.id, COALESCE(t.carga, 0) AS carga, t.ord
      FROM unnest(p_ids, p_cargas) WITH ORDINALITY AS t(id, carga, ord)
     WHERE t.id IS NOT NULL
  ), p AS (
    SELECT COALESCE((SELECT c2.ord FROM c c2 WHERE c2.id = p_ponteiro), 0) AS pos,
           (SELECT count(*) FROM c) AS n
  )
  SELECT c.id
    FROM c CROSS JOIN p
   ORDER BY c.carga ASC, ((c.ord - p.pos - 1 + p.n) % p.n) ASC, c.ord ASC
   LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public.rodizio_nome(p_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT COALESCE((SELECT COALESCE(NULLIF(btrim(p.nome), ''), p.email) FROM public.profiles p WHERE p.id = p_user), 'SDR');
$fn$;

-- ============================================================ 3. helpers de escrita
-- O livro: toda decisão do motor vira linha (nome/telefone congelados, run_id
-- agrupa a rodada, criado_por = quem disparou, NULL para o servidor).
CREATE OR REPLACE FUNCTION public.rodizio_livro(p_lead public.crm_leads, p_de uuid, p_para uuid, p_fase text, p_motivo text, p_run uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $fn$
  INSERT INTO public.crm_lead_atribuicoes
    (tenant_id, lead_id, lead_nome, lead_telefone, de_user_id, para_user_id, fase, motivo, run_id, criado_por)
  VALUES ((p_lead).tenant_id, (p_lead).id, (p_lead).name, (p_lead).phone, p_de, p_para, p_fase, p_motivo, p_run, auth.uid());
$fn$;

-- Mensagem de sistema no chat do lead (o mesmo molde da varredura de etapas).
CREATE OR REPLACE FUNCTION public.rodizio_msg_sistema(p_lead_id uuid, p_tenant uuid, p_texto text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $fn$
  INSERT INTO public.messages (lead_id, tenant_id, direction, type, content, status)
  VALUES (p_lead_id, p_tenant, 'outbound', 'system', p_texto, 'system');
$fn$;

-- Notificação in-app. dedupe_key (índice único parcial) evita repetir avisos
-- diários; sem lead_id o aviso é visível para a pessoa mesmo que o lead já não
-- seja dela (sdr_escopo_crm_notifications). "Já avisado" só vale se a linha
-- com a chave é DESSA pessoa: chave gravada por outra (a policy
-- notif_dedupe_so_servidor, 20260909100100, fecha esse INSERT; a checagem fica
-- por defesa) não cala o aviso — o INSERT toma a chave (ON CONFLICT DO UPDATE
-- só quando a linha existente não é do destinatário).
CREATE OR REPLACE FUNCTION public.rodizio_notifica(p_user uuid, p_lead_id uuid, p_titulo text, p_corpo text, p_dedupe text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  IF p_dedupe IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.crm_notifications n WHERE n.dedupe_key = p_dedupe AND n.user_id = p_user) THEN
    RETURN;
  END IF;
  INSERT INTO public.crm_notifications AS n (user_id, lead_id, title, body, type, dedupe_key)
  VALUES (p_user, p_lead_id, p_titulo, p_corpo, 'rodizio', p_dedupe)
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE
    SET user_id = EXCLUDED.user_id, lead_id = EXCLUDED.lead_id, title = EXCLUDED.title,
        body = EXCLUDED.body, type = EXCLUDED.type, is_read = false, created_at = now()
    WHERE n.user_id IS DISTINCT FROM EXCLUDED.user_id;
END $fn$;

-- ============================================================ 4. o motor
-- Trata UM lead da fila de entrada: distribui na hora (alguém aberta), reserva
-- (ninguém aberta) ou anota a sombra. Serializa por cliente (mutex na linha de
-- config) e faz o claim atômico. Devolve um código curto para o chamador.
CREATE OR REPLACE FUNCTION public.rodizio_processar_lead(p_lead_id uuid, p_origem text, p_run uuid DEFAULT gen_random_uuid())
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  l public.crm_leads;
  cfg public.crm_rodizio_config;
  v_funil uuid; v_numero uuid; v_hoje date;
  v_ids uuid[]; v_cargas integer[]; v_abertas uuid[]; v_cargas_abertas integer[];
  v_presentes uuid[]; v_cargas_presentes integer[];
  v_pool_ids uuid[]; v_pool_cargas integer[];
  v_imediato boolean; v_alvo uuid; v_alvo_nome text; v_ok uuid;
BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id = p_lead_id;
  IF NOT FOUND OR l.tenant_id IS NULL THEN RETURN 'sem_lead'; END IF;

  -- Interruptor + mutex por cliente (solta no commit).
  SELECT * INTO cfg FROM public.crm_rodizio_config WHERE tenant_id = l.tenant_id FOR UPDATE;
  IF NOT FOUND OR cfg.modo = 'desligado' THEN RETURN 'desligado'; END IF;

  -- Relê o lead DEPOIS de ter o mutex: outra rodada pode ter tratado enquanto
  -- esta esperava.
  SELECT * INTO l FROM public.crm_leads WHERE id = p_lead_id;
  v_funil := public.rodizio_funil(l.tenant_id);
  v_numero := public.rodizio_numero_principal(l.tenant_id);
  IF NOT public.rodizio_lead_na_fila(l, cfg.gestor_user_id, v_funil, v_numero, public.rodizio_etapas_entrada(l.tenant_id)) THEN
    RETURN 'fora_da_fila';
  END IF;

  IF cfg.modo = 'sombra' AND EXISTS (
       SELECT 1 FROM public.crm_lead_atribuicoes a
        WHERE a.lead_id = l.id AND a.fase = 'sombra' AND a.motivo LIKE 'entrada:%') THEN
    RETURN 'sombra_ja_anotado';
  END IF;

  SELECT array_agg(p.user_id ORDER BY p.ordem),
         array_agg(p.carga ORDER BY p.ordem),
         array_agg(p.user_id ORDER BY p.ordem) FILTER (WHERE p.aberta),
         array_agg(p.carga ORDER BY p.ordem) FILTER (WHERE p.aberta),
         array_agg(p.user_id ORDER BY p.ordem) FILTER (WHERE p.presente),
         array_agg(p.carga ORDER BY p.ordem) FILTER (WHERE p.presente)
    INTO v_ids, v_cargas, v_abertas, v_cargas_abertas, v_presentes, v_cargas_presentes
    FROM public.rodizio_pool(l.tenant_id) p;

  IF v_ids IS NULL THEN
    v_hoje := (now() AT TIME ZONE public.rodizio_tz(l.tenant_id))::date;
    PERFORM public.rodizio_notifica(cfg.gestor_user_id, NULL,
      'Rodízio: nenhuma SDR elegível',
      'Chegou lead no funil e não há SDR ativa no rodízio (desbloqueada e ligada na aba Equipe). O lead ficou com o administrador.',
      'rodizio:sem_elegiveis:' || l.tenant_id::text || ':' || v_hoje::text);
    RETURN 'sem_elegiveis';
  END IF;

  -- Alguém presente (aberta ou pausada) → entrega na hora: abertas primeiro;
  -- só pausadas → a pausada. Ninguém presente → reserva entre todas.
  v_imediato := v_presentes IS NOT NULL;
  IF NOT v_imediato OR NOT cfg.preferir_em_expediente THEN
    v_pool_ids := v_ids; v_pool_cargas := v_cargas;
  ELSIF v_abertas IS NOT NULL THEN
    v_pool_ids := v_abertas; v_pool_cargas := v_cargas_abertas;
  ELSE
    v_pool_ids := v_presentes; v_pool_cargas := v_cargas_presentes;
  END IF;
  v_alvo := public.rodizio_escolher(v_pool_ids, v_pool_cargas, cfg.ponteiro_user_id);
  IF v_alvo IS NULL THEN RETURN 'sem_alvo'; END IF;
  v_alvo_nome := public.rodizio_nome(v_alvo);

  -- O ponteiro avança em sombra e em ligado (estado do motor, não do lead).
  UPDATE public.crm_rodizio_config SET ponteiro_user_id = v_alvo WHERE tenant_id = l.tenant_id;

  IF cfg.modo = 'sombra' THEN
    PERFORM public.rodizio_livro(l, l.assigned_to, v_alvo, 'sombra',
      'entrada: ' || p_origem || ' — '
        || CASE WHEN v_imediato THEN 'iria na hora para ' || v_alvo_nome || ' (presente)'
                ELSE 'ficaria reservado para ' || v_alvo_nome || ' (ninguém presente)' END,
      p_run);
    RETURN 'sombra';
  END IF;

  IF v_imediato THEN
    UPDATE public.crm_leads
       SET assigned_to = v_alvo, distribuido_em = now(),
           rodizio_reservado_para = NULL, rodizio_reservado_em = NULL, updated_at = now()
     WHERE id = l.id
       AND distribuido_em IS NULL AND rodizio_reservado_para IS NULL
       AND (assigned_to IS NULL OR assigned_to = cfg.gestor_user_id)
     RETURNING id INTO v_ok;
    IF v_ok IS NULL THEN RETURN 'perdeu_corrida'; END IF;
    PERFORM public.rodizio_livro(l, l.assigned_to, v_alvo, 'aplicacao',
      'entrada: ' || p_origem || ' — distribuição imediata (SDR presente)', p_run);
    PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id, '🔀 Lead distribuído para ' || v_alvo_nome || ' pelo rodízio');
    PERFORM public.rodizio_notifica(v_alvo, l.id, 'Novo lead para você',
      COALESCE(NULLIF(btrim(l.name), ''), 'Lead') || COALESCE(' · ' || NULLIF(btrim(l.phone), ''), ''));
    RETURN 'aplicado';
  END IF;

  UPDATE public.crm_leads
     SET rodizio_reservado_para = v_alvo, rodizio_reservado_em = now()
   WHERE id = l.id
     AND distribuido_em IS NULL AND rodizio_reservado_para IS NULL
     AND (assigned_to IS NULL OR assigned_to = cfg.gestor_user_id)
   RETURNING id INTO v_ok;
  IF v_ok IS NULL THEN RETURN 'perdeu_corrida'; END IF;
  PERFORM public.rodizio_livro(l, l.assigned_to, v_alvo, 'reserva',
    'entrada: ' || p_origem || ' — reservado (ninguém presente); aplica quando ela abrir o expediente', p_run);
  RETURN 'reservado';
END $fn$;

-- Aplica o lote reservado da SDR que abriu/retomou o expediente. Chamada pelo
-- gatilho em crm_ponto_eventos, por ponto_abrir (SECURITY DEFINER) e pelo
-- corte das 9h — chamar duas vezes é inofensivo: a segunda não encontra nada.
-- INTERNA: sem EXECUTE para authenticated (exposta por RPC, a SDR a chamaria
-- de casa às 7h e absorveria o lote antes do corte). Só em modo 'ligado'.
CREATE OR REPLACE FUNCTION public.rodizio_aplicar_lote_ao_abrir(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  v_tenant uuid; cfg public.crm_rodizio_config; r record; l public.crm_leads;
  v_ok uuid; v_n integer := 0; v_nome text; v_run uuid := gen_random_uuid();
  v_claim_sub text; v_claims text; v_presente boolean;
BEGIN
  IF p_user_id IS NULL THEN RETURN 0; END IF;
  SELECT p.tenant_id INTO v_tenant FROM public.profiles p
   WHERE p.id = p_user_id AND NOT COALESCE(p.is_blocked, false);
  IF v_tenant IS NULL THEN RETURN 0; END IF;
  -- Porta (a função é interna; isto é defesa em profundidade). Sem sessão =
  -- servidor (cron do corte). Com sessão: a própria SDR (via ponto_abrir) ou
  -- o gestor da equipe do MESMO cliente — v_tenant sai do perfil do alvo, e
  -- sem a checagem o gestor de um cliente aplicaria o lote de uma SDR de outro.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    IF NOT public.is_gestor_equipe() THEN
      RAISE EXCEPTION 'Só a própria SDR ou o gestor da equipe podem aplicar o lote reservado.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.has_role(auth.uid(), 'superadmin'::app_role) AND v_tenant IS DISTINCT FROM public.current_tenant_id() THEN
      RAISE EXCEPTION 'Essa SDR não é da sua clínica.' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO cfg FROM public.crm_rodizio_config WHERE tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR cfg.modo <> 'ligado' THEN RETURN 0; END IF;
  -- Quem saiu do rodízio (ou foi bloqueada) não recebe nem o que estava
  -- reservado — o corte das 9h passa essas reservas adiante.
  SELECT q.presente INTO v_presente FROM public.rodizio_pool(v_tenant) q WHERE q.user_id = p_user_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  -- Com sessão, só com o expediente aberto/pausado (o evento 'abrir' já está
  -- gravado quando o gatilho e ponto_abrir chegam aqui): a regra do dono é
  -- "reserva de quem não abriu vai para quem abriu" — sem isto a SDR puxaria
  -- o lote sem abrir o expediente e o corte das 9h não acharia nada.
  IF auth.uid() IS NOT NULL AND NOT COALESCE(v_presente, false) THEN
    RAISE EXCEPTION 'O lote reservado só é aplicado com o expediente aberto.' USING ERRCODE = '42501';
  END IF;
  v_nome := public.rodizio_nome(p_user_id);

  -- O motor é o servidor: durante os UPDATEs abaixo as claims do JWT ficam
  -- vazias (transacional) para os gatilhos trg_sdr_nao_transfere_lead /
  -- trg_sdr_nao_altera_distribuicao não recusarem a entrega à própria SDR.
  -- Restauradas antes de sair; em erro, o bloco EXCEPTION reverte o savepoint
  -- (e com ele o set_config).
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);

    FOR r IN
      SELECT x.id FROM public.crm_leads x
       WHERE x.tenant_id = v_tenant AND x.rodizio_reservado_para = p_user_id AND x.distribuido_em IS NULL
       ORDER BY x.rodizio_reservado_em NULLS FIRST, x.created_at
    LOOP
      SELECT * INTO l FROM public.crm_leads WHERE id = r.id;
      v_ok := NULL;
      UPDATE public.crm_leads
         SET assigned_to = p_user_id, distribuido_em = now(),
             rodizio_reservado_para = NULL, rodizio_reservado_em = NULL, updated_at = now()
       WHERE id = r.id
         AND distribuido_em IS NULL AND rodizio_reservado_para = p_user_id
         AND (assigned_to IS NULL OR assigned_to = cfg.gestor_user_id)
         AND NOT COALESCE(is_blocked, false)
       RETURNING id INTO v_ok;
      IF v_ok IS NULL THEN
        -- Reserva órfã (dono mudou por fora / lead bloqueado): solta sem mover.
        UPDATE public.crm_leads SET rodizio_reservado_para = NULL, rodizio_reservado_em = NULL
         WHERE id = r.id AND distribuido_em IS NULL;
        PERFORM public.rodizio_livro(l, p_user_id, NULL, 'saneamento',
          'reserva descartada ao aplicar o lote: o lead já não estava com o administrador (ou está bloqueado)', v_run);
        CONTINUE;
      END IF;
      v_n := v_n + 1;
      PERFORM public.rodizio_livro(l, l.assigned_to, p_user_id, 'aplicacao',
        'lote reservado aplicado ao abrir o expediente', v_run);
      PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
        '🔀 Lead entregue a ' || v_nome || ' (reserva aplicada ao abrir o expediente)');
    END LOOP;

    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_claim_sub, ''), true);
    PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_claim_sub, ''), true);
    PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
    RAISE;
  END;

  IF v_n > 0 THEN
    PERFORM public.rodizio_notifica(p_user_id, NULL, 'Leads reservados aplicados',
      'Você recebeu ' || v_n || ' lead(s) que estavam reservados para você.');
  END IF;
  RETURN v_n;
END $fn$;

-- Varredura de segurança (cron, 5 min): leads que foram CRIADOS ou MANDARAM
-- MENSAGEM (last_inbound_at) depois da última troca de modo e nos últimos 2
-- dias e ainda estão na fila (o gatilho de lead novo OU o de mensagem não
-- conseguiu a trava, ou não havia SDR elegível na hora). Nunca olha o acervo
-- anterior à troca de modo: lead antigo sem mensagem nova continua onde está.
CREATE OR REPLACE FUNCTION public.rodizio_processar_novos()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE c record; r record; v_funil uuid; v_numero uuid; v_etapas uuid[]; v_n integer := 0; v_run uuid := gen_random_uuid(); v_res text;
BEGIN
  FOR c IN SELECT k.tenant_id, k.modo, k.modo_alterado_em, k.gestor_user_id
             FROM public.crm_rodizio_config k WHERE k.modo <> 'desligado'
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtext('rodizio:novos:' || c.tenant_id::text)) THEN CONTINUE; END IF;
    v_funil := public.rodizio_funil(c.tenant_id);
    v_numero := public.rodizio_numero_principal(c.tenant_id);
    v_etapas := public.rodizio_etapas_entrada(c.tenant_id);
    IF v_funil IS NULL OR v_etapas IS NULL OR c.modo_alterado_em IS NULL THEN CONTINUE; END IF;
    FOR r IN
      SELECT l.id
        FROM public.crm_leads l
       WHERE l.tenant_id = c.tenant_id
         AND l.pipeline_id = v_funil
         -- criado OU com mensagem recebida depois da troca de modo, nos
         -- últimos 2 dias (o caminho da mensagem também pode falhar por trava)
         AND GREATEST(l.created_at, COALESCE(l.last_inbound_at, l.created_at))
             >= GREATEST(c.modo_alterado_em, now() - interval '2 days')
         AND l.distribuido_em IS NULL
         AND l.rodizio_reservado_para IS NULL
         AND (l.assigned_to IS NULL OR l.assigned_to = c.gestor_user_id)
         -- a régua única (etapa de entrada, sem agendamento, conversa aberta,
         -- origem, número, Instagram, bloqueio) — a mesma dos gatilhos
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

-- Corte das 9h (cron, 5 min): dentro de [hora_corte, corte_ate] local, em dia
-- útil, modo 'ligado'. "Abriu" = presente (aberta ou pausada). (1) quem abriu
-- recebe o que é dela (idempotente); (2) reservas de quem NÃO abriu vão para
-- quem abriu, "menos leads no ciclo" (abertas antes das pausadas); ninguém
-- presente → nada se move e o gestor recebe UM aviso por dia.
CREATE OR REPLACE FUNCTION public.rodizio_corte_9h()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  c record; cfg public.crm_rodizio_config; r record; l public.crm_leads; u uuid;
  v_tz text; v_local timestamp; v_hoje date; v_pend integer;
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
    IF v_local::time < cfg.hora_corte OR v_local::time > cfg.corte_ate THEN CONTINUE; END IF;

    SELECT count(*) INTO v_pend FROM public.crm_leads x
     WHERE x.tenant_id = c.tenant_id AND x.rodizio_reservado_para IS NOT NULL AND x.distribuido_em IS NULL;
    IF v_pend = 0 THEN CONTINUE; END IF;

    SELECT array_agg(p.user_id ORDER BY p.ordem) FILTER (WHERE p.presente) INTO v_abertas
      FROM public.rodizio_pool(c.tenant_id) p;
    IF v_abertas IS NULL THEN
      PERFORM public.rodizio_notifica(cfg.gestor_user_id, NULL,
        'Rodízio: ninguém abriu o expediente',
        'Há ' || v_pend || ' lead(s) reservados e nenhuma SDR abriu o expediente até '
          || to_char(v_local, 'HH24:MI') || '. Nada foi movido; o corte tenta de novo a cada 5 minutos até '
          || to_char(cfg.corte_ate, 'HH24:MI') || '.',
        'rodizio:corte_sem_aberta:' || c.tenant_id::text || ':' || v_hoje::text);
      CONTINUE;
    END IF;

    -- (1) quem abriu recebe o que é dela.
    FOREACH u IN ARRAY v_abertas LOOP
      v_n := v_n + public.rodizio_aplicar_lote_ao_abrir(u);
    END LOOP;

    -- (2) reservas de quem não abriu → quem abriu.
    v_por_alvo := '{}'::jsonb;
    FOR r IN
      SELECT x.id, x.rodizio_reservado_para AS reservada
        FROM public.crm_leads x
       WHERE x.tenant_id = c.tenant_id
         AND x.rodizio_reservado_para IS NOT NULL
         AND x.distribuido_em IS NULL
         AND NOT (x.rodizio_reservado_para = ANY (v_abertas))
       ORDER BY x.rodizio_reservado_em NULLS FIRST, x.created_at
    LOOP
      SELECT array_agg(p.user_id ORDER BY p.ordem), array_agg(p.carga ORDER BY p.ordem)
        INTO v_ids, v_cargas
        FROM public.rodizio_pool(c.tenant_id) p WHERE p.aberta;
      IF v_ids IS NULL THEN
        SELECT array_agg(p.user_id ORDER BY p.ordem), array_agg(p.carga ORDER BY p.ordem)
          INTO v_ids, v_cargas
          FROM public.rodizio_pool(c.tenant_id) p WHERE p.presente;
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
         AND distribuido_em IS NULL AND rodizio_reservado_para = r.reservada
         AND (assigned_to IS NULL OR assigned_to = cfg.gestor_user_id)
         AND NOT COALESCE(is_blocked, false)
       RETURNING id INTO v_ok;
      IF v_ok IS NULL THEN
        UPDATE public.crm_leads SET rodizio_reservado_para = NULL, rodizio_reservado_em = NULL
         WHERE id = r.id AND distribuido_em IS NULL;
        PERFORM public.rodizio_livro(l, r.reservada, NULL, 'saneamento',
          'reserva descartada no corte: o lead já não estava com o administrador (ou está bloqueado)', v_run);
        CONTINUE;
      END IF;
      UPDATE public.crm_rodizio_config SET ponteiro_user_id = v_alvo WHERE tenant_id = c.tenant_id;
      PERFORM public.rodizio_livro(l, r.reservada, v_alvo, 'corte_9h',
        'corte das ' || to_char(cfg.hora_corte, 'HH24:MI') || ': estava reservado para '
          || public.rodizio_nome(r.reservada) || ', que não abriu o expediente', v_run);
      PERFORM public.rodizio_msg_sistema(l.id, l.tenant_id,
        '🔀 Lead entregue a ' || public.rodizio_nome(v_alvo) || ' no corte das '
          || to_char(cfg.hora_corte, 'HH24:MI') || ' (estava reservado para '
          || public.rodizio_nome(r.reservada) || ', que não abriu o expediente)');
      v_k := v_alvo::text;
      v_por_alvo := v_por_alvo || jsonb_build_object(v_k, COALESCE((v_por_alvo ->> v_k)::integer, 0) + 1);
      v_n := v_n + 1;
    END LOOP;

    FOR v_k IN SELECT j.key FROM jsonb_each(v_por_alvo) j LOOP
      PERFORM public.rodizio_notifica(v_k::uuid, NULL,
        'Corte das ' || to_char(cfg.hora_corte, 'HH24:MI'),
        'Você recebeu ' || (v_por_alvo ->> v_k) || ' lead(s) reservados para colegas que não abriram o expediente.');
    END LOOP;
  END LOOP;
  RETURN v_n;
END $fn$;

-- Realocação por silêncio (cron, 5 min): em horário comercial do cliente, lead
-- entregue pelo rodízio E AINDA NA FILA DE ENTRADA (etapa de entrada e sem
-- agendamento não cancelado — os mesmos predicados de rodizio_lead_na_fila;
-- lead agendado é da recepção/closer e não volta a girar) cuja última
-- mensagem é do lead há mais de realocar_sem_resposta_min sem resposta HUMANA
-- (rodizio_msg_humana: sender_id/from_device, ligação, ou conteúdo que não é
-- bot/template/espera/sistema) vai para uma SDR aberta (menos leads no ciclo,
-- nunca a própria dona; se só houver pausadas, para uma pausada).
-- TETO: uma realocação por lead por dia da clínica (linha 'realocacao_1h' de
-- hoje no livro; em sombra, anotação 'realocação:' de hoje) — sem isso o mesmo
-- lead giraria a cada hora entre as SDRs (pingue-pongue).
-- CONVERSA FECHADA não é filtro: fechar só tira o lead da realocação quando
-- houve resposta humana ao último inbound, que é exatamente o NOT EXISTS
-- abaixo — fechar sem responder não livra a dona. Mensagem nova do lead reabre
-- a conversa (gatilho da Fase 2) e zera o relógio como qualquer inbound; a
-- realocação não mexe em conversa_fechada_em (o claim exige o valor lido).
-- Em SOMBRA a dona é VIRTUAL — a para_user_id da última anotação de sombra do
-- lead (entrada ou realocação) e o relógio começa nessa anotação —, o lead
-- continua com o administrador e só o livro recebe 'realocação: …'.
CREATE OR REPLACE FUNCTION public.rodizio_realocar_sem_resposta()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  c record; cfg public.crm_rodizio_config; r record; l public.crm_leads;
  v_funil uuid; v_etapas uuid[]; v_tz text; v_ini timestamptz; v_limite interval;
  v_ids uuid[]; v_cargas integer[]; v_ponteiro uuid; v_alvo uuid; v_ok uuid;
  v_n integer := 0; v_run uuid := gen_random_uuid(); v_min integer; v_de_nome text; v_para_nome text;
BEGIN
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
             AND NOT EXISTS (SELECT 1 FROM public.crm_appointments a
                              WHERE a.lead_id = l0.id AND COALESCE(a.status, '') <> 'cancelled')
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
             AND NOT EXISTS (SELECT 1 FROM public.crm_appointments a
                              WHERE a.lead_id = l0.id AND COALESCE(a.status, '') <> 'cancelled')
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

-- Distribuição inicial dos leads que JÁ existem: só os que estão aguardando
-- resposta agora (última mensagem é do lead). p_dry_run = true lista o que
-- aconteceria, simulando a rodada inteira (cargas e ponteiro em memória) sem
-- escrever nada; false exige modo 'ligado' e trata cada um como lead novo.
-- Porta: gestor da equipe (JWT) ou servidor (auth.uid() NULL, com p_tenant).
CREATE OR REPLACE FUNCTION public.rodizio_distribuir_sem_resposta_agora(p_dry_run boolean DEFAULT true, p_tenant uuid DEFAULT NULL)
RETURNS TABLE(lead_id uuid, lead_nome text, lead_telefone text, etapa text, ultima_mensagem_em timestamptz,
              acao text, para_user_id uuid, para_nome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  v_tenant uuid; cfg public.crm_rodizio_config; v_funil uuid; v_numero uuid; v_etapas uuid[]; r record; l public.crm_leads;
  v_ids uuid[]; v_cargas integer[]; v_abertas uuid[]; v_cargas_abertas integer[];
  v_presentes uuid[]; v_cargas_presentes integer[];
  v_pool_ids uuid[]; v_pool_cargas integer[]; v_ponteiro uuid; v_alvo uuid; v_imediato boolean;
  v_res text; v_run uuid := gen_random_uuid(); i integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_gestor_equipe() THEN
      RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
    END IF;
    IF public.has_role(auth.uid(), 'superadmin'::app_role) THEN
      v_tenant := COALESCE(p_tenant, public.current_tenant_id());
    ELSE
      v_tenant := public.current_tenant_id();
    END IF;
  ELSE
    v_tenant := p_tenant;
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Informe o cliente (p_tenant) ao chamar sem sessão.' USING ERRCODE = '22023';
  END IF;

  IF p_dry_run THEN
    SELECT * INTO cfg FROM public.crm_rodizio_config WHERE tenant_id = v_tenant;
  ELSE
    SELECT * INTO cfg FROM public.crm_rodizio_config WHERE tenant_id = v_tenant FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rodízio não configurado para este cliente.' USING ERRCODE = '22023';
  END IF;
  IF NOT p_dry_run AND cfg.modo <> 'ligado' THEN
    RAISE EXCEPTION 'O motor do rodízio não está ligado (modo atual: %). Ligue antes de distribuir.', cfg.modo
      USING ERRCODE = '55000';
  END IF;
  v_funil := public.rodizio_funil(v_tenant);
  v_numero := public.rodizio_numero_principal(v_tenant);
  v_etapas := public.rodizio_etapas_entrada(v_tenant);

  SELECT array_agg(p.user_id ORDER BY p.ordem),
         array_agg(p.carga ORDER BY p.ordem),
         array_agg(p.user_id ORDER BY p.ordem) FILTER (WHERE p.aberta),
         array_agg(p.carga ORDER BY p.ordem) FILTER (WHERE p.aberta),
         array_agg(p.user_id ORDER BY p.ordem) FILTER (WHERE p.presente),
         array_agg(p.carga ORDER BY p.ordem) FILTER (WHERE p.presente)
    INTO v_ids, v_cargas, v_abertas, v_cargas_abertas, v_presentes, v_cargas_presentes
    FROM public.rodizio_pool(v_tenant) p;
  v_ponteiro := cfg.ponteiro_user_id;

  FOR r IN
    SELECT l0.id, l0.name, l0.phone, s.name AS etapa_nome, l0.last_inbound_at
      FROM public.crm_leads l0
      LEFT JOIN public.crm_stages s ON s.id = l0.stage_id
     WHERE l0.tenant_id = v_tenant
       AND v_funil IS NOT NULL AND l0.pipeline_id = v_funil
       AND l0.distribuido_em IS NULL
       AND l0.rodizio_reservado_para IS NULL
       AND (l0.assigned_to IS NULL OR (cfg.gestor_user_id IS NOT NULL AND l0.assigned_to = cfg.gestor_user_id))
       -- a régua única (etapa de entrada, sem agendamento, conversa aberta,
       -- origem, número, Instagram, bloqueio) — a mesma dos gatilhos
       AND public.rodizio_lead_na_fila(l0, cfg.gestor_user_id, v_funil, v_numero, v_etapas)
       AND l0.last_inbound_at IS NOT NULL
       AND l0.last_inbound_at > COALESCE(l0.last_outbound_at, '-infinity'::timestamptz)
     ORDER BY l0.last_inbound_at
  LOOP
    lead_id := r.id; lead_nome := r.name; lead_telefone := r.phone;
    etapa := r.etapa_nome; ultima_mensagem_em := r.last_inbound_at;
    para_user_id := NULL; para_nome := NULL;

    IF v_ids IS NULL THEN
      acao := 'sem SDR elegível — fica com o administrador';
      RETURN NEXT; CONTINUE;
    END IF;

    IF p_dry_run THEN
      v_imediato := v_presentes IS NOT NULL;
      IF NOT v_imediato OR NOT cfg.preferir_em_expediente THEN
        v_pool_ids := v_ids; v_pool_cargas := v_cargas;
      ELSIF v_abertas IS NOT NULL THEN
        v_pool_ids := v_abertas; v_pool_cargas := v_cargas_abertas;
      ELSE
        v_pool_ids := v_presentes; v_pool_cargas := v_cargas_presentes;
      END IF;
      v_alvo := public.rodizio_escolher(v_pool_ids, v_pool_cargas, v_ponteiro);
      FOR i IN 1..COALESCE(array_length(v_ids, 1), 0) LOOP
        IF v_ids[i] = v_alvo THEN v_cargas[i] := v_cargas[i] + 1; END IF;
      END LOOP;
      FOR i IN 1..COALESCE(array_length(v_abertas, 1), 0) LOOP
        IF v_abertas[i] = v_alvo THEN v_cargas_abertas[i] := v_cargas_abertas[i] + 1; END IF;
      END LOOP;
      FOR i IN 1..COALESCE(array_length(v_presentes, 1), 0) LOOP
        IF v_presentes[i] = v_alvo THEN v_cargas_presentes[i] := v_cargas_presentes[i] + 1; END IF;
      END LOOP;
      v_ponteiro := v_alvo;
      para_user_id := v_alvo; para_nome := public.rodizio_nome(v_alvo);
      acao := CASE WHEN cfg.modo = 'ligado' THEN 'simulação: ' ELSE 'simulação (modo ' || cfg.modo || '): ' END
           || CASE WHEN v_imediato THEN 'iria na hora para ' || para_nome || ' (presente)'
                   ELSE 'ficaria reservado para ' || para_nome || ' (ninguém presente)' END;
      RETURN NEXT; CONTINUE;
    END IF;

    v_res := public.rodizio_processar_lead(r.id, 'distribuição inicial (aguardando resposta)', v_run);
    SELECT * INTO l FROM public.crm_leads WHERE id = r.id;
    para_user_id := COALESCE(l.rodizio_reservado_para, CASE WHEN v_res = 'aplicado' THEN l.assigned_to END);
    para_nome := CASE WHEN para_user_id IS NOT NULL THEN public.rodizio_nome(para_user_id) END;
    acao := CASE v_res
              WHEN 'aplicado'  THEN 'distribuído para ' || para_nome
              WHEN 'reservado' THEN 'reservado para ' || para_nome || ' (ninguém presente)'
              ELSE v_res END;
    RETURN NEXT;
  END LOOP;
END $fn$;

-- O interruptor, pela porta do gestor da equipe (a mesma das RPCs equipe_*).
-- Devolve o modo e quantas SDRs estão elegíveis/abertas — para a tela avisar
-- "ligou sem ninguém no rodízio". Vai para access_logs.
CREATE OR REPLACE FUNCTION public.rodizio_definir_modo(p_modo text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id(); v_antes text; v_eleg integer; v_abertas integer;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sem cliente ativo.' USING ERRCODE = '42501';
  END IF;
  IF p_modo IS NULL OR p_modo NOT IN ('desligado', 'sombra', 'ligado') THEN
    RAISE EXCEPTION 'Modo inválido: use desligado, sombra ou ligado.' USING ERRCODE = '22023';
  END IF;
  SELECT k.modo INTO v_antes FROM public.crm_rodizio_config k WHERE k.tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rodízio não configurado para este cliente.' USING ERRCODE = '22023';
  END IF;
  IF v_antes IS DISTINCT FROM p_modo THEN
    UPDATE public.crm_rodizio_config SET modo = p_modo WHERE tenant_id = v_tenant;
    INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
    VALUES (auth.uid(), v_tenant, 'tenant', 'rodizio_modo', jsonb_build_object('de', v_antes, 'para', p_modo));
  END IF;
  SELECT count(*), count(*) FILTER (WHERE p.aberta) INTO v_eleg, v_abertas FROM public.rodizio_pool(v_tenant) p;
  RETURN jsonb_build_object('modo', p_modo, 'modo_anterior', v_antes, 'elegiveis', v_eleg, 'abertas', v_abertas);
END $fn$;

-- Painel do motor para o gestor (só leitura): modo, régua, quem está aberta,
-- carga e reservas pendentes. Zero SDRs → equipe = [].
CREATE OR REPLACE FUNCTION public.rodizio_estado()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id(); cfg public.crm_rodizio_config; v_tz text; v_local timestamp; v_reservas integer;
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
  RETURN jsonb_build_object(
    'modo', cfg.modo,
    'modo_alterado_em', cfg.modo_alterado_em,
    'ponteiro_user_id', cfg.ponteiro_user_id,
    'preferir_em_expediente', cfg.preferir_em_expediente,
    'realocar_sem_resposta_min', cfg.realocar_sem_resposta_min,
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
    -- reserva só se aplica/corta em modo ligado; fora dele fica congelada
    'reservas_aviso', CASE WHEN cfg.modo <> 'ligado' AND v_reservas > 0
                           THEN 'Há ' || v_reservas || ' reserva(s) pendente(s) com o motor em modo ' || cfg.modo
                                || ': reservas só se aplicam em modo ligado.' END,
    'equipe', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', p.user_id, 'nome', p.nome, 'estado', p.estado, 'aberta', p.aberta, 'carga', p.carga,
               'reservas', (SELECT count(*) FROM public.crm_leads x
                             WHERE x.tenant_id = v_tenant AND x.rodizio_reservado_para = p.user_id AND x.distribuido_em IS NULL))
             ORDER BY p.ordem)
        FROM public.rodizio_pool(v_tenant) p), '[]'::jsonb));
END $fn$;

-- ============================================================ 5. gatilhos
-- Lead novo (todo caminho de entrada). AFTER INSERT: o lead já existe com o dono
-- padrão do webhook; o motor sobrescreve. Nunca falha o INSERT.
CREATE OR REPLACE FUNCTION public.rodizio_on_lead_novo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE v_modo text; v_admin uuid;
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;
  SELECT k.modo, k.gestor_user_id INTO v_modo, v_admin FROM public.crm_rodizio_config k WHERE k.tenant_id = NEW.tenant_id;
  IF v_modo IS NULL OR v_modo = 'desligado' THEN RETURN NEW; END IF;
  -- Régua da fila avaliada ANTES do mutex: lead de outro funil, de origem
  -- excluída ou com outra dona não trava nada (o motor confere de novo dentro).
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

DROP TRIGGER IF EXISTS trg_zz_rodizio_lead_novo ON public.crm_leads;
CREATE TRIGGER trg_zz_rodizio_lead_novo
  AFTER INSERT ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.rodizio_on_lead_novo();

-- Mensagem recebida: lead do administrador (sem dona) que mandou mensagem vira
-- lead novo. Quase toda mensagem sai no pré-filtro (motor desligado, lead já
-- distribuído, reservado, de outro funil, de outra etapa ou de outra dona)
-- sem tocar no mutex. O modo é lido ANTES de carregar o lead (o caminho
-- quente do whatsapp-webhook, para todos os papéis, não paga a linha do lead
-- com o motor desligado). Resposta a template (button/interactive) e nota
-- numérica de pesquisa pendente não são "o lead mandou mensagem".
CREATE OR REPLACE FUNCTION public.rodizio_on_mensagem()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE v_tenant uuid; v_modo text; v_admin uuid; l public.crm_leads;
BEGIN
  IF NEW.direction <> 'inbound' OR NEW.lead_id IS NULL OR NEW.instagram_comment_id IS NOT NULL
     OR NEW.type IN ('button', 'interactive') THEN
    RETURN NEW;
  END IF;
  v_tenant := COALESCE(NEW.tenant_id, (SELECT x.tenant_id FROM public.crm_leads x WHERE x.id = NEW.lead_id));
  IF v_tenant IS NULL THEN RETURN NEW; END IF;
  SELECT k.modo, k.gestor_user_id INTO v_modo, v_admin FROM public.crm_rodizio_config k WHERE k.tenant_id = v_tenant;
  IF v_modo IS NULL OR v_modo = 'desligado' THEN RETURN NEW; END IF;
  SELECT * INTO l FROM public.crm_leads x WHERE x.id = NEW.lead_id;
  IF NOT FOUND OR l.tenant_id IS NULL THEN RETURN NEW; END IF;
  -- Régua da fila avaliada ANTES do mutex (lead já distribuído/reservado, de
  -- outro funil/etapa, de origem excluída ou de outra dona sai aqui, sem travar).
  IF NOT public.rodizio_lead_na_fila(l, v_admin, public.rodizio_funil(l.tenant_id),
                                     public.rodizio_numero_principal(l.tenant_id), public.rodizio_etapas_entrada(l.tenant_id)) THEN
    RETURN NEW;
  END IF;
  -- Nota da pesquisa de satisfação pendente (só um número, até 7 dias): é a
  -- resposta da pesquisa, não conversa nova — o mesmo teste do gatilho
  -- conversa_reabre_ao_receber (20260909100100), que roda antes deste.
  IF COALESCE(NEW.type, 'text') = 'text'
     AND COALESCE(NEW.content, '') ~ '^\s*\d{1,2}\s*[.!]?\s*$'
     AND EXISTS (SELECT 1 FROM public.crm_pesquisa_respostas pr
                  WHERE pr.lead_id = NEW.lead_id
                    AND pr.respondida_em IS NULL AND pr.nota IS NULL
                    AND pr.enviada_em >= now() - interval '7 days') THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM public.rodizio_processar_lead(NEW.lead_id, 'mensagem recebida em lead do administrador');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rodizio_on_mensagem: lead % não distribuído (%): %', NEW.lead_id, SQLSTATE, SQLERRM;
  END;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_zz_rodizio_mensagem ON public.messages;
CREATE TRIGGER trg_zz_rodizio_mensagem
  AFTER INSERT ON public.messages
  FOR EACH ROW WHEN (NEW.direction = 'inbound')
  EXECUTE FUNCTION public.rodizio_on_mensagem();

-- Abrir/retomar o expediente aplica o lote reservado. Nunca falha o INSERT do
-- ponto: erro vira WARNING e o corte das 9h/cron cobre depois.
CREATE OR REPLACE FUNCTION public.rodizio_on_ponto_abrir()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
BEGIN
  IF NEW.tipo NOT IN ('abrir', 'retomar') THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.rodizio_aplicar_lote_ao_abrir(NEW.user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rodizio_on_ponto_abrir: lote de % não aplicado (%): %', NEW.user_id, SQLSTATE, SQLERRM;
  END;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_zz_rodizio_ponto_abrir ON public.crm_ponto_eventos;
CREATE TRIGGER trg_zz_rodizio_ponto_abrir
  AFTER INSERT ON public.crm_ponto_eventos
  FOR EACH ROW WHEN (NEW.tipo IN ('abrir', 'retomar'))
  EXECUTE FUNCTION public.rodizio_on_ponto_abrir();

-- Dono trocado por fora (transfer-lead, crc, admin-api). Dois efeitos:
--   (1) reserva pendente cai e o livro registra (o próprio motor limpa a
--       reserva no mesmo UPDATE, então aqui só entra troca alheia ao rodízio);
--   (2) lead JÁ DISTRIBUÍDO devolvido ao administrador (ou deixado sem dona)
--       tem distribuido_em zerado e VOLTA À FILA de entrada — sem isso nada
--       zerava a coluna e devolver = sair do rodízio para sempre (o motor só
--       entrega distribuido_em IS NULL; transfer-lead só carimba ao dar a uma
--       SDR). Só quando há configuração do rodízio no cliente.
-- Roda DEPOIS de trg_sdr_nao_transfere_lead (ordem alfabética): se aquele
-- recusar, nada disto acontece. trg_sdr_nao_altera_distribuicao é "OF
-- distribuido_em" e não dispara pelo que este gatilho muda em NEW.
CREATE OR REPLACE FUNCTION public.rodizio_limpa_reserva()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_admin uuid; v_tem_cfg boolean := false;
BEGIN
  IF NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN RETURN NEW; END IF;
  IF NEW.rodizio_reservado_para IS NOT NULL
     AND NEW.rodizio_reservado_para IS NOT DISTINCT FROM OLD.rodizio_reservado_para THEN
    INSERT INTO public.crm_lead_atribuicoes
      (tenant_id, lead_id, lead_nome, lead_telefone, de_user_id, para_user_id, fase, motivo, criado_por)
    VALUES (NEW.tenant_id, NEW.id, NEW.name, NEW.phone, NEW.rodizio_reservado_para, NULL, 'saneamento',
            'reserva cancelada: o dono do lead foi alterado fora do rodízio', auth.uid());
    NEW.rodizio_reservado_para := NULL;
    NEW.rodizio_reservado_em := NULL;
  END IF;
  IF OLD.distribuido_em IS NOT NULL AND NEW.distribuido_em IS NOT DISTINCT FROM OLD.distribuido_em THEN
    SELECT true, k.gestor_user_id INTO v_tem_cfg, v_admin
      FROM public.crm_rodizio_config k WHERE k.tenant_id = NEW.tenant_id;
    IF v_tem_cfg AND (NEW.assigned_to IS NULL OR (v_admin IS NOT NULL AND NEW.assigned_to = v_admin)) THEN
      INSERT INTO public.crm_lead_atribuicoes
        (tenant_id, lead_id, lead_nome, lead_telefone, de_user_id, para_user_id, fase, motivo, criado_por)
      VALUES (NEW.tenant_id, NEW.id, NEW.name, NEW.phone, OLD.assigned_to, NEW.assigned_to, 'saneamento',
              'devolvido ao administrador: sai da posse da SDR e volta à fila de entrada do rodízio', auth.uid());
      NEW.distribuido_em := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_zz_rodizio_limpa_reserva ON public.crm_leads;
CREATE TRIGGER trg_zz_rodizio_limpa_reserva
  BEFORE UPDATE OF assigned_to ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.rodizio_limpa_reserva();

-- Configuração: carimba modo_alterado_em/updated_at; sair de 'ligado' (para
-- 'desligado' OU 'sombra') cancela a fila de reservas — em sombra nada aplica
-- nem corta reserva, e reserva congelada some do teste do dono. Nenhum lead
-- muda de dono (assigned_to continua o administrador). Mover só o ponteiro
-- não toca updated_at.
CREATE OR REPLACE FUNCTION public.rodizio_config_carimba()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE r record;
BEGIN
  IF NEW.modo IS DISTINCT FROM OLD.modo THEN
    NEW.modo_alterado_em := now();
    NEW.updated_at := now();
    IF NEW.modo IN ('desligado', 'sombra') THEN
      FOR r IN
        SELECT x.id, x.tenant_id, x.name, x.phone, x.rodizio_reservado_para
          FROM public.crm_leads x
         WHERE x.tenant_id = NEW.tenant_id AND x.rodizio_reservado_para IS NOT NULL AND x.distribuido_em IS NULL
      LOOP
        INSERT INTO public.crm_lead_atribuicoes
          (tenant_id, lead_id, lead_nome, lead_telefone, de_user_id, para_user_id, fase, motivo, criado_por)
        VALUES (r.tenant_id, r.id, r.name, r.phone, r.rodizio_reservado_para, NULL, 'saneamento',
                CASE WHEN NEW.modo = 'desligado' THEN 'reserva cancelada: motor desligado'
                     ELSE 'reserva cancelada: motor em sombra (reserva só se aplica em modo ligado)' END,
                auth.uid());
      END LOOP;
      UPDATE public.crm_leads SET rodizio_reservado_para = NULL, rodizio_reservado_em = NULL
       WHERE tenant_id = NEW.tenant_id AND rodizio_reservado_para IS NOT NULL AND distribuido_em IS NULL;
    END IF;
  ELSIF (to_jsonb(NEW) - 'ponteiro_user_id' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'ponteiro_user_id' - 'updated_at') THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_rodizio_config_carimba ON public.crm_rodizio_config;
CREATE TRIGGER trg_rodizio_config_carimba
  BEFORE UPDATE ON public.crm_rodizio_config
  FOR EACH ROW EXECUTE FUNCTION public.rodizio_config_carimba();

-- ============================================================ 5b. policy: o livro não vaza lead que não é da SDR
-- Em sombra, reserva e corte o livro grava nome/telefone/id de leads que a SDR
-- NÃO recebeu (para_user_id = ela em sombra/reserva; de_user_id = ela no corte)
-- e a permissiva atribuicoes_le_gestao (Fase 0) libera SELECT por
-- de_user_id/para_user_id = auth.uid(). Esta RESTRICTIVE fecha: a SDR só lê
-- linhas de lead que é dela HOJE (sdr_pode_ver_lead) — o mesmo cerco das
-- demais tabelas-filhas da Fase 1. crc/gerente/superadmin: inalterados.
DROP POLICY IF EXISTS sdr_escopo_crm_lead_atribuicoes ON public.crm_lead_atribuicoes;
CREATE POLICY sdr_escopo_crm_lead_atribuicoes ON public.crm_lead_atribuicoes
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR public.sdr_pode_ver_lead(lead_id));

-- ============================================================ 6. portas
-- Internas e de cron: ninguém chama por RPC (SECURITY DEFINER nasce com EXECUTE
-- para PUBLIC — fechado aqui). Funções de gatilho não são chamáveis por RPC.
REVOKE ALL ON FUNCTION public.rodizio_tz(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_feriado(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_dia_util(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_em_expediente(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_funil(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_numero_principal(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_fonte_excluida(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_msg_humana(public.messages) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_etapas_entrada(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_lead_na_fila(public.crm_leads, uuid, uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_pool(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_escolher(uuid[], integer[], uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_nome(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_livro(public.crm_leads, uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_msg_sistema(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_notifica(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_processar_lead(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_processar_novos() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_corte_9h() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rodizio_realocar_sem_resposta() FROM PUBLIC, anon, authenticated;

-- Interna também: ponto_abrir (SECURITY DEFINER), o gatilho do ponto e o corte
-- das 9h a chamam como dono. Exposta por RPC, a SDR a chamaria de casa às 7h
-- e o gestor de um cliente aplicaria o lote de uma SDR de outro.
REVOKE ALL ON FUNCTION public.rodizio_aplicar_lote_ao_abrir(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rodizio_aplicar_lote_ao_abrir(uuid) TO service_role;

-- Chamáveis com sessão (porta checada dentro de cada uma).
REVOKE ALL ON FUNCTION public.rodizio_distribuir_sem_resposta_agora(boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rodizio_distribuir_sem_resposta_agora(boolean, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.rodizio_definir_modo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rodizio_definir_modo(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.rodizio_estado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rodizio_estado() TO authenticated, service_role;

-- ============================================================ 7. crons (idempotentes)
-- cron.unschedule(text) levanta erro se o job não existe: por isso o IF.
DO $do$
DECLARE v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'rodizio-processar-novos';
  IF v_id IS NOT NULL THEN PERFORM cron.unschedule(v_id); END IF;
  PERFORM cron.schedule('rodizio-processar-novos', '*/5 * * * *',
    $cmd$SELECT public.rodizio_processar_novos();$cmd$);

  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'rodizio-corte-9h';
  IF v_id IS NOT NULL THEN PERFORM cron.unschedule(v_id); END IF;
  PERFORM cron.schedule('rodizio-corte-9h', '1,6,11,16,21,26,31,36,41,46,51,56 * * * *',
    $cmd$SELECT public.rodizio_corte_9h();$cmd$);

  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'rodizio-realocacao';
  IF v_id IS NOT NULL THEN PERFORM cron.unschedule(v_id); END IF;
  PERFORM cron.schedule('rodizio-realocacao', '2,7,12,17,22,27,32,37,42,47,52,57 * * * *',
    $cmd$SELECT public.rodizio_realocar_sem_resposta();$cmd$);
END
$do$;

-- ============================================================ VERIFICAÇÃO (rodar à mão, só leitura)
-- Números de base em 08/09/2026 22:15 UTC: leads do tenant 9.404 · do admin
-- (d9b27aa3) 7.641 · sem dona 1.344 · Funil Principal 3.502 · distribuido_em
-- preenchido 0 · livro 17 linhas (só 'saneamento') · crm_ponto_eventos 0.
--
-- (0) Objetos no lugar:
--   SELECT modo, modo_alterado_em, funil_id, ponteiro_user_id FROM public.crm_rodizio_config;
--     -- desligado | NULL | a1b2c3d4-0001-… | NULL
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname LIKE 'rodizio_%';                       -- 29
--   SELECT tgname, tgrelid::regclass FROM pg_trigger
--    WHERE NOT tgisinternal AND (tgname LIKE 'trg_zz_rodizio_%' OR tgname='trg_rodizio_config_carimba')
--    ORDER BY 1;                                                                    -- 5
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'rodizio-%';  -- 3, active
--   SELECT has_function_privilege('authenticated','public.rodizio_processar_lead(uuid,text,uuid)','EXECUTE'); -- false
--   SELECT has_function_privilege('authenticated','public.rodizio_definir_modo(text)','EXECUTE');            -- true
--   SELECT has_function_privilege('authenticated','public.rodizio_aplicar_lote_ao_abrir(uuid)','EXECUTE');   -- false
--   SELECT etapas_entrada FROM public.crm_rodizio_config;   -- 5 uuids (Novo Lead … Recuperado)
--   SELECT s.name FROM public.crm_stages s WHERE s.id = ANY (public.rodizio_etapas_entrada('00000000-0000-0000-0000-000000000010'));
--   -- nenhuma policy EXISTENTE foi tocada: o hash das 589 policies (512 antigas
--   -- + 77 sdr_) continua o mesmo de antes, excluindo a única nova:
--   SELECT md5(string_agg(tablename||'|'||policyname||'|'||permissive||'|'||cmd||'|'||roles::text
--          ||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''), E'\n' ORDER BY tablename, policyname))
--     FROM pg_policies WHERE schemaname IN ('public','storage')
--      AND policyname <> 'sdr_escopo_crm_lead_atribuicoes';
--   SELECT permissive, cmd, qual FROM pg_policies WHERE policyname = 'sdr_escopo_crm_lead_atribuicoes'; -- RESTRICTIVE, SELECT
--   -- com o JWT de uma SDR, depois de uma rodada em sombra:
--   SELECT count(*) FROM public.crm_lead_atribuicoes WHERE para_user_id = auth.uid();  -- 0 (lead não é dela)
--   -- régua de etapa (deve devolver 0: nenhum lead de etapa pós-agendamento na fila):
--   SELECT count(*) FROM public.crm_leads l JOIN public.crm_stages s ON s.id = l.stage_id
--    WHERE l.tenant_id='00000000-0000-0000-0000-000000000010' AND l.assigned_to='d9b27aa3-049e-4ec9-9ae3-fb160a9544fa'
--      AND l.distribuido_em IS NULL AND s.position >= 5
--      AND public.rodizio_lead_na_fila(l, 'd9b27aa3-049e-4ec9-9ae3-fb160a9544fa', l.pipeline_id, NULL,
--                                      public.rodizio_etapas_entrada(l.tenant_id));
--
-- (a) MODO DESLIGADO NÃO MOVE NADA — deixar os crons rodarem uma hora e:
--   SELECT count(*) FROM public.crm_leads WHERE distribuido_em IS NOT NULL;             -- 0
--   SELECT count(*) FROM public.crm_leads WHERE rodizio_reservado_para IS NOT NULL;     -- 0
--   SELECT fase, count(*) FROM public.crm_lead_atribuicoes GROUP BY 1;                  -- só saneamento = 17
--   SELECT count(*) FROM public.crm_leads
--    WHERE tenant_id='00000000-0000-0000-0000-000000000010'
--      AND assigned_to='d9b27aa3-049e-4ec9-9ae3-fb160a9544fa';                        -- 7.641 + leads novos do webhook
--   SELECT j.jobname, d.status, d.return_message, d.end_time
--     FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
--    WHERE j.jobname LIKE 'rodizio-%' ORDER BY d.end_time DESC LIMIT 12;                -- succeeded, sem WARNING
--   -- e a ponta: inserir um lead de teste no Funil Principal como servidor
--   -- (admin-api ou SQL) → assigned_to continua o admin, distribuido_em NULL,
--   -- nenhuma linha nova no livro.
--
-- (b) SOMBRA GRAVA SEM MOVER — com o JWT do gestor (rizodentvca2):
--   SELECT public.equipe_rodizio('<ID_SDR>', true);  -- ligar as 3 no rodízio (aba Equipe)
--   SELECT public.rodizio_definir_modo('sombra');    -- {"modo":"sombra","elegiveis":3,"abertas":0,...}
--   -- deixar chegar leads (ou inserir 3 de teste com source='whatsapp',
--   -- assigned_to = admin, no Funil Principal) e conferir:
--   SELECT lead_nome, para_user_id, motivo, criado_em
--     FROM public.crm_lead_atribuicoes WHERE fase='sombra' ORDER BY criado_em DESC;
--     -- 1 linha por lead, revezando entre as 3 (ponteiro), motivo 'entrada: … ficaria reservado para X (ninguém presente)'
--   SELECT count(*) FROM public.crm_leads WHERE distribuido_em IS NOT NULL
--       OR rodizio_reservado_para IS NOT NULL;                                          -- 0
--   SELECT id, assigned_to FROM public.crm_leads
--    WHERE id IN (SELECT lead_id FROM public.crm_lead_atribuicoes WHERE fase='sombra');  -- todos ainda com o admin
--   SELECT public.rodizio_estado();                  -- carga de cada SDR = anotações de sombra de hoje
--   -- realocação em sombra (dona virtual): lead anotado 'entrada:' para X que
--   -- passa realocar_sem_resposta_min sem resposta humana em horário comercial →
--   -- linha 'realocação: iria de X para Y (N min sem resposta humana)', assigned_to intacto.
--
-- (c) LIGADO DISTRIBUI IGUAL — SDRs com o ponto aberto (insert em
--     crm_ponto_eventos tipo 'abrir' pela RPC do ponto, ou como servidor):
--   SELECT public.rodizio_definir_modo('ligado');
--   SELECT * FROM public.rodizio_distribuir_sem_resposta_agora(true);   -- dry-run: lista + quem receberia
--   SELECT * FROM public.rodizio_distribuir_sem_resposta_agora(false);  -- distribui os "aguardando resposta"
--   SELECT para_user_id, public.rodizio_nome(para_user_id), count(*)
--     FROM public.crm_lead_atribuicoes
--    WHERE fase IN ('aplicacao','corte_9h','realocacao_1h')
--      AND (criado_em AT TIME ZONE 'America/Bahia')::date = (now() AT TIME ZONE 'America/Bahia')::date
--    GROUP BY 1,2 ORDER BY 3 DESC;                   -- diferença máxima de 1 entre as abertas o dia todo
--   SELECT * FROM public.equipe_listar();            -- leads_hoje bate com a contagem acima
--   -- fora do expediente (ninguém presente): lead novo → rodizio_reservado_para
--   -- preenchido, assigned_to = admin, livro fase='reserva'; ao abrir o ponto:
--   -- 'aplicacao' + mensagem de sistema no chat + notificação "Leads reservados aplicados".
--
-- (d) NENHUM LEAD COM DUAS DONAS / ENTREGUE DUAS VEZES:
--   SELECT lead_id, count(*) FROM public.crm_lead_atribuicoes
--    WHERE fase IN ('aplicacao','corte_9h') GROUP BY 1 HAVING count(*) > 1;            -- 0 linhas
--   SELECT count(*) FROM public.crm_leads
--    WHERE rodizio_reservado_para IS NOT NULL AND distribuido_em IS NOT NULL;          -- 0
--   SELECT count(*) FROM public.crm_leads l
--    WHERE l.distribuido_em IS NOT NULL AND NOT EXISTS (
--          SELECT 1 FROM public.crm_lead_atribuicoes a
--           WHERE a.lead_id = l.id AND a.para_user_id = l.assigned_to AND a.fase <> 'sombra');
--     -- 0 (toda dona atual de lead distribuído está no livro; exceção legítima:
--     -- lead criado pela própria SDR no Kanban — sdr_carimba_dona — sem linha no livro)
--   -- corrida: dois INSERTs simultâneos (duas sessões, mesmo segundo) → dois
--   -- leads, duas SDRs diferentes, 2 linhas no livro, nenhuma repetida.
--
-- (e) CONTAGEM DO ADMIN INTACTA enquanto desligado (mesma consulta de (a)); ligado,
--     ela cai EXATAMENTE pelo número de linhas 'aplicacao'/'corte_9h' cujo
--     de_user_id = admin:
--   SELECT count(*) FROM public.crm_lead_atribuicoes
--    WHERE fase IN ('aplicacao','corte_9h') AND de_user_id='d9b27aa3-049e-4ec9-9ae3-fb160a9544fa';
--
-- (f) DESLIGAR DE VOLTA: rodizio_definir_modo('desligado') → reservas pendentes
--     viram 'saneamento' no livro, rodizio_reservado_para zera, NENHUM
--     assigned_to muda; os crons passam a sair na primeira linha.
