-- =============================================================================
-- CONVERSA FECHADA NÃO É REALOCADA (decisão do dono, 24/09/2026)
--
-- O caso que trouxe a regra: lead BARBARA (5adc6f00), 24/09. A paciente mandou
-- um áudio às 09:32 dizendo a disponibilidade dela, a Kelly FECHOU a conversa
-- às 09:44, e às 10:07 o motor realocou o lead para a Bia — "34 min de
-- expediente dela sem resposta humana". A Bia devolveu à mão 3 minutos depois.
--
-- Por que isso acontecia: a escolha dos candidatos NUNCA olhou
-- `conversa_fechada_em`. Foi de propósito em 11/09 — na época o medo era o
-- lead agendado, cujo "Ok" de confirmação reabre a conversa
-- (trg_zz_conversa_reabre_ao_receber) e desfazia a proteção em segundos. A
-- saída de lá foi proteger por ETAPA (v_paradas), e ela CONTINUA valendo.
--
-- O que muda agora: fechar a conversa também segura o lead com quem fechou.
-- A reabertura continua sendo a válvula — se a paciente escrever de novo, a
-- conversa reabre e o relógio do silêncio volta a correr a partir dali. Ou
-- seja, a regra só protege enquanto ninguém do outro lado estiver esperando.
--
-- O risco, dito com todas as letras: fechar a conversa com mensagem da
-- paciente pendente (foi o caso da BARBARA) agora faz o lead PARAR na mão de
-- quem fechou, e ninguém responde por ela. Isso vira assunto de gestão, não
-- de sistema — o relatório da SDR e a aba Conversas seguem mostrando.
--
-- Vale nos DOIS ramos do UNION ALL (motor ligado e modo sombra), para a
-- simulação continuar espelhando o que aconteceria de verdade.
-- =============================================================================

DO $aplica$
DECLARE d text; alvo text; quantos int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rodizio_realocar_sem_resposta';

  IF d IS NULL THEN
    RAISE EXCEPTION 'rodizio_realocar_sem_resposta não existe neste banco';
  END IF;

  IF position('l0.conversa_fechada_em IS NULL' in d) > 0 THEN
    RAISE NOTICE 'rodizio_realocar_sem_resposta já protege conversa fechada';
    RETURN;
  END IF;

  -- POR QUE TRANSFORMAR EM VEZ DE RECOLAR A FUNÇÃO INTEIRA: mesma razão da
  -- migration 20260911310000 — esta função é o coração do rodízio e recolar
  -- uma cópia do repositório já reverteu decisão do dono em silêncio uma vez.
  -- Lemos o corpo QUE ESTÁ EM PRODUÇÃO, trocamos por âncora literal, e
  -- abortamos se a âncora não aparecer exatamente duas vezes.
  alvo := '             AND NOT (l0.stage_id = ANY (v_paradas))';

  SELECT count(*) INTO quantos
    FROM regexp_matches(d, replace(replace(replace(alvo, '\', '\\'), '(', '\('), ')', '\)'), 'g');
  IF quantos <> 2 THEN
    RAISE EXCEPTION 'âncora da etapa parada apareceu % vez(es), esperava 2 — a função mudou de forma', quantos;
  END IF;

  d := replace(d, alvo,
       alvo || E'\n' ||
       '             -- CONVERSA FECHADA (24/09/2026): quem fechou fica com o lead.' || E'\n' ||
       '             -- Mensagem nova da paciente reabre (trg_zz_conversa_reabre_ao_receber)' || E'\n' ||
       '             -- e o relógio volta a correr dali — a proteção não vira esconderijo.' || E'\n' ||
       '             AND l0.conversa_fechada_em IS NULL');

  EXECUTE d;
  RAISE NOTICE 'rodizio_realocar_sem_resposta: conversa fechada passa a segurar o lead';
END $aplica$;

-- Conferência: tem de aparecer 2 vezes (um ramo ligado, um ramo sombra).
DO $confere$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace,
         regexp_matches(pg_get_functiondef(p.oid), 'l0\.conversa_fechada_em IS NULL', 'g')
   WHERE ns.nspname = 'public' AND p.proname = 'rodizio_realocar_sem_resposta';
  IF n <> 2 THEN
    RAISE EXCEPTION 'esperava 2 guardas de conversa fechada, encontrei %', n;
  END IF;
END $confere$;
