-- =============================================================================
-- A realocação por silêncio não tira o lead de quem está com a conversa ABERTA.
--
-- RELATO DO DONO (11/09/2026): "aconteceu de a sdr está com a conversa aberta de
-- um lead que estava na espera, e estava pra responder ele e ele foi transferido
-- para outro sdr, sendo que ela já estava pra responder, isso não pode
-- acontecer."
--
-- POR QUE ACONTECIA. A régua da realocação olhava só o relógio: passou do limite
-- sem resposta humana, o lead troca de dona. Ela não tinha como saber que alguém
-- estava ali, digitando — o sistema não guardava esse sinal em lugar nenhum.
-- (A tabela messages não tem is_read, read_at nem read_by: não havia nem por
-- onde inferir.)
--
-- O QUE ESTA MIGRATION FAZ. Cria o sinal e faz a realocação respeitá-lo:
--   1. crm_leads.em_atendimento_por / em_atendimento_em — quem está na conversa
--      e desde quando.
--   2. RPC conversa_estou_aqui(lead) — a tela carimba ao abrir e renova a cada
--      minuto ENQUANTO A ABA ESTIVER VISÍVEL.
--   3. crm_rodizio_config.presenca_segura_min (padrão 5) — por quanto tempo o
--      carimbo segura o lead.
--   4. rodizio_realocar_sem_resposta passa a pular o lead carimbado pela DONA
--      ATUAL dentro dessa janela.
--
-- POR QUE A PRESENÇA NÃO VIRA ARMA PARA PRENDER LEAD. Três travas: o carimbo só
-- conta se for da dona atual (colega que abriu para olhar não segura nada); dura
-- poucos minutos e precisa ser renovado; e a renovação para quando a aba perde a
-- visibilidade. Quem deixou a tela aberta e foi almoçar para de renovar, e em
-- cinco minutos o lead volta a andar. Isso é de propósito: a regra existe para
-- proteger quem está trabalhando, não para reservar fila.
-- =============================================================================

-- ============================================================ 1. o sinal
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS em_atendimento_por uuid,
  ADD COLUMN IF NOT EXISTS em_atendimento_em  timestamptz;

COMMENT ON COLUMN public.crm_leads.em_atendimento_por IS
  'Quem está com esta conversa aberta agora (carimbado pela RPC conversa_estou_aqui). Serve para a realocação por silêncio não tirar o lead de quem está atendendo.';
COMMENT ON COLUMN public.crm_leads.em_atendimento_em IS
  'Quando o carimbo de presença foi renovado pela última vez. Vale por crm_rodizio_config.presenca_segura_min minutos.';

-- Índice só do que a realocação consulta, e só das linhas que interessam.
CREATE INDEX IF NOT EXISTS idx_crm_leads_presenca
  ON public.crm_leads (em_atendimento_por, em_atendimento_em)
  WHERE em_atendimento_por IS NOT NULL;

ALTER TABLE public.crm_rodizio_config
  ADD COLUMN IF NOT EXISTS presenca_segura_min integer NOT NULL DEFAULT 5;

COMMENT ON COLUMN public.crm_rodizio_config.presenca_segura_min IS
  'Por quantos minutos o carimbo de presença segura o lead com a dona atual. A tela renova a cada minuto enquanto a aba está visível, então este número é a folga depois que a pessoa sai da tela.';

-- ============================================================ 2. a RPC
-- Carimba presença. Só quem pode ABRIR o lead carimba — a mesma régua de sempre
-- (sdr_pode_ver_lead para SDR; tenant para os demais papéis do cliente).
--
-- NÃO toca updated_at: se tocasse, cada carimbo de cada SDR, de minuto em
-- minuto, viraria um evento de mudança que faria a lista de conversas de todo
-- mundo reordenar sozinha.
CREATE OR REPLACE FUNCTION public.conversa_estou_aqui(p_lead_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid; v_ok boolean;
BEGIN
  IF auth.uid() IS NULL OR p_lead_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_sessao');
  END IF;

  SELECT l.tenant_id INTO v_tenant FROM public.crm_leads l WHERE l.id = p_lead_id;
  IF v_tenant IS NULL OR v_tenant IS DISTINCT FROM public.current_tenant_id() THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'fora_do_cliente');
  END IF;

  IF public.has_role(auth.uid(), 'sdr'::app_role) THEN
    v_ok := public.sdr_pode_ver_lead(p_lead_id);
  ELSE
    v_ok := true;  -- tenant já conferido acima
  END IF;
  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_acesso');
  END IF;

  UPDATE public.crm_leads
     SET em_atendimento_por = auth.uid(),
         em_atendimento_em  = now()
   WHERE id = p_lead_id;

  RETURN jsonb_build_object('ok', true, 'em', now());
END $fn$;
REVOKE ALL ON FUNCTION public.conversa_estou_aqui(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversa_estou_aqui(uuid) TO authenticated, service_role;

-- ============================================================ 3. a realocação
-- Corpo copiado VERBATIM de 20260910140000_relogio_justo_do_silencio.sql, com
-- UMA adição: o predicado de presença no WHERE do ramo 'ligado'. Tudo o mais
-- continua igual — ramo sombra, peneira barata antes do LIMIT 100, teto de uma
-- realocação por lead por dia, régua de resposta humana, relógio do expediente
-- da SDR, teto de ausência, carência de abertura, livro e mensagem de sistema.
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
    -- "hoje" da clínica: fronteira do teto de uma realocação por lead por dia,
    -- e também o dia do teto de ausência (o começo do dia local é onde se
    -- pergunta "ela trabalhou algum minuto hoje?").
    v_tz := public.rodizio_tz(c.tenant_id);
    v_hoje := (now() AT TIME ZONE v_tz)::date;
    v_ini := (v_hoje::timestamp) AT TIME ZONE v_tz;
    v_avisadas := ARRAY[]::uuid[];

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
             -- PRESENÇA: não tirar o lead de quem está COM A CONVERSA ABERTA.
             -- Relato do dono em 11/09: "a sdr estava com a conversa aberta de um
             -- lead que estava na espera, e estava pra responder ele e ele foi
             -- transferido para outro sdr, sendo que ela já estava pra responder,
             -- isso não pode acontecer". Repare que o carimbo só vale se for da
             -- DONA ATUAL: colega que abriu para olhar não segura o lead de
             -- ninguém. E vale por poucos minutos (presenca_segura_min), com a
             -- tela renovando enquanto a aba está visível — quem fechou o
             -- navegador ou foi embora para de renovar e o lead volta a andar.
             AND NOT (l0.em_atendimento_por IS NOT NULL
                      AND l0.em_atendimento_por = l0.assigned_to
                      AND l0.em_atendimento_em IS NOT NULL
                      AND l0.em_atendimento_em > now()
                          - make_interval(mins => COALESCE(cfg.presenca_segura_min, 5)))
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
        -- Segue seguro com o relógio novo, por dois motivos: minutos
        -- TRABALHADOS pela dona também nunca passam de minutos corridos, e o
        -- limite deste lead só CRESCE com a carência de abertura. Quem a peneira
        -- corta aqui jamais seria realocado lá dentro. Vale também para o ramo
        -- de dona ausente, que volta ao relógio da clínica: ele igualmente nunca
        -- passa dos minutos corridos, e ali o limite é o base, sem carência.
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
      -- 100), e não no WHERE: quem passou a peneira de parede mas não tem
      -- minutos suficientes NO RELÓGIO CERTO fica onde está.
      IF cfg.modo = 'sombra' THEN
        -- RAMO SOMBRA: não existe dona de verdade. A "dona" é a última anotação
        -- de fase 'sombra' e o lead segue com o administrador — ninguém abriu
        -- expediente por esse lead, então não há expediente de quem cobrar. O
        -- relógio continua o COMERCIAL da clínica, exatamente como era: sombra
        -- só ensaia o motor no papel, e mudar a régua dela mudaria o que o
        -- ensaio prevê sem que ninguém tenha sido injustiçado.
        v_fora := false;
        v_ausente := false;
        v_limite := cfg.realocar_sem_resposta_min;
        v_min := public.rodizio_minutos_uteis(c.tenant_id, GREATEST(r.last_inbound_at, r.desde), now());
        -- sentinela de 30 dias: o número cru decide, o texto vira frase (senão
        -- o livro e o chat diriam "999999 min sem resposta").
        v_txt := CASE WHEN v_min >= 999999 THEN 'mais de 30 dias' ELSE v_min || ' min úteis' END;
      ELSE
        -- RAMO LIGADO: o lead TEM dona, então o relógio é o DELA — minutos em
        -- que o expediente estava ABERTO e não pausado (rodizio_minutos_da_sdr).
        -- Almoço, pausa de café, noite, fim de semana e feriado deixam de
        -- correr contra ela, e não por regra especial: é que ela não estava
        -- trabalhando. Era o pedido do dono — "quando o sdr tiver pausado para
        -- o almoço (...) os leads dele por mais que tenham mais de 30 min sem
        -- resposta deve continuar com ele".
        --
        -- TETO DE AUSÊNCIA, primeiro: quem NÃO VEIO trabalhar não segura lead.
        -- Sem ele, a dona que falta (atestado, férias, conta esquecida, ou
        -- clicou 'pausar' ontem e foi embora) tem zero minuto para sempre: o
        -- lead dela nunca mais é realocado, ninguém é avisado e — pior — esses
        -- leads ficam na cabeça da fila (ORDER BY silêncio mais antigo,
        -- LIMIT 100) consumindo as 100 vagas de toda rodada, até a realocação
        -- morrer em silêncio para o cliente inteiro. A régua é a MESMA do corte
        -- da manhã (rodizio_corte_9h): não trabalha hoje, ou já passou da
        -- entrada dela mais cfg.corte_tolerancia_min — E nada trabalhado hoje.
        -- As duas metades importam: só "não bateu ponto" puniria quem ainda
        -- está dentro da tolerância da entrada; só "passou da entrada" puniria
        -- quem abriu no horário e está no almoço.
        SELECT * INTO h FROM public.rodizio_horario_dia(c.tenant_id, r.dona, v_hoje);

        -- (i) QUEM BATEU PONTO HOJE NUNCA É AUSENTE. Esta é a metade que faltava
        -- e que produzia acusação falsa: a SDR com o sábado em branco no cadastro
        -- (rodizio_horario_dia devolve entrada NULL para quem TEM horário próprio)
        -- ou de turno trocado aparecia com h.entrada IS NULL, caía direto em
        -- "ausente" e tinha os leads levados para as colegas enquanto estava
        -- sentada atendendo — com um aviso ao gestor dizendo que ela não abriu o
        -- expediente. É a mesma leitura de ponto que rodizio_pool já faz.
        -- (ii) O PRAZO NÃO PODE VENCER FORA DA JANELA EM QUE O MOTOR RODA. A
        -- função só roda com a clínica aberta; se entrada + tolerância caísse
        -- depois do fechamento (entrada tarde, ou tolerância grande — a tela
        -- aceita até 480 min), não existiria instante que satisfizesse as duas
        -- coisas: ninguém seria declarado ausente NUNCA, o lead ficaria parado
        -- para sempre e ainda ocuparia vaga na fila de 100 a cada rodada.
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
          -- O gestor precisa saber, e uma vez só: a chave de dedupe cuida do
          -- dia (rodizio_notifica ignora repetição), e o array cuida da rodada,
          -- para não recontar os leads calados a cada lead dela no lote.
          -- Sem gestor_user_id configurado não há para quem avisar
          -- (rodizio_notifica devolve na hora) — a realocação acontece do mesmo
          -- jeito, só o aviso se perde; é mais um motivo para a aba Equipe
          -- exigir um gestor.
          -- A contagem abaixo é a consulta mais cara do laço (anti-join em
          -- messages sobre todos os leads dela). O array v_avisadas evita
          -- repetir dentro da rodada, mas o dedupe do DIA vive dentro de
          -- rodizio_notifica, que descarta a notificação DEPOIS de a contagem
          -- já ter sido paga — eram onze varreduras jogadas fora por dona
          -- ausente por dia. Testar a chave antes evita todas elas.
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
          -- Relógio da CLÍNICA, como era antes desta migration. A CARÊNCIA DE
          -- ABERTURA CONTINUA VALENDO: tirá-la aqui criava um degrau na hora da
          -- tolerância — a SDR que chegasse 61 minutos atrasada perdia de uma
          -- vez a fila inteira da noite, porque os leads que escreveram fora do
          -- horário dela deixavam de ter limite + carência e passavam a ter só
          -- o limite, na mesma rodada. O "prazo maior pela manhã" que o dono
          -- pediu não pode sumir por atraso; quem não veio já perde o lead pelo
          -- relógio da clínica, que é o freio desta regra.
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
          -- A mensagem chegou FORA do horário CONTRATADO dela? A pergunta é
          -- sobre o CONTRATO, não sobre o clique: rodizio_horario_dia no dia do
          -- inbound (o horário dela, ou o da clínica quando ela não tem horário
          -- próprio) mais rodizio_dia_util, para feriado e dia em que a clínica
          -- não abre. Antes isto era medido chamando o relógio numa janela de
          -- dois minutos em torno do inbound, o que dava a carência TAMBÉM
          -- quando a mensagem chegou durante a PAUSA dela — e o relógio dela já
          -- resolve o almoço inteiro. As duas coisas somadas faziam o lead que
          -- escreveu 12h10 só poder trocar de dona no meio da tarde. O empate
          -- continua a favor da SDR: horário faltando no cadastro = fora.
          v_dia_in := (r.last_inbound_at AT TIME ZONE v_tz)::date;
          SELECT * INTO hin FROM public.rodizio_horario_dia(c.tenant_id, r.dona, v_dia_in);
          v_fora := NOT public.rodizio_dia_util(c.tenant_id, v_dia_in)
                    OR hin.entrada IS NULL OR hin.saida IS NULL
                    OR r.last_inbound_at <  ((v_dia_in + hin.entrada) AT TIME ZONE v_tz)
                    OR r.last_inbound_at >= ((v_dia_in + hin.saida)   AT TIME ZONE v_tz);
          -- O "prazo maior pela manhã" do dono: quem chegou fora do horário
          -- dela ganha a carência de abertura em cima do limite normal. Ela abre
          -- o dia com a fila da noite acumulada e tem folga para responder.
          v_limite := cfg.realocar_sem_resposta_min
                    + CASE WHEN v_fora THEN COALESCE(cfg.realocar_carencia_abertura_min, 60) ELSE 0 END;
          v_min := public.rodizio_minutos_da_sdr(c.tenant_id, r.dona, GREATEST(r.last_inbound_at, r.desde), now());
          v_txt := v_min || ' min de expediente dela'
                || CASE WHEN v_fora THEN ' (mensagem chegou fora do horário dela)' ELSE '' END;
        END IF;
      END IF;
      -- A peneira barata do WHERE continua válida: ela usa o limite BASE em
      -- tempo de parede, e (a) minutos trabalhados nunca passam de minutos
      -- corridos, (b) o limite deste lead só CRESCE com a carência. Quem não
      -- passou lá jamais passaria aqui.
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
      -- o que a mensagem e o livro dizem é o silêncio no relógio CERTO (v_min e
      -- v_txt já calculados no topo do laço, sem uma segunda chamada da função):
      -- no ramo ligado, minutos de expediente DELA — ou minutos úteis da clínica
      -- quando ela não abriu o expediente hoje, e aí o texto diz isso; no
      -- sombra, minutos úteis da clínica. Dizer "840 min sem resposta" para uma
      -- noite inteira era acusação falsa — e cobrar o almoço dela era pior.
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
        v_txt || ' sem resposta humana da dona (limite ' || v_limite || ' min'
        || CASE WHEN v_fora
                THEN ' = ' || cfg.realocar_sem_resposta_min || ' + '
                     || COALESCE(cfg.realocar_carencia_abertura_min, 60)
                     || ' de carência porque a mensagem chegou fora do horário contratado dela'
                ELSE '' END
        -- com a dona ausente o motivo do relógio já saiu dentro de v_txt
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
REVOKE ALL ON FUNCTION public.rodizio_realocar_sem_resposta() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rodizio_realocar_sem_resposta() TO service_role;