-- =============================================================================
-- Relatório de ponto do gestor: as pausas e o tempo de atendimento, no dia e no mês.
--
-- PEDIDO DO DONO (11/09/2026): "a sdr fabiola fez varias pausas no expediente
-- hoje, pra fazer ligacoes, e o sistema ta dizendo que tem 2 horas ativo, sendo
-- que ela abriu o expediente as 7:30 e agora sao 11:32. Preciso saber se esta
-- realmente certo. Alem disso preciso de um relatorio que mostre essas pausas e
-- o tempo de atendimento no dia/mes, tanto para o sdr quanto para o usuario
-- principal".
--
-- O NÚMERO JÁ ESTAVA CERTO — conferido evento a evento em crm_ponto_eventos
-- (fuso America/Bahia, 11/09/2026):
--     07:47:09 abrir
--     09:21:07 pausar (outro)      10:14:53 retomar      → 53min23 de pausa
--     10:58:35 pausar (cafe)       11:30:12 encerrar     → 31min37 de pausa
--   trabalhado 2h17 (137 min) · pausado 1h25 (85 min) · 2 pausas
-- O dono lembrava 07:30 (foram 07:47) e achava que ela seguia ativa (ela
-- encerrou 11:30 ainda dentro da pausa do café). Ou seja: o CÁLCULO está certo,
-- o que faltava era a TELA. public.ponto_relatorio existe desde o começo do
-- rodízio e NENHUMA parte do front a chama.
--
-- O QUE ESTA MIGRATION ACRESCENTA (só leitura; nenhuma escrita, nenhuma policy
-- criada/editada/removida, nenhuma tabela ou gatilho tocado):
--   public.ponto_pausas(p_de, p_ate)  — uma linha POR PAUSA.
--   public.ponto_resumo(p_de, p_ate)  — uma linha POR PESSOA no período.
-- As duas com a MESMA guarda de ponto_relatorio (public.is_gestor_equipe()) e o
-- MESMO teto de período (um ano), com a mesma mensagem de recusa.
--
-- DE ONDE VÊM OS NÚMEROS. Os totais (trabalhado, pausado, número de pausas)
-- saem de public.ponto_sessoes — a MESMA função que alimenta o cartão da SDR
-- (ponto_meu_estado) e o ponto_relatorio. Não existe uma segunda soma aqui: se
-- existisse, gestor e SDR veriam horas diferentes do mesmo dia. O que é novo é
-- só a QUEBRA por pausa, que ponto_sessoes não devolve — e a máquina de estados
-- do detalhamento é cópia fiel da dela:
--   • 'pausar' só vale com o expediente aberto e fora de pausa;
--   • 'retomar' só fecha pausa se havia pausa aberta;
--   • 'encerrar' FECHA a pausa aberta (é o caso da Fabíola às 10:58 — ela
--     encerrou sem retomar, e essa pausa tem de aparecer mesmo assim);
--   • um 'abrir' sem encerrar o anterior fecha a sessão E a pausa naquele
--     instante;
--   • evento órfão antes do primeiro 'abrir' da janela é ignorado.
-- Único arredondamento diferente: cada pausa da lista é truncada em minutos
-- inteiros (o mesmo piso de ponto_sessoes, aplicado por pausa). Somar a lista
-- pode dar 1–2 minutos a menos que o total da sessão; a AUTORIDADE do total é
-- sempre ponto_resumo, que vem de ponto_sessoes. Por isso ponto_pausas devolve
-- também os segundos de cada pausa.
--
-- O FURO CONHECIDO DA JANELA, E COMO FOI TRATADO. ponto_sessoes só enxerga
-- eventos DENTRO de [p_de, p_ate]. Sem tratar, uma sessão aberta 23:50 de ontem
-- e encerrada 02:00 de hoje SOME do relatório de hoje (o 'abrir' ficou de fora
-- da janela e, sem ele, os eventos seguintes são ignorados) e aparece CORTADA
-- na meia-noite no relatório de ontem. Regra adotada aqui — a mesma que
-- ponto_relatorio já usa para carimbar o dia (dia = dia do 'abrir'):
--   1. a sessão pertence ao dia em que ABRIU e é medida INTEIRA;
--   2. para isso a leitura vai até 24h depois do fim do período (ou até agora,
--      o que vier antes), então o 'encerrar' da madrugada seguinte entra na
--      conta e a sessão não é mais cortada na meia-noite;
--   3. sessão que abriu DEPOIS do fim do período (só apareceu por causa dessa
--      margem) é descartada;
--   4. sessão que abriu ANTES do início do período não entra — ela conta
--      inteira no período anterior. Nunca nos dois: nada é contado em dobro.
-- Consequência honesta, e escrita na tela: a madrugada de um expediente que
-- virou o dia aparece no dia em que ele COMEÇOU, não no dia seguinte.
-- Quem está com o expediente ABERTO AGORA é resolvido FORA da janela (âncora no
-- último 'abrir' da pessoa, exatamente como ponto_meu_estado faz), então uma
-- sessão que atravessou a madrugada e segue aberta continua visível como
-- "aberto agora" mesmo no relatório de hoje.
--
-- QUEM APARECE NO RESUMO. Todo perfil do cliente com papel sdr ou crc (o
-- administrador principal), mesmo sem nenhum expediente no período — é assim
-- que o gestor vê "o usuário principal não bate ponto" em vez de não ver linha
-- nenhuma — mais qualquer pessoa com evento de ponto no período (uma ex-SDR já
-- bloqueada, por exemplo) e qualquer pessoa com expediente aberto agora.
-- ATENÇÃO, e a tela diz isso: hoje SÓ papel sdr consegue bater ponto —
-- public.ponto_abrir chama public.ponto_exige_sdr(). O usuário principal (crc)
-- vai aparecer com "sem expediente no período" até que se decida abrir o ponto
-- para ele; essa decisão mexe em ponto_exige_sdr e NÃO está nesta migration.
--
-- Rollback: DROP das duas funções. Nada mais foi tocado.
-- =============================================================================

SET LOCAL lock_timeout = '5s';

-- ============================================================ 1. uma linha por PAUSA
-- Serve à lista da tela e é a fonte do "motivo mais frequente" do resumo.
-- ============================================== 0. o rótulo de um motivo
-- Ponto ÚNICO de tradução chave -> rótulo. Antes havia três listas fixas do mesmo
-- trio café/almoço/outro espalhadas (ponto_pausar, a tela do SDR e o aviso de
-- pausa longa do gestor); o CRC agora configura a lista, e qualquer cópia fixa
-- passaria a mentir. Motivo apagado depois de usado cai no COALESCE e volta como
-- a própria chave, para o relatório histórico não quebrar nem sumir com a pausa.
CREATE OR REPLACE FUNCTION public.ponto_rotulo_motivo(p_tenant uuid, p_chave text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT COALESCE(
    (SELECT m.rotulo FROM public.crm_ponto_motivos m
      WHERE m.tenant_id = p_tenant AND m.chave = p_chave),
    NULLIF(btrim(COALESCE(p_chave, '')), ''),
    'sem motivo');
$fn$;
REVOKE ALL ON FUNCTION public.ponto_rotulo_motivo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_rotulo_motivo(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ponto_pausas(p_de date, p_ate date)
RETURNS TABLE(
  user_id  uuid,
  nome     text,
  papel    text,
  dia      date,
  inicio   timestamptz,
  fim      timestamptz,
  minutos  integer,
  segundos integer,
  motivo   text,
  -- 11/09: o rótulo vem de crm_ponto_motivos (o CRC configura a lista) e o
  -- detalhe é o texto que a SDR escreve quando o motivo pede. Sem estes dois, a
  -- tela mostrava a CHAVE crua ('ligacao', 'reuniao_com_a_gerencia') e o motivo
  -- escrito não chegava a lugar nenhum — a SDR escrevia e ninguém lia.
  rotulo   text,
  detalhe  text,
  em_curso boolean,
  fim_por  text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_tz text;
  v_de timestamptz;
  v_ate timestamptz;        -- fim do período, EXCLUSIVO
  v_ler_ate timestamptz;    -- fim da LEITURA (margem da virada do dia)
  r record;
  v_ev record;
  v_aberta boolean;         -- há sessão aberta?
  v_sessao_abriu timestamptz;
  v_sessao_vale boolean;    -- a sessão abriu dentro do período pedido?
  v_pausa_desde timestamptz;
  v_pausa_motivo text;
  v_pausa_detalhe text;
  v_fecha timestamptz;
  v_fecha_por text;
BEGIN
  -- Mesma guarda e mesmo teto de ponto_relatorio.
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN RETURN; END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de OR (p_ate - p_de) > 366 THEN
    RAISE EXCEPTION 'Período inválido (no máximo um ano, com a data final depois da inicial).';
  END IF;

  v_tz      := public.ponto_fuso_do_tenant(v_tenant);
  v_de      := p_de::timestamp AT TIME ZONE v_tz;
  v_ate     := (p_ate + 1)::timestamp AT TIME ZONE v_tz;
  v_ler_ate := LEAST(now(), v_ate + interval '1 day');
  IF v_ler_ate <= v_de THEN RETURN; END IF;  -- período no futuro: nada a ler

  FOR r IN
    SELECT u.uid,
           (SELECT pf.nome FROM public.profiles pf WHERE pf.id = u.uid) AS nome,
           CASE WHEN public.has_role(u.uid, 'sdr'::app_role) THEN 'sdr'
                WHEN public.has_role(u.uid, 'crc'::app_role) THEN 'crc'
                ELSE 'outro' END AS papel
      FROM (SELECT DISTINCT e.user_id AS uid
              FROM public.crm_ponto_eventos e
             WHERE e.tenant_id = v_tenant AND e.em >= v_de AND e.em <= v_ler_ate) u
     ORDER BY 2
  LOOP
    v_aberta := false; v_sessao_abriu := NULL; v_sessao_vale := false;
    v_pausa_desde := NULL; v_pausa_motivo := NULL; v_pausa_detalhe := NULL;

    FOR v_ev IN
      SELECT e.tipo, e.motivo AS motivo_ev, e.motivo_detalhe AS detalhe_ev, e.em
        FROM public.crm_ponto_eventos e
       WHERE e.tenant_id = v_tenant AND e.user_id = r.uid
         AND e.em >= v_de AND e.em <= v_ler_ate
       ORDER BY e.em, e.id
    LOOP
      -- (1) este evento fecha a pausa aberta?
      v_fecha := NULL; v_fecha_por := NULL;
      IF v_aberta AND v_pausa_desde IS NOT NULL
         AND v_ev.tipo IN ('retomar', 'encerrar', 'abrir') THEN
        v_fecha := v_ev.em; v_fecha_por := v_ev.tipo;
      END IF;

      -- (2) fechou: devolve a pausa (só se a sessão dela conta para o período)
      IF v_fecha IS NOT NULL THEN
        IF v_sessao_vale THEN
          user_id  := r.uid;
          nome     := r.nome;
          papel    := r.papel;
          dia      := (v_sessao_abriu AT TIME ZONE v_tz)::date;
          inicio   := v_pausa_desde;
          fim      := v_fecha;
          segundos := GREATEST(0, (EXTRACT(EPOCH FROM (v_fecha - v_pausa_desde)))::integer);
          minutos  := segundos / 60;
          motivo   := v_pausa_motivo;
          rotulo   := public.ponto_rotulo_motivo(v_tenant, v_pausa_motivo);
          detalhe  := v_pausa_detalhe;
          em_curso := false;
          fim_por  := v_fecha_por;
          RETURN NEXT;
        END IF;
        v_pausa_desde := NULL; v_pausa_motivo := NULL; v_pausa_detalhe := NULL;
      END IF;

      -- (3) transições de sessão — cópia da máquina de estados de ponto_sessoes
      IF v_ev.tipo = 'abrir' THEN
        v_aberta := true;
        v_sessao_abriu := v_ev.em;
        v_sessao_vale := (v_ev.em >= v_de AND v_ev.em < v_ate);
      ELSIF NOT v_aberta THEN
        CONTINUE;  -- evento órfão (a sessão dele começou antes da janela)
      ELSIF v_ev.tipo = 'pausar' AND v_pausa_desde IS NULL THEN
        v_pausa_desde := v_ev.em;
        v_pausa_motivo := v_ev.motivo_ev;
        v_pausa_detalhe := v_ev.detalhe_ev;
      ELSIF v_ev.tipo = 'encerrar' THEN
        v_aberta := false; v_sessao_abriu := NULL; v_sessao_vale := false;
      END IF;
    END LOOP;

    -- (4) pausa ainda aberta no fim da leitura: conta até agora e vem marcada
    IF v_aberta AND v_pausa_desde IS NOT NULL AND v_sessao_vale THEN
      user_id  := r.uid;
      nome     := r.nome;
      papel    := r.papel;
      dia      := (v_sessao_abriu AT TIME ZONE v_tz)::date;
      inicio   := v_pausa_desde;
      fim      := NULL;
      segundos := GREATEST(0, (EXTRACT(EPOCH FROM (v_ler_ate - v_pausa_desde)))::integer);
      minutos  := segundos / 60;
      motivo   := v_pausa_motivo;
      rotulo   := public.ponto_rotulo_motivo(v_tenant, v_pausa_motivo);
      detalhe  := v_pausa_detalhe;
      em_curso := true;
      fim_por  := 'em_curso';
      RETURN NEXT;
    END IF;
  END LOOP;
END $fn$;

COMMENT ON FUNCTION public.ponto_pausas(date, date) IS
  'Uma linha por PAUSA do ponto no período (só o gestor da equipe). A pausa fechada por "encerrar" (a pessoa encerrou sem retomar) aparece com fim_por=encerrar; a que ainda corre vem com em_curso=true e contada até agora. A sessão pertence ao dia em que abriu e é medida inteira, mesmo atravessando a meia-noite. Minutos truncados por pausa: o total oficial é o de ponto_resumo.';

REVOKE ALL ON FUNCTION public.ponto_pausas(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_pausas(date, date) TO authenticated, service_role;

-- ============================================================ 2. uma linha por PESSOA
CREATE OR REPLACE FUNCTION public.ponto_resumo(p_de date, p_ate date)
RETURNS TABLE(
  user_id              uuid,
  nome                 text,
  papel                text,
  dias                 integer,
  minutos_trabalhados  integer,
  minutos_pausa        integer,
  pausas               integer,
  media_diaria_min     integer,
  motivo_top           text,
  rotulo_top           text,   -- 11/09: o nome que o CRC configurou, já traduzido
  motivo_top_qtd       integer,
  estado_agora         text,
  aberto_desde         timestamptz,
  pausado_desde        timestamptz,
  motivo_pausa_atual   text,
  rotulo_pausa_atual   text,
  minutos_sessao_atual integer,
  minutos_pausa_atual  integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_tz text;
  v_de timestamptz;
  v_ate timestamptz;
  v_ler_ate timestamptz;
  v_motivos jsonb := '{}'::jsonb;
  r record;
  s record;
  v_atual record;
  v_abrir timestamptz;
  v_dia date;
  v_ult_dia date;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN RETURN; END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de OR (p_ate - p_de) > 366 THEN
    RAISE EXCEPTION 'Período inválido (no máximo um ano, com a data final depois da inicial).';
  END IF;

  v_tz      := public.ponto_fuso_do_tenant(v_tenant);
  v_de      := p_de::timestamp AT TIME ZONE v_tz;
  v_ate     := (p_ate + 1)::timestamp AT TIME ZONE v_tz;
  v_ler_ate := LEAST(now(), v_ate + interval '1 day');

  -- Motivo mais frequente por pessoa: UMA passada na quebra de pausas (mesma
  -- régua da lista da tela, então o "mais frequente" bate com o que se vê).
  IF v_ler_ate > v_de THEN
    WITH m AS (
      SELECT pp.user_id AS uid,
             COALESCE(NULLIF(btrim(pp.motivo), ''), 'sem motivo') AS mot,
             count(*)::integer AS qtd
        FROM public.ponto_pausas(p_de, p_ate) pp
       GROUP BY 1, 2
    ), topo AS (
      SELECT DISTINCT ON (m.uid) m.uid, m.mot, m.qtd
        FROM m ORDER BY m.uid, m.qtd DESC, m.mot
    )
    SELECT COALESCE(jsonb_object_agg(topo.uid::text,
             jsonb_build_object('motivo', topo.mot, 'qtd', topo.qtd)), '{}'::jsonb)
      INTO v_motivos
      FROM topo;
  END IF;

  FOR r IN
    SELECT u.uid,
           (SELECT pf.nome FROM public.profiles pf WHERE pf.id = u.uid) AS nome,
           CASE WHEN public.has_role(u.uid, 'sdr'::app_role) THEN 'sdr'
                WHEN public.has_role(u.uid, 'crc'::app_role) THEN 'crc'
                ELSE 'outro' END AS papel
      FROM (
        -- a) o time do cliente que deveria bater ponto (aparece mesmo com zero)
        SELECT pf.id AS uid
          FROM public.profiles pf
         WHERE pf.tenant_id = v_tenant
           AND COALESCE(pf.is_blocked, false) = false
           AND (public.has_role(pf.id, 'sdr'::app_role) OR public.has_role(pf.id, 'crc'::app_role))
        UNION
        -- b) quem tem evento no período (inclui conta já bloqueada/desligada)
        SELECT DISTINCT e.user_id
          FROM public.crm_ponto_eventos e
         WHERE e.tenant_id = v_tenant AND e.em >= v_de AND e.em <= v_ler_ate
        UNION
        -- c) quem está com o expediente ABERTO agora, mesmo fora do período
        --    pedido (o painel "aberto agora" não pode depender do filtro)
        SELECT e2.user_id
          FROM public.crm_ponto_eventos e2
         WHERE e2.tenant_id = v_tenant
         GROUP BY e2.user_id
        HAVING (array_agg(e2.tipo ORDER BY e2.em DESC, e2.id DESC))[1] <> 'encerrar'
      ) u
     ORDER BY 2
  LOOP
    dias := 0; minutos_trabalhados := 0; minutos_pausa := 0; pausas := 0;
    v_ult_dia := NULL;

    IF v_ler_ate > v_de THEN
      FOR s IN SELECT * FROM public.ponto_sessoes(v_tenant, r.uid, v_de, v_ler_ate) LOOP
        -- abriu depois do período: só apareceu por causa da margem da virada
        CONTINUE WHEN s.abriu_em >= v_ate;
        v_dia := (s.abriu_em AT TIME ZONE v_tz)::date;
        IF v_ult_dia IS NULL OR v_dia <> v_ult_dia THEN
          dias := dias + 1; v_ult_dia := v_dia;
        END IF;
        minutos_trabalhados := minutos_trabalhados + COALESCE(s.minutos_trabalhados, 0);
        minutos_pausa       := minutos_pausa       + COALESCE(s.minutos_pausa, 0);
        pausas              := pausas              + COALESCE(s.pausas, 0);
      END LOOP;
    END IF;

    -- Estado AGORA, fora da janela do relatório: âncora no último 'abrir' da
    -- pessoa (o mesmo truque de ponto_meu_estado). COALESCE(v_abrir, now())
    -- garante que quem nunca abriu devolva zero linhas — e não o estado de
    -- quem veio antes nesta volta do laço.
    SELECT e.em INTO v_abrir
      FROM public.crm_ponto_eventos e
     WHERE e.tenant_id = v_tenant AND e.user_id = r.uid AND e.tipo = 'abrir'
     ORDER BY e.em DESC LIMIT 1;
    SELECT sa.* INTO v_atual
      FROM public.ponto_sessoes(v_tenant, r.uid, COALESCE(v_abrir, now()), now()) sa
     ORDER BY sa.abriu_em DESC LIMIT 1;

    estado_agora := COALESCE(v_atual.estado, 'fechado');
    IF estado_agora = 'fechado' THEN
      aberto_desde := NULL; pausado_desde := NULL; motivo_pausa_atual := NULL; rotulo_pausa_atual := NULL;
      minutos_sessao_atual := 0; minutos_pausa_atual := 0;
    ELSE
      aberto_desde         := v_atual.abriu_em;
      pausado_desde        := v_atual.pausa_desde;
      motivo_pausa_atual   := v_atual.motivo_pausa;
      rotulo_pausa_atual   := public.ponto_rotulo_motivo(v_tenant, v_atual.motivo_pausa);
      minutos_sessao_atual := COALESCE(v_atual.minutos_trabalhados, 0);
      minutos_pausa_atual  := COALESCE(v_atual.minutos_pausa, 0);
    END IF;

    media_diaria_min := CASE WHEN dias > 0 THEN minutos_trabalhados / dias ELSE 0 END;
    motivo_top       := v_motivos -> r.uid::text ->> 'motivo';
    rotulo_top       := public.ponto_rotulo_motivo(v_tenant, v_motivos -> r.uid::text ->> 'motivo');
    motivo_top_qtd   := COALESCE((v_motivos -> r.uid::text ->> 'qtd')::integer, 0);
    user_id := r.uid; nome := r.nome; papel := r.papel;
    RETURN NEXT;
  END LOOP;
END $fn$;

COMMENT ON FUNCTION public.ponto_resumo(date, date) IS
  'Uma linha por pessoa no período (só o gestor da equipe): dias com expediente, minutos trabalhados e de pausa, quantidade de pausas, média diária, motivo de pausa mais frequente e o estado AGORA (aberto/pausado/fechado, resolvido fora da janela do filtro). Totais vindos de ponto_sessoes, a mesma régua do cartão da SDR.';

REVOKE ALL ON FUNCTION public.ponto_resumo(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_resumo(date, date) TO authenticated, service_role;

-- =============================================================================
-- VERIFICAÇÃO (só leitura, depois de aplicar)
--
-- 1. Portas: nenhuma das duas aberta para anon; search_path fixo.
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--        has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
--        has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role,
--        p.proconfig, p.prosecdef
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname IN ('ponto_pausas','ponto_resumo');
-- -- esperado: anon=false, authenticated=true, service_role=true,
-- --           proconfig={search_path=public}, prosecdef=true.
--
-- 2. Nenhuma policy criada/removida por esta migration (comparar com o número
--    de antes do deploy — tem de ser o mesmo):
-- SELECT count(*) FROM pg_policies WHERE schemaname='public'
--  AND tablename IN ('crm_ponto_eventos','profiles','user_roles');
--
-- =============================================================================
-- ENSAIO 1 — os números da Fabíola de hoje, emulando o GESTOR (desfeito pelo
-- RAISE final; não escreve nada de qualquer forma).
--
-- DO $t$
-- DECLARE
--   v_gestor uuid := 'd9b27aa3-049e-4ec9-9ae3-fb160a9544fa';  -- Rizodent (crc, gestor da equipe)
--   v_hoje date := (now() AT TIME ZONE 'America/Bahia')::date;
--   rep text := E'\n'; r record; n integer; v_seg integer;
-- BEGIN
--   PERFORM set_config('request.jwt.claims',
--     json_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);
--   EXECUTE 'SET LOCAL ROLE authenticated';
--
--   FOR r IN SELECT * FROM public.ponto_resumo(v_hoje, v_hoje) ORDER BY 2 LOOP
--     rep := rep || format('1 resumo %s (%s): %s min trabalhados, %s de pausa, %s pausas, %s dia(s), agora=%s',
--       r.nome, r.papel, r.minutos_trabalhados, r.minutos_pausa, r.pausas, r.dias, r.estado_agora) || E'\n';
--   END LOOP;
--   -- esperado hoje (11/09/2026): Fabíola sdr 137 / 85 / 2 / 1 dia, agora=fechado;
--   --   Bia sdr com expediente aberto (agora=aberto ou pausado);
--   --   Rizodent crc 0/0/0/0 agora=fechado  ← o "usuário principal" não bate ponto.
--
--   FOR r IN SELECT * FROM public.ponto_pausas(v_hoje, v_hoje) ORDER BY 2, 5 LOOP
--     rep := rep || format('2 pausa %s %s→%s %s min motivo=%s fim_por=%s em_curso=%s',
--       r.nome, to_char(r.inicio AT TIME ZONE 'America/Bahia','HH24:MI'),
--       COALESCE(to_char(r.fim AT TIME ZONE 'America/Bahia','HH24:MI'),'—'),
--       r.minutos, COALESCE(r.motivo,'—'), r.fim_por, r.em_curso) || E'\n';
--   END LOOP;
--   -- esperado: Fabíola 09:21→10:14 (53 min, outro, fim_por=retomar) e
--   --           10:58→11:30 (31 min, cafe, fim_por=ENCERRAR) — é a pausa que
--   --           terminou com o encerramento, e ela TEM de aparecer.
--
--   SELECT sum(pp.segundos) INTO v_seg FROM public.ponto_pausas(v_hoje, v_hoje) pp
--    WHERE pp.nome = 'Fabíola';
--   SELECT pr.minutos_pausa INTO n FROM public.ponto_resumo(v_hoje, v_hoje) pr
--    WHERE pr.nome = 'Fabíola';
--   rep := rep || format('3 soma das pausas da lista: %s s (%s min) × total do resumo: %s min',
--     v_seg, v_seg/60, n) || E'\n';
--   -- esperado: 5123 s, que pela lista viram 84 min (53 + 31, cada pausa
--   -- truncada) e no resumo viram 85 min (ponto_sessoes soma as pausas ANTES
--   -- de truncar). É exatamente o 1 minuto de piso avisado no cabeçalho: a
--   -- diferença nunca passa do número de pausas, e o total oficial é o resumo.
--
--   EXECUTE 'RESET ROLE';
--   RAISE EXCEPTION 'ENSAIO (desfeito): %', rep;
-- END $t$;
--
-- =============================================================================
-- ENSAIO 2 — a guarda: quem NÃO é gestor não lê ponto de ninguém.
--
-- DO $t$
-- DECLARE
--   v_sdr uuid := '1717b224-800b-439a-8b9c-16f2336e3ee4';  -- Fabíola (sdr)
--   v_hoje date := (now() AT TIME ZONE 'America/Bahia')::date;
--   rep text := E'\n'; n integer;
-- BEGIN
--   PERFORM set_config('request.jwt.claims',
--     json_build_object('sub', v_sdr, 'role', 'authenticated')::text, true);
--   EXECUTE 'SET LOCAL ROLE authenticated';
--   BEGIN
--     SELECT count(*) INTO n FROM public.ponto_resumo(v_hoje, v_hoje);
--     rep := rep || '1 a SDR leu o resumo da equipe: ' || n || ' linhas (esperado: recusa)' || E'\n';
--   EXCEPTION WHEN OTHERS THEN rep := rep || '1 resumo: recusado (' || SQLERRM || ')' || E'\n'; END;
--   BEGIN
--     SELECT count(*) INTO n FROM public.ponto_pausas(v_hoje, v_hoje);
--     rep := rep || '2 a SDR leu as pausas da equipe: ' || n || ' linhas (esperado: recusa)' || E'\n';
--   EXCEPTION WHEN OTHERS THEN rep := rep || '2 pausas: recusado (' || SQLERRM || ')' || E'\n'; END;
--   EXECUTE 'RESET ROLE';
--   RAISE EXCEPTION 'ENSAIO (desfeito): %', rep;
-- END $t$;
--
-- =============================================================================
-- ENSAIO 3 — a VIRADA DO DIA (o furo de ponto_sessoes). Este escreve eventos e
-- desfaz tudo no RAISE final.
--
-- CUIDADO, e é por isso que tem session_replication_role: crm_ponto_eventos tem
-- o gatilho trg_zz_rodizio_ponto_abrir, que num INSERT de 'abrir' chama
-- public.rodizio_aplicar_lote_ao_abrir e DISTRIBUI LEADS para a pessoa. O
-- ensaio desliga os gatilhos só nesta transação ('replica'), então o lote não
-- roda. Rodar sem essa linha mexeria na fila real das SDRs.
--
-- DO $t$
-- DECLARE
--   v_tenant uuid := '00000000-0000-0000-0000-000000000010';
--   v_sdr uuid := '1717b224-800b-439a-8b9c-16f2336e3ee4';  -- Fabíola
--   v_tz text := 'America/Bahia';
--   v_d1 date := (now() AT TIME ZONE v_tz)::date - 30;      -- dia da abertura
--   v_d2 date := (now() AT TIME ZONE v_tz)::date - 29;      -- dia do encerramento
--   rep text := E'\n'; r record;
-- BEGIN
--   SET LOCAL session_replication_role = 'replica';   -- não dispara o rodízio
--   INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, motivo, origem, em) VALUES
--     (v_tenant, v_sdr, 'abrir',    NULL,   'admin', (v_d1 + time '23:50') AT TIME ZONE v_tz),
--     (v_tenant, v_sdr, 'pausar',   'cafe', 'admin', (v_d2 + time '00:30') AT TIME ZONE v_tz),
--     (v_tenant, v_sdr, 'retomar',  NULL,   'admin', (v_d2 + time '00:50') AT TIME ZONE v_tz),
--     (v_tenant, v_sdr, 'encerrar', NULL,   'admin', (v_d2 + time '02:00') AT TIME ZONE v_tz);
--   SET LOCAL session_replication_role = 'origin';
--
--   PERFORM set_config('request.jwt.claims',
--     json_build_object('sub','d9b27aa3-049e-4ec9-9ae3-fb160a9544fa','role','authenticated')::text, true);
--   EXECUTE 'SET LOCAL ROLE authenticated';
--
--   FOR r IN SELECT * FROM public.ponto_resumo(v_d1, v_d1) WHERE user_id = v_sdr LOOP
--     rep := rep || format('1 dia da abertura: %s min trabalhados, %s de pausa, %s dia(s)',
--       r.minutos_trabalhados, r.minutos_pausa, r.dias) || E'\n';
--   END LOOP;
--   -- esperado: 110 min trabalhados (23:50→02:00 menos os 20 de pausa) e 20 de
--   -- pausa — a sessão INTEIRA, não os 10 min até a meia-noite.
--   FOR r IN SELECT * FROM public.ponto_resumo(v_d2, v_d2) WHERE user_id = v_sdr LOOP
--     rep := rep || format('2 dia seguinte: %s min trabalhados, %s dia(s) (esperado 0 e 0)',
--       r.minutos_trabalhados, r.dias) || E'\n';
--   END LOOP;
--   FOR r IN SELECT * FROM public.ponto_pausas(v_d1, v_d1) WHERE user_id = v_sdr LOOP
--     rep := rep || format('3 pausa da madrugada aparece no dia %s: %s→%s (%s min)', r.dia,
--       to_char(r.inicio AT TIME ZONE v_tz,'DD/MM HH24:MI'),
--       to_char(r.fim AT TIME ZONE v_tz,'DD/MM HH24:MI'), r.minutos) || E'\n';
--   END LOOP;
--   -- esperado: dia = o da ABERTURA, mesmo a pausa tendo ocorrido depois da
--   -- meia-noite. Nada é contado duas vezes: o dia seguinte veio zerado.
--   EXECUTE 'RESET ROLE';
--   RAISE EXCEPTION 'ENSAIO (desfeito): %', rep;
-- END $t$;
-- =============================================================================
