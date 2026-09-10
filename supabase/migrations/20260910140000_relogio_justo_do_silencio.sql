-- Relógio justo do silêncio: pausa, almoço e noite da SDR param o cronômetro
-- (10/09/2026 — pedido do dono).
--
-- O PEDIDO, palavras dele:
--   "quando o sdr tiver pausado para o almoco quando clicar no botao de pausa,
--    os leads dele por mais que tenham mais de 30 min sem resposta deve
--    continuar com ele e nao deve ser transferido pra outro. Mesma coisa apos
--    encerrar o expediente, os leads que ja sao dele que estao falando com ele
--    a noite ou ficou sem resposta, deve continuar com ele. E geralmente no
--    periodo da manha para esses leads tem que ter um prazo maior de resposta.
--    Pq imagina o seguinte o lead ficou de so passar o nome e o horario do
--    agendamento, e o sdr foi almocar e o lead respondeu durante o horario do
--    almoco, nao e justo o lead ser transferido para outro sdr ganhar o
--    agendamento. (...) Os unicos leads que devem redistribuir sao os que ainda
--    nao tem usuario responsavel como um dos sdrs, que sao leads da base, e
--    leads novos. Os que ja estao com elas durante a noite deve continuar com
--    elas."
--   E o motivo: "é uma regra pra manter a organização dos leads para o time e
--   evitar injustiças."
--
-- O DEFEITO, em uma frase: o relógio do silêncio era o da CLÍNICA e não o da
-- PESSOA. public.rodizio_minutos_uteis já não contava noite, domingo nem
-- feriado (migration 20260910011000) — mas, DENTRO do horário comercial,
-- contava o almoço dela, a pausa de café e o pedaço do dia em que ela não
-- tinha aberto (ou já havia encerrado) o expediente. O lead que respondeu
-- 12h10, enquanto ela almoçava, batia os 30 minutos às 12h40 e ia para outra
-- SDR — que ganhava o agendamento construído por ela. Era exatamente a
-- injustiça descrita no pedido.
--
-- A REGRA NOVA, em quatro linhas:
--   1. lead COM dona: o relógio é o EXPEDIENTE DELA — minutos em que o ponto
--      estava aberto, não pausado e DENTRO do horário dela. Almoço, pausa,
--      noite, fim de semana e feriado não correm; não por exceção escrita à
--      mão, e sim porque ela não estava trabalhando;
--   2. mensagem que chegou fora do HORÁRIO CONTRATADO dela (ou fora de dia
--      útil) ganha uma carência a mais
--      (crm_rodizio_config.realocar_carencia_abertura_min, 60 min por padrão):
--      é o "prazo maior pela manhã" — ela abre o dia com a fila da noite
--      acumulada e tem folga para responder antes de perder lead. Mensagem
--      chegada na PAUSA não ganha carência: ali o relógio dela já está parado,
--      e as duas coisas somadas prendiam o lead até o meio da tarde;
--   3. dona que NÃO ABRIU o expediente hoje não segura lead: aquele lead volta
--      para o relógio da clínica e o gestor é avisado (o teto de ausência,
--      logo abaixo);
--   4. lead SEM dona (do administrador, da base, lead novo) continua igual:
--      distribuição inicial, corte da manhã (rodizio_corte_9h) e reserva NÃO
--      são tocados por esta migration. O dono foi explícito nisso.
--
-- O QUE ESTA MIGRATION FAZ:
--   (1) public.rodizio_minutos_da_sdr(tenant, user, de, ate) — o relógio da
--       pessoa, lido dos cliques de public.crm_ponto_eventos e GRAMPEADO ao
--       horário do dia dela (public.rodizio_horario_dia): nenhum minuto antes
--       da entrada nem depois da saída conta, mesmo que o ponto tenha ficado
--       aberto. Assim a conta NÃO depende de o cron ponto_vigia ter carimbado o
--       'encerrar' — sem o grampo, uma sessão de ontem esquecida aberta fazia a
--       NOITE INTEIRA contar como trabalhada e o lead que escreveu às 21h era
--       realocado na primeira rodada da manhã: a injustiça do pedido, invertida
--       e em silêncio;
--   (2) coluna crm_rodizio_config.realocar_carencia_abertura_min (default 60);
--   (3) CREATE OR REPLACE de public.rodizio_realocar_sem_resposta(): no ramo
--       'ligado' (lead com dona real) o relógio passa a ser o dela, com TETO DE
--       AUSÊNCIA (quem não veio trabalhar não segura lead — ver abaixo), e o
--       limite ganha a carência quando o inbound chegou fora do horário
--       CONTRATADO dela ou fora de dia útil — pausa NÃO dá carência, porque o
--       relógio dela já para o almoço inteiro e as duas coisas somadas faziam o
--       lead que escreveu 12h10 só poder trocar de dona no meio da tarde. No ramo
--       'sombra' NADA muda (não há dona de verdade — ver o comentário no
--       corpo). Todo o resto do corpo é o de 20260910011000, verbatim: peneira
--       barata no WHERE, LIMIT 100, teto de uma realocação por lead por dia,
--       exigência de resposta HUMANA (rodizio_msg_humana), exclusão de ciclo
--       encerrado (etapa invisível para a SDR + entrega em crm_entregas_gestor),
--       GUC de propriedade colado no UPDATE, livro e mensagem de sistema;
--   (4) public.rodizio_definir_carencia_abertura(min) para o gestor ajustar, e
--       public.rodizio_estado() devolvendo o campo novo para a tela;
--   (5) no fim do arquivo, os ENSAIOS que provam a regra — cada um dentro de
--       DO $t$ ... RAISE EXCEPTION 'ENSAIO (desfeito): %', rep; END $t$;, de
--       modo que tudo é desfeito.
--
-- O QUE ESTA MIGRATION NÃO FAZ: nenhuma policy é criada, editada ou removida;
-- nenhuma migration existente é tocada; nenhum cron muda; a distribuição de
-- quem não tem dona (rodizio_processar_lead, rodizio_processar_novos,
-- rodizio_corte_9h, reserva) fica exatamente como está; rodizio_minutos_uteis
-- continua existindo e sendo usada (ramo sombra e o resto do motor).
--
-- O TETO DE AUSÊNCIA (o que impede o lead preso E a fila entupida): a régua
-- passa a DEPENDER do ponto, e sem teto quem não bate ponto tem zero minuto
-- trabalhado para sempre. Dois efeitos, os dois medidos: (a) o lead da SDR
-- ausente nunca mais é realocado e ninguém é avisado — o paciente espera calado
-- e a colega que está na mesa não recebe; (b) pior, o laço pega LIMIT 100
-- ordenado do silêncio MAIS ANTIGO para o mais novo, e esses leads presos ficam
-- na cabeça da fila para sempre, consumindo as 100 vagas de toda rodada: com
-- duas SDRs ausentes e uma centena de leads calados nas mãos delas, NENHUM lead
-- de SDR presente é mais realocado, a função devolve 0 e não há erro nem log —
-- a realocação morre em silêncio para o cliente inteiro.
--   Por isso, no ramo 'ligado', antes de medir: a dona é considerada AUSENTE
--   HOJE quando (i) não trabalha hoje (rodizio_horario_dia sem entrada) ou já
--   passou da entrada dela mais a tolerância do corte
--   (crm_rodizio_config.corte_tolerancia_min — a MESMA régua que o corte da
--   manhã usa para dizer "não abriu o expediente") E (ii) tem ZERO minuto
--   trabalhado hoje. Nesse caso o relógio daquele lead volta a ser o da CLÍNICA
--   (public.rodizio_minutos_uteis), sem carência, e o livro e a mensagem de
--   sistema dizem "relógio da clínica porque a dona não abriu o expediente
--   hoje". O gestor é avisado uma vez por dona por dia (dedupe
--   'rodizio:dona_ausente:<tenant>:<dona>:<data>') com quantos leads dela estão
--   calados.
--   Isso NÃO reabre a injustiça do pedido: almoço, pausa, noite, fim de semana e
--   feriado continuam parando o relógio de quem TRABALHOU no dia. Quem não veio
--   trabalhar não segura lead.
--
-- DECISÕES REGISTRADAS (confirmadas; não mexa nelas sem novo pedido do dono):
--   • public.rodizio_minutos_da_sdr fica FECHADA também para authenticated,
--     igual à irmã public.rodizio_minutos_uteis: quem a chama é SECURITY DEFINER
--     e o cron. A tela lê pelo public.rodizio_estado, que passa por
--     is_gestor_equipe(). Aberta para authenticated, qualquer usuário logado
--     leria o ponto de qualquer user_id de qualquer cliente.
--   • A PAUSA NÃO TEM TETO, de propósito: uma SDR pode congelar o relógio dela
--     ficando pausada, e o único controle é o aviso de pausa longa ao gestor
--     (crm_rodizio_config.pausa_alerta_min, 75 min por padrão, disparado pelo
--     cron ponto_vigia — migration 20260910003000). É consequência direta do que
--     o dono pediu: pausa não conta contra ela. Se algum dia um teto for
--     desejado, ele entra DENTRO de rodizio_minutos_da_sdr (por exemplo: somar
--     no máximo N minutos de pausa por dia), nunca no motor da realocação.
--     Atenção ao alcance do teto de ausência: ele só pega quem tem ZERO minuto
--     no dia. Quem trabalhou de manhã e pausou (ou encerrou) ao meio-dia segura
--     os leads dela até amanhã — isso aparece no aviso de pausa longa e no
--     relatório de ponto, não aqui.
--
-- COMO DESFAZER: rodizio_realocar_sem_resposta volta pelo corpo de
-- 20260910011000 (seção "B + G"); rodizio_estado, pelo corpo da mesma
-- migration (seção "H"); as duas funções novas saem por DROP FUNCTION; a
-- coluna sai por ALTER TABLE ... DROP COLUMN realocar_carencia_abertura_min
-- (ou, sem tocar no esquema, basta pôr 0 pela RPC: carência 0 = comportamento
-- de antes, só com o relógio da pessoa).
--
-- PRÉ-REQUISITOS (versões vigentes lidas para escrever este arquivo):
-- 20260901220100 (crm_ponto_eventos, crm_rodizio_config), 20260909100000
-- (rodizio_pool, rodizio_livro, rodizio_msg_humana, rodizio_em_expediente),
-- 20260909100100 (ponto_sessoes — lida e NÃO reutilizada: ela só enxerga
-- eventos DENTRO da janela, então não sabe medir "quanto ela trabalhou desde
-- X" quando a sessão abriu antes de X; era o caso que mais importa aqui),
-- 20260909100000 também para rodizio_dia_util e rodizio_notifica (o aviso de
-- dona ausente), 20260910000000 (rodizio_horario_dia e
-- crm_rodizio_config.corte_tolerancia_min, a régua do corte da manhã),
-- 20260910003000 (ponto_vigia e pausa_alerta_min) e 20260910011000
-- (rodizio_minutos_uteis, rodizio_em_almoco, rodizio_realocar_sem_resposta,
-- rodizio_estado).

SET LOCAL lock_timeout = '5s';

-- ================================================================ 1. a carência de abertura
-- O "prazo maior pela manhã" do pedido, em minutos. Vale para o lead cuja
-- mensagem chegou fora do HORÁRIO CONTRATADO da dona (antes da entrada, depois
-- da saída, fim de semana, feriado ou dia em que a clínica não abre): o limite
-- daquele lead vira realocar_sem_resposta_min + realocar_carencia_abertura_min.
-- 0 desliga a carência (fica só o relógio da pessoa, que já é a parte principal
-- da regra).
-- NÃO vale para mensagem que chegou durante a PAUSA dela, mesmo sendo "fora do
-- expediente aberto": ali o relógio dela já está parado, e empilhar a carência
-- em cima fazia o lead que escreveu 12h10 só poder trocar de dona no meio da
-- tarde. A carência foi calibrada para a fila da manhã, não para o almoço.
ALTER TABLE public.crm_rodizio_config
  ADD COLUMN IF NOT EXISTS realocar_carencia_abertura_min integer NOT NULL DEFAULT 60;
COMMENT ON COLUMN public.crm_rodizio_config.realocar_carencia_abertura_min IS
  'Minutos a MAIS no limite de silêncio quando a mensagem do lead chegou fora do HORÁRIO CONTRATADO da dona (antes da entrada, depois da saída, fim de semana, feriado ou dia em que a clínica não abre). É o prazo maior da manhã: a SDR abre o dia com a fila acumulada e tem folga para responder. Pausa/almoço NÃO dão carência: ali o relógio dela já está parado. 0 desliga. Gravado por rodizio_definir_carencia_abertura.';

-- ================================================================ 2. o relógio da pessoa
-- Quantos MINUTOS, dentro de [p_de, p_ate], esta SDR esteve com o expediente
-- ABERTO e NÃO pausada. É o irmão de rodizio_minutos_uteis (que mede o
-- expediente da CLÍNICA); a diferença é que aqui a fonte é o ponto dela.
--
-- Por que não reusei public.ponto_sessoes: ela só lê eventos com
-- em >= p_de AND em <= p_ate. Quem abriu o expediente às 07:30 e é medida a
-- partir das 12h40 (o instante em que o lead escreveu) apareceria como "sem
-- sessão" — justamente o caso que esta regra existe para resolver. O estado
-- vigente NO INÍCIO da janela é o coração da conta, e por isso ele é o passo 1.
--
-- Leitura dos tipos (a mesma de rodizio_pool): 'abrir'/'retomar' = aberto,
-- 'pausar' = pausado, 'encerrar' = fechado, nenhum evento = fechado. Evento
-- fora de ordem (retomar sem pausa) não é tratado como erro: as RPCs do ponto
-- já recusam a transição inválida no clique, e um lançamento administrativo
-- vale pelo que diz.
--
-- O GRAMPO DO HORÁRIO (passo 4, e o motivo dele): o passo 1 lê o último evento
-- de QUALQUER dia, de propósito — a sessão pode ter aberto muito antes da
-- janela. Só que, se o cron ponto_vigia falhar e uma sessão de ontem ficar sem
-- 'encerrar', o ponto continua "aberto" e a NOITE INTEIRA contaria como
-- trabalhada: o lead que escreveu às 21h seria realocado na primeira rodada da
-- manhã — a injustiça que esta migration existe para impedir, invertida e em
-- silêncio. Então os trechos abertos são RECORTADOS pelo horário do dia dela
-- (public.rodizio_horario_dia, que já cai no business_hours da clínica para quem
-- não tem horário próprio): nada antes da entrada nem depois da saída conta, e
-- dia sem horário nenhum (domingo, ou quem não trabalha naquele dia) vale 0.
-- A conta deixa de depender do carimbo do vigia.
-- Cadastro pela metade (entrada sem saída) faz aquele dia valer 0 — e aí o teto
-- de ausência do motor devolve o lead ao relógio da clínica em vez de prendê-lo
-- com ela; é a mesma rede de quem não bate ponto.
-- Custo: uma leitura de horário por dia local da janela, e a função roda no
-- máximo 100 vezes por rodada (uma por lead do lote). A janela é limitada a 30
-- dias — ver o comentário do teto, dentro do corpo.
CREATE OR REPLACE FUNCTION public.rodizio_minutos_da_sdr(p_tenant uuid, p_user uuid, p_de timestamptz, p_ate timestamptz)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_ev record;
  v_estado text;          -- 'aberto' | 'pausado' | 'fechado' — vigente no trecho corrente
  v_marca timestamptz;    -- início do trecho corrente
  v_de timestamptz;       -- p_de, encurtado para no máximo 30 dias (ver o teto)
  v_seg numeric := 0;
  v_abertos tstzrange[] := ARRAY[]::tstzrange[];   -- os trechos com o ponto ABERTO
  v_tz text; v_d date; v_ultimo date;
  v_abre time; v_fecha time;   -- a janela da CLÍNICA naquele dia (o grampo)
  v_janela tstzrange;     -- a janela do dia, já em timestamptz
  v_trecho tstzrange; v_corte tstzrange;
BEGIN
  IF p_tenant IS NULL OR p_user IS NULL OR p_de IS NULL OR p_ate IS NULL OR p_ate <= p_de THEN RETURN 0; END IF;

  -- TETO DE 30 DIAS. O passo 4 custa uma leitura de horário por dia local, e
  -- ninguém precisa somar meses. Em vez da sentinela da irmã
  -- (rodizio_minutos_uteis devolve 999999 acima de 30 dias), aqui a JANELA é
  -- encurtada: mede-se só os últimos 30 dias. Duas razões para preferir isso à
  -- sentinela: o número que sai continua sendo minutos de verdade (não vaza
  -- "999999 min de expediente dela" para o livro nem para o chat) e o erro,
  -- quando existe, é para BAIXO — a favor da SDR, que é o lado certo de errar
  -- aqui. Uma sentinela faria o contrário: a SDR que volta de férias e abre o
  -- expediente perderia, no mesmo minuto, o lead calado há dois meses.
  -- Quem trabalhou passa do limite de sobra dentro de 30 dias; quem não
  -- trabalhou minuto nenhum cai no teto de ausência do motor, que usa o relógio
  -- da clínica.
  v_de := GREATEST(p_de, p_ate - interval '30 days');

  -- 1. o estado vigente em v_de: o ÚLTIMO clique dela com em <= v_de, de
  --    qualquer dia (a sessão pode ter aberto muito antes da janela). Sem
  --    nenhum evento: fechada — quem nunca bateu ponto não estava trabalhando.
  SELECT CASE e.tipo WHEN 'abrir'   THEN 'aberto'
                     WHEN 'retomar' THEN 'aberto'
                     WHEN 'pausar'  THEN 'pausado'
                     ELSE 'fechado' END
    INTO v_estado
    FROM public.crm_ponto_eventos e
   WHERE e.tenant_id = p_tenant AND e.user_id = p_user AND e.em <= v_de
   ORDER BY e.em DESC, e.id DESC
   LIMIT 1;
  v_estado := COALESCE(v_estado, 'fechado');
  v_marca := v_de;

  -- 2. cada clique dentro da janela FECHA o trecho anterior (GUARDANDO-O se ele
  --    era aberto) e abre o seguinte. Guardar em vez de somar na hora é a única
  --    diferença em relação ao algoritmo original: a soma foi para o passo 4,
  --    onde cada trecho é recortado pelo horário do dia dela.
  FOR v_ev IN
    SELECT e.tipo, e.em
      FROM public.crm_ponto_eventos e
     WHERE e.tenant_id = p_tenant AND e.user_id = p_user
       AND e.em > v_de AND e.em <= p_ate
     ORDER BY e.em, e.id
  LOOP
    IF v_estado = 'aberto' AND v_ev.em > v_marca THEN
      v_abertos := v_abertos || tstzrange(v_marca, v_ev.em, '[)');
    END IF;
    v_estado := CASE v_ev.tipo WHEN 'abrir'   THEN 'aberto'
                               WHEN 'retomar' THEN 'aberto'
                               WHEN 'pausar'  THEN 'pausado'
                               ELSE 'fechado' END;
    v_marca := v_ev.em;
  END LOOP;

  -- 3. o último trecho vai até p_ate com o estado que sobrou.
  IF v_estado = 'aberto' AND p_ate > v_marca THEN
    v_abertos := v_abertos || tstzrange(v_marca, p_ate, '[)');
  END IF;

  -- Nada aberto na janela: nem precisa ler horário.
  IF array_length(v_abertos, 1) IS NULL THEN RETURN 0; END IF;

  -- 4. GRAMPO DO HORÁRIO: de cada trecho aberto vale só o pedaço que cai DENTRO
  --    do horário daquele dia. Um horário por dia local da janela (no máximo 31
  --    dias, pelo teto acima); dia sem entrada/saída não soma nada. É isto que
  --    tira a dependência do 'encerrar' do ponto_vigia: sessão esquecida aberta
  --    para de valer na saída do dia, sozinha.
  v_tz := public.rodizio_tz(p_tenant);
  v_d := (v_de AT TIME ZONE v_tz)::date;
  v_ultimo := (p_ate AT TIME ZONE v_tz)::date;
  WHILE v_d <= v_ultimo LOOP
    -- O GRAMPO É O HORÁRIO DA CLÍNICA, não o contratado da SDR.
    --
    -- Primeira versão grampeava pelo horário dela (rodizio_horario_dia) e isso
    -- descartava o trabalho de quem estava trabalhando: rodizio_horario_dia
    -- devolve NULL no sábado para quem TEM hora_entrada e está com sabado_* em
    -- branco, então a SDR que foi trabalhar no sábado somava 0 minuto; e a SDR
    -- cadastrada 13:00–18:00 que cobriu a colega das 08:00 às 12:00 também
    -- somava 0. Nos dois casos o lead dela nunca seria realocado e ela ainda
    -- levava um aviso ao gestor dizendo que não abriu o expediente.
    --
    -- O grampo tem UM propósito: sessão esquecida aberta não pode fazer a noite
    -- e o fim de semana contarem como trabalhados, sem depender de o cron
    -- ponto-vigia ter carimbado o 'encerrar'. O horário da clínica cumpre isso
    -- inteiro — fora dele ninguém atende ninguém — e não pune quem cobriu turno.
    -- O desconto fino (almoço, café, saída antes do fim) continua vindo do
    -- PONTO, que é o mecanismo principal desta função.
    BEGIN
      SELECT (t.business_hours -> (extract(dow FROM v_d)::int)::text ->> 0)::time,
             (t.business_hours -> (extract(dow FROM v_d)::int)::text ->> 1)::time
        INTO v_abre, v_fecha
        FROM public.tenants t
       WHERE t.id = p_tenant
         AND jsonb_typeof(t.business_hours -> (extract(dow FROM v_d)::int)::text) = 'array'
         AND jsonb_array_length(t.business_hours -> (extract(dow FROM v_d)::int)::text) >= 2;
    EXCEPTION WHEN OTHERS THEN
      -- business_hours com texto que não é hora: o dia simplesmente não conta.
      v_abre := NULL; v_fecha := NULL;
    END;
    -- Feriado não conta, pela mesma régua do resto do motor.
    IF v_abre IS NOT NULL AND v_fecha IS NOT NULL AND v_fecha > v_abre
       AND NOT public.rodizio_feriado(p_tenant, v_d) THEN
      v_janela := tstzrange((v_d + v_abre)  AT TIME ZONE v_tz,
                            (v_d + v_fecha) AT TIME ZONE v_tz, '[)');
      FOREACH v_trecho IN ARRAY v_abertos LOOP
        v_corte := v_trecho * v_janela;
        IF NOT isempty(v_corte) THEN
          v_seg := v_seg + extract(epoch FROM (upper(v_corte) - lower(v_corte)));
        END IF;
      END LOOP;
    END IF;
    v_d := v_d + 1;
  END LOOP;

  RETURN floor(v_seg / 60)::integer;
END $fn$;
-- Porta: a MESMA de rodizio_minutos_uteis, a irmã dela — só o servidor. A
-- função devolve quanto uma pessoa trabalhou num intervalo e não pergunta quem
-- está chamando; aberta para authenticated, qualquer usuário logado leria o
-- ponto de qualquer user_id de qualquer cliente. Quem precisa disso na tela
-- passa por uma RPC com is_gestor_equipe() (é o que rodizio_estado faz).
-- Se algum dia a tela precisar chamar direto, a linha é uma:
--   GRANT EXECUTE ON FUNCTION public.rodizio_minutos_da_sdr(uuid, uuid, timestamptz, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.rodizio_minutos_da_sdr(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rodizio_minutos_da_sdr(uuid, uuid, timestamptz, timestamptz) TO service_role;

-- ============================================ 2b. o fechamento da clínica no dia
-- Serve a UM propósito: o teto de ausência não pode vencer depois que a clínica
-- fecha, porque a realocação só roda com a clínica aberta (rodizio_em_expediente).
-- Sem esse limite, entrada tarde ou tolerância grande (a tela aceita até 480 min)
-- fazem o prazo cair fora da janela do motor e NINGUÉM é declarado ausente nunca
-- — o lead fica parado para sempre e ainda ocupa vaga na fila de 100 por rodada.
-- Devolve NULL quando a clínica não abre no dia; LEAST ignora NULL, então quem
-- chama fica só com o prazo da entrada, que é o comportamento desejado.
CREATE OR REPLACE FUNCTION public.rodizio_fim_do_expediente(p_tenant uuid, p_data date)
RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tz text; v_dia jsonb; v_fecha time;
BEGIN
  IF p_tenant IS NULL OR p_data IS NULL THEN RETURN NULL; END IF;
  SELECT t.business_hours -> (extract(dow FROM p_data)::int)::text INTO v_dia
    FROM public.tenants t WHERE t.id = p_tenant;
  IF v_dia IS NULL OR jsonb_typeof(v_dia) <> 'array' OR jsonb_array_length(v_dia) < 2 THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_fecha := (v_dia ->> 1)::time;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  v_tz := public.rodizio_tz(p_tenant);
  RETURN (p_data + v_fecha) AT TIME ZONE v_tz;
END $fn$;
REVOKE ALL ON FUNCTION public.rodizio_fim_do_expediente(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rodizio_fim_do_expediente(uuid, date) TO service_role;

-- ================================================================ 3. a realocação por silêncio passa a usar o relógio certo
-- Corpo de 20260910011000 (seção "B + G") copiado VERBATIM — as quatro
-- correções de lá seguem valendo: vários funis, peneira barata no WHERE com o
-- teste caro dentro do laço, sentinela de 30 dias que não vaza para texto e
-- GUC de autorização colado no UPDATE. Só TRÊS coisas mudam, as três dentro do
-- laço:
--   (1) no ramo 'ligado' o relógio é rodizio_minutos_da_sdr da DONA, no lugar
--       de rodizio_minutos_uteis (que era o expediente da clínica);
--   (2) TETO DE AUSÊNCIA: se a dona não abriu o expediente hoje (a régua do
--       corte da manhã: não trabalha hoje, ou passou da entrada + tolerância, e
--       zero minuto trabalhado), aquele lead volta para o relógio da clínica e
--       o gestor é avisado. Sem isso o lead fica preso para sempre e — pior — a
--       fila (LIMIT 100 pelo silêncio mais antigo) entope com os leads dela e a
--       realocação para para o cliente inteiro, sem erro nem log;
--   (3) o limite deixa de ser fixo: ganha realocar_carencia_abertura_min quando
--       a mensagem do lead chegou fora do horário CONTRATADO da dona (ou fora de
--       dia útil). PAUSA NÃO DÁ CARÊNCIA: o relógio dela já para o almoço
--       inteiro, e a carência empilhada em cima fazia o lead que escreveu 12h10
--       só poder trocar de dona no meio da tarde. A carência foi calibrada para
--       a fila da manhã.
-- O ramo 'sombra' continua com rodizio_minutos_uteis, de propósito — o porquê
-- está no comentário dentro do IF.

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

-- ================================================================ 4. o gestor ajusta a carência
-- Mesmo molde de rodizio_definir_tempo_realocacao (20260909160000): só o gestor
-- da equipe, lock_timeout curto, registro em access_logs e jsonb de volta.
-- Teto de 480 min (8 h): o caso extremo previsto é "o lead escreveu à noite e
-- a SDR só chega às 13h" — acima disso a regra viraria "nunca realoca", que já
-- se obtém com realocar_sem_resposta_min = 0 (desliga a regra inteira).
CREATE OR REPLACE FUNCTION public.rodizio_definir_carencia_abertura(p_min integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id(); v_antes integer;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sem cliente ativo.' USING ERRCODE = '42501';
  END IF;
  IF p_min IS NULL OR p_min < 0 OR p_min > 480 THEN
    RAISE EXCEPTION 'Informe uma carência entre 0 (desligada) e 480 minutos.' USING ERRCODE = '22023';
  END IF;
  SELECT realocar_carencia_abertura_min INTO v_antes FROM public.crm_rodizio_config WHERE tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rodízio não configurado para este cliente.' USING ERRCODE = '22023';
  END IF;
  IF v_antes IS DISTINCT FROM p_min THEN
    UPDATE public.crm_rodizio_config SET realocar_carencia_abertura_min = p_min WHERE tenant_id = v_tenant;
    INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
    VALUES (auth.uid(), v_tenant, 'tenant', 'rodizio_carencia_abertura', jsonb_build_object('de', v_antes, 'para', p_min));
  END IF;
  RETURN jsonb_build_object('minutos', p_min, 'antes', v_antes);
END $fn$;
REVOKE ALL ON FUNCTION public.rodizio_definir_carencia_abertura(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rodizio_definir_carencia_abertura(integer) TO authenticated, service_role;

-- ================================================================ 5. o painel do gestor mostra a carência
-- Mesmo corpo de 20260910011000 (seção "H"), com UMA chave nova:
-- realocar_carencia_abertura_min. Sem isso o gestor ajustaria um número que a
-- tela não sabe ler — foi assim que os 6 funis novos sumiram em silêncio.

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
    'realocar_carencia_abertura_min', cfg.realocar_carencia_abertura_min,
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
REVOKE ALL ON FUNCTION public.rodizio_estado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rodizio_estado() TO authenticated, service_role;
-- rodizio_realocar_sem_resposta continua fechada como estava (só o cron, que
-- roda como postgres): CREATE OR REPLACE preserva os grants, e nenhum papel
-- ganha nada aqui. A linha abaixo só reafirma o estado atual.
REVOKE ALL ON FUNCTION public.rodizio_realocar_sem_resposta() FROM PUBLIC, anon, authenticated;

-- ================================================================ 6. ENSAIOS (prontos para rodar; tudo é desfeito)
-- Cada bloco monta o cenário DENTRO de uma transação e termina em
-- RAISE EXCEPTION: o resultado chega na mensagem do erro e TUDO é desfeito —
-- os cliques de ponto do ensaio, o horário próprio das SDRs, o lead de teste, o
-- modo do motor, o horário da clínica, o aviso ao gestor e qualquer realocação
-- que a rodada tenha feito em leads de verdade. NUNCA rode um bloco sem o RAISE
-- do fim.
--
-- Cinco avisos antes de colar no SQL editor:
--   • rode como postgres / service_role: rodizio_minutos_da_sdr,
--     rodizio_minutos_uteis, rodizio_horario_dia e rodizio_dia_util são fechadas
--     para authenticated de propósito;
--   • cada bloco APAGA, dentro da transação, os cliques de ponto das SDRs que
--     usa e ZERA o horário próprio delas (hora_entrada/hora_saida/sábado) — é o
--     que torna o cenário determinístico, porque assim rodizio_horario_dia cai
--     no business_hours que o próprio bloco acabou de gravar, e é esse horário
--     que o grampo do relógio usa para recortar o ponto. Como tudo é desfeito, o
--     cadastro real volta intacto; é por isso que o RAISE não é opcional;
--   • cada bloco só roda entre 06:00 e 22:00 no fuso da clínica (ele mesmo
--     recusa fora disso): o cenário monta o ponto de HOJE contando horas para
--     trás, e a virada de meia-noite embaralharia a conta;
--   • 'realocados_na_rodada_inteira' conta a rodada TODA (leads de verdade
--     entram, porque a função varre o cliente inteiro). O veredito de cada
--     ensaio é 'mudou_de_dona' do lead do ensaio, não esse contador;
--   • o bloco liga o motor e abre a clínica só para poder rodar a qualquer hora:
--     rodizio_em_expediente é a primeira porta da função. Se o INSERT do lead
--     reclamar de telefone duplicado, rode de novo (o número é aleatório).

-- ---------------------------------------------------------------- (a) o caso normal: ela estava trabalhando e ficou calada
-- DO $t$
-- DECLARE
--   v_tenant uuid := '00000000-0000-0000-0000-000000000010';
--   v_tz     text := public.rodizio_tz(v_tenant);
--   v_dona uuid; v_colega uuid; v_funil uuid; v_etapa uuid; v_lead uuid; v_depois uuid;
--   v_in    timestamptz := now() - interval '40 minutes';   -- o instante em que o paciente escreveu
--   v_desde timestamptz := now() - interval '6 hours';    -- distribuido_em do lead
--   v_dia_in date; v_hin record; v_h record; v_fora boolean; v_ausente boolean;
--   v_n integer; rep jsonb;
-- BEGIN
--   IF (now() AT TIME ZONE v_tz)::time NOT BETWEEN time '06:00' AND time '22:00' THEN
--     RAISE EXCEPTION 'ENSAIO: rode entre 06:00 e 22:00 no fuso da clínica — o cenário monta o ponto de HOJE contando horas para trás.';
--   END IF;
--
--   -- (0) cenário, só dentro desta transação: clínica aberta 24 h,
--   --     hoje e ontem sem feriado e motor ligado.
--   UPDATE public.tenants SET business_hours = '{"0":["00:00","23:59"],"1":["00:00","23:59"],"2":["00:00","23:59"],"3":["00:00","23:59"],"4":["00:00","23:59"],"5":["00:00","23:59"],"6":["00:00","23:59"]}'::jsonb
--    WHERE id = v_tenant;
--   DELETE FROM public.dashboard_holidays
--    WHERE tenant_id = v_tenant AND data >= (now() AT TIME ZONE v_tz)::date - 1 AND clinica_id IS NULL;
--   UPDATE public.crm_rodizio_config
--      SET modo = 'ligado', realocar_sem_resposta_min = 30, realocar_carencia_abertura_min = 60
--    WHERE tenant_id = v_tenant;
--
--   -- (1) duas SDRs de verdade (o ensaio não cria usuário): a dona do lead e a
--   --     colega que estaria disponível para receber.
--   SELECT p.user_id INTO v_dona   FROM public.rodizio_pool(v_tenant) p ORDER BY p.ordem LIMIT 1;
--   SELECT p.user_id INTO v_colega FROM public.rodizio_pool(v_tenant) p WHERE p.user_id <> v_dona ORDER BY p.ordem LIMIT 1;
--   IF v_dona IS NULL OR v_colega IS NULL THEN
--     RAISE EXCEPTION 'ENSAIO: preciso de 2 SDRs elegíveis na aba Equipe (sem elas não há para quem realocar).';
--   END IF;
--
--   -- (2) horário próprio ZERADO e ponto determinístico (as duas coisas só nesta
--   --     transação): sem hora_entrada, rodizio_horario_dia cai no business_hours
--   --     que o passo (0) gravou — e é ele que o grampo do relógio usa.
--   UPDATE public.crm_rodizio_membros
--      SET hora_entrada = NULL, hora_saida = NULL, sabado_entrada = NULL, sabado_saida = NULL
--    WHERE tenant_id = v_tenant AND user_id IN (v_dona, v_colega);
--   DELETE FROM public.crm_ponto_eventos WHERE tenant_id = v_tenant AND user_id IN (v_dona, v_colega);
--   INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, motivo, origem, em) VALUES
--     (v_tenant, v_colega, 'abrir', NULL, 'admin', now() - interval '1 minute'),
--     (v_tenant, v_dona, 'abrir',   NULL,    'admin', now() - interval '2 hours');
--
--   -- (3) o lead: dona real, etapa de entrada de um funil do rodízio, calado.
--   --     Sem mensagem nenhuma na tabela messages, a antijunção de "resposta
--   --     humana" passa — é o mesmo que "ela não respondeu".
--   SELECT (public.rodizio_funis(v_tenant))[1] INTO v_funil;
--   SELECT s.id INTO v_etapa FROM public.crm_stages s
--    WHERE s.pipeline_id = v_funil AND s.id = ANY (public.rodizio_etapas_entrada(v_tenant))
--    ORDER BY s.position LIMIT 1;
--   INSERT INTO public.crm_leads (tenant_id, pipeline_id, stage_id, name, phone, source,
--                                 assigned_to, distribuido_em, last_inbound_at)
--   VALUES (v_tenant, v_funil, v_etapa, 'ENSAIO relógio justo', '5577' || to_char(floor(random()*1e9)::bigint, 'FM000000000'),
--           'ensaio', v_dona, v_desde, v_in)
--   RETURNING id INTO v_lead;
--
--   -- (4) as MESMAS contas do motor, para o relatório explicar o veredito
--   v_dia_in := (v_in AT TIME ZONE v_tz)::date;
--   SELECT * INTO v_hin FROM public.rodizio_horario_dia(v_tenant, v_dona, v_dia_in);
--   v_fora := NOT public.rodizio_dia_util(v_tenant, v_dia_in)
--             OR v_hin.entrada IS NULL OR v_hin.saida IS NULL
--             OR v_in <  ((v_dia_in + v_hin.entrada) AT TIME ZONE v_tz)
--             OR v_in >= ((v_dia_in + v_hin.saida)   AT TIME ZONE v_tz);
--   SELECT * INTO v_h FROM public.rodizio_horario_dia(v_tenant, v_dona, (now() AT TIME ZONE v_tz)::date);
--   v_ausente := (v_h.entrada IS NULL
--                 OR now() >= (((now() AT TIME ZONE v_tz)::date + v_h.entrada) AT TIME ZONE v_tz)
--                             + make_interval(mins => (SELECT COALESCE(k.corte_tolerancia_min, 60)
--                                                        FROM public.crm_rodizio_config k WHERE k.tenant_id = v_tenant)))
--                AND public.rodizio_minutos_da_sdr(v_tenant, v_dona,
--                      ((now() AT TIME ZONE v_tz)::date::timestamp) AT TIME ZONE v_tz, now()) = 0;
--
--   -- (5) a rodada do cron
--   v_n := public.rodizio_realocar_sem_resposta();
--   SELECT l.assigned_to INTO v_depois FROM public.crm_leads l WHERE l.id = v_lead;
--
--   rep := jsonb_build_object(
--     'caso', '(a) expediente ABERTO e sem pausa, lead calado há 40 min',
--     'esperado', 'REALOCA: 40 min de expediente dela desde o inbound contra limite 30, e sem carência porque a mensagem caiu DENTRO do horário dela → mudou_de_dona = true',
--     'dona_ausente_hoje', v_ausente,
--     'relogio_usado', CASE WHEN v_ausente THEN 'da clínica (a dona não abriu o expediente hoje)'
--                           ELSE 'do expediente dela' END,
--     'minutos_no_relogio_certo', CASE WHEN v_ausente
--         THEN public.rodizio_minutos_uteis(v_tenant, GREATEST(v_in, v_desde), now())
--         ELSE public.rodizio_minutos_da_sdr(v_tenant, v_dona, GREATEST(v_in, v_desde), now()) END,
--     'minutos_de_parede', (extract(epoch FROM (now() - GREATEST(v_in, v_desde))) / 60)::integer,
--     'inbound_fora_do_horario_dela', v_fora,
--     'carencia_aplicada', v_fora AND NOT v_ausente,
--     'limite_deste_lead_min', 30 + CASE WHEN v_fora AND NOT v_ausente THEN 60 ELSE 0 END,
--     'dona_antes', public.rodizio_nome(v_dona),
--     'dona_depois', public.rodizio_nome(v_depois),
--     'mudou_de_dona', v_depois IS DISTINCT FROM v_dona,
--     'livro_deste_lead', COALESCE((SELECT jsonb_agg(a.fase || ': ' || a.motivo ORDER BY a.criado_em)
--                                     FROM public.crm_lead_atribuicoes a WHERE a.lead_id = v_lead), '[]'::jsonb),
--     'realocados_na_rodada_inteira', v_n);
--   RAISE EXCEPTION 'ENSAIO (desfeito): %', rep;
-- END $t$;

-- ---------------------------------------------------------------- (b) PAUSA: o almoço do pedido do dono
-- DO $t$
-- DECLARE
--   v_tenant uuid := '00000000-0000-0000-0000-000000000010';
--   v_tz     text := public.rodizio_tz(v_tenant);
--   v_dona uuid; v_colega uuid; v_funil uuid; v_etapa uuid; v_lead uuid; v_depois uuid;
--   v_in    timestamptz := now() - interval '40 minutes';   -- o instante em que o paciente escreveu
--   v_desde timestamptz := now() - interval '6 hours';    -- distribuido_em do lead
--   v_dia_in date; v_hin record; v_h record; v_fora boolean; v_ausente boolean;
--   v_n integer; rep jsonb;
-- BEGIN
--   IF (now() AT TIME ZONE v_tz)::time NOT BETWEEN time '06:00' AND time '22:00' THEN
--     RAISE EXCEPTION 'ENSAIO: rode entre 06:00 e 22:00 no fuso da clínica — o cenário monta o ponto de HOJE contando horas para trás.';
--   END IF;
--
--   -- (0) cenário, só dentro desta transação: clínica aberta 24 h,
--   --     hoje e ontem sem feriado e motor ligado.
--   UPDATE public.tenants SET business_hours = '{"0":["00:00","23:59"],"1":["00:00","23:59"],"2":["00:00","23:59"],"3":["00:00","23:59"],"4":["00:00","23:59"],"5":["00:00","23:59"],"6":["00:00","23:59"]}'::jsonb
--    WHERE id = v_tenant;
--   DELETE FROM public.dashboard_holidays
--    WHERE tenant_id = v_tenant AND data >= (now() AT TIME ZONE v_tz)::date - 1 AND clinica_id IS NULL;
--   UPDATE public.crm_rodizio_config
--      SET modo = 'ligado', realocar_sem_resposta_min = 30, realocar_carencia_abertura_min = 60
--    WHERE tenant_id = v_tenant;
--
--   -- (1) duas SDRs de verdade (o ensaio não cria usuário): a dona do lead e a
--   --     colega que estaria disponível para receber.
--   SELECT p.user_id INTO v_dona   FROM public.rodizio_pool(v_tenant) p ORDER BY p.ordem LIMIT 1;
--   SELECT p.user_id INTO v_colega FROM public.rodizio_pool(v_tenant) p WHERE p.user_id <> v_dona ORDER BY p.ordem LIMIT 1;
--   IF v_dona IS NULL OR v_colega IS NULL THEN
--     RAISE EXCEPTION 'ENSAIO: preciso de 2 SDRs elegíveis na aba Equipe (sem elas não há para quem realocar).';
--   END IF;
--
--   -- (2) horário próprio ZERADO e ponto determinístico (as duas coisas só nesta
--   --     transação): sem hora_entrada, rodizio_horario_dia cai no business_hours
--   --     que o passo (0) gravou — e é ele que o grampo do relógio usa.
--   UPDATE public.crm_rodizio_membros
--      SET hora_entrada = NULL, hora_saida = NULL, sabado_entrada = NULL, sabado_saida = NULL
--    WHERE tenant_id = v_tenant AND user_id IN (v_dona, v_colega);
--   DELETE FROM public.crm_ponto_eventos WHERE tenant_id = v_tenant AND user_id IN (v_dona, v_colega);
--   INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, motivo, origem, em) VALUES
--     (v_tenant, v_colega, 'abrir', NULL, 'admin', now() - interval '1 minute'),
--     (v_tenant, v_dona, 'abrir',   NULL,    'admin', now() - interval '3 hours'),
--     (v_tenant, v_dona, 'pausar',  'almoco', 'admin', now() - interval '1 hour');
--
--   -- (3) o lead: dona real, etapa de entrada de um funil do rodízio, calado.
--   --     Sem mensagem nenhuma na tabela messages, a antijunção de "resposta
--   --     humana" passa — é o mesmo que "ela não respondeu".
--   SELECT (public.rodizio_funis(v_tenant))[1] INTO v_funil;
--   SELECT s.id INTO v_etapa FROM public.crm_stages s
--    WHERE s.pipeline_id = v_funil AND s.id = ANY (public.rodizio_etapas_entrada(v_tenant))
--    ORDER BY s.position LIMIT 1;
--   INSERT INTO public.crm_leads (tenant_id, pipeline_id, stage_id, name, phone, source,
--                                 assigned_to, distribuido_em, last_inbound_at)
--   VALUES (v_tenant, v_funil, v_etapa, 'ENSAIO relógio justo', '5577' || to_char(floor(random()*1e9)::bigint, 'FM000000000'),
--           'ensaio', v_dona, v_desde, v_in)
--   RETURNING id INTO v_lead;
--
--   -- (4) as MESMAS contas do motor, para o relatório explicar o veredito
--   v_dia_in := (v_in AT TIME ZONE v_tz)::date;
--   SELECT * INTO v_hin FROM public.rodizio_horario_dia(v_tenant, v_dona, v_dia_in);
--   v_fora := NOT public.rodizio_dia_util(v_tenant, v_dia_in)
--             OR v_hin.entrada IS NULL OR v_hin.saida IS NULL
--             OR v_in <  ((v_dia_in + v_hin.entrada) AT TIME ZONE v_tz)
--             OR v_in >= ((v_dia_in + v_hin.saida)   AT TIME ZONE v_tz);
--   SELECT * INTO v_h FROM public.rodizio_horario_dia(v_tenant, v_dona, (now() AT TIME ZONE v_tz)::date);
--   v_ausente := (v_h.entrada IS NULL
--                 OR now() >= (((now() AT TIME ZONE v_tz)::date + v_h.entrada) AT TIME ZONE v_tz)
--                             + make_interval(mins => (SELECT COALESCE(k.corte_tolerancia_min, 60)
--                                                        FROM public.crm_rodizio_config k WHERE k.tenant_id = v_tenant)))
--                AND public.rodizio_minutos_da_sdr(v_tenant, v_dona,
--                      ((now() AT TIME ZONE v_tz)::date::timestamp) AT TIME ZONE v_tz, now()) = 0;
--
--   -- (5) a rodada do cron
--   v_n := public.rodizio_realocar_sem_resposta();
--   SELECT l.assigned_to INTO v_depois FROM public.crm_leads l WHERE l.id = v_lead;
--
--   rep := jsonb_build_object(
--     'caso', '(b) SDR em PAUSA desde antes do inbound, 40 min de relógio de parede',
--     'esperado', 'NÃO REALOCA: pausada o tempo todo → 0 min trabalhados (era o caso do almoço do pedido). Repare que a carência NÃO entra: pausa não é fora do horário dela',
--     'dona_ausente_hoje', v_ausente,
--     'relogio_usado', CASE WHEN v_ausente THEN 'da clínica (a dona não abriu o expediente hoje)'
--                           ELSE 'do expediente dela' END,
--     'minutos_no_relogio_certo', CASE WHEN v_ausente
--         THEN public.rodizio_minutos_uteis(v_tenant, GREATEST(v_in, v_desde), now())
--         ELSE public.rodizio_minutos_da_sdr(v_tenant, v_dona, GREATEST(v_in, v_desde), now()) END,
--     'minutos_de_parede', (extract(epoch FROM (now() - GREATEST(v_in, v_desde))) / 60)::integer,
--     'inbound_fora_do_horario_dela', v_fora,
--     'carencia_aplicada', v_fora AND NOT v_ausente,
--     'limite_deste_lead_min', 30 + CASE WHEN v_fora AND NOT v_ausente THEN 60 ELSE 0 END,
--     'dona_antes', public.rodizio_nome(v_dona),
--     'dona_depois', public.rodizio_nome(v_depois),
--     'mudou_de_dona', v_depois IS DISTINCT FROM v_dona,
--     'livro_deste_lead', COALESCE((SELECT jsonb_agg(a.fase || ': ' || a.motivo ORDER BY a.criado_em)
--                                     FROM public.crm_lead_atribuicoes a WHERE a.lead_id = v_lead), '[]'::jsonb),
--     'realocados_na_rodada_inteira', v_n);
--   RAISE EXCEPTION 'ENSAIO (desfeito): %', rep;
-- END $t$;

-- ---------------------------------------------------------------- (c) EXPEDIENTE ENCERRADO: o lead da noite
-- DO $t$
-- DECLARE
--   v_tenant uuid := '00000000-0000-0000-0000-000000000010';
--   v_tz     text := public.rodizio_tz(v_tenant);
--   v_dona uuid; v_colega uuid; v_funil uuid; v_etapa uuid; v_lead uuid; v_depois uuid;
--   v_in    timestamptz := now() - interval '90 minutes';   -- o instante em que o paciente escreveu
--   v_desde timestamptz := now() - interval '6 hours';    -- distribuido_em do lead
--   v_dia_in date; v_hin record; v_h record; v_fora boolean; v_ausente boolean;
--   v_n integer; rep jsonb;
-- BEGIN
--   IF (now() AT TIME ZONE v_tz)::time NOT BETWEEN time '06:00' AND time '22:00' THEN
--     RAISE EXCEPTION 'ENSAIO: rode entre 06:00 e 22:00 no fuso da clínica — o cenário monta o ponto de HOJE contando horas para trás.';
--   END IF;
--
--   -- (0) cenário, só dentro desta transação: clínica aberta 24 h,
--   --     hoje e ontem sem feriado e motor ligado.
--   UPDATE public.tenants SET business_hours = '{"0":["00:00","23:59"],"1":["00:00","23:59"],"2":["00:00","23:59"],"3":["00:00","23:59"],"4":["00:00","23:59"],"5":["00:00","23:59"],"6":["00:00","23:59"]}'::jsonb
--    WHERE id = v_tenant;
--   DELETE FROM public.dashboard_holidays
--    WHERE tenant_id = v_tenant AND data >= (now() AT TIME ZONE v_tz)::date - 1 AND clinica_id IS NULL;
--   UPDATE public.crm_rodizio_config
--      SET modo = 'ligado', realocar_sem_resposta_min = 30, realocar_carencia_abertura_min = 60
--    WHERE tenant_id = v_tenant;
--
--   -- (1) duas SDRs de verdade (o ensaio não cria usuário): a dona do lead e a
--   --     colega que estaria disponível para receber.
--   SELECT p.user_id INTO v_dona   FROM public.rodizio_pool(v_tenant) p ORDER BY p.ordem LIMIT 1;
--   SELECT p.user_id INTO v_colega FROM public.rodizio_pool(v_tenant) p WHERE p.user_id <> v_dona ORDER BY p.ordem LIMIT 1;
--   IF v_dona IS NULL OR v_colega IS NULL THEN
--     RAISE EXCEPTION 'ENSAIO: preciso de 2 SDRs elegíveis na aba Equipe (sem elas não há para quem realocar).';
--   END IF;
--
--   -- (2) horário próprio ZERADO e ponto determinístico (as duas coisas só nesta
--   --     transação): sem hora_entrada, rodizio_horario_dia cai no business_hours
--   --     que o passo (0) gravou — e é ele que o grampo do relógio usa.
--   UPDATE public.crm_rodizio_membros
--      SET hora_entrada = NULL, hora_saida = NULL, sabado_entrada = NULL, sabado_saida = NULL
--    WHERE tenant_id = v_tenant AND user_id IN (v_dona, v_colega);
--   DELETE FROM public.crm_ponto_eventos WHERE tenant_id = v_tenant AND user_id IN (v_dona, v_colega);
--   INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, motivo, origem, em) VALUES
--     (v_tenant, v_colega, 'abrir', NULL, 'admin', now() - interval '1 minute'),
--     (v_tenant, v_dona, 'abrir',   NULL,    'admin', now() - interval '10 hours'),
--     (v_tenant, v_dona, 'encerrar', NULL,    'admin', now() - interval '2 hours');
--
--   -- (3) o lead: dona real, etapa de entrada de um funil do rodízio, calado.
--   --     Sem mensagem nenhuma na tabela messages, a antijunção de "resposta
--   --     humana" passa — é o mesmo que "ela não respondeu".
--   SELECT (public.rodizio_funis(v_tenant))[1] INTO v_funil;
--   SELECT s.id INTO v_etapa FROM public.crm_stages s
--    WHERE s.pipeline_id = v_funil AND s.id = ANY (public.rodizio_etapas_entrada(v_tenant))
--    ORDER BY s.position LIMIT 1;
--   INSERT INTO public.crm_leads (tenant_id, pipeline_id, stage_id, name, phone, source,
--                                 assigned_to, distribuido_em, last_inbound_at)
--   VALUES (v_tenant, v_funil, v_etapa, 'ENSAIO relógio justo', '5577' || to_char(floor(random()*1e9)::bigint, 'FM000000000'),
--           'ensaio', v_dona, v_desde, v_in)
--   RETURNING id INTO v_lead;
--
--   -- (4) as MESMAS contas do motor, para o relatório explicar o veredito
--   v_dia_in := (v_in AT TIME ZONE v_tz)::date;
--   SELECT * INTO v_hin FROM public.rodizio_horario_dia(v_tenant, v_dona, v_dia_in);
--   v_fora := NOT public.rodizio_dia_util(v_tenant, v_dia_in)
--             OR v_hin.entrada IS NULL OR v_hin.saida IS NULL
--             OR v_in <  ((v_dia_in + v_hin.entrada) AT TIME ZONE v_tz)
--             OR v_in >= ((v_dia_in + v_hin.saida)   AT TIME ZONE v_tz);
--   SELECT * INTO v_h FROM public.rodizio_horario_dia(v_tenant, v_dona, (now() AT TIME ZONE v_tz)::date);
--   v_ausente := (v_h.entrada IS NULL
--                 OR now() >= (((now() AT TIME ZONE v_tz)::date + v_h.entrada) AT TIME ZONE v_tz)
--                             + make_interval(mins => (SELECT COALESCE(k.corte_tolerancia_min, 60)
--                                                        FROM public.crm_rodizio_config k WHERE k.tenant_id = v_tenant)))
--                AND public.rodizio_minutos_da_sdr(v_tenant, v_dona,
--                      ((now() AT TIME ZONE v_tz)::date::timestamp) AT TIME ZONE v_tz, now()) = 0;
--
--   -- (5) a rodada do cron
--   v_n := public.rodizio_realocar_sem_resposta();
--   SELECT l.assigned_to INTO v_depois FROM public.crm_leads l WHERE l.id = v_lead;
--
--   rep := jsonb_build_object(
--     'caso', '(c) expediente ENCERRADO, lead escreveu depois (a noite)',
--     'esperado', 'NÃO REALOCA: expediente fechado → 0 min trabalhados; o lead continua com ela. E ela NÃO conta como ausente: trabalhou hoje',
--     'dona_ausente_hoje', v_ausente,
--     'relogio_usado', CASE WHEN v_ausente THEN 'da clínica (a dona não abriu o expediente hoje)'
--                           ELSE 'do expediente dela' END,
--     'minutos_no_relogio_certo', CASE WHEN v_ausente
--         THEN public.rodizio_minutos_uteis(v_tenant, GREATEST(v_in, v_desde), now())
--         ELSE public.rodizio_minutos_da_sdr(v_tenant, v_dona, GREATEST(v_in, v_desde), now()) END,
--     'minutos_de_parede', (extract(epoch FROM (now() - GREATEST(v_in, v_desde))) / 60)::integer,
--     'inbound_fora_do_horario_dela', v_fora,
--     'carencia_aplicada', v_fora AND NOT v_ausente,
--     'limite_deste_lead_min', 30 + CASE WHEN v_fora AND NOT v_ausente THEN 60 ELSE 0 END,
--     'dona_antes', public.rodizio_nome(v_dona),
--     'dona_depois', public.rodizio_nome(v_depois),
--     'mudou_de_dona', v_depois IS DISTINCT FROM v_dona,
--     'livro_deste_lead', COALESCE((SELECT jsonb_agg(a.fase || ': ' || a.motivo ORDER BY a.criado_em)
--                                     FROM public.crm_lead_atribuicoes a WHERE a.lead_id = v_lead), '[]'::jsonb),
--     'realocados_na_rodada_inteira', v_n);
--   RAISE EXCEPTION 'ENSAIO (desfeito): %', rep;
-- END $t$;

-- ---------------------------------------------------------------- (d1) a carência da manhã: 20 min de expediente não bastam
-- A clínica abre no minuto em que ela abriu o expediente, então o lead de
-- ontem à noite chegou ANTES da entrada dela: é o caso da carência.
-- DO $t$
-- DECLARE
--   v_tenant uuid := '00000000-0000-0000-0000-000000000010';
--   v_tz     text := public.rodizio_tz(v_tenant);
--   v_dona uuid; v_colega uuid; v_funil uuid; v_etapa uuid; v_lead uuid; v_depois uuid;
--   v_in    timestamptz := now() - interval '5 hours';   -- o instante em que o paciente escreveu
--   v_desde timestamptz := now() - interval '6 hours';    -- distribuido_em do lead
--   v_dia_in date; v_hin record; v_h record; v_fora boolean; v_ausente boolean;
--   v_n integer; rep jsonb;
-- BEGIN
--   IF (now() AT TIME ZONE v_tz)::time NOT BETWEEN time '06:00' AND time '22:00' THEN
--     RAISE EXCEPTION 'ENSAIO: rode entre 06:00 e 22:00 no fuso da clínica — o cenário monta o ponto de HOJE contando horas para trás.';
--   END IF;
--
--   -- (0) cenário, só dentro desta transação: clínica aberta desde 20 min atrás,
--   --     hoje e ontem sem feriado e motor ligado.
--   -- a clínica (e, por tabela, o horário dela) abre há 20 min e vai até 23:59
--   UPDATE public.tenants SET business_hours = (
--     SELECT jsonb_object_agg(d::text, jsonb_build_array(to_char((now() AT TIME ZONE v_tz) - interval '20 minutes', 'HH24:MI'), '23:59'))
--       FROM generate_series(0, 6) d)
--    WHERE id = v_tenant;
--   DELETE FROM public.dashboard_holidays
--    WHERE tenant_id = v_tenant AND data >= (now() AT TIME ZONE v_tz)::date - 1 AND clinica_id IS NULL;
--   UPDATE public.crm_rodizio_config
--      SET modo = 'ligado', realocar_sem_resposta_min = 30, realocar_carencia_abertura_min = 60
--    WHERE tenant_id = v_tenant;
--
--   -- (1) duas SDRs de verdade (o ensaio não cria usuário): a dona do lead e a
--   --     colega que estaria disponível para receber.
--   SELECT p.user_id INTO v_dona   FROM public.rodizio_pool(v_tenant) p ORDER BY p.ordem LIMIT 1;
--   SELECT p.user_id INTO v_colega FROM public.rodizio_pool(v_tenant) p WHERE p.user_id <> v_dona ORDER BY p.ordem LIMIT 1;
--   IF v_dona IS NULL OR v_colega IS NULL THEN
--     RAISE EXCEPTION 'ENSAIO: preciso de 2 SDRs elegíveis na aba Equipe (sem elas não há para quem realocar).';
--   END IF;
--
--   -- (2) horário próprio ZERADO e ponto determinístico (as duas coisas só nesta
--   --     transação): sem hora_entrada, rodizio_horario_dia cai no business_hours
--   --     que o passo (0) gravou — e é ele que o grampo do relógio usa.
--   UPDATE public.crm_rodizio_membros
--      SET hora_entrada = NULL, hora_saida = NULL, sabado_entrada = NULL, sabado_saida = NULL
--    WHERE tenant_id = v_tenant AND user_id IN (v_dona, v_colega);
--   DELETE FROM public.crm_ponto_eventos WHERE tenant_id = v_tenant AND user_id IN (v_dona, v_colega);
--   INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, motivo, origem, em) VALUES
--     (v_tenant, v_colega, 'abrir', NULL, 'admin', now() - interval '1 minute'),
--     (v_tenant, v_dona, 'abrir',   NULL,    'admin', now() - interval '12 hours'),
--     (v_tenant, v_dona, 'encerrar', NULL,    'admin', now() - interval '8 hours'),
--     (v_tenant, v_dona, 'abrir',   NULL,    'admin', now() - interval '20 minutes');
--
--   -- (3) o lead: dona real, etapa de entrada de um funil do rodízio, calado.
--   --     Sem mensagem nenhuma na tabela messages, a antijunção de "resposta
--   --     humana" passa — é o mesmo que "ela não respondeu".
--   SELECT (public.rodizio_funis(v_tenant))[1] INTO v_funil;
--   SELECT s.id INTO v_etapa FROM public.crm_stages s
--    WHERE s.pipeline_id = v_funil AND s.id = ANY (public.rodizio_etapas_entrada(v_tenant))
--    ORDER BY s.position LIMIT 1;
--   INSERT INTO public.crm_leads (tenant_id, pipeline_id, stage_id, name, phone, source,
--                                 assigned_to, distribuido_em, last_inbound_at)
--   VALUES (v_tenant, v_funil, v_etapa, 'ENSAIO relógio justo', '5577' || to_char(floor(random()*1e9)::bigint, 'FM000000000'),
--           'ensaio', v_dona, v_desde, v_in)
--   RETURNING id INTO v_lead;
--
--   -- (4) as MESMAS contas do motor, para o relatório explicar o veredito
--   v_dia_in := (v_in AT TIME ZONE v_tz)::date;
--   SELECT * INTO v_hin FROM public.rodizio_horario_dia(v_tenant, v_dona, v_dia_in);
--   v_fora := NOT public.rodizio_dia_util(v_tenant, v_dia_in)
--             OR v_hin.entrada IS NULL OR v_hin.saida IS NULL
--             OR v_in <  ((v_dia_in + v_hin.entrada) AT TIME ZONE v_tz)
--             OR v_in >= ((v_dia_in + v_hin.saida)   AT TIME ZONE v_tz);
--   SELECT * INTO v_h FROM public.rodizio_horario_dia(v_tenant, v_dona, (now() AT TIME ZONE v_tz)::date);
--   v_ausente := (v_h.entrada IS NULL
--                 OR now() >= (((now() AT TIME ZONE v_tz)::date + v_h.entrada) AT TIME ZONE v_tz)
--                             + make_interval(mins => (SELECT COALESCE(k.corte_tolerancia_min, 60)
--                                                        FROM public.crm_rodizio_config k WHERE k.tenant_id = v_tenant)))
--                AND public.rodizio_minutos_da_sdr(v_tenant, v_dona,
--                      ((now() AT TIME ZONE v_tz)::date::timestamp) AT TIME ZONE v_tz, now()) = 0;
--
--   -- (5) a rodada do cron
--   v_n := public.rodizio_realocar_sem_resposta();
--   SELECT l.assigned_to INTO v_depois FROM public.crm_leads l WHERE l.id = v_lead;
--
--   rep := jsonb_build_object(
--     'caso', '(d1) lead escreveu antes da entrada dela e o expediente abriu há 20 min (carência 60)',
--     'esperado', 'NÃO REALOCA: 20 min de expediente contra limite 30 + 60 de carência = 90',
--     'dona_ausente_hoje', v_ausente,
--     'relogio_usado', CASE WHEN v_ausente THEN 'da clínica (a dona não abriu o expediente hoje)'
--                           ELSE 'do expediente dela' END,
--     'minutos_no_relogio_certo', CASE WHEN v_ausente
--         THEN public.rodizio_minutos_uteis(v_tenant, GREATEST(v_in, v_desde), now())
--         ELSE public.rodizio_minutos_da_sdr(v_tenant, v_dona, GREATEST(v_in, v_desde), now()) END,
--     'minutos_de_parede', (extract(epoch FROM (now() - GREATEST(v_in, v_desde))) / 60)::integer,
--     'inbound_fora_do_horario_dela', v_fora,
--     'carencia_aplicada', v_fora AND NOT v_ausente,
--     'limite_deste_lead_min', 30 + CASE WHEN v_fora AND NOT v_ausente THEN 60 ELSE 0 END,
--     'dona_antes', public.rodizio_nome(v_dona),
--     'dona_depois', public.rodizio_nome(v_depois),
--     'mudou_de_dona', v_depois IS DISTINCT FROM v_dona,
--     'livro_deste_lead', COALESCE((SELECT jsonb_agg(a.fase || ': ' || a.motivo ORDER BY a.criado_em)
--                                     FROM public.crm_lead_atribuicoes a WHERE a.lead_id = v_lead), '[]'::jsonb),
--     'realocados_na_rodada_inteira', v_n);
--   RAISE EXCEPTION 'ENSAIO (desfeito): %', rep;
-- END $t$;

-- ---------------------------------------------------------------- (d2) a mesma manhã, 95 min depois: agora realoca
-- Igual ao (d1), só que ela abriu o expediente há 95 min. A carência é folga,
-- não perdão eterno.
-- DO $t$
-- DECLARE
--   v_tenant uuid := '00000000-0000-0000-0000-000000000010';
--   v_tz     text := public.rodizio_tz(v_tenant);
--   v_dona uuid; v_colega uuid; v_funil uuid; v_etapa uuid; v_lead uuid; v_depois uuid;
--   v_in    timestamptz := now() - interval '5 hours';   -- o instante em que o paciente escreveu
--   v_desde timestamptz := now() - interval '6 hours';    -- distribuido_em do lead
--   v_dia_in date; v_hin record; v_h record; v_fora boolean; v_ausente boolean;
--   v_n integer; rep jsonb;
-- BEGIN
--   IF (now() AT TIME ZONE v_tz)::time NOT BETWEEN time '06:00' AND time '22:00' THEN
--     RAISE EXCEPTION 'ENSAIO: rode entre 06:00 e 22:00 no fuso da clínica — o cenário monta o ponto de HOJE contando horas para trás.';
--   END IF;
--
--   -- (0) cenário, só dentro desta transação: clínica aberta desde 95 min atrás,
--   --     hoje e ontem sem feriado e motor ligado.
--   -- a clínica (e, por tabela, o horário dela) abre há 95 min e vai até 23:59
--   UPDATE public.tenants SET business_hours = (
--     SELECT jsonb_object_agg(d::text, jsonb_build_array(to_char((now() AT TIME ZONE v_tz) - interval '95 minutes', 'HH24:MI'), '23:59'))
--       FROM generate_series(0, 6) d)
--    WHERE id = v_tenant;
--   DELETE FROM public.dashboard_holidays
--    WHERE tenant_id = v_tenant AND data >= (now() AT TIME ZONE v_tz)::date - 1 AND clinica_id IS NULL;
--   UPDATE public.crm_rodizio_config
--      SET modo = 'ligado', realocar_sem_resposta_min = 30, realocar_carencia_abertura_min = 60
--    WHERE tenant_id = v_tenant;
--
--   -- (1) duas SDRs de verdade (o ensaio não cria usuário): a dona do lead e a
--   --     colega que estaria disponível para receber.
--   SELECT p.user_id INTO v_dona   FROM public.rodizio_pool(v_tenant) p ORDER BY p.ordem LIMIT 1;
--   SELECT p.user_id INTO v_colega FROM public.rodizio_pool(v_tenant) p WHERE p.user_id <> v_dona ORDER BY p.ordem LIMIT 1;
--   IF v_dona IS NULL OR v_colega IS NULL THEN
--     RAISE EXCEPTION 'ENSAIO: preciso de 2 SDRs elegíveis na aba Equipe (sem elas não há para quem realocar).';
--   END IF;
--
--   -- (2) horário próprio ZERADO e ponto determinístico (as duas coisas só nesta
--   --     transação): sem hora_entrada, rodizio_horario_dia cai no business_hours
--   --     que o passo (0) gravou — e é ele que o grampo do relógio usa.
--   UPDATE public.crm_rodizio_membros
--      SET hora_entrada = NULL, hora_saida = NULL, sabado_entrada = NULL, sabado_saida = NULL
--    WHERE tenant_id = v_tenant AND user_id IN (v_dona, v_colega);
--   DELETE FROM public.crm_ponto_eventos WHERE tenant_id = v_tenant AND user_id IN (v_dona, v_colega);
--   INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, motivo, origem, em) VALUES
--     (v_tenant, v_colega, 'abrir', NULL, 'admin', now() - interval '1 minute'),
--     (v_tenant, v_dona, 'abrir',   NULL,    'admin', now() - interval '12 hours'),
--     (v_tenant, v_dona, 'encerrar', NULL,    'admin', now() - interval '8 hours'),
--     (v_tenant, v_dona, 'abrir',   NULL,    'admin', now() - interval '95 minutes');
--
--   -- (3) o lead: dona real, etapa de entrada de um funil do rodízio, calado.
--   --     Sem mensagem nenhuma na tabela messages, a antijunção de "resposta
--   --     humana" passa — é o mesmo que "ela não respondeu".
--   SELECT (public.rodizio_funis(v_tenant))[1] INTO v_funil;
--   SELECT s.id INTO v_etapa FROM public.crm_stages s
--    WHERE s.pipeline_id = v_funil AND s.id = ANY (public.rodizio_etapas_entrada(v_tenant))
--    ORDER BY s.position LIMIT 1;
--   INSERT INTO public.crm_leads (tenant_id, pipeline_id, stage_id, name, phone, source,
--                                 assigned_to, distribuido_em, last_inbound_at)
--   VALUES (v_tenant, v_funil, v_etapa, 'ENSAIO relógio justo', '5577' || to_char(floor(random()*1e9)::bigint, 'FM000000000'),
--           'ensaio', v_dona, v_desde, v_in)
--   RETURNING id INTO v_lead;
--
--   -- (4) as MESMAS contas do motor, para o relatório explicar o veredito
--   v_dia_in := (v_in AT TIME ZONE v_tz)::date;
--   SELECT * INTO v_hin FROM public.rodizio_horario_dia(v_tenant, v_dona, v_dia_in);
--   v_fora := NOT public.rodizio_dia_util(v_tenant, v_dia_in)
--             OR v_hin.entrada IS NULL OR v_hin.saida IS NULL
--             OR v_in <  ((v_dia_in + v_hin.entrada) AT TIME ZONE v_tz)
--             OR v_in >= ((v_dia_in + v_hin.saida)   AT TIME ZONE v_tz);
--   SELECT * INTO v_h FROM public.rodizio_horario_dia(v_tenant, v_dona, (now() AT TIME ZONE v_tz)::date);
--   v_ausente := (v_h.entrada IS NULL
--                 OR now() >= (((now() AT TIME ZONE v_tz)::date + v_h.entrada) AT TIME ZONE v_tz)
--                             + make_interval(mins => (SELECT COALESCE(k.corte_tolerancia_min, 60)
--                                                        FROM public.crm_rodizio_config k WHERE k.tenant_id = v_tenant)))
--                AND public.rodizio_minutos_da_sdr(v_tenant, v_dona,
--                      ((now() AT TIME ZONE v_tz)::date::timestamp) AT TIME ZONE v_tz, now()) = 0;
--
--   -- (5) a rodada do cron
--   v_n := public.rodizio_realocar_sem_resposta();
--   SELECT l.assigned_to INTO v_depois FROM public.crm_leads l WHERE l.id = v_lead;
--
--   rep := jsonb_build_object(
--     'caso', '(d2) o mesmo lead da noite, agora com 95 min de expediente aberto (carência 60)',
--     'esperado', 'REALOCA: 95 min de expediente >= 90 (30 + 60). A carência é folga, não perdão eterno',
--     'dona_ausente_hoje', v_ausente,
--     'relogio_usado', CASE WHEN v_ausente THEN 'da clínica (a dona não abriu o expediente hoje)'
--                           ELSE 'do expediente dela' END,
--     'minutos_no_relogio_certo', CASE WHEN v_ausente
--         THEN public.rodizio_minutos_uteis(v_tenant, GREATEST(v_in, v_desde), now())
--         ELSE public.rodizio_minutos_da_sdr(v_tenant, v_dona, GREATEST(v_in, v_desde), now()) END,
--     'minutos_de_parede', (extract(epoch FROM (now() - GREATEST(v_in, v_desde))) / 60)::integer,
--     'inbound_fora_do_horario_dela', v_fora,
--     'carencia_aplicada', v_fora AND NOT v_ausente,
--     'limite_deste_lead_min', 30 + CASE WHEN v_fora AND NOT v_ausente THEN 60 ELSE 0 END,
--     'dona_antes', public.rodizio_nome(v_dona),
--     'dona_depois', public.rodizio_nome(v_depois),
--     'mudou_de_dona', v_depois IS DISTINCT FROM v_dona,
--     'livro_deste_lead', COALESCE((SELECT jsonb_agg(a.fase || ': ' || a.motivo ORDER BY a.criado_em)
--                                     FROM public.crm_lead_atribuicoes a WHERE a.lead_id = v_lead), '[]'::jsonb),
--     'realocados_na_rodada_inteira', v_n);
--   RAISE EXCEPTION 'ENSAIO (desfeito): %', rep;
-- END $t$;

-- ---------------------------------------------------------------- (e) lead SEM dona: nada mudou para ele
-- DO $t$
-- DECLARE
--   v_tenant uuid := '00000000-0000-0000-0000-000000000010';
--   v_tz     text := public.rodizio_tz(v_tenant);
--   v_admin uuid; v_colega uuid; v_funil uuid; v_etapa uuid; v_lead uuid;
--   l public.crm_leads; v_n integer; v_res text; rep jsonb;
-- BEGIN
--   -- (0) mesmo cenário dos outros ensaios
--   UPDATE public.tenants SET business_hours = '{"0":["00:00","23:59"],"1":["00:00","23:59"],"2":["00:00","23:59"],"3":["00:00","23:59"],"4":["00:00","23:59"],"5":["00:00","23:59"],"6":["00:00","23:59"]}'::jsonb
--    WHERE id = v_tenant;
--   DELETE FROM public.dashboard_holidays
--    WHERE tenant_id = v_tenant AND data = (now() AT TIME ZONE v_tz)::date AND clinica_id IS NULL;
--   -- modo_alterado_em entra porque a varredura de novos ignora cliente com
--   -- ela nula e só olha o que nasceu depois dela (GREATEST com now() - 2 dias).
--   UPDATE public.crm_rodizio_config
--      SET modo = 'ligado', realocar_sem_resposta_min = 30, realocar_carencia_abertura_min = 60,
--          modo_alterado_em = now() - interval '1 day'
--    WHERE tenant_id = v_tenant;
--   SELECT k.gestor_user_id INTO v_admin FROM public.crm_rodizio_config k WHERE k.tenant_id = v_tenant;
--
--   -- (1) alguém na mesa para receber
--   SELECT p.user_id INTO v_colega FROM public.rodizio_pool(v_tenant) p ORDER BY p.ordem LIMIT 1;
--   IF v_colega IS NULL THEN RAISE EXCEPTION 'ENSAIO: preciso de 1 SDR elegível na aba Equipe.'; END IF;
--   DELETE FROM public.crm_ponto_eventos WHERE tenant_id = v_tenant AND user_id = v_colega;
--   INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, motivo, origem, em)
--   VALUES (v_tenant, v_colega, 'abrir', NULL, 'admin', now() - interval '1 minute');
--
--   -- (2) o lead da BASE: sem dona nenhuma (é do administrador), calado há 40 min
--   SELECT (public.rodizio_funis(v_tenant))[1] INTO v_funil;
--   SELECT s.id INTO v_etapa FROM public.crm_stages s
--    WHERE s.pipeline_id = v_funil AND s.id = ANY (public.rodizio_etapas_entrada(v_tenant))
--    ORDER BY s.position LIMIT 1;
--   INSERT INTO public.crm_leads (tenant_id, pipeline_id, stage_id, name, phone, source,
--                                 assigned_to, distribuido_em, last_inbound_at)
--   VALUES (v_tenant, v_funil, v_etapa, 'ENSAIO lead da base', '5577' || to_char(floor(random()*1e9)::bigint, 'FM000000000'),
--           'ensaio', v_admin, NULL, now() - interval '40 minutes')
--   RETURNING id INTO v_lead;
--
--   -- (3) o gatilho de lead novo já processa no INSERT; a varredura é chamada
--   --     para o ensaio não depender dele. Depois, a rodada da realocação.
--   v_res := public.rodizio_processar_novos()::text;
--   v_n := public.rodizio_realocar_sem_resposta();
--   SELECT * INTO l FROM public.crm_leads WHERE id = v_lead;
--
--   rep := jsonb_build_object(
--     'caso', '(e) lead SEM dona (da base): a distribuição normal continua igual',
--     'esperado', 'GANHA DONA pela ENTRADA: livro com fase aplicacao (ou reserva) e NUNCA realocacao_1h',
--     'dona_depois', public.rodizio_nome(l.assigned_to),
--     'era_do_administrador', v_admin,
--     'distribuido_em_preenchido', l.distribuido_em IS NOT NULL,
--     'reservado_para', public.rodizio_nome(l.rodizio_reservado_para),
--     'whatsapp_number_id', l.whatsapp_number_id,   -- se vier preenchido e o lead ficar fora da fila, é aqui que se olha
--     'livro_deste_lead', COALESCE((SELECT jsonb_agg(a.fase || ': ' || a.motivo ORDER BY a.criado_em)
--                                     FROM public.crm_lead_atribuicoes a WHERE a.lead_id = v_lead), '[]'::jsonb),
--     'varredura_de_novos', v_res,
--     'realocados_na_rodada_inteira', v_n);
--   RAISE EXCEPTION 'ENSAIO (desfeito): %', rep;
-- END $t$;
-- ---------------------------------------------------------------- (g) DONA AUSENTE HOJE: o lead volta ao relógio da clínica e o gestor é avisado
-- O par mais grave que o teto de ausência conserta: sem ele, a dona que não
-- bate ponto tem zero minuto para sempre, o lead nunca mais é realocado e
-- ninguém é avisado — e esses leads presos, sendo os de silêncio mais antigo,
-- ocupam as 100 vagas de toda rodada até a realocação parar para o cliente
-- inteiro. Aqui a dona não tem NENHUM clique de ponto hoje.
-- (o aviso só aparece se crm_rodizio_config.gestor_user_id estiver preenchido)
-- DO $t$
-- DECLARE
--   v_tenant uuid := '00000000-0000-0000-0000-000000000010';
--   v_tz     text := public.rodizio_tz(v_tenant);
--   v_dona uuid; v_colega uuid; v_funil uuid; v_etapa uuid; v_lead uuid; v_depois uuid;
--   v_in    timestamptz := now() - interval '40 minutes';   -- o instante em que o paciente escreveu
--   v_desde timestamptz := now() - interval '6 hours';    -- distribuido_em do lead
--   v_dia_in date; v_hin record; v_h record; v_fora boolean; v_ausente boolean;
--   v_n integer; rep jsonb;
-- BEGIN
--   IF (now() AT TIME ZONE v_tz)::time NOT BETWEEN time '06:00' AND time '22:00' THEN
--     RAISE EXCEPTION 'ENSAIO: rode entre 06:00 e 22:00 no fuso da clínica — o cenário monta o ponto de HOJE contando horas para trás.';
--   END IF;
--
--   -- (0) cenário, só dentro desta transação: clínica aberta 24 h,
--   --     hoje e ontem sem feriado e motor ligado.
--   UPDATE public.tenants SET business_hours = '{"0":["00:00","23:59"],"1":["00:00","23:59"],"2":["00:00","23:59"],"3":["00:00","23:59"],"4":["00:00","23:59"],"5":["00:00","23:59"],"6":["00:00","23:59"]}'::jsonb
--    WHERE id = v_tenant;
--   DELETE FROM public.dashboard_holidays
--    WHERE tenant_id = v_tenant AND data >= (now() AT TIME ZONE v_tz)::date - 1 AND clinica_id IS NULL;
--   UPDATE public.crm_rodizio_config
--      SET modo = 'ligado', realocar_sem_resposta_min = 30, realocar_carencia_abertura_min = 60
--    WHERE tenant_id = v_tenant;
--
--   -- (1) duas SDRs de verdade (o ensaio não cria usuário): a dona do lead e a
--   --     colega que estaria disponível para receber.
--   SELECT p.user_id INTO v_dona   FROM public.rodizio_pool(v_tenant) p ORDER BY p.ordem LIMIT 1;
--   SELECT p.user_id INTO v_colega FROM public.rodizio_pool(v_tenant) p WHERE p.user_id <> v_dona ORDER BY p.ordem LIMIT 1;
--   IF v_dona IS NULL OR v_colega IS NULL THEN
--     RAISE EXCEPTION 'ENSAIO: preciso de 2 SDRs elegíveis na aba Equipe (sem elas não há para quem realocar).';
--   END IF;
--
--   -- (2) horário próprio ZERADO e ponto determinístico (as duas coisas só nesta
--   --     transação): sem hora_entrada, rodizio_horario_dia cai no business_hours
--   --     que o passo (0) gravou — e é ele que o grampo do relógio usa.
--   UPDATE public.crm_rodizio_membros
--      SET hora_entrada = NULL, hora_saida = NULL, sabado_entrada = NULL, sabado_saida = NULL
--    WHERE tenant_id = v_tenant AND user_id IN (v_dona, v_colega);
--   DELETE FROM public.crm_ponto_eventos WHERE tenant_id = v_tenant AND user_id IN (v_dona, v_colega);
--   INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, motivo, origem, em) VALUES
--     (v_tenant, v_colega, 'abrir', NULL, 'admin', now() - interval '1 minute');
--
--   -- (3) o lead: dona real, etapa de entrada de um funil do rodízio, calado.
--   --     Sem mensagem nenhuma na tabela messages, a antijunção de "resposta
--   --     humana" passa — é o mesmo que "ela não respondeu".
--   SELECT (public.rodizio_funis(v_tenant))[1] INTO v_funil;
--   SELECT s.id INTO v_etapa FROM public.crm_stages s
--    WHERE s.pipeline_id = v_funil AND s.id = ANY (public.rodizio_etapas_entrada(v_tenant))
--    ORDER BY s.position LIMIT 1;
--   INSERT INTO public.crm_leads (tenant_id, pipeline_id, stage_id, name, phone, source,
--                                 assigned_to, distribuido_em, last_inbound_at)
--   VALUES (v_tenant, v_funil, v_etapa, 'ENSAIO relógio justo', '5577' || to_char(floor(random()*1e9)::bigint, 'FM000000000'),
--           'ensaio', v_dona, v_desde, v_in)
--   RETURNING id INTO v_lead;
--
--   -- (4) as MESMAS contas do motor, para o relatório explicar o veredito
--   v_dia_in := (v_in AT TIME ZONE v_tz)::date;
--   SELECT * INTO v_hin FROM public.rodizio_horario_dia(v_tenant, v_dona, v_dia_in);
--   v_fora := NOT public.rodizio_dia_util(v_tenant, v_dia_in)
--             OR v_hin.entrada IS NULL OR v_hin.saida IS NULL
--             OR v_in <  ((v_dia_in + v_hin.entrada) AT TIME ZONE v_tz)
--             OR v_in >= ((v_dia_in + v_hin.saida)   AT TIME ZONE v_tz);
--   SELECT * INTO v_h FROM public.rodizio_horario_dia(v_tenant, v_dona, (now() AT TIME ZONE v_tz)::date);
--   v_ausente := (v_h.entrada IS NULL
--                 OR now() >= (((now() AT TIME ZONE v_tz)::date + v_h.entrada) AT TIME ZONE v_tz)
--                             + make_interval(mins => (SELECT COALESCE(k.corte_tolerancia_min, 60)
--                                                        FROM public.crm_rodizio_config k WHERE k.tenant_id = v_tenant)))
--                AND public.rodizio_minutos_da_sdr(v_tenant, v_dona,
--                      ((now() AT TIME ZONE v_tz)::date::timestamp) AT TIME ZONE v_tz, now()) = 0;
--
--   -- (5) a rodada do cron
--   v_n := public.rodizio_realocar_sem_resposta();
--   SELECT l.assigned_to INTO v_depois FROM public.crm_leads l WHERE l.id = v_lead;
--
--   rep := jsonb_build_object(
--     'caso', '(g) a dona NÃO ABRIU o expediente hoje (falta, atestado, férias, conta esquecida)',
--     'esperado', 'REALOCA pelo relógio da CLÍNICA (40 min úteis >= 30, sem carência): dona_ausente_hoje = true, mudou_de_dona = true, gestor_avisado = true e o livro diz "relógio da clínica porque a dona não abriu o expediente hoje"',
--     'dona_ausente_hoje', v_ausente,
--     'relogio_usado', CASE WHEN v_ausente THEN 'da clínica (a dona não abriu o expediente hoje)'
--                           ELSE 'do expediente dela' END,
--     'minutos_no_relogio_certo', CASE WHEN v_ausente
--         THEN public.rodizio_minutos_uteis(v_tenant, GREATEST(v_in, v_desde), now())
--         ELSE public.rodizio_minutos_da_sdr(v_tenant, v_dona, GREATEST(v_in, v_desde), now()) END,
--     'minutos_de_parede', (extract(epoch FROM (now() - GREATEST(v_in, v_desde))) / 60)::integer,
--     'inbound_fora_do_horario_dela', v_fora,
--     'carencia_aplicada', v_fora AND NOT v_ausente,
--     'limite_deste_lead_min', 30 + CASE WHEN v_fora AND NOT v_ausente THEN 60 ELSE 0 END,
--     'dona_antes', public.rodizio_nome(v_dona),
--     'dona_depois', public.rodizio_nome(v_depois),
--     'mudou_de_dona', v_depois IS DISTINCT FROM v_dona,
--     'gestor_avisado', EXISTS (SELECT 1 FROM public.crm_notifications n
--                                WHERE n.dedupe_key = 'rodizio:dona_ausente:' || v_tenant::text || ':'
--                                      || v_dona::text || ':' || (now() AT TIME ZONE v_tz)::date::text),
--     'aviso_ao_gestor', (SELECT n.title || ' — ' || n.body FROM public.crm_notifications n
--                          WHERE n.dedupe_key = 'rodizio:dona_ausente:' || v_tenant::text || ':'
--                                || v_dona::text || ':' || (now() AT TIME ZONE v_tz)::date::text),
--     'livro_deste_lead', COALESCE((SELECT jsonb_agg(a.fase || ': ' || a.motivo ORDER BY a.criado_em)
--                                     FROM public.crm_lead_atribuicoes a WHERE a.lead_id = v_lead), '[]'::jsonb),
--     'realocados_na_rodada_inteira', v_n);
--   RAISE EXCEPTION 'ENSAIO (desfeito): %', rep;
-- END $t$;

-- ---------------------------------------------------------------- (h) INBOUND NA PAUSA: o relógio dela já basta, a carência não entra
-- Antes do conserto, "chegou fora do expediente" era medido numa janela de 2
-- minutos em torno do inbound: mensagem chegada durante a PAUSA dava carência,
-- e o limite deste lead virava 90 min DEPOIS de ela voltar do almoço — o lead
-- que escreveu 12h10 só podia trocar de dona no meio da tarde. Agora a carência
-- olha o horário CONTRATADO, e a pausa fica por conta do relógio dela.
-- DO $t$
-- DECLARE
--   v_tenant uuid := '00000000-0000-0000-0000-000000000010';
--   v_tz     text := public.rodizio_tz(v_tenant);
--   v_dona uuid; v_colega uuid; v_funil uuid; v_etapa uuid; v_lead uuid; v_depois uuid;
--   v_in    timestamptz := now() - interval '45 minutes';   -- o instante em que o paciente escreveu
--   v_desde timestamptz := now() - interval '6 hours';    -- distribuido_em do lead
--   v_dia_in date; v_hin record; v_h record; v_fora boolean; v_ausente boolean;
--   v_n integer; rep jsonb;
-- BEGIN
--   IF (now() AT TIME ZONE v_tz)::time NOT BETWEEN time '06:00' AND time '22:00' THEN
--     RAISE EXCEPTION 'ENSAIO: rode entre 06:00 e 22:00 no fuso da clínica — o cenário monta o ponto de HOJE contando horas para trás.';
--   END IF;
--
--   -- (0) cenário, só dentro desta transação: clínica aberta 24 h,
--   --     hoje e ontem sem feriado e motor ligado.
--   UPDATE public.tenants SET business_hours = '{"0":["00:00","23:59"],"1":["00:00","23:59"],"2":["00:00","23:59"],"3":["00:00","23:59"],"4":["00:00","23:59"],"5":["00:00","23:59"],"6":["00:00","23:59"]}'::jsonb
--    WHERE id = v_tenant;
--   DELETE FROM public.dashboard_holidays
--    WHERE tenant_id = v_tenant AND data >= (now() AT TIME ZONE v_tz)::date - 1 AND clinica_id IS NULL;
--   UPDATE public.crm_rodizio_config
--      SET modo = 'ligado', realocar_sem_resposta_min = 30, realocar_carencia_abertura_min = 60
--    WHERE tenant_id = v_tenant;
--
--   -- (1) duas SDRs de verdade (o ensaio não cria usuário): a dona do lead e a
--   --     colega que estaria disponível para receber.
--   SELECT p.user_id INTO v_dona   FROM public.rodizio_pool(v_tenant) p ORDER BY p.ordem LIMIT 1;
--   SELECT p.user_id INTO v_colega FROM public.rodizio_pool(v_tenant) p WHERE p.user_id <> v_dona ORDER BY p.ordem LIMIT 1;
--   IF v_dona IS NULL OR v_colega IS NULL THEN
--     RAISE EXCEPTION 'ENSAIO: preciso de 2 SDRs elegíveis na aba Equipe (sem elas não há para quem realocar).';
--   END IF;
--
--   -- (2) horário próprio ZERADO e ponto determinístico (as duas coisas só nesta
--   --     transação): sem hora_entrada, rodizio_horario_dia cai no business_hours
--   --     que o passo (0) gravou — e é ele que o grampo do relógio usa.
--   UPDATE public.crm_rodizio_membros
--      SET hora_entrada = NULL, hora_saida = NULL, sabado_entrada = NULL, sabado_saida = NULL
--    WHERE tenant_id = v_tenant AND user_id IN (v_dona, v_colega);
--   DELETE FROM public.crm_ponto_eventos WHERE tenant_id = v_tenant AND user_id IN (v_dona, v_colega);
--   INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, motivo, origem, em) VALUES
--     (v_tenant, v_colega, 'abrir', NULL, 'admin', now() - interval '1 minute'),
--     (v_tenant, v_dona, 'abrir',   NULL,    'admin', now() - interval '3 hours'),
--     (v_tenant, v_dona, 'pausar',  'almoco', 'admin', now() - interval '50 minutes'),
--     (v_tenant, v_dona, 'retomar', NULL,    'admin', now() - interval '35 minutes');
--
--   -- (3) o lead: dona real, etapa de entrada de um funil do rodízio, calado.
--   --     Sem mensagem nenhuma na tabela messages, a antijunção de "resposta
--   --     humana" passa — é o mesmo que "ela não respondeu".
--   SELECT (public.rodizio_funis(v_tenant))[1] INTO v_funil;
--   SELECT s.id INTO v_etapa FROM public.crm_stages s
--    WHERE s.pipeline_id = v_funil AND s.id = ANY (public.rodizio_etapas_entrada(v_tenant))
--    ORDER BY s.position LIMIT 1;
--   INSERT INTO public.crm_leads (tenant_id, pipeline_id, stage_id, name, phone, source,
--                                 assigned_to, distribuido_em, last_inbound_at)
--   VALUES (v_tenant, v_funil, v_etapa, 'ENSAIO relógio justo', '5577' || to_char(floor(random()*1e9)::bigint, 'FM000000000'),
--           'ensaio', v_dona, v_desde, v_in)
--   RETURNING id INTO v_lead;
--
--   -- (4) as MESMAS contas do motor, para o relatório explicar o veredito
--   v_dia_in := (v_in AT TIME ZONE v_tz)::date;
--   SELECT * INTO v_hin FROM public.rodizio_horario_dia(v_tenant, v_dona, v_dia_in);
--   v_fora := NOT public.rodizio_dia_util(v_tenant, v_dia_in)
--             OR v_hin.entrada IS NULL OR v_hin.saida IS NULL
--             OR v_in <  ((v_dia_in + v_hin.entrada) AT TIME ZONE v_tz)
--             OR v_in >= ((v_dia_in + v_hin.saida)   AT TIME ZONE v_tz);
--   SELECT * INTO v_h FROM public.rodizio_horario_dia(v_tenant, v_dona, (now() AT TIME ZONE v_tz)::date);
--   v_ausente := (v_h.entrada IS NULL
--                 OR now() >= (((now() AT TIME ZONE v_tz)::date + v_h.entrada) AT TIME ZONE v_tz)
--                             + make_interval(mins => (SELECT COALESCE(k.corte_tolerancia_min, 60)
--                                                        FROM public.crm_rodizio_config k WHERE k.tenant_id = v_tenant)))
--                AND public.rodizio_minutos_da_sdr(v_tenant, v_dona,
--                      ((now() AT TIME ZONE v_tz)::date::timestamp) AT TIME ZONE v_tz, now()) = 0;
--
--   -- (5) a rodada do cron
--   v_n := public.rodizio_realocar_sem_resposta();
--   SELECT l.assigned_to INTO v_depois FROM public.crm_leads l WHERE l.id = v_lead;
--
--   rep := jsonb_build_object(
--     'caso', '(h) o inbound caiu DURANTE a pausa dela; depois ela retomou e ficou 35 min calada',
--     'esperado', 'REALOCA: sem carência (a mensagem caiu dentro do horário contratado dela), 35 min de expediente >= 30. Com a carência antiga o limite seria 90 e o lead ficaria preso',
--     'dona_ausente_hoje', v_ausente,
--     'relogio_usado', CASE WHEN v_ausente THEN 'da clínica (a dona não abriu o expediente hoje)'
--                           ELSE 'do expediente dela' END,
--     'minutos_no_relogio_certo', CASE WHEN v_ausente
--         THEN public.rodizio_minutos_uteis(v_tenant, GREATEST(v_in, v_desde), now())
--         ELSE public.rodizio_minutos_da_sdr(v_tenant, v_dona, GREATEST(v_in, v_desde), now()) END,
--     'minutos_de_parede', (extract(epoch FROM (now() - GREATEST(v_in, v_desde))) / 60)::integer,
--     'inbound_fora_do_horario_dela', v_fora,
--     'carencia_aplicada', v_fora AND NOT v_ausente,
--     'limite_deste_lead_min', 30 + CASE WHEN v_fora AND NOT v_ausente THEN 60 ELSE 0 END,
--     'dona_antes', public.rodizio_nome(v_dona),
--     'dona_depois', public.rodizio_nome(v_depois),
--     'mudou_de_dona', v_depois IS DISTINCT FROM v_dona,
--     'livro_deste_lead', COALESCE((SELECT jsonb_agg(a.fase || ': ' || a.motivo ORDER BY a.criado_em)
--                                     FROM public.crm_lead_atribuicoes a WHERE a.lead_id = v_lead), '[]'::jsonb),
--     'realocados_na_rodada_inteira', v_n);
--   RAISE EXCEPTION 'ENSAIO (desfeito): %', rep;
-- END $t$;

-- ---------------------------------------------------------------- (i) SESSÃO SEM 'encerrar' (o ponto_vigia falhou): o que está fora do horário não conta
-- O passo 1 do relógio lê o último evento de QUALQUER dia. Se o vigia falhar e
-- a sessão ficar sem 'encerrar', sem o grampo a noite inteira contaria como
-- trabalhada e o lead que escreveu às 21h seria realocado na primeira rodada da
-- manhã — a injustiça, invertida. Aqui o formato é o mesmo, comprimido para o
-- ensaio rodar a qualquer hora do dia: o ponto está aberto desde 5 h atrás, sem
-- nenhum 'encerrar', e o horário do dia só começa 1 h atrás.
-- Para ver o caso literal da noite: business_hours ["08:00","18:00"] nos 7 dias,
-- 'abrir' ontem às 22:00 sem 'encerrar', inbound ontem às 23:00, e rode às 09:00
-- — dá 60 min de expediente contra o limite 90, e o lead fica com ela.
-- DO $t$
-- DECLARE
--   v_tenant uuid := '00000000-0000-0000-0000-000000000010';
--   v_tz     text := public.rodizio_tz(v_tenant);
--   v_dona uuid; v_colega uuid; v_funil uuid; v_etapa uuid; v_lead uuid; v_depois uuid;
--   v_in    timestamptz := now() - interval '4 hours';   -- o instante em que o paciente escreveu
--   v_desde timestamptz := now() - interval '6 hours';    -- distribuido_em do lead
--   v_dia_in date; v_hin record; v_h record; v_fora boolean; v_ausente boolean;
--   v_n integer; rep jsonb;
-- BEGIN
--   IF (now() AT TIME ZONE v_tz)::time NOT BETWEEN time '06:00' AND time '22:00' THEN
--     RAISE EXCEPTION 'ENSAIO: rode entre 06:00 e 22:00 no fuso da clínica — o cenário monta o ponto de HOJE contando horas para trás.';
--   END IF;
--
--   -- (0) cenário, só dentro desta transação: clínica aberta só na última hora,
--   --     hoje e ontem sem feriado e motor ligado.
--   -- o horário do dia é só [1 h atrás, 1 h à frente]
--   UPDATE public.tenants SET business_hours = (
--     SELECT jsonb_object_agg(d::text, jsonb_build_array(to_char((now() AT TIME ZONE v_tz) - interval '1 hour', 'HH24:MI'), to_char((now() AT TIME ZONE v_tz) + interval '1 hour', 'HH24:MI')))
--       FROM generate_series(0, 6) d)
--    WHERE id = v_tenant;
--   DELETE FROM public.dashboard_holidays
--    WHERE tenant_id = v_tenant AND data >= (now() AT TIME ZONE v_tz)::date - 1 AND clinica_id IS NULL;
--   UPDATE public.crm_rodizio_config
--      SET modo = 'ligado', realocar_sem_resposta_min = 30, realocar_carencia_abertura_min = 60
--    WHERE tenant_id = v_tenant;
--
--   -- (1) duas SDRs de verdade (o ensaio não cria usuário): a dona do lead e a
--   --     colega que estaria disponível para receber.
--   SELECT p.user_id INTO v_dona   FROM public.rodizio_pool(v_tenant) p ORDER BY p.ordem LIMIT 1;
--   SELECT p.user_id INTO v_colega FROM public.rodizio_pool(v_tenant) p WHERE p.user_id <> v_dona ORDER BY p.ordem LIMIT 1;
--   IF v_dona IS NULL OR v_colega IS NULL THEN
--     RAISE EXCEPTION 'ENSAIO: preciso de 2 SDRs elegíveis na aba Equipe (sem elas não há para quem realocar).';
--   END IF;
--
--   -- (2) horário próprio ZERADO e ponto determinístico (as duas coisas só nesta
--   --     transação): sem hora_entrada, rodizio_horario_dia cai no business_hours
--   --     que o passo (0) gravou — e é ele que o grampo do relógio usa.
--   UPDATE public.crm_rodizio_membros
--      SET hora_entrada = NULL, hora_saida = NULL, sabado_entrada = NULL, sabado_saida = NULL
--    WHERE tenant_id = v_tenant AND user_id IN (v_dona, v_colega);
--   DELETE FROM public.crm_ponto_eventos WHERE tenant_id = v_tenant AND user_id IN (v_dona, v_colega);
--   INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, motivo, origem, em) VALUES
--     (v_tenant, v_colega, 'abrir', NULL, 'admin', now() - interval '1 minute'),
--     (v_tenant, v_dona, 'abrir',   NULL,    'admin', now() - interval '5 hours');
--
--   -- (3) o lead: dona real, etapa de entrada de um funil do rodízio, calado.
--   --     Sem mensagem nenhuma na tabela messages, a antijunção de "resposta
--   --     humana" passa — é o mesmo que "ela não respondeu".
--   SELECT (public.rodizio_funis(v_tenant))[1] INTO v_funil;
--   SELECT s.id INTO v_etapa FROM public.crm_stages s
--    WHERE s.pipeline_id = v_funil AND s.id = ANY (public.rodizio_etapas_entrada(v_tenant))
--    ORDER BY s.position LIMIT 1;
--   INSERT INTO public.crm_leads (tenant_id, pipeline_id, stage_id, name, phone, source,
--                                 assigned_to, distribuido_em, last_inbound_at)
--   VALUES (v_tenant, v_funil, v_etapa, 'ENSAIO relógio justo', '5577' || to_char(floor(random()*1e9)::bigint, 'FM000000000'),
--           'ensaio', v_dona, v_desde, v_in)
--   RETURNING id INTO v_lead;
--
--   -- (4) as MESMAS contas do motor, para o relatório explicar o veredito
--   v_dia_in := (v_in AT TIME ZONE v_tz)::date;
--   SELECT * INTO v_hin FROM public.rodizio_horario_dia(v_tenant, v_dona, v_dia_in);
--   v_fora := NOT public.rodizio_dia_util(v_tenant, v_dia_in)
--             OR v_hin.entrada IS NULL OR v_hin.saida IS NULL
--             OR v_in <  ((v_dia_in + v_hin.entrada) AT TIME ZONE v_tz)
--             OR v_in >= ((v_dia_in + v_hin.saida)   AT TIME ZONE v_tz);
--   SELECT * INTO v_h FROM public.rodizio_horario_dia(v_tenant, v_dona, (now() AT TIME ZONE v_tz)::date);
--   v_ausente := (v_h.entrada IS NULL
--                 OR now() >= (((now() AT TIME ZONE v_tz)::date + v_h.entrada) AT TIME ZONE v_tz)
--                             + make_interval(mins => (SELECT COALESCE(k.corte_tolerancia_min, 60)
--                                                        FROM public.crm_rodizio_config k WHERE k.tenant_id = v_tenant)))
--                AND public.rodizio_minutos_da_sdr(v_tenant, v_dona,
--                      ((now() AT TIME ZONE v_tz)::date::timestamp) AT TIME ZONE v_tz, now()) = 0;
--
--   -- (5) a rodada do cron
--   v_n := public.rodizio_realocar_sem_resposta();
--   SELECT l.assigned_to INTO v_depois FROM public.crm_leads l WHERE l.id = v_lead;
--
--   rep := jsonb_build_object(
--     'caso', '(i) ponto aberto há 5 h e nunca encerrado; o horário do dia começou há 1 h',
--     'esperado', 'NÃO REALOCA: das 4 h de parede desde o inbound só contam os 60 min DENTRO do horário dela, contra o limite 90 (o inbound chegou antes da entrada). Sem o grampo contariam 240 min e o lead trocaria de dona',
--     'dona_ausente_hoje', v_ausente,
--     'relogio_usado', CASE WHEN v_ausente THEN 'da clínica (a dona não abriu o expediente hoje)'
--                           ELSE 'do expediente dela' END,
--     'minutos_no_relogio_certo', CASE WHEN v_ausente
--         THEN public.rodizio_minutos_uteis(v_tenant, GREATEST(v_in, v_desde), now())
--         ELSE public.rodizio_minutos_da_sdr(v_tenant, v_dona, GREATEST(v_in, v_desde), now()) END,
--     'minutos_de_parede', (extract(epoch FROM (now() - GREATEST(v_in, v_desde))) / 60)::integer,
--     'inbound_fora_do_horario_dela', v_fora,
--     'carencia_aplicada', v_fora AND NOT v_ausente,
--     'limite_deste_lead_min', 30 + CASE WHEN v_fora AND NOT v_ausente THEN 60 ELSE 0 END,
--     'dona_antes', public.rodizio_nome(v_dona),
--     'dona_depois', public.rodizio_nome(v_depois),
--     'mudou_de_dona', v_depois IS DISTINCT FROM v_dona,
--     'livro_deste_lead', COALESCE((SELECT jsonb_agg(a.fase || ': ' || a.motivo ORDER BY a.criado_em)
--                                     FROM public.crm_lead_atribuicoes a WHERE a.lead_id = v_lead), '[]'::jsonb),
--     'realocados_na_rodada_inteira', v_n);
--   RAISE EXCEPTION 'ENSAIO (desfeito): %', rep;
-- END $t$;

-- ---------------------------------------------------------------- (f) conferências de leitura (rode à vontade, não muda nada)
-- -- o relógio da pessoa contra o relógio da clínica, para cada SDR, nas
-- -- últimas 3 horas: a diferença é o almoço, a pausa e o que ela não abriu.
--   SELECT public.rodizio_nome(m.user_id) AS sdr,
--          public.rodizio_minutos_uteis('00000000-0000-0000-0000-000000000010', now() - interval '3 hours', now()) AS min_da_clinica,
--          public.rodizio_minutos_da_sdr('00000000-0000-0000-0000-000000000010', m.user_id, now() - interval '3 hours', now()) AS min_dela
--     FROM public.crm_rodizio_membros m
--    WHERE m.tenant_id = '00000000-0000-0000-0000-000000000010' AND m.ativo;
--
-- -- a coluna nova e o valor em uso:
--   SELECT realocar_sem_resposta_min, realocar_carencia_abertura_min, modo
--     FROM public.crm_rodizio_config WHERE tenant_id = '00000000-0000-0000-0000-000000000010';
--
-- -- o painel do gestor devolve o campo novo (logado como gestor):
--   SELECT public.rodizio_estado() -> 'realocar_carencia_abertura_min';
--
-- -- e o gestor ajustando (logado como gestor; 0 desliga só a carência):
--   SELECT public.rodizio_definir_carencia_abertura(90);
--
-- -- portas: nenhuma função nova aberta para anon, e o relógio da pessoa
-- -- fechado até para authenticated (só o servidor lê ponto de terceiro).
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
--          has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role,
--          p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('rodizio_minutos_da_sdr','rodizio_definir_carencia_abertura',
--                        'rodizio_realocar_sem_resposta','rodizio_estado')
--    ORDER BY 1;
--   -- esperado: anon = false nas quatro; authenticated = true só em
--   -- rodizio_definir_carencia_abertura e rodizio_estado; search_path=public em todas.
--
-- -- nenhuma policy foi criada, editada ou removida por esta migration:
--   SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
--    AND tablename IN ('crm_leads','crm_lead_atribuicoes','crm_rodizio_config','crm_rodizio_membros','crm_ponto_eventos');
--   -- comparar com o número de antes do deploy: tem de ser o mesmo.
--
-- -- o aviso de dona ausente que a rodada de hoje gerou (um por dona, por dia):
--   SELECT n.created_at, n.title, n.body, n.dedupe_key
--     FROM public.crm_notifications n
--    WHERE n.dedupe_key LIKE 'rodizio:dona_ausente:00000000-0000-0000-0000-000000000010:%'
--    ORDER BY n.created_at DESC LIMIT 20;
--
-- -- o grampo do horário em uma linha: quanto ela trabalhou hoje pelo relógio,
-- -- e qual é o horário contratado dela hoje (fora dele nada conta).
--   SELECT public.rodizio_nome(m.user_id) AS sdr,
--          (SELECT to_char(hd.entrada, 'HH24:MI') || '–' || to_char(hd.saida, 'HH24:MI')
--             FROM public.rodizio_horario_dia(m.tenant_id, m.user_id,
--                    (now() AT TIME ZONE public.rodizio_tz(m.tenant_id))::date) hd) AS horario_hoje,
--          public.rodizio_minutos_da_sdr(m.tenant_id, m.user_id,
--            (((now() AT TIME ZONE public.rodizio_tz(m.tenant_id))::date)::timestamp)
--              AT TIME ZONE public.rodizio_tz(m.tenant_id), now()) AS min_trabalhados_hoje
--     FROM public.crm_rodizio_membros m
--    WHERE m.tenant_id = '00000000-0000-0000-0000-000000000010' AND m.ativo;
--   -- min_trabalhados_hoje = 0 depois da entrada + corte_tolerancia_min é
--   -- exatamente a dona AUSENTE: os leads dela contam pelo relógio da clínica.
