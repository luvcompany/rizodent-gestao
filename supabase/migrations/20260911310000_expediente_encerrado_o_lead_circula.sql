-- =============================================================================
-- O lead volta a circular quando a SDR encerra o expediente antes da clínica.
--
-- DECISÃO DO DONO (11/09/2026), palavras dele: "Quero que o lead volte a
-- circular quando o expediente da sdr fechar mais cedo do que o horário da
-- clínica".
--
-- Isto AJUSTA — não revoga — a regra que ele pediu em 10/09: "quando o sdr
-- tiver pausado para o almoço ... os leads dele por mais que tenham mais de 30
-- min sem resposta deve continuar com ele ... Mesma coisa após encerrar o
-- expediente". Na prática, "após encerrar o expediente" queria dizer o FIM DO
-- DIA. O caso que não estava coberto é encerrar no meio do dia.
--
-- O QUE ESTAVA ACONTECENDO. rodizio_minutos_da_sdr só conta minuto com o ponto
-- ABERTO e não pausado — com o ponto encerrado ela devolve 0, para sempre. E o
-- teto de ausência (v_ausente) só pega quem NÃO clicou "abrir" no dia. Quem
-- abriu de manhã e encerrou às 11:30 caía no meio dos dois: o relógio dela
-- parado e nenhuma rede de proteção. Medido em 11/09 (sexta, clínica aberta até
-- as 18:00): Fabíola encerrou 11:30, Júlia 12:21 — um lead que escrevesse ao
-- meio-dia acumularia 0 minuto contra um limite de 30, enquanto o relógio da
-- clínica já marcava 138. O lead ficaria mudo até a meia-noite, e ainda ocuparia
-- a cabeça da fila (ORDER BY silêncio mais antigo / LIMIT 100) em todas as
-- rodadas seguintes.
--
-- ============================== O QUE NÃO MUDA ===============================
-- Os dois pedidos anteriores do dono continuam de pé, e isto foi provado por
-- ensaio antes de aplicar (tudo desfeito, o ponto real não foi tocado):
--
--   1. ABERTA desde 08:00             -> dela  301 | clínica  301  => usa o DELA
--   2. PAUSADA (almoço) desde 11:30   -> dela    0                 => SEGURA
--   3. ENCERROU 11:30, clínica aberta -> dela    0 | CLÍNICA  301  => CIRCULA
--   4. Mensagem 21h -> 23h30 (fechada)-> clínica   0               => SEGURA
--
--   * PAUSA (almoço, café, ligação) continua segurando: o último evento do dia
--     é 'pausar', não 'encerrar'.
--   * A NOITE continua segurando sozinha, sem regra nova: depois que a clínica
--     fecha, o relógio DA CLÍNICA também não corre.
--   * Reabrir o expediente devolve o relógio dela na hora.
--   * A carência de abertura (o "prazo maior pela manhã") continua valendo.
--
-- ============================ E O GESTOR FICA SABENDO ========================
-- Um aviso por SDR por dia: "encerrou às HH:MM e a clínica segue aberta". Sem
-- ele, leads mudariam de dona e o gestor não saberia por quê. Segue o mesmo
-- molde do aviso de "não abriu o expediente hoje", inclusive testando o dedupe
-- ANTES de pagar qualquer contagem cara.
-- =============================================================================

DO $aplica$
DECLARE d text; alvo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rodizio_realocar_sem_resposta';

  IF position('v_encerrou' in d) > 0 THEN
    RAISE NOTICE 'rodizio_realocar_sem_resposta já tem a regra do expediente encerrado';
    RETURN;
  END IF;

  -- POR QUE TRANSFORMAR EM VEZ DE RECOLAR A FUNÇÃO INTEIRA: esta função tem
  -- ~400 linhas e é o coração do rodízio. Recolar uma cópia do repositório foi
  -- exatamente o defeito que reprovou a primeira versão do pacote da pesquisa
  -- (uma cópia velha de relatorio_sdr_calc teria revertido uma decisão do dono
  -- em silêncio). Aqui lemos o corpo QUE ESTÁ EM PRODUÇÃO, trocamos os dois
  -- trechos por âncora literal, e abortamos se qualquer âncora não existir.
  alvo := '  v_ausente boolean;  -- a dona não abriu o expediente hoje?';
  IF position(alvo in d) = 0 THEN
    RAISE EXCEPTION 'âncora da declaração não encontrada — a função mudou de forma';
  END IF;
  d := replace(d, alvo,
       alvo || E'\n' ||
       '  v_encerrou boolean;      -- a dona ENCERROU o expediente e não voltou?' || E'\n' ||
       '  v_encerrou_em timestamptz;  -- quando (vai no aviso ao gestor)');

  alvo := '          v_min := public.rodizio_minutos_da_sdr(c.tenant_id, r.dona, GREATEST(r.last_inbound_at, r.desde), now());' || E'\n' ||
          '          v_txt := v_min || '' min de expediente dela''' || E'\n' ||
          '                || CASE WHEN v_fora THEN '' (mensagem chegou fora do horário dela)'' ELSE '''' END;';
  IF position(alvo in d) = 0 THEN
    RAISE EXCEPTION 'âncora do relógio da SDR não encontrada — a função mudou de forma';
  END IF;

  d := replace(d, alvo,
'          -- ENCERROU O EXPEDIENTE MAIS CEDO QUE A CLÍNICA? (decisão do dono,' || E'\n' ||
'          -- 11/09/2026). Ver o cabeçalho da migration 20260911310000 para o que' || E'\n' ||
'          -- continua valendo: pausa segura, noite segura, reabrir devolve o' || E'\n' ||
'          -- relógio dela.' || E'\n' ||
'          SELECT (e.tipo = ''encerrar''), e.em INTO v_encerrou, v_encerrou_em' || E'\n' ||
'            FROM public.crm_ponto_eventos e' || E'\n' ||
'           WHERE e.tenant_id = c.tenant_id AND e.user_id = r.dona AND e.em >= v_ini' || E'\n' ||
'           ORDER BY e.em DESC, e.id DESC LIMIT 1;' || E'\n' ||
E'\n' ||
'          IF COALESCE(v_encerrou, false) THEN' || E'\n' ||
'            IF NOT (r.dona = ANY (v_avisadas))' || E'\n' ||
'               AND cfg.gestor_user_id IS NOT NULL' || E'\n' ||
'               AND NOT EXISTS (SELECT 1 FROM public.crm_notifications n' || E'\n' ||
'                                WHERE n.user_id = cfg.gestor_user_id' || E'\n' ||
'                                  AND n.dedupe_key = ''rodizio:encerrou_cedo:'' || c.tenant_id::text' || E'\n' ||
'                                                     || '':'' || r.dona::text || '':'' || v_hoje::text) THEN' || E'\n' ||
'              v_avisadas := v_avisadas || r.dona;' || E'\n' ||
'              PERFORM public.rodizio_notifica(cfg.gestor_user_id, NULL,' || E'\n' ||
'                ''Rodízio: '' || public.rodizio_nome(r.dona) || '' encerrou o expediente e a clínica segue aberta'',' || E'\n' ||
'                ''Encerrou às '' || to_char(v_encerrou_em AT TIME ZONE v_tz, ''HH24:MI'')' || E'\n' ||
'                  || ''. Os leads dela sem resposta voltam a contar pelo relógio da clínica e podem ser realocados para quem está na mesa.'',' || E'\n' ||
'                ''rodizio:encerrou_cedo:'' || c.tenant_id::text || '':'' || r.dona::text || '':'' || v_hoje::text);' || E'\n' ||
'            END IF;' || E'\n' ||
'            v_min := public.rodizio_minutos_uteis(c.tenant_id, GREATEST(r.last_inbound_at, r.desde), now());' || E'\n' ||
'            v_txt := CASE WHEN v_min >= 999999 THEN ''mais de 30 dias'' ELSE v_min || '' min úteis'' END' || E'\n' ||
'                  || '' (relógio da clínica porque ela encerrou o expediente às ''' || E'\n' ||
'                  || to_char(v_encerrou_em AT TIME ZONE v_tz, ''HH24:MI'') || '')'';' || E'\n' ||
'          ELSE' || E'\n' ||
'            v_min := public.rodizio_minutos_da_sdr(c.tenant_id, r.dona, GREATEST(r.last_inbound_at, r.desde), now());' || E'\n' ||
'            v_txt := v_min || '' min de expediente dela''' || E'\n' ||
'                  || CASE WHEN v_fora THEN '' (mensagem chegou fora do horário dela)'' ELSE '''' END;' || E'\n' ||
'          END IF;');

  IF position('encerrou o expediente às' in d) = 0 THEN
    RAISE EXCEPTION 'a substituição do relógio não entrou';
  END IF;
  EXECUTE d;
END $aplica$;

-- =============================================================================
-- VERIFICAÇÃO (só leitura, depois de aplicar)
--
-- 1) As três peças estão lá?
-- SELECT position('v_encerrou' in pg_get_functiondef(p.oid)) > 0            AS regra_nova,
--        position('rodizio_minutos_da_sdr' in pg_get_functiondef(p.oid)) > 0 AS relogio_dela_preservado,
--        position('encerrou_cedo' in pg_get_functiondef(p.oid)) > 0          AS avisa_o_gestor
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND p.proname='rodizio_realocar_sem_resposta';
--
-- 2) Quem encerrou hoje, e quantos leads passam a circular:
-- WITH ultimo AS (
--   SELECT DISTINCT ON (e.user_id) e.user_id, e.tipo, e.em
--     FROM public.crm_ponto_eventos e
--    WHERE e.tenant_id='00000000-0000-0000-0000-000000000010'
--      AND e.em >= (date_trunc('day', now() AT TIME ZONE 'America/Bahia')) AT TIME ZONE 'America/Bahia'
--    ORDER BY e.user_id, e.em DESC, e.id DESC)
-- SELECT public.rodizio_nome(u.user_id), u.tipo,
--        to_char(u.em AT TIME ZONE 'America/Bahia','HH24:MI') AS as_horas
--   FROM ultimo u WHERE u.tipo = 'encerrar';
-- =============================================================================
