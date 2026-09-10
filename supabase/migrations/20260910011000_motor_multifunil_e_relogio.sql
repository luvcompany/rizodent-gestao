-- Motor do rodízio: vários funis, relógio em horário comercial, almoço que
-- vale, corte sem virada de meia-noite e teto na distribuição em lote.
-- Achados da revisão de 09/09/2026 (noite), um bloco por defeito.
--
-- A) VÁRIOS FUNIS. O motor lia UM funil (crm_rodizio_config.funil_id). O dono
--    criou 6 funis por procedimento; todo lead que nasce fora do Funil
--    Principal simplesmente sumia do motor — não entrava, não era reservado,
--    não era realocado, e ninguém via porque o lead ficava com o
--    administrador (que é o dono padrão de quem chega pelo webhook).
--    Agora crm_rodizio_config.funis_ids (uuid[]) lista os funis do rodízio e
--    public.rodizio_funis() é a régua única. NULL/vazio = comportamento de
--    hoje (rodizio_funil), para nada mudar em cliente que não configurou.
--
-- B) RELÓGIO DO SILÊNCIO EM HORÁRIO COMERCIAL. A realocação por silêncio
--    contava tempo de parede: quem escrevia às 17h55 chegava às 8h da manhã
--    com ~14 horas de silêncio, e na primeira rodada do dia a fila inteira da
--    noite trocava de dona de uma vez — punindo a SDR pelo horário em que a
--    clínica está fechada. Agora o relógio só corre dentro do horário
--    comercial do cliente e fora de feriado (public.rodizio_minutos_uteis).
--
-- C) ALMOÇO PASSA A VALER. crm_rodizio_membros.almoco_inicio/almoco_fim era
--    configurado pelo gestor, validado, mostrado na tela — e NENHUMA decisão
--    do motor lia a coluna. O dono acredita que o motor para de entregar no
--    almoço da SDR e o motor não para. Agora rodizio_pool marca aberta =
--    'aberta' E fora do almoço dela.
--
-- D) EXPEDIENTE FECHADO RECEBENDO NA HORA. Com preferir_em_expediente = false
--    o ramo IMEDIATO usava TODAS as elegíveis, inclusive quem está com o
--    expediente fechado: o lead ia na hora para quem está em casa e ficava
--    parado até ela abrir. O ramo imediato agora escolhe SEMPRE entre as
--    presentes; a válvula preferir_em_expediente só descreve o pool da
--    RESERVA (que já era, e continua, todas as elegíveis).
--
-- E) CORTE COM VIRADA DE MEIA-NOITE. v_limite := (entrada + tolerância)::time
--    dava WRAP: entrada 17:00 com tolerância de 480 min virava 01:00, e o
--    teste "hora local >= 01:00" ficava verdadeiro o dia inteiro — a reserva
--    da SDR da tarde era passada adiante às 8h da manhã, antes da hora dela.
--    O limite passa a ser calculado em TIMESTAMP e comparado com now().
--
-- F) RETOMAR DEPOIS DA SAÍDA DEIXAVA A SDR "EM EXPEDIENTE" DEPOIS DE
--    ENCERRADA. O encerrar automático era gravado com o MESMO instante do
--    clique em "retomar" (GREATEST(corte, último evento)); com empate no
--    campo `em`, o desempate é por id (uuid aleatório) e o pool às vezes lia
--    'retomar' como último evento — a SDR ficava aberta depois de encerrada e
--    o motor entregava lead para uma mesa vazia. O evento automático agora é
--    gravado pelo menos 1 segundo DEPOIS do último evento humano.
--
-- G) GUC DE AUTORIZAÇÃO NUNCA DESLIGADO. set_config('rodizio.autorizado',
--    'sim', true) vale até o fim da transação. Ligado uma vez no topo do
--    laço, a trava de propriedade (trg_zz_propriedade_lead) ficava ABERTA
--    para todos os leads seguintes daquela rodada — inclusive para qualquer
--    UPDATE de assigned_to disparado por gatilho no meio do lote. Agora o GUC
--    liga imediatamente antes do UPDATE que troca a dona e desliga logo
--    depois.
--
-- I) LOTE SEM TETO. rodizio_distribuir_sem_resposta_agora moveria os 828
--    leads de uma vez. Ganhou p_max_por_sdr.
--
-- NADA DE ISOLAMENTO MUDA: nenhuma policy é criada, editada ou removida;
-- can_access_whatsapp_number / can_access_pipeline / tenant_hard_isolation
-- continuam como estão. As funções novas nascem com search_path fixo e
-- REVOKE/GRANT explícito; nenhuma delas é chamável por anon.
--
-- PRÉ-REQUISITOS (versões vigentes copiadas): 20260909100000 (rodizio_pool,
-- rodizio_processar_lead, rodizio_distribuir_sem_resposta_agora),
-- 20260909230000 (rodizio_lead_na_fila, rodizio_etapas_entrada,
-- rodizio_realocar_sem_resposta, rodizio_processar_novos), 20260910000000
-- (rodizio_corte_9h, rodizio_estado, rodizio_horario_dia) e 20260910003000
-- (ponto_vigia).

SET LOCAL lock_timeout = '5s';

-- ================================================================ A. vários funis
-- NULL (ou vazio) = o rodízio segue lendo rodizio_funil(), exatamente como
-- antes desta migration. Só quem preencher a lista muda de comportamento.
ALTER TABLE public.crm_rodizio_config ADD COLUMN IF NOT EXISTS funis_ids uuid[];
COMMENT ON COLUMN public.crm_rodizio_config.funis_ids IS
  'Funis que o rodízio distribui. NULL ou vazio = só o funil de rodizio_funil (comportamento anterior). Gravado por rodizio_definir_funis.';

-- A régua ÚNICA de "quais funis o rodízio enxerga". Todo predicado de funil do
-- motor passa por aqui — é o que impede um funil novo do dono de nascer
-- invisível para o motor.
-- Quem GUARDA a lista é a escrita (rodizio_definir_funis recusa Instagram,
-- pós-venda e funil com allowed_roles preenchido): aqui a lista é lida como
-- está. Se o gestor restringir por papel (allowed_roles) um funil que já está
-- na lista, ele precisa refazer a lista — a leitura não revalida.
CREATE OR REPLACE FUNCTION public.rodizio_funis(p_tenant uuid)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_ids uuid[]; v_um uuid;
BEGIN
  IF p_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT c.funis_ids INTO v_ids FROM public.crm_rodizio_config c WHERE c.tenant_id = p_tenant;
  IF v_ids IS NOT NULL AND COALESCE(array_length(v_ids, 1), 0) > 0 THEN RETURN v_ids; END IF;
  v_um := public.rodizio_funil(p_tenant);
  IF v_um IS NULL THEN RETURN NULL; END IF;   -- sem funil = ninguém entra
  RETURN ARRAY[v_um];
END $fn$;
REVOKE ALL ON FUNCTION public.rodizio_funis(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rodizio_funis(uuid) TO service_role;

-- Régua de entrada: mesmo corpo de 20260909230000, com UMA mudança — o funil.
-- p_funil deixa de ser "o funil" e passa a ser apenas o funil de REFERÊNCIA
-- (a assinatura é usada em vários lugares e não muda): vale qualquer funil da
-- lista do rodízio, e só se a lista não existir é que o parâmetro decide.
CREATE OR REPLACE FUNCTION public.rodizio_lead_na_fila(p_lead public.crm_leads, p_admin uuid, p_funil uuid, p_numero uuid, p_etapas uuid[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT (p_lead).id IS NOT NULL
     AND (p_lead).pipeline_id = ANY (COALESCE(public.rodizio_funis((p_lead).tenant_id), ARRAY[p_funil]))
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

-- Etapas de entrada: mesmo corpo de 20260909230000, agora somando as etapas de
-- TODOS os funis do rodízio. Sem a união, um lead de um funil novo caía fora da
-- régua mesmo com o funil na lista (o stage_id dele nunca estava no array).
-- Por funil: entrada_todas_etapas → todas as etapas visíveis para a SDR;
-- etapas_entrada configurado → as configuradas QUE SÃO DESTE funil (o gestor
-- escolheu à mão as do Funil Principal; os demais funis caem na régua
-- derivada, senão nasceriam com zero etapa de entrada); senão → as etapas
-- antes da primeira de agendamento/ganho/perda.
CREATE OR REPLACE FUNCTION public.rodizio_etapas_entrada(p_tenant uuid)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_cfg uuid[]; v_todas boolean; v_funis uuid[]; v_funil uuid;
  v_corte integer; v_ids uuid[]; v_acc uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT c.etapas_entrada, COALESCE(c.entrada_todas_etapas, false) INTO v_cfg, v_todas
    FROM public.crm_rodizio_config c WHERE c.tenant_id = p_tenant;
  v_funis := public.rodizio_funis(p_tenant);
  IF v_funis IS NULL OR array_length(v_funis, 1) IS NULL THEN RETURN NULL; END IF;

  FOREACH v_funil IN ARRAY v_funis LOOP
    CONTINUE WHEN v_funil IS NULL;
    v_ids := NULL;
    IF v_todas THEN
      -- Todas as etapas do funil, menos as do administrador (visivel_para_sdr = false).
      SELECT array_agg(s.id ORDER BY s.position) INTO v_ids FROM public.crm_stages s
       WHERE s.pipeline_id = v_funil AND COALESCE(s.visivel_para_sdr, true);
    ELSIF v_cfg IS NOT NULL AND COALESCE(array_length(v_cfg, 1), 0) > 0
          AND EXISTS (SELECT 1 FROM public.crm_stages s
                       WHERE s.pipeline_id = v_funil AND s.id = ANY (v_cfg)) THEN
      SELECT array_agg(s.id ORDER BY s.position) INTO v_ids FROM public.crm_stages s
       WHERE s.pipeline_id = v_funil AND s.id = ANY (v_cfg);
    ELSE
      SELECT min(s.position) INTO v_corte FROM public.crm_stages s
       WHERE s.pipeline_id = v_funil
         AND (COALESCE(s.is_won, false) OR COALESCE(s.is_lost, false) OR lower(s.name) LIKE '%agend%');
      SELECT array_agg(s.id ORDER BY s.position) INTO v_ids FROM public.crm_stages s
       WHERE s.pipeline_id = v_funil
         AND NOT COALESCE(s.is_won, false) AND NOT COALESCE(s.is_lost, false)
         AND (v_corte IS NULL OR s.position < v_corte);
    END IF;
    IF v_ids IS NOT NULL THEN v_acc := v_acc || v_ids; END IF;
  END LOOP;

  IF array_length(v_acc, 1) IS NULL THEN RETURN NULL; END IF;   -- NULL = ninguém entra
  RETURN v_acc;
END $fn$;

-- Quem escolhe os funis do rodízio: o gestor da equipe, pela mesma porta das
-- RPCs equipe_*. Funil de Instagram e de pós-venda ficam de fora por regra do
-- dono (Instagram é do administrador; pós-venda é de outro papel), e funil com
-- allowed_roles preenchido fica de fora porque a SDR não tem como abri-lo.
CREATE OR REPLACE FUNCTION public.rodizio_definir_funis(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id(); v_id uuid; v_ids uuid[]; v_antes uuid[]; p record;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem cliente ativo.' USING ERRCODE = '42501'; END IF;

  IF p_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY p_ids LOOP
      CONTINUE WHEN v_id IS NULL;
      SELECT x.id, x.name, COALESCE(x.is_instagram, false) AS ig, COALESCE(x.is_posvenda, false) AS pv,
             x.allowed_roles AS ar
        INTO p FROM public.crm_pipelines x WHERE x.id = v_id AND x.tenant_id = v_tenant;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Funil % não é desta clínica.', v_id USING ERRCODE = '22023';
      END IF;
      IF p.ig THEN
        RAISE EXCEPTION 'O funil "%" é de Instagram e não entra no rodízio.', p.name USING ERRCODE = '22023';
      END IF;
      IF p.pv THEN
        RAISE EXCEPTION 'O funil "%" é de pós-venda e não entra no rodízio.', p.name USING ERRCODE = '22023';
      END IF;
      -- DEFEITO QUE EXISTIA: a validação recusava só Instagram e pós-venda e
      -- deixava passar funil com allowed_roles preenchido — "Padrão Closer" e
      -- "Padrão Recepção" não são nem um nem outro. E allowed_roles é a ÚNICA
      -- régua que sempre protegeu o rodízio: rodizio_funil() só escolhe funil
      -- com allowed_roles IS NULL; o override de pipeline que faz a SDR VER o
      -- funil (sdr_prepara_novo_membro) também só é concedido para funil com
      -- allowed_roles IS NULL; e a policy de SELECT de crm_leads exige
      -- can_access_pipeline, que para funil restrito e papel sdr é false.
      -- Resultado do defeito: o gestor punha "Padrão Closer" na lista, o motor
      -- tirava o lead do administrador e carimbava assigned_to = SDR, e a SDR
      -- não conseguia abrir o lead — entregue e invisível, o pior dos dois.
      IF p.ar IS NOT NULL THEN
        RAISE EXCEPTION 'O funil "%" é restrito a outro papel (closer/recepção) e não entra no rodízio.', p.name USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  SELECT c.funis_ids INTO v_antes FROM public.crm_rodizio_config c WHERE c.tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rodízio não configurado para este cliente.' USING ERRCODE = '22023';
  END IF;

  -- Lista vazia ou NULL = volta ao padrão (grava NULL): rodizio_funis cai em
  -- rodizio_funil e o motor se comporta como antes desta migration.
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    v_ids := NULL;
  ELSE
    -- Relê do banco na ordem de exibição (position) e já sem repetidos.
    SELECT array_agg(x.id ORDER BY COALESCE(x.position, 1000), x.created_at) INTO v_ids
      FROM public.crm_pipelines x WHERE x.tenant_id = v_tenant AND x.id = ANY (p_ids);
  END IF;

  UPDATE public.crm_rodizio_config SET funis_ids = v_ids WHERE tenant_id = v_tenant;
  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), v_tenant, 'tenant', 'rodizio_funis',
          jsonb_build_object('de', to_jsonb(v_antes), 'para', to_jsonb(v_ids)));

  RETURN jsonb_build_object(
    'funis', COALESCE(array_length(v_ids, 1), 0),
    'padrao', v_ids IS NULL,
    'funis_ids', to_jsonb(public.rodizio_funis(v_tenant)));
END $fn$;
REVOKE ALL ON FUNCTION public.rodizio_definir_funis(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rodizio_definir_funis(uuid[]) TO authenticated, service_role;

-- ================================================================ B. relógio comercial
-- Minutos de horário comercial do cliente entre dois instantes: soma só as
-- janelas [abre, fecha] de tenants.business_hours de cada dia da semana, fora
-- de feriado da clínica inteira, no fuso do cliente. É o relógio honesto do
-- silêncio: noite, domingo e feriado não contam contra a SDR.
-- Teto de segurança: acima de 30 dias não vale a pena somar dia a dia — quem
-- pergunta só quer saber se já passou do limite, então devolve um número
-- grande (999999 min = ~694 dias) em vez de varrer.
CREATE OR REPLACE FUNCTION public.rodizio_minutos_uteis(p_tenant uuid, p_de timestamptz, p_ate timestamptz)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_tz text; v_bh jsonb; v_dia jsonb; v_d date; v_ultimo date;
  v_abre time; v_fecha time; v_ini timestamptz; v_fim timestamptz;
  v_a timestamptz; v_b timestamptz; v_seg numeric := 0;
BEGIN
  IF p_tenant IS NULL OR p_de IS NULL OR p_ate IS NULL OR p_ate <= p_de THEN RETURN 0; END IF;
  SELECT t.business_hours INTO v_bh FROM public.tenants t WHERE t.id = p_tenant;
  -- Sem horário cadastrado = nunca é expediente (o mesmo contrato de rodizio_dia_util).
  IF v_bh IS NULL OR jsonb_typeof(v_bh) <> 'object' THEN RETURN 0; END IF;
  v_tz := public.rodizio_tz(p_tenant);
  v_d := (p_de AT TIME ZONE v_tz)::date;
  v_ultimo := (p_ate AT TIME ZONE v_tz)::date;
  IF v_ultimo - v_d > 30 THEN RETURN 999999; END IF;

  WHILE v_d <= v_ultimo LOOP
    v_dia := v_bh -> (extract(dow FROM v_d)::int)::text;
    IF v_dia IS NOT NULL AND jsonb_typeof(v_dia) = 'array' AND jsonb_array_length(v_dia) >= 2
       AND NOT public.rodizio_feriado(p_tenant, v_d) THEN
      BEGIN
        v_abre := (v_dia ->> 0)::time;
        v_fecha := (v_dia ->> 1)::time;
      EXCEPTION WHEN OTHERS THEN
        v_abre := NULL; v_fecha := NULL;
      END;
      IF v_abre IS NOT NULL AND v_fecha IS NOT NULL AND v_fecha > v_abre THEN
        v_ini := (v_d + v_abre) AT TIME ZONE v_tz;
        v_fim := (v_d + v_fecha) AT TIME ZONE v_tz;
        v_a := GREATEST(v_ini, p_de);
        v_b := LEAST(v_fim, p_ate);
        IF v_b > v_a THEN v_seg := v_seg + extract(epoch FROM (v_b - v_a)); END IF;
      END IF;
    END IF;
    v_d := v_d + 1;
  END LOOP;
  RETURN floor(v_seg / 60)::integer;
END $fn$;
REVOKE ALL ON FUNCTION public.rodizio_minutos_uteis(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rodizio_minutos_uteis(uuid, timestamptz, timestamptz) TO service_role;

-- ================================================================ C. almoço
-- A SDR está no almoço dela AGORA? Só vale para quem tem horário próprio
-- naquele dia (seg–sex hora_entrada, sábado sabado_entrada): sem horário
-- próprio o motor não sabe quando é o almoço dela e não inventa. O almoço é o
-- mesmo nos dois casos (o gestor cadastra um só).
CREATE OR REPLACE FUNCTION public.rodizio_em_almoco(p_tenant uuid, p_user uuid, p_quando timestamptz DEFAULT now())
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE m record; v_local timestamp; v_dow integer;
BEGIN
  IF p_tenant IS NULL OR p_user IS NULL THEN RETURN false; END IF;
  SELECT * INTO m FROM public.crm_rodizio_membros
   WHERE tenant_id = p_tenant AND user_id = p_user;
  IF NOT FOUND OR m.almoco_inicio IS NULL OR m.almoco_fim IS NULL
     OR m.almoco_fim <= m.almoco_inicio THEN
    RETURN false;
  END IF;
  v_local := COALESCE(p_quando, now()) AT TIME ZONE public.rodizio_tz(p_tenant);
  v_dow := extract(dow FROM v_local)::integer;
  IF v_dow BETWEEN 1 AND 5 THEN
    IF m.hora_entrada IS NULL THEN RETURN false; END IF;
  ELSIF v_dow = 6 THEN
    IF m.sabado_entrada IS NULL THEN RETURN false; END IF;
  ELSE
    RETURN false;   -- domingo: sem horário próprio, sem almoço
  END IF;
  RETURN v_local::time >= m.almoco_inicio AND v_local::time < m.almoco_fim;
END $fn$;
REVOKE ALL ON FUNCTION public.rodizio_em_almoco(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rodizio_em_almoco(uuid, uuid, timestamptz) TO service_role;

-- rodizio_pool: mesmo corpo de 20260909100000, com UMA mudança — "aberta"
-- passa a exigir estar fora do almoço dela. "presente" (aberta ou pausada)
-- continua igual DE PROPÓSITO: a regra do dono é que pausa não tira ninguém
-- da fila, então, durante o almoço, a SDR só recebe se NINGUÉM mais estiver
-- aberta (o motor cai de v_abertas para v_presentes) — melhor a ela do que ao
-- limbo. O almoço nunca a tira do corte das 9h nem das reservas.
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
         b.pestado = 'aberta' AND NOT public.rodizio_em_almoco(p_tenant, b.uid, now()),
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

-- ================================================================ D. ramo imediato só entre as presentes
-- Mesmo corpo de 20260909100000, com UMA mudança no bloco de escolha do pool.
-- Antes: "IF NOT v_imediato OR NOT cfg.preferir_em_expediente THEN pool =
-- todas as elegíveis" — com a válvula desligada, o lead ia NA HORA para uma
-- SDR de expediente fechado (em casa), e ficava sem resposta até ela abrir.
-- Agora: quem está presente recebe na hora (abertas primeiro, pausadas
-- depois); a válvula preferir_em_expediente só descreve o pool da RESERVA,
-- que é (e já era) todas as elegíveis — porque, com ninguém presente, não há
-- "quem está em expediente" para preferir.
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
  -- Funil de REFERÊNCIA: a régua aceita qualquer funil de rodizio_funis().
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

  -- Alguém presente (aberta ou pausada) → entrega na hora, SEMPRE entre as
  -- presentes: abertas primeiro (e "aberta" já exclui quem está no almoço);
  -- só pausadas → a pausada. Ninguém presente → reserva entre todas as
  -- elegíveis (é o pool que preferir_em_expediente = false descrevia).
  v_imediato := v_presentes IS NOT NULL;
  IF NOT v_imediato THEN
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

-- ================================================================ varredura em vários funis
-- Mesmo corpo de 20260909230000, com UMA mudança: a varredura passa a olhar
-- todos os funis do rodízio (era pipeline_id = v_funil — leads dos funis
-- novos nunca eram varridos, nem quando o gatilho falhava por trava).
CREATE OR REPLACE FUNCTION public.rodizio_processar_novos()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE c record; r record; v_funis uuid[]; v_numero uuid; v_etapas uuid[]; v_n integer := 0; v_run uuid := gen_random_uuid(); v_res text; v_desde timestamptz;
BEGIN
  FOR c IN SELECT k.tenant_id, k.modo, k.modo_alterado_em, k.gestor_user_id
             FROM public.crm_rodizio_config k WHERE k.modo <> 'desligado'
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtext('rodizio:novos:' || c.tenant_id::text)) THEN CONTINUE; END IF;
    v_funis := public.rodizio_funis(c.tenant_id);
    v_numero := public.rodizio_numero_principal(c.tenant_id);
    v_etapas := public.rodizio_etapas_entrada(c.tenant_id);
    IF v_funis IS NULL OR v_etapas IS NULL OR c.modo_alterado_em IS NULL THEN CONTINUE; END IF;
    v_desde := GREATEST(c.modo_alterado_em, now() - interval '2 days');
    FOR r IN
      SELECT l.id
        FROM public.crm_leads l
       WHERE l.tenant_id = c.tenant_id
         AND l.pipeline_id = ANY (v_funis)
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
         AND public.rodizio_lead_na_fila(l, c.gestor_user_id, v_funis[1], v_numero, v_etapas)
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

-- ================================================================ B + G. realocação por silêncio
-- Mesmo corpo de 20260909230000, com QUATRO mudanças:
--   (1) vários funis: l0.pipeline_id = ANY (v_funis);
--   (2) o relógio do silêncio é de MINUTOS ÚTEIS (rodizio_minutos_uteis) — o
--       tempo de parede contava a madrugada, o domingo e o feriado: quem
--       escrevia 17h55 chegava com ~14 h de silêncio às 8h e a fila da noite
--       inteira trocava de dona na primeira rodada do dia. No WHERE fica só a
--       peneira BARATA (tempo de parede + a antijunção de messages), com o
--       ORDER BY e o LIMIT 100; os minutos úteis são testados DENTRO do laço.
--       Pôr rodizio_minutos_uteis no WHERE custava caro: o WHERE é avaliado
--       ANTES do LIMIT, então com vários funis ligados a função (um laço dia a
--       dia por chamada) rodava uma vez por candidato que passou a peneira de
--       parede — centenas ou milhares de chamadas para usar só 100;
--   (4) o sentinela de 30 dias não vaza para texto: rodizio_minutos_uteis
--       devolve 999999 em vez de varrer acima de 30 dias, e esse número cru
--       aparecia nas mensagens ("999999 min sem resposta"). O número continua
--       decidindo; o texto vira frase (v_txt);
--   (3) o GUC rodizio.autorizado liga imediatamente antes do UPDATE que troca
--       a dona e desliga imediatamente depois. Ligado no topo do laço, ele
--       valia até o fim da transação e deixava a trava de propriedade
--       (trg_zz_propriedade_lead) ABERTA para todos os leads seguintes do
--       lote — qualquer UPDATE de assigned_to disparado no meio da rodada
--       passava sem ser autorizado.
CREATE OR REPLACE FUNCTION public.rodizio_realocar_sem_resposta()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  c record; cfg public.crm_rodizio_config; r record; l public.crm_leads;
  v_funis uuid[]; v_etapas uuid[]; v_tz text; v_ini timestamptz;
  v_ids uuid[]; v_cargas integer[]; v_ponteiro uuid; v_alvo uuid; v_ok uuid;
  v_n integer := 0; v_run uuid := gen_random_uuid(); v_min integer; v_de_nome text; v_para_nome text;
  v_txt text;   -- o silêncio em texto: "N min úteis" ou "mais de 30 dias" (sentinela)
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
             AND l0.pipeline_id = ANY (v_funis)
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
        -- Peneira BARATA e só ela: nenhum lead pode ter mais minutos ÚTEIS do
        -- que minutos corridos, então quem não passou do limite no relógio de
        -- parede jamais passaria no relógio comercial — é um pré-filtro seguro.
        -- DEFEITO QUE EXISTIA: rodizio_minutos_uteis também estava aqui, no
        -- WHERE, que é avaliado ANTES do LIMIT 100. Com vários funis ligados,
        -- ela rodava uma vez por candidato que passou a peneira de parede
        -- (centenas ou milhares na primeira rodada do dia, cada chamada
        -- varrendo dia a dia) para no fim aproveitar 100 linhas. O teste dos
        -- minutos úteis foi para DENTRO do laço, onde roda no máximo 100 vezes.
       WHERE GREATEST(cand.last_inbound_at, cand.desde) < now() - make_interval(mins => cfg.realocar_sem_resposta_min)
         -- sem resposta HUMANA ao último inbound (régua única rodizio_msg_humana)
         AND NOT EXISTS (
               SELECT 1 FROM public.messages m
                WHERE m.lead_id = cand.id
                  AND m.created_at >= cand.last_inbound_at
                  AND public.rodizio_msg_humana(m))
       ORDER BY GREATEST(cand.last_inbound_at, cand.desde)
       LIMIT 100
    LOOP
      -- Relógio de verdade AQUI (uma chamada por lead da rodada, no máximo
      -- 100), e não no WHERE: só minutos de horário comercial do cliente
      -- contam contra a SDR. Quem passou a peneira de parede mas não tem
      -- minutos ÚTEIS suficientes fica onde está.
      v_min := public.rodizio_minutos_uteis(c.tenant_id, GREATEST(r.last_inbound_at, r.desde), now());
      CONTINUE WHEN v_min < cfg.realocar_sem_resposta_min;
      -- DEFEITO QUE EXISTIA: rodizio_minutos_uteis tem teto de 30 dias e
      -- devolve o sentinela 999999 em vez de varrer dia a dia; esse número cru
      -- ia direto para o livro, para a mensagem do chat e para as duas
      -- notificações — um lead calado há meses gerava "999999 min sem
      -- resposta". O número cru continua DECIDINDO (a comparação acima); só o
      -- texto passa a ser frase.
      v_txt := CASE WHEN v_min >= 999999 THEN 'mais de 30 dias' ELSE v_min || ' min úteis' END;

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
      -- o que a mensagem e o livro dizem é o silêncio ÚTIL (v_min e v_txt já
      -- calculados no topo do laço, sem uma segunda chamada da função): dizer
      -- "840 min sem resposta" para uma noite inteira era acusação falsa.
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
      -- Regra universal de propriedade: só a realocação (aqui) e a
      -- transferência autorizada trocam a dona de um lead de SDR. O GUC é
      -- transacional: liga colado no UPDATE e desliga colado nele, para a
      -- autorização não sobrar para o resto do lote.
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
        v_txt || ' sem resposta humana da dona (limite ' || cfg.realocar_sem_resposta_min || ' min, só horário comercial)', v_run);
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

-- ================================================================ E. corte sem virada de meia-noite
-- Mesmo corpo de 20260910000000, com UMA mudança: o limite do corte deixa de
-- ser um `time`. v_limite := (h.entrada + make_interval(mins => tolerância))::time
-- fazia WRAP de meia-noite — entrada 17:00 com tolerância de 480 min virava
-- 01:00, e "hora local >= 01:00" era verdadeiro das 01:00 às 23:59: a reserva
-- da SDR da tarde era passada para as colegas da manhã ANTES da hora dela
-- entrar. Agora o limite é um TIMESTAMP (data local + entrada + tolerância)
-- comparado com now(), que não tem como dar a volta no relógio.
CREATE OR REPLACE FUNCTION public.rodizio_corte_9h()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  c record; cfg public.crm_rodizio_config; m record; r record; l public.crm_leads; u uuid; h record;
  v_tz text; v_local timestamp; v_hoje date; v_pend integer; v_limite_ts timestamptz; v_atrasada boolean; v_motivo text;
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
        -- em TIMESTAMP: entrada de hoje na hora da clínica + tolerância.
        v_limite_ts := ((v_hoje + h.entrada) AT TIME ZONE v_tz) + make_interval(mins => COALESCE(cfg.corte_tolerancia_min, 60));
        v_atrasada := now() >= v_limite_ts;
        -- o dia sai na mensagem porque o limite pode cair no dia seguinte
        -- (entrada tarde + tolerância grande) — e aí ele ainda não venceu.
        v_motivo := 'não abriu o expediente até ' || to_char(v_limite_ts AT TIME ZONE v_tz, 'DD/MM HH24:MI')
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

-- ================================================================ F. encerrar automático depois do último clique
-- Mesmo corpo de 20260910003000, com UMA mudança nas DUAS gravações de
-- 'encerrar' automático: v_em := GREATEST(<corte ou fim>, ultimo_evento_em)
-- gravava o evento no MESMO instante do clique quando a SDR clicava em
-- "retomar" depois da hora de saída. Com empate no campo `em`, o desempate do
-- pool é por id (uuid aleatório): metade das vezes 'retomar' era lido como
-- último evento, a SDR aparecia em expediente DEPOIS de encerrada e o motor
-- entregava lead para uma mesa vazia. O evento automático agora fica pelo
-- menos 1 segundo DEPOIS do último evento humano — não há mais empate a
-- desempatar.
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
      v_em := GREATEST(v_corte, s.ultimo_evento_em + interval '1 second');
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
        v_em := GREATEST(v_fim, s.ultimo_evento_em + interval '1 second');
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

-- ================================================================ H. painel do gestor mostra os funis
-- Mesmo corpo de 20260910000000, com DUAS chaves novas: funis_ids (a lista
-- efetiva, para a tela marcar as caixas) e funis (id + nome na ordem de
-- exibição). Sem isso o gestor não tem como saber quais funis o motor enxerga
-- — que é exatamente o defeito que fez os 6 funis novos sumirem em silêncio.
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

-- ================================================================ I. lote com teto por SDR
-- Mesmo corpo de 20260909100000, com TRÊS mudanças:
--   (1) vários funis (pipeline_id = ANY (v_funis));
--   (2) a simulação do dry-run e o ramo imediato passam a espelhar a correção
--       (D): presentes primeiro, nunca quem está de expediente fechado;
--   (3) p_max_por_sdr: sem teto a função moveria os 828 leads do administrador
--       de uma vez para 2 ou 3 SDRs — despejo, não distribuição.
-- Como o teto é honrado: quem entrega é o motor (rodizio_processar_lead), e não
-- há como pedir a ele que pule alguém sem duplicar a decisão dele (duplicar
-- era o risco de o teto e o motor discordarem). Então, antes de cada lead, a
-- função PREVÊ o alvo com a mesma decisão do motor — rodizio_pool +
-- rodizio_escolher com o ponteiro relido — e, se essa SDR já bateu o teto
-- NESTA execução, a rodada termina ali. Os leads restantes ficam para a
-- próxima execução: a carga de hoje de quem recebeu já subiu, então a próxima
-- rodada cai naturalmente nas outras. Rodar 4 vezes com teto 20 é uma
-- distribuição controlada; rodar uma vez sem teto é o despejo. A linha que
-- anuncia a parada sai com para_user_id/para_nome NULOS: ela não entrega o
-- lead a ninguém, e preencher esses campos com a SDR que bateu o teto fazia a
-- tela do gestor lê-la como destino (o contrato é para_nome = para quem vai).
-- A assinatura muda (p_max_por_sdr), por isso o DROP da antiga.
DROP FUNCTION IF EXISTS public.rodizio_distribuir_sem_resposta_agora(boolean, uuid);
CREATE FUNCTION public.rodizio_distribuir_sem_resposta_agora(
  p_dry_run boolean DEFAULT true,
  p_tenant uuid DEFAULT NULL,
  p_max_por_sdr integer DEFAULT NULL)
RETURNS TABLE(lead_id uuid, lead_nome text, lead_telefone text, etapa text, ultima_mensagem_em timestamptz,
              acao text, para_user_id uuid, para_nome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  v_tenant uuid; cfg public.crm_rodizio_config; v_funis uuid[]; v_numero uuid; v_etapas uuid[]; r record; l public.crm_leads;
  v_ids uuid[]; v_cargas integer[]; v_abertas uuid[]; v_cargas_abertas integer[];
  v_presentes uuid[]; v_cargas_presentes integer[];
  v_pool_ids uuid[]; v_pool_cargas integer[]; v_ponteiro uuid; v_alvo uuid; v_imediato boolean;
  v_res text; v_run uuid := gen_random_uuid(); i integer;
  v_por_alvo jsonb := '{}'::jsonb; v_feitos integer; v_teto_alvo uuid;
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
  IF p_max_por_sdr IS NOT NULL AND p_max_por_sdr < 1 THEN
    RAISE EXCEPTION 'O teto por SDR, quando informado, precisa ser ao menos 1.' USING ERRCODE = '22023';
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
  v_funis := public.rodizio_funis(v_tenant);
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
       AND v_funis IS NOT NULL AND l0.pipeline_id = ANY (v_funis)
       AND l0.distribuido_em IS NULL
       AND l0.rodizio_reservado_para IS NULL
       AND (l0.assigned_to IS NULL OR (cfg.gestor_user_id IS NOT NULL AND l0.assigned_to = cfg.gestor_user_id))
       -- a régua única (etapa de entrada, sem agendamento, conversa aberta,
       -- origem, número, Instagram, bloqueio) — a mesma dos gatilhos
       AND public.rodizio_lead_na_fila(l0, cfg.gestor_user_id, v_funis[1], v_numero, v_etapas)
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

    -- Teto: prevê o alvo com a decisão do motor. No dry-run as cargas são as
    -- simuladas (o laço já as incrementa); no real, o pool e o ponteiro são
    -- relidos do banco a cada lead — é o mesmo estado que rodizio_processar_lead
    -- vai ler em seguida.
    IF p_max_por_sdr IS NOT NULL THEN
      IF NOT p_dry_run THEN
        SELECT array_agg(p.user_id ORDER BY p.ordem),
               array_agg(p.carga ORDER BY p.ordem),
               array_agg(p.user_id ORDER BY p.ordem) FILTER (WHERE p.aberta),
               array_agg(p.carga ORDER BY p.ordem) FILTER (WHERE p.aberta),
               array_agg(p.user_id ORDER BY p.ordem) FILTER (WHERE p.presente),
               array_agg(p.carga ORDER BY p.ordem) FILTER (WHERE p.presente)
          INTO v_ids, v_cargas, v_abertas, v_cargas_abertas, v_presentes, v_cargas_presentes
          FROM public.rodizio_pool(v_tenant) p;
        SELECT k.ponteiro_user_id INTO v_ponteiro FROM public.crm_rodizio_config k WHERE k.tenant_id = v_tenant;
      END IF;
      v_imediato := v_presentes IS NOT NULL;
      IF NOT v_imediato THEN
        v_pool_ids := v_ids; v_pool_cargas := v_cargas;
      ELSIF v_abertas IS NOT NULL THEN
        v_pool_ids := v_abertas; v_pool_cargas := v_cargas_abertas;
      ELSE
        v_pool_ids := v_presentes; v_pool_cargas := v_cargas_presentes;
      END IF;
      v_teto_alvo := public.rodizio_escolher(v_pool_ids, v_pool_cargas, v_ponteiro);
      IF v_teto_alvo IS NOT NULL THEN
        v_feitos := COALESCE((v_por_alvo ->> v_teto_alvo::text)::integer, 0);
        IF v_feitos >= p_max_por_sdr THEN
          -- DEFEITO QUE EXISTIA: esta linha anuncia uma PARADA (este lead NÃO
          -- vai para ninguém) e ainda assim preenchia para_user_id/para_nome
          -- com a SDR que bateu o teto. Isso quebrava o contrato das outras
          -- linhas — em todas elas para_nome é "para quem o lead vai" — e a
          -- tela do gestor mostrava o nome dela como destino de um lead que
          -- ficou com o administrador. Os dois campos ficam nulos; o nome de
          -- quem bateu o teto vai só no texto de `acao`.
          para_user_id := NULL; para_nome := NULL;
          acao := 'parou aqui: ' || public.rodizio_nome(v_teto_alvo) || ' já recebeu o teto de '
               || p_max_por_sdr || ' lead(s) nesta rodada — rode de novo para continuar';
          RETURN NEXT;
          EXIT;
        END IF;
      END IF;
    END IF;

    IF p_dry_run THEN
      v_imediato := v_presentes IS NOT NULL;
      -- espelha a correção (D): presente recebe na hora; ninguém presente → reserva
      IF NOT v_imediato THEN
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
      IF v_alvo IS NOT NULL THEN
        v_por_alvo := v_por_alvo || jsonb_build_object(v_alvo::text,
                        COALESCE((v_por_alvo ->> v_alvo::text)::integer, 0) + 1);
      END IF;
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
    IF v_res IN ('aplicado', 'reservado') AND para_user_id IS NOT NULL THEN
      v_por_alvo := v_por_alvo || jsonb_build_object(para_user_id::text,
                      COALESCE((v_por_alvo ->> para_user_id::text)::integer, 0) + 1);
    END IF;
    RETURN NEXT;
  END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION public.rodizio_distribuir_sem_resposta_agora(boolean, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rodizio_distribuir_sem_resposta_agora(boolean, uuid, integer) TO authenticated, service_role;

-- ================================================================ J. verificação (só leitura)
-- Rizodent = tenant 00000000-0000-0000-0000-000000000010. Nada aqui escreve.
--
-- (a) A COLUNA E A RÉGUA DOS FUNIS
--   SELECT funis_ids, corte_tolerancia_min FROM public.crm_rodizio_config
--    WHERE tenant_id = '00000000-0000-0000-0000-000000000010';
--   -- funis_ids NULL = padrão (só rodizio_funil), o comportamento de antes
--   SELECT public.rodizio_funil('00000000-0000-0000-0000-000000000010') AS um_funil,
--          public.rodizio_funis('00000000-0000-0000-0000-000000000010') AS lista;
--   -- os funis do cliente, para o gestor escolher na tela: ig, pv e
--   -- allowed_roles são exatamente os três motivos de recusa da RPC — funil com
--   -- allowed_roles preenchido ("Padrão Closer", "Padrão Recepção") a SDR nem
--   -- consegue abrir (can_access_pipeline = false para o papel sdr).
--   SELECT id, name, position, COALESCE(is_instagram,false) ig, COALESCE(is_posvenda,false) pv,
--          allowed_roles
--     FROM public.crm_pipelines WHERE tenant_id = '00000000-0000-0000-0000-000000000010'
--    ORDER BY COALESCE(position, 1000), created_at;
--   -- quantas etapas de entrada a união produz (antes: só as do Funil Principal)
--   SELECT array_length(public.rodizio_etapas_entrada('00000000-0000-0000-0000-000000000010'), 1);
--
-- (b) QUANTOS LEADS ESTAVAM INVISÍVEIS PARA O MOTOR (o defeito A, em número)
--   SELECT p.name, count(*) AS leads_do_admin_na_fila
--     FROM public.crm_leads l JOIN public.crm_pipelines p ON p.id = l.pipeline_id
--    WHERE l.tenant_id = '00000000-0000-0000-0000-000000000010'
--      AND l.distribuido_em IS NULL
--      AND public.rodizio_lead_na_fila(l,
--            (SELECT gestor_user_id FROM public.crm_rodizio_config WHERE tenant_id = l.tenant_id),
--            public.rodizio_funil(l.tenant_id),
--            public.rodizio_numero_principal(l.tenant_id),
--            public.rodizio_etapas_entrada(l.tenant_id))
--    GROUP BY p.name ORDER BY 2 DESC;
--   -- rodar ANTES de preencher funis_ids e DEPOIS: a diferença são os leads
--   -- dos funis novos que o motor não via.
--
-- (c) O RELÓGIO COMERCIAL (defeito B)
--   SELECT business_hours, timezone FROM public.tenants
--    WHERE id = '00000000-0000-0000-0000-000000000010';
--   -- ontem 17:55 → hoje 08:00 (fuso da clínica): parede x úteis
--   WITH t AS (SELECT '00000000-0000-0000-0000-000000000010'::uuid tn,
--                     ((current_date - 1) + time '17:55') AT TIME ZONE public.rodizio_tz('00000000-0000-0000-0000-000000000010') de,
--                     (current_date + time '08:00') AT TIME ZONE public.rodizio_tz('00000000-0000-0000-0000-000000000010') ate)
--   SELECT floor(extract(epoch FROM (ate - de))/60)::int AS min_parede,
--          public.rodizio_minutos_uteis(tn, de, ate) AS min_uteis FROM t;
--   -- min_parede ~ 845; min_uteis deve ser só o pedaço comercial (fecha 18h,
--   -- abre 8h → ~5 min de ontem + 0 de hoje). Feriado/domingo devem zerar:
--   SELECT public.rodizio_minutos_uteis('00000000-0000-0000-0000-000000000010',
--            now() - interval '90 days', now());   -- teto: 999999
--
-- (d) O ALMOÇO (defeito C)
--   SELECT m.user_id, public.rodizio_nome(m.user_id) AS sdr,
--          m.hora_entrada, m.hora_saida, m.almoco_inicio, m.almoco_fim, m.sabado_entrada,
--          public.rodizio_em_almoco(m.tenant_id, m.user_id, now()) AS em_almoco_agora
--     FROM public.crm_rodizio_membros m
--    WHERE m.tenant_id = '00000000-0000-0000-0000-000000000010' AND m.ativo;
--   -- e o efeito no pool: durante o almoço dela, aberta = false, presente = true
--   SELECT * FROM public.rodizio_pool('00000000-0000-0000-0000-000000000010');
--   -- simular o meio do almoço sem esperar a hora:
--   SELECT public.rodizio_em_almoco('00000000-0000-0000-0000-000000000010', m.user_id,
--            (current_date + m.almoco_inicio + interval '5 minutes') AT TIME ZONE public.rodizio_tz(m.tenant_id))
--     FROM public.crm_rodizio_membros m
--    WHERE m.tenant_id = '00000000-0000-0000-0000-000000000010' AND m.almoco_inicio IS NOT NULL;
--
-- (e) O CORTE SEM WRAP (defeito E) — a conta que dava a volta no relógio
--   SELECT h.entrada, cfg.corte_tolerancia_min,
--          (h.entrada + make_interval(mins => cfg.corte_tolerancia_min))::time AS limite_antigo_com_wrap,
--          ((current_date + h.entrada) AT TIME ZONE public.rodizio_tz(cfg.tenant_id))
--            + make_interval(mins => cfg.corte_tolerancia_min) AS limite_novo_ts,
--          now() >= (((current_date + h.entrada) AT TIME ZONE public.rodizio_tz(cfg.tenant_id))
--            + make_interval(mins => cfg.corte_tolerancia_min)) AS venceu
--     FROM public.crm_rodizio_config cfg
--     JOIN public.crm_rodizio_membros m ON m.tenant_id = cfg.tenant_id AND m.ativo
--     CROSS JOIN LATERAL public.rodizio_horario_dia(cfg.tenant_id, m.user_id, current_date) h
--    WHERE cfg.tenant_id = '00000000-0000-0000-0000-000000000010' AND h.entrada IS NOT NULL;
--   -- entrada 17:00 + 480 min: limite_antigo_com_wrap = 01:00 (verdadeiro o dia
--   -- inteiro) e limite_novo_ts = amanhã 01:00 (falso agora). É o defeito.
--
-- (f) PONTO: NENHUM EVENTO AUTOMÁTICO EMPATADO COM O HUMANO (defeito F)
--   SELECT e.tenant_id, e.user_id, e.em, e.tipo, e.origem
--     FROM public.crm_ponto_eventos e
--    WHERE e.tenant_id = '00000000-0000-0000-0000-000000000010'
--      AND e.em >= now() - interval '7 days'
--    ORDER BY e.user_id, e.em DESC, e.id DESC;
--   -- empates a caçar (a partir de agora não devem mais nascer):
--   SELECT a.user_id, a.em, a.tipo, b.tipo
--     FROM public.crm_ponto_eventos a JOIN public.crm_ponto_eventos b
--       ON b.tenant_id = a.tenant_id AND b.user_id = a.user_id AND b.em = a.em AND b.id <> a.id
--    WHERE a.origem = 'auto';
--
-- (g) PAINEL DO GESTOR (defeito A visível na tela) — logado como gestor:
--   SELECT public.rodizio_estado();
--   -- deve trazer funis_ids, funis [{id,nome}], corte_tolerancia_min,
--   -- entrega_gestor_apos_min, entregas_pendentes e equipe com entrada_hoje/saida_hoje.
--
-- (h) LOTE COM TETO (defeito I) — dry-run primeiro, sempre:
--   SELECT * FROM public.rodizio_distribuir_sem_resposta_agora(true, NULL, 20);
--   -- a última linha deve ser "parou aqui: <SDR> já recebeu o teto de 20 ...".
--   SELECT count(*) FROM public.rodizio_distribuir_sem_resposta_agora(true);  -- sem teto: o total
--
-- (i) PORTAS (nenhuma função nova aberta para anon; nenhum papel ganhou nada)
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
--          has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('rodizio_funis','rodizio_minutos_uteis','rodizio_em_almoco',
--                        'rodizio_definir_funis','rodizio_distribuir_sem_resposta_agora',
--                        'rodizio_estado','rodizio_pool','rodizio_lead_na_fila')
--    ORDER BY 1;
--   -- esperado: anon = false em todas; authenticated = true só em
--   -- rodizio_definir_funis, rodizio_estado e rodizio_distribuir_sem_resposta_agora.
--   -- E toda função do motor com search_path fixo:
--   SELECT p.proname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname LIKE 'rodizio_%'
--      AND (p.proconfig IS NULL OR NOT ('search_path=public' = ANY (p.proconfig)));
--   -- só devem aparecer as IMMUTABLE puras (rodizio_escolher, rodizio_msg_humana,
--   -- rodizio_fonte_excluida), que não tocam em tabela.
--
-- (j) NADA DE POLICY MUDOU (esta migration não cria, edita nem remove policy):
--   SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN
--     ('crm_leads','crm_lead_atribuicoes','crm_rodizio_config','crm_rodizio_membros','crm_ponto_eventos');
--   -- comparar com o número de antes do deploy.
