-- =============================================================================
-- Motivos de pausa configuráveis pelo CRC, "Outro" com o motivo escrito e a
-- opção "Ligação".
--
-- PEDIDO DO DONO (11/09/2026): "Na opção também de pausa aparece as opções,
-- café almoço e outros, quando o sdr clicar em outros deve abrir a opção de
-- digitar o motivo, além disso crie a opção ligação. E no CRC adicione a opção
-- de configurar essas opções de pausa. Pq o crc deve gerenciar tudo isso do
-- SDR".
--
-- O QUE MUDA
--   1. public.crm_ponto_motivos — a lista de motivos passa a ser DADO do
--      cliente (uma linha por motivo, por tenant), não mais uma lista escrita
--      dentro da função e outra dentro da tela. Semeada com Café, Almoço,
--      Ligação e Outro para todo cliente que já tem configuração de rodízio.
--   2. public.crm_ponto_eventos.motivo_detalhe — o texto que a SDR escreve.
--      O MOTIVO CONTINUA SENDO A CHAVE ('outro'), curta e estável; o texto
--      livre mora em outra coluna. Isso é o que mantém o relatório de ponto
--      (public.ponto_pausas / public.ponto_resumo, do outro agente) agrupando
--      por motivo: se o texto entrasse na coluna `motivo`, cada pausa viraria
--      um grupo de um e o "motivo mais frequente" viraria lixo.
--   3. public.ponto_pausar valida contra a TABELA (motivos ativos do cliente),
--      não mais contra a lista fixa ('cafe','almoco','outro') do código.
--   4. RPCs de gestão para o CRC: listar, criar, editar, reordenar,
--      ativar/desativar e excluir motivo — todas com public.is_gestor_equipe().
--
-- >>> ATENÇÃO, A PEGADINHA QUE QUASE PASSOU EM BRANCO <<<
-- A tabela crm_ponto_eventos tinha um CHECK com a MESMA lista fixa:
--     crm_ponto_eventos_motivo_check
--       CHECK (motivo IS NULL OR motivo IN ('cafe','almoco','outro'))
-- Sem trocar esse CHECK, gravar 'ligacao' (ou qualquer motivo novo do gestor)
-- estouraria NO INSERT, depois de toda a validação passar — a SDR clicaria em
-- "Ligação" e levaria um erro cru do Postgres. Ele é SUBSTITUÍDO aqui por um
-- CHECK de FORMATO (chave curta em minúsculas), que não conhece lista nenhuma:
--     crm_ponto_eventos_motivo_chave_ck
--       CHECK (motivo IS NULL OR motivo ~ '^[a-z][a-z0-9_]{0,23}$')
-- Os 3 motivos já gravados em produção ('cafe' x2, 'outro' x1) passam nesse
-- formato — nenhuma linha existente vira inválida. Esta é a ÚNICA coisa
-- existente que a migration derruba, e é um CHECK, não uma policy: nenhuma
-- policy é criada sobre tabela alheia, editada ou removida.
--
-- COMPATIBILIDADE COM A TELA QUE ESTÁ NO AR (a janela entre aplicar a migration
-- e publicar o site). A tela publicada hoje chama ponto_pausar com UM argumento.
-- Por isso ficam DUAS assinaturas públicas, as duas chamando o mesmo miolo:
--     ponto_pausar(p_motivo text)              → site antigo (sem campo de texto)
--     ponto_pausar(p_motivo text, p_detalhe text) → site novo
-- E as duas SEM DEFAULT, de propósito. A assinatura pedida
-- `(p_motivo text, p_detalhe text DEFAULT NULL)` convivendo com a de um
-- argumento seria uma armadilha: para o Postgres, `ponto_pausar('cafe')` ficaria
-- AMBÍGUO ("function ponto_pausar(unknown) is not unique") e o PostgREST
-- devolveria PGRST203 ("could not choose the best candidate function") — ou
-- seja, o remédio da compatibilidade mataria justamente quem ele ia proteger: a
-- SDR do site antigo não conseguiria pausar de jeito nenhum. Com duas
-- assinaturas sem default a escolha é determinística: um argumento → a de um
-- argumento; dois argumentos → a de dois.
-- O miolo (ponto_pausar_registrar) recebe um terceiro parâmetro, p_exigir_texto:
--   • pela assinatura NOVA vem true  → motivo com exige_texto sem texto é RECUSADO;
--   • pela assinatura ANTIGA vem false → a pausa é aceita sem o texto.
-- Sem isso, no dia em que a migration subisse antes do site, a SDR clicaria em
-- "Outro" na tela velha (que não tem campo nenhum) e receberia "escreva o
-- motivo" sem ter onde escrever. Quando todo mundo estiver no site novo, a
-- assinatura de um argumento pode ser derrubada — e só ela.
--
-- AS TRAVAS (o que o banco recusa, e por quê)
--   a) LISTA VAZIA. Desativar ou excluir o último motivo ativo é recusado:
--      sem motivo ativo a SDR não consegue pausar (ponto_pausar exige um da
--      lista). A conferência é feita depois de travar as linhas do cliente
--      (SELECT ... FOR UPDATE), senão dois gestores desativando ao mesmo tempo
--      passariam os dois pela checagem e zerariam a lista.
--   b) CHAVE DUPLICADA. UNIQUE (tenant_id, chave) no banco e mensagem em PT-BR
--      antes de tentar: se a chave já existe DESATIVADA, a mensagem manda
--      reativar em vez de criar outra — reaproveitar a chave é o que mantém o
--      histórico junto no relatório.
--   c) A CHAVE NUNCA MUDA. Editar troca rótulo, ícone e "pede texto"; a chave
--      é imutável de propósito. Renomear "Ligação" para "Ligação ativa" não
--      pode reescrever o passado nem partir o agrupamento do relatório.
--   d) EVENTO ANTIGO COM MOTIVO QUE NÃO EXISTE MAIS. Nada quebra: `motivo` é
--      texto solto em crm_ponto_eventos, sem FK para esta tabela — de caso
--      pensado. ponto_pausas/ponto_resumo continuam agrupando pela chave
--      gravada, e ponto_motivos_listar devolve essas chaves órfãs marcadas
--      (orfao = true, com quantas pausas existem), para o gestor ver que o
--      histórico tem "ligacao" mesmo depois de ele excluir o motivo. Excluir um
--      motivo JÁ USADO é recusado: o caminho é desativar, e aí o rótulo
--      continua existindo para quem for ler o passado.
--   e) SÓ "outro" nasce com exige_texto = true; o gestor pode marcar qualquer
--      outro (ou desmarcar o "outro") — é decisão dele, é o CRC que gerencia.
--   f) CLIENTE SEM LISTA. Cliente criado depois desta migration (ou linha
--      apagada na unha) seria uma SDR sem como pausar. ponto_pausar e
--      ponto_motivos_ativos chamam ponto_motivos_semear() antes de ler: se o
--      cliente não tem NENHUMA linha, os quatro padrões nascem ali. Semear só
--      acontece com a lista totalmente vazia — desativar tudo não ressuscita
--      nada (e a trava (a) impede que chegue a zero ativo).
--
-- Rollback: DROP das funções novas, DROP da tabela crm_ponto_motivos (as
-- policies caem com ela), DROP da coluna motivo_detalhe, DROP dos dois CHECKs
-- novos e recriação do CHECK antigo com a lista fixa — lembrando que, se já
-- houver pausa gravada com 'ligacao', o CHECK antigo só volta depois de tratar
-- essas linhas.
-- =============================================================================

SET LOCAL lock_timeout = '5s';

-- =============================================================== 1. a tabela
CREATE TABLE IF NOT EXISTS public.crm_ponto_motivos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  -- chave curta, estável e sem acento: é ela que vai para crm_ponto_eventos.motivo
  chave          text NOT NULL,
  rotulo         text NOT NULL,
  -- nome do ícone lucide; a tela traduz para o componente e cai em "pause" se não conhecer
  icone          text NOT NULL DEFAULT 'pause',
  posicao        integer NOT NULL DEFAULT 0,
  ativo          boolean NOT NULL DEFAULT true,
  exige_texto    boolean NOT NULL DEFAULT false,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  CONSTRAINT crm_ponto_motivos_chave_uk UNIQUE (tenant_id, chave),
  CONSTRAINT crm_ponto_motivos_chave_ck CHECK (chave ~ '^[a-z][a-z0-9_]{0,23}$'),
  CONSTRAINT crm_ponto_motivos_rotulo_ck CHECK (btrim(rotulo) <> '' AND length(rotulo) <= 40),
  CONSTRAINT crm_ponto_motivos_icone_ck CHECK (btrim(icone) <> '' AND length(icone) <= 32)
);

COMMENT ON TABLE public.crm_ponto_motivos IS
  'Motivos de pausa do ponto da SDR, por cliente, configurados pelo CRC (gestor da equipe). A CHAVE é o que vai para crm_ponto_eventos.motivo e é imutável — é ela que mantém o relatório de ponto agrupável. O rótulo é só o que aparece na tela. exige_texto = a SDR precisa escrever o motivo (grava em crm_ponto_eventos.motivo_detalhe).';
COMMENT ON COLUMN public.crm_ponto_motivos.chave IS 'Chave curta, minúscula e sem acento (cafe, almoco, ligacao, outro). Nunca muda depois de criada.';
COMMENT ON COLUMN public.crm_ponto_motivos.exige_texto IS 'Quando true, ponto_pausar(p_motivo, p_detalhe) exige o texto (>= 3 letras).';

CREATE INDEX IF NOT EXISTS crm_ponto_motivos_tenant_pos_idx
  ON public.crm_ponto_motivos (tenant_id, posicao, rotulo);

ALTER TABLE public.crm_ponto_motivos ENABLE ROW LEVEL SECURITY;

-- Policies NOVAS, de nome próprio, sobre tabela NOVA. Escrita real acontece
-- pelas RPCs SECURITY DEFINER; estas policies são a segunda tranca (quem
-- chegar pelo PostgREST direto só lê, e só do próprio cliente).
DO $policies$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='crm_ponto_motivos' AND policyname='ponto_motivos_le_do_tenant') THEN
    CREATE POLICY ponto_motivos_le_do_tenant ON public.crm_ponto_motivos
      FOR SELECT TO authenticated
      USING (tenant_id = (SELECT public.current_tenant_id()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='crm_ponto_motivos' AND policyname='ponto_motivos_gestor_insere') THEN
    CREATE POLICY ponto_motivos_gestor_insere ON public.crm_ponto_motivos
      FOR INSERT TO authenticated
      WITH CHECK (tenant_id = (SELECT public.current_tenant_id()) AND (SELECT public.is_gestor_equipe()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='crm_ponto_motivos' AND policyname='ponto_motivos_gestor_edita') THEN
    CREATE POLICY ponto_motivos_gestor_edita ON public.crm_ponto_motivos
      FOR UPDATE TO authenticated
      USING (tenant_id = (SELECT public.current_tenant_id()) AND (SELECT public.is_gestor_equipe()))
      WITH CHECK (tenant_id = (SELECT public.current_tenant_id()) AND (SELECT public.is_gestor_equipe()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='crm_ponto_motivos' AND policyname='ponto_motivos_gestor_apaga') THEN
    CREATE POLICY ponto_motivos_gestor_apaga ON public.crm_ponto_motivos
      FOR DELETE TO authenticated
      USING (tenant_id = (SELECT public.current_tenant_id()) AND (SELECT public.is_gestor_equipe()));
  END IF;

  -- Mesma tranca dura das irmãs (crm_ponto_eventos, crm_rodizio_config): nada
  -- atravessa cliente, nem por engano de uma policy permissiva futura.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='crm_ponto_motivos' AND policyname='tenant_hard_isolation_crm_ponto_motivos') THEN
    CREATE POLICY tenant_hard_isolation_crm_ponto_motivos ON public.crm_ponto_motivos
      AS RESTRICTIVE FOR ALL TO authenticated
      USING (tenant_id = (SELECT public.current_tenant_id())
             OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)))
      WITH CHECK (tenant_id = (SELECT public.current_tenant_id())
             OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role)));
  END IF;
END $policies$;

-- No Supabase toda tabela nova nasce com privilégio de tabela para anon e
-- authenticated (é o default privilege do projeto: quem segura a porta é a RLS).
-- Aqui não existe policy nenhuma para anon — então anon já não lê nada —, e o
-- REVOKE abaixo fecha a porta também no nível do privilégio, para o dia em que
-- alguém criar uma policy FOR ALL TO public sem perceber.
REVOKE ALL ON TABLE public.crm_ponto_motivos FROM anon;

-- E A ESCRITA DIRETA DO GESTOR TAMBÉM FECHA AQUI. Sem estas duas linhas, o
-- comentário acima seria meia verdade: `authenticated` tem INSERT/UPDATE/DELETE
-- por privilégio padrão do projeto, e as policies do gestor deixariam ele
-- escrever na tabela pelo PostgREST, PULANDO todas as travas que vivem nas RPCs
-- — a que impede esvaziar a lista (e deixar a SDR sem como pausar) e a que
-- impede apagar motivo já usado (o relatório perderia o rótulo). O gestor passa
-- a mexer SÓ pelas funções, que é onde as regras estão escritas. Ler continua
-- liberado: é a lista que a tela do SDR e a do CRC mostram.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.crm_ponto_motivos FROM authenticated;
GRANT SELECT ON TABLE public.crm_ponto_motivos TO authenticated;

-- ======================================= 2. semeadura (agora e para o futuro)
-- Função interna: só serve para um cliente que não tem NENHUM motivo cadastrado
-- não deixar a SDR sem como pausar. Não é uma RPC de tela — fica fora do
-- alcance de authenticated/anon de propósito (quem a chama são funções
-- SECURITY DEFINER, que rodam como dono e não precisam de GRANT).
CREATE OR REPLACE FUNCTION public.ponto_motivos_semear(p_tenant uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_n integer := 0;
BEGIN
  IF p_tenant IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.crm_ponto_motivos m WHERE m.tenant_id = p_tenant) THEN
    RETURN 0;  -- cliente já tem lista: nunca ressuscitar o que o gestor desativou
  END IF;
  INSERT INTO public.crm_ponto_motivos (tenant_id, chave, rotulo, icone, posicao, ativo, exige_texto)
  SELECT p_tenant, d.chave, d.rotulo, d.icone, d.posicao, true, d.exige_texto
    FROM (VALUES ('cafe',   'Café',    'coffee',          10, false),
                 ('almoco', 'Almoço',  'utensils',        20, false),
                 ('ligacao','Ligação', 'phone',           30, false),
                 ('outro',  'Outro',   'more-horizontal', 40, true)
         ) AS d(chave, rotulo, icone, posicao, exige_texto)
  ON CONFLICT (tenant_id, chave) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;

COMMENT ON FUNCTION public.ponto_motivos_semear(uuid) IS
  'Interna: cria os quatro motivos padrão (Café, Almoço, Ligação, Outro) para um cliente que ainda não tem NENHUM. Não reativa e não recria nada que o gestor tenha mexido.';
REVOKE ALL ON FUNCTION public.ponto_motivos_semear(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ponto_motivos_semear(uuid) TO service_role;

-- Semeadura de agora: todo cliente que já tem configuração de rodízio.
-- ON CONFLICT DO NOTHING: reaplicar a migration não duplica nem sobrescreve.
INSERT INTO public.crm_ponto_motivos (tenant_id, chave, rotulo, icone, posicao, ativo, exige_texto)
SELECT c.tenant_id, d.chave, d.rotulo, d.icone, d.posicao, true, d.exige_texto
  FROM public.crm_rodizio_config c
  CROSS JOIN (VALUES ('cafe',   'Café',    'coffee',          10, false),
                     ('almoco', 'Almoço',  'utensils',        20, false),
                     ('ligacao','Ligação', 'phone',           30, false),
                     ('outro',  'Outro',   'more-horizontal', 40, true)
             ) AS d(chave, rotulo, icone, posicao, exige_texto)
ON CONFLICT (tenant_id, chave) DO NOTHING;

-- ========================== 3. o texto livre, e o CHECK que travava a lista
ALTER TABLE public.crm_ponto_eventos ADD COLUMN IF NOT EXISTS motivo_detalhe text;

COMMENT ON COLUMN public.crm_ponto_eventos.motivo_detalhe IS
  'Texto que a SDR escreve quando o motivo exige (ex.: motivo="outro", detalhe="buscar documento no cartório"). O AGRUPAMENTO do relatório continua sendo por `motivo` (a chave); este campo é só a explicação daquela pausa.';

DO $checks$
BEGIN
  -- Sai o CHECK com a lista fixa ('cafe','almoco','outro') — é ele que
  -- impediria gravar 'ligacao' e qualquer motivo criado pelo gestor.
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.crm_ponto_eventos'::regclass
                AND conname = 'crm_ponto_eventos_motivo_check') THEN
    ALTER TABLE public.crm_ponto_eventos DROP CONSTRAINT crm_ponto_eventos_motivo_check;
  END IF;

  -- Entra um CHECK de FORMATO: mesma régua da coluna chave da tabela nova.
  -- Continua garantindo que o motivo é uma CHAVE curta (e não um texto livre
  -- que estouraria o agrupamento do relatório de ponto).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.crm_ponto_eventos'::regclass
                    AND conname = 'crm_ponto_eventos_motivo_chave_ck') THEN
    ALTER TABLE public.crm_ponto_eventos
      ADD CONSTRAINT crm_ponto_eventos_motivo_chave_ck
      CHECK (motivo IS NULL OR motivo ~ '^[a-z][a-z0-9_]{0,23}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.crm_ponto_eventos'::regclass
                    AND conname = 'crm_ponto_eventos_motivo_detalhe_ck') THEN
    ALTER TABLE public.crm_ponto_eventos
      ADD CONSTRAINT crm_ponto_eventos_motivo_detalhe_ck
      CHECK (motivo_detalhe IS NULL
             OR (btrim(motivo_detalhe) <> '' AND length(motivo_detalhe) <= 200));
  END IF;
END $checks$;

-- ================================================= 4. pausar (o miolo e as 2 portas)
-- O miolo. p_exigir_texto é o que separa a tela nova (que TEM campo para
-- escrever) da tela que está publicada agora (que não tem): ver o cabeçalho.
CREATE OR REPLACE FUNCTION public.ponto_pausar_registrar(
  p_motivo text, p_detalhe text, p_exigir_texto boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_estado text;
  v_chave  text;
  v_detalhe text;
  v_letras integer;
  v_m record;
  v_lista text;
BEGIN
  PERFORM public.ponto_exige_sdr();

  v_chave := lower(btrim(COALESCE(p_motivo, '')));
  IF v_chave = '' THEN
    RAISE EXCEPTION 'Escolha o motivo da pausa.' USING ERRCODE = '22023';
  END IF;

  -- Cliente sem lista nenhuma (novo, ou linha apagada na unha) não pode deixar
  -- a SDR sem como pausar.
  PERFORM public.ponto_motivos_semear(v_tenant);

  SELECT m.chave, m.rotulo, m.exige_texto INTO v_m
    FROM public.crm_ponto_motivos m
   WHERE m.tenant_id = v_tenant AND m.chave = v_chave AND m.ativo;

  IF NOT FOUND THEN
    -- Mensagem diferente para "existe mas foi desligado" e para "não existe":
    -- a primeira é uma decisão do gestor e a SDR precisa entender isso.
    IF EXISTS (SELECT 1 FROM public.crm_ponto_motivos m2
                WHERE m2.tenant_id = v_tenant AND m2.chave = v_chave) THEN
      RAISE EXCEPTION 'O motivo de pausa "%" foi desativado pelo administrador. Atualize a página e escolha outro.', v_chave
        USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(m3.rotulo, ', ' ORDER BY m3.posicao, m3.rotulo) INTO v_lista
      FROM public.crm_ponto_motivos m3
     WHERE m3.tenant_id = v_tenant AND m3.ativo;
    IF v_lista IS NULL THEN
      RAISE EXCEPTION 'Nenhum motivo de pausa está ativo nesta clínica. Peça ao administrador para ativar um motivo em Equipe → Motivos de pausa.'
        USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'Motivo de pausa inválido. Escolha um da lista: %.', v_lista USING ERRCODE = '22023';
  END IF;

  v_detalhe := NULLIF(btrim(COALESCE(p_detalhe, '')), '');
  IF v_m.exige_texto AND COALESCE(p_exigir_texto, true) THEN
    -- "pelo menos 3 letras" medido em caracteres de verdade: "..." ou "--" não passam.
    v_letras := length(regexp_replace(COALESCE(v_detalhe, ''), '[^[:alnum:]]', '', 'g'));
    IF v_letras < 3 THEN
      RAISE EXCEPTION 'Escreva o motivo da pausa "%" (pelo menos 3 letras). Exemplo: buscar documento no cartório.', v_m.rotulo
        USING ERRCODE = '22023';
    END IF;
  END IF;
  -- Corta em 200 em vez de recusar: a SDR está com pressa, e perder a pausa
  -- por causa do 201º caractere seria pior do que guardar o começo do recado.
  IF v_detalhe IS NOT NULL AND length(v_detalhe) > 200 THEN
    v_detalhe := left(v_detalhe, 200);
  END IF;

  v_estado := public.ponto_meu_estado()->>'estado';
  IF v_estado = 'pausado' THEN
    RAISE EXCEPTION 'Você já está em pausa.';
  ELSIF v_estado <> 'aberto' THEN
    RAISE EXCEPTION 'Abra o expediente antes de pausar.';
  END IF;

  INSERT INTO public.crm_ponto_eventos (tenant_id, user_id, tipo, motivo, motivo_detalhe, origem, criado_por)
  VALUES (v_tenant, v_uid, 'pausar', v_m.chave, v_detalhe, 'ui', v_uid);

  -- O estado de sempre, mais o que a tela precisa para escrever
  -- "Em pausa · Outro: buscar documento" sem uma segunda ida ao banco.
  RETURN public.ponto_meu_estado()
         || jsonb_build_object('motivo_detalhe', v_detalhe, 'motivo_rotulo', v_m.rotulo);
END $fn$;

COMMENT ON FUNCTION public.ponto_pausar_registrar(text, text, boolean) IS
  'Miolo do pausar: valida o motivo contra crm_ponto_motivos ATIVOS do cliente e, quando o motivo exige texto E p_exigir_texto é true, exige o detalhe (>= 3 letras). p_exigir_texto = false é a porta da tela antiga (um argumento), que não tem campo para escrever.';
REVOKE ALL ON FUNCTION public.ponto_pausar_registrar(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ponto_pausar_registrar(text, text, boolean) TO service_role;

-- Porta NOVA (tela nova): dois argumentos, sem DEFAULT — ver o cabeçalho.
CREATE OR REPLACE FUNCTION public.ponto_pausar(p_motivo text, p_detalhe text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  RETURN public.ponto_pausar_registrar(p_motivo, p_detalhe, true);
END $fn$;

COMMENT ON FUNCTION public.ponto_pausar(text, text) IS
  'Pausa o expediente da SDR com um motivo da lista do cliente (crm_ponto_motivos) e, quando o motivo exige, o texto escrito por ela (vai para crm_ponto_eventos.motivo_detalhe).';
REVOKE ALL ON FUNCTION public.ponto_pausar(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_pausar(text, text) TO authenticated, service_role;

-- Porta ANTIGA (a tela que está publicada agora): um argumento só. Continua
-- funcionando, inclusive para motivo que exige texto — a tela velha não tem
-- onde digitar, e negar a pausa dela seria estragar o expediente de quem ainda
-- não recebeu o site novo. Pode ser derrubada depois que o site novo estiver no ar.
CREATE OR REPLACE FUNCTION public.ponto_pausar(p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  RETURN public.ponto_pausar_registrar(p_motivo, NULL::text, false);
END $fn$;

COMMENT ON FUNCTION public.ponto_pausar(text) IS
  'Compatibilidade: a tela publicada antes dos motivos configuráveis chama com um argumento só. Valida o motivo contra a lista do cliente e grava sem detalhe. A porta nova é ponto_pausar(p_motivo, p_detalhe).';
REVOKE ALL ON FUNCTION public.ponto_pausar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_pausar(text) TO authenticated, service_role;

-- ====================================== 5. o que a tela da SDR precisa ler
-- Lista dos motivos ATIVOS do cliente (qualquer pessoa logada do cliente lê:
-- é configuração da clínica, não dado de ninguém).
CREATE OR REPLACE FUNCTION public.ponto_motivos_ativos()
RETURNS TABLE(chave text, rotulo text, icone text, exige_texto boolean, posicao integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN RETURN; END IF;
  PERFORM public.ponto_motivos_semear(v_tenant);
  RETURN QUERY
    SELECT m.chave, m.rotulo, m.icone, m.exige_texto, m.posicao
      FROM public.crm_ponto_motivos m
     WHERE m.tenant_id = v_tenant AND m.ativo
     ORDER BY m.posicao, m.rotulo;
END $fn$;

COMMENT ON FUNCTION public.ponto_motivos_ativos() IS
  'Motivos de pausa ativos do cliente, na ordem definida pelo gestor — é o que o menu "Pausar" da SDR mostra.';
REVOKE ALL ON FUNCTION public.ponto_motivos_ativos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_motivos_ativos() TO authenticated, service_role;

-- A pausa ABERTA de quem está chamando (motivo, rótulo e o texto escrito).
-- ponto_meu_estado devolve a chave do motivo, não o detalhe; em vez de mexer
-- naquela função (que o cartão da SDR, o relatório do gestor e o motor leem),
-- o detalhe vem por aqui, só quando a tela precisa dele.
CREATE OR REPLACE FUNCTION public.ponto_minha_pausa()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_ev record;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RETURN jsonb_build_object('pausado', false);
  END IF;
  -- Último evento da pessoa: se for 'pausar', a pausa está aberta (mesma
  -- leitura da máquina de estados de ponto_sessoes; encerramento automático
  -- também grava evento, então ele apareceria aqui).
  SELECT e.tipo, e.motivo, e.motivo_detalhe, e.em INTO v_ev
    FROM public.crm_ponto_eventos e
   WHERE e.tenant_id = v_tenant AND e.user_id = v_uid
   ORDER BY e.em DESC, e.id DESC
   LIMIT 1;
  IF NOT FOUND OR v_ev.tipo <> 'pausar' THEN
    RETURN jsonb_build_object('pausado', false);
  END IF;
  RETURN jsonb_build_object(
    'pausado', true,
    'motivo',  v_ev.motivo,
    'rotulo',  (SELECT m.rotulo FROM public.crm_ponto_motivos m
                 WHERE m.tenant_id = v_tenant AND m.chave = v_ev.motivo),
    'detalhe', v_ev.motivo_detalhe,
    'desde',   v_ev.em
  );
END $fn$;

COMMENT ON FUNCTION public.ponto_minha_pausa() IS
  'A pausa aberta de quem está chamando: motivo (chave), rótulo atual e o texto escrito. Só a própria linha. Rótulo nulo = o motivo daquela pausa não está mais cadastrado (evento antigo) — a tela mostra a chave.';
REVOKE ALL ON FUNCTION public.ponto_minha_pausa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_minha_pausa() TO authenticated, service_role;

-- Ícones aceitos: os nomes lucide que a TELA sabe desenhar. Se o banco
-- aceitasse qualquer texto, o gestor escolheria um ícone que a tela não
-- conhece e a lista da SDR mostraria o genérico sem ninguém entender por quê.
-- A tela ainda cai em "pause" para o que não reconhecer (banco e tela podem
-- andar em versões diferentes), mas o que ENTRA já vem conferido.
CREATE OR REPLACE FUNCTION public.ponto_motivo_icone_valido(p_icone text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v text := lower(btrim(COALESCE(p_icone, '')));
  v_ok text[] := ARRAY['coffee','utensils','phone','more-horizontal','pause',
                       'clock','car','stethoscope','user','book-open'];
BEGIN
  IF v = '' THEN RETURN 'pause'; END IF;
  IF NOT (v = ANY(v_ok)) THEN
    RAISE EXCEPTION 'Ícone inválido: escolha um destes — %.', array_to_string(v_ok, ', ')
      USING ERRCODE = '22023';
  END IF;
  RETURN v;
END $fn$;

COMMENT ON FUNCTION public.ponto_motivo_icone_valido(text) IS
  'Interna: confere o nome do ícone lucide do motivo de pausa contra a lista que a tela sabe desenhar. Vazio vira "pause".';
REVOKE ALL ON FUNCTION public.ponto_motivo_icone_valido(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ponto_motivo_icone_valido(text) TO service_role;

-- ============================================ 6. o CRC gerenciando a lista
-- Todas no mesmo padrão das outras funções de gestão do projeto
-- (is_gestor_equipe + lock_timeout + access_logs + retorno jsonb).

-- Lista COMPLETA para a tela do gestor: ativos e desativados, com quantas
-- pausas cada um já teve. As últimas linhas são as chaves ÓRFÃS — motivos que
-- só existem no histórico (o gestor excluiu, ou vieram de antes desta lista).
-- Elas aparecem marcadas, e não somem do relatório de ponto.
CREATE OR REPLACE FUNCTION public.ponto_motivos_listar()
RETURNS TABLE(
  id uuid, chave text, rotulo text, icone text, posicao integer,
  ativo boolean, exige_texto boolean, usos integer, orfao boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN RETURN; END IF;
  PERFORM public.ponto_motivos_semear(v_tenant);

  RETURN QUERY
  WITH hist AS (
    SELECT e.motivo AS chave, count(*)::integer AS n
      FROM public.crm_ponto_eventos e
     WHERE e.tenant_id = v_tenant AND e.tipo = 'pausar' AND e.motivo IS NOT NULL
     GROUP BY e.motivo
  )
  SELECT m.id, m.chave, m.rotulo, m.icone, m.posicao, m.ativo, m.exige_texto,
         COALESCE(h.n, 0), false
    FROM public.crm_ponto_motivos m
    LEFT JOIN hist h ON h.chave = m.chave
   WHERE m.tenant_id = v_tenant
  UNION ALL
  SELECT NULL::uuid, h2.chave, h2.chave, 'pause'::text, 999999, false, false, h2.n, true
    FROM hist h2
   WHERE NOT EXISTS (SELECT 1 FROM public.crm_ponto_motivos m2
                      WHERE m2.tenant_id = v_tenant AND m2.chave = h2.chave)
   ORDER BY 9, 5, 3;
END $fn$;

COMMENT ON FUNCTION public.ponto_motivos_listar() IS
  'Motivos de pausa do cliente para a tela do gestor (ativos e desativados), com o número de pausas já registradas em cada um. As linhas com orfao=true são chaves que só existem no histórico (id nulo): o relatório de ponto continua mostrando essas pausas.';
REVOKE ALL ON FUNCTION public.ponto_motivos_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_motivos_listar() TO authenticated, service_role;

-- ---------------------------------------------------------------- criar
CREATE OR REPLACE FUNCTION public.ponto_motivo_criar(
  p_rotulo text, p_icone text, p_exige_texto boolean, p_chave text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_rotulo text;
  v_icone  text;
  v_chave  text;
  v_pos    integer;
  v_n      integer;
  v_ja     record;
  v_id     uuid;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sem cliente ativo.' USING ERRCODE = '42501';
  END IF;

  v_rotulo := btrim(COALESCE(p_rotulo, ''));
  IF v_rotulo = '' THEN
    RAISE EXCEPTION 'Dê um nome ao motivo (ex.: Ligação, Banheiro, Reunião).' USING ERRCODE = '22023';
  END IF;
  IF length(v_rotulo) > 40 THEN
    RAISE EXCEPTION 'O nome do motivo precisa ter até 40 caracteres.' USING ERRCODE = '22023';
  END IF;

  v_icone := public.ponto_motivo_icone_valido(p_icone);

  -- A chave é derivada do nome quando o gestor não manda uma: minúscula, sem
  -- acento, só letras/números/underscore. É ela que vai para o histórico.
  v_chave := lower(btrim(COALESCE(NULLIF(btrim(COALESCE(p_chave, '')), ''), v_rotulo)));
  v_chave := translate(v_chave,
                       'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                       'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn');
  v_chave := btrim(regexp_replace(v_chave, '[^a-z0-9]+', '_', 'g'), '_');
  v_chave := left(v_chave, 24);
  IF v_chave !~ '^[a-z][a-z0-9_]{0,23}$' THEN
    RAISE EXCEPTION 'Use um nome que comece com letra (ex.: Ligação, Banheiro). "%" não vira uma chave válida.', v_rotulo
      USING ERRCODE = '22023';
  END IF;

  -- Trava as linhas do cliente: contagem e chave duplicada decididas sem corrida.
  PERFORM 1 FROM public.crm_ponto_motivos m WHERE m.tenant_id = v_tenant FOR UPDATE;

  SELECT m.chave, m.rotulo, m.ativo INTO v_ja
    FROM public.crm_ponto_motivos m
   WHERE m.tenant_id = v_tenant AND m.chave = v_chave;
  IF FOUND THEN
    IF v_ja.ativo THEN
      RAISE EXCEPTION 'Já existe o motivo "%" (chave %). Use outro nome.', v_ja.rotulo, v_ja.chave USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'O motivo "%" (chave %) existe, mas está desativado. Ligue o interruptor dele na lista em vez de criar outro — assim o histórico continua junto.', v_ja.rotulo, v_ja.chave
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer INTO v_n FROM public.crm_ponto_motivos m WHERE m.tenant_id = v_tenant;
  IF v_n >= 12 THEN
    RAISE EXCEPTION 'A lista de motivos de pausa tem no máximo 12 itens. Exclua ou desative algum antes de criar outro.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(max(m.posicao), 0) + 10 INTO v_pos
    FROM public.crm_ponto_motivos m WHERE m.tenant_id = v_tenant;

  INSERT INTO public.crm_ponto_motivos
    (tenant_id, chave, rotulo, icone, posicao, ativo, exige_texto, criado_por, atualizado_por)
  VALUES (v_tenant, v_chave, v_rotulo, v_icone, v_pos, true, COALESCE(p_exige_texto, false), auth.uid(), auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), v_tenant, 'tenant', 'ponto_motivo_criar',
          jsonb_build_object('id', v_id, 'chave', v_chave, 'rotulo', v_rotulo,
                             'icone', v_icone, 'exige_texto', COALESCE(p_exige_texto, false)));

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'chave', v_chave, 'rotulo', v_rotulo,
                            'icone', v_icone, 'posicao', v_pos, 'ativo', true,
                            'exige_texto', COALESCE(p_exige_texto, false));
END $fn$;

COMMENT ON FUNCTION public.ponto_motivo_criar(text, text, boolean, text) IS
  'Cria um motivo de pausa para o cliente (só o gestor da equipe). A chave é derivada do nome quando não vem pronta, e nunca muda depois. Máximo de 12 motivos por cliente.';
REVOKE ALL ON FUNCTION public.ponto_motivo_criar(text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_motivo_criar(text, text, boolean, text) TO authenticated, service_role;

-- --------------------------------------------------------------- editar
-- Rótulo, ícone e "pede o motivo escrito". A CHAVE NÃO ENTRA aqui de propósito:
-- ela é o que costura o histórico do relatório de ponto.
CREATE OR REPLACE FUNCTION public.ponto_motivo_editar(
  p_id uuid, p_rotulo text, p_icone text, p_exige_texto boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_rotulo text;
  v_icone  text;
  v_antes  record;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sem cliente ativo.' USING ERRCODE = '42501';
  END IF;

  v_rotulo := btrim(COALESCE(p_rotulo, ''));
  IF v_rotulo = '' THEN
    RAISE EXCEPTION 'O motivo precisa de um nome.' USING ERRCODE = '22023';
  END IF;
  IF length(v_rotulo) > 40 THEN
    RAISE EXCEPTION 'O nome do motivo precisa ter até 40 caracteres.' USING ERRCODE = '22023';
  END IF;
  v_icone := public.ponto_motivo_icone_valido(p_icone);

  SELECT m.id, m.chave, m.rotulo, m.icone, m.exige_texto INTO v_antes
    FROM public.crm_ponto_motivos m
   WHERE m.id = p_id AND m.tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Motivo de pausa não encontrado.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.crm_ponto_motivos
     SET rotulo = v_rotulo, icone = v_icone, exige_texto = COALESCE(p_exige_texto, false),
         atualizado_em = now(), atualizado_por = auth.uid()
   WHERE id = p_id AND tenant_id = v_tenant;

  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), v_tenant, 'tenant', 'ponto_motivo_editar',
          jsonb_build_object('id', p_id, 'chave', v_antes.chave,
                             'de', jsonb_build_object('rotulo', v_antes.rotulo, 'icone', v_antes.icone, 'exige_texto', v_antes.exige_texto),
                             'para', jsonb_build_object('rotulo', v_rotulo, 'icone', v_icone, 'exige_texto', COALESCE(p_exige_texto, false))));

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'chave', v_antes.chave, 'rotulo', v_rotulo,
                            'icone', v_icone, 'exige_texto', COALESCE(p_exige_texto, false));
END $fn$;

COMMENT ON FUNCTION public.ponto_motivo_editar(uuid, text, text, boolean) IS
  'Renomeia um motivo de pausa e muda o ícone / se ele pede o motivo escrito (só o gestor da equipe). A chave não muda: o histórico do relatório de ponto continua agrupado.';
REVOKE ALL ON FUNCTION public.ponto_motivo_editar(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_motivo_editar(uuid, text, text, boolean) TO authenticated, service_role;

-- ------------------------------------------------------ ativar/desativar
CREATE OR REPLACE FUNCTION public.ponto_motivo_ativar(p_id uuid, p_ativo boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_m record;
  v_ativos integer;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sem cliente ativo.' USING ERRCODE = '42501';
  END IF;
  IF p_ativo IS NULL THEN
    RAISE EXCEPTION 'Informe se o motivo fica ligado ou desligado.' USING ERRCODE = '22023';
  END IF;

  -- Trava a lista inteira do cliente ANTES de contar: dois gestores desligando
  -- ao mesmo tempo passariam os dois pela conferência e zerariam a lista.
  PERFORM 1 FROM public.crm_ponto_motivos m WHERE m.tenant_id = v_tenant FOR UPDATE;

  SELECT m.id, m.chave, m.rotulo, m.ativo INTO v_m
    FROM public.crm_ponto_motivos m WHERE m.id = p_id AND m.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Motivo de pausa não encontrado.' USING ERRCODE = '22023';
  END IF;
  IF v_m.ativo = p_ativo THEN
    RETURN jsonb_build_object('ok', true, 'id', p_id, 'chave', v_m.chave, 'ativo', p_ativo, 'mudou', false);
  END IF;

  IF NOT p_ativo THEN
    SELECT count(*)::integer INTO v_ativos
      FROM public.crm_ponto_motivos m WHERE m.tenant_id = v_tenant AND m.ativo;
    IF v_ativos <= 1 THEN
      RAISE EXCEPTION 'Pelo menos um motivo precisa continuar ligado: sem nenhum, a SDR não consegue pausar o expediente.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.crm_ponto_motivos
     SET ativo = p_ativo, atualizado_em = now(), atualizado_por = auth.uid()
   WHERE id = p_id AND tenant_id = v_tenant;

  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), v_tenant, 'tenant', 'ponto_motivo_ativar',
          jsonb_build_object('id', p_id, 'chave', v_m.chave, 'rotulo', v_m.rotulo, 'ativo', p_ativo));

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'chave', v_m.chave, 'rotulo', v_m.rotulo,
                            'ativo', p_ativo, 'mudou', true);
END $fn$;

COMMENT ON FUNCTION public.ponto_motivo_ativar(uuid, boolean) IS
  'Liga/desliga um motivo de pausa (só o gestor da equipe). Recusa desligar o último ativo — a SDR ficaria sem como pausar. Pausa já gravada com esse motivo não muda.';
REVOKE ALL ON FUNCTION public.ponto_motivo_ativar(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_motivo_ativar(uuid, boolean) TO authenticated, service_role;

-- -------------------------------------------------------------- excluir
CREATE OR REPLACE FUNCTION public.ponto_motivo_excluir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_m record;
  v_usos integer;
  v_ativos integer;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sem cliente ativo.' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.crm_ponto_motivos m WHERE m.tenant_id = v_tenant FOR UPDATE;

  SELECT m.id, m.chave, m.rotulo, m.ativo INTO v_m
    FROM public.crm_ponto_motivos m WHERE m.id = p_id AND m.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Motivo de pausa não encontrado.' USING ERRCODE = '22023';
  END IF;

  -- Motivo já usado não se apaga: o relatório de ponto lê a CHAVE gravada no
  -- evento, e sem a linha aqui o gestor perde o rótulo ("Ligação" viraria
  -- "ligacao" na tela dele). Desativar resolve e preserva o passado.
  SELECT count(*)::integer INTO v_usos
    FROM public.crm_ponto_eventos e
   WHERE e.tenant_id = v_tenant AND e.tipo = 'pausar' AND e.motivo = v_m.chave;
  IF v_usos > 0 THEN
    RAISE EXCEPTION 'Este motivo já foi usado em % pausa(s). Desative-o no interruptor em vez de excluir, para o relatório de ponto continuar mostrando "%".', v_usos, v_m.rotulo
      USING ERRCODE = '22023';
  END IF;

  IF v_m.ativo THEN
    SELECT count(*)::integer INTO v_ativos
      FROM public.crm_ponto_motivos m WHERE m.tenant_id = v_tenant AND m.ativo;
    IF v_ativos <= 1 THEN
      RAISE EXCEPTION 'Pelo menos um motivo precisa continuar na lista: sem nenhum, a SDR não consegue pausar o expediente.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  DELETE FROM public.crm_ponto_motivos WHERE id = p_id AND tenant_id = v_tenant;

  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), v_tenant, 'tenant', 'ponto_motivo_excluir',
          jsonb_build_object('id', p_id, 'chave', v_m.chave, 'rotulo', v_m.rotulo));

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'chave', v_m.chave, 'rotulo', v_m.rotulo);
END $fn$;

COMMENT ON FUNCTION public.ponto_motivo_excluir(uuid) IS
  'Exclui um motivo de pausa que NUNCA foi usado (só o gestor da equipe). Motivo com histórico só pode ser desativado; e a lista nunca fica sem nenhum ativo.';
REVOKE ALL ON FUNCTION public.ponto_motivo_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_motivo_excluir(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------ reordenar
-- A tela manda a lista inteira na ordem nova (setas para cima/baixo). Mandar a
-- lista inteira, e não "troque este com aquele", evita ordem quebrada quando
-- duas abas mexem ao mesmo tempo: a lista precisa bater com a do banco, senão
-- a RPC recusa e a tela recarrega.
CREATE OR REPLACE FUNCTION public.ponto_motivos_reordenar(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_total integer;
  v_validos integer;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sem cliente ativo.' USING ERRCODE = '42501';
  END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Informe a ordem dos motivos.' USING ERRCODE = '22023';
  END IF;
  IF array_length(p_ids, 1) <> (SELECT count(DISTINCT t.id)::integer FROM unnest(p_ids) AS t(id)) THEN
    RAISE EXCEPTION 'A ordem enviada tem motivo repetido.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.crm_ponto_motivos m WHERE m.tenant_id = v_tenant FOR UPDATE;

  SELECT count(*)::integer INTO v_total FROM public.crm_ponto_motivos m WHERE m.tenant_id = v_tenant;
  SELECT count(*)::integer INTO v_validos
    FROM public.crm_ponto_motivos m
   WHERE m.tenant_id = v_tenant AND m.id = ANY(p_ids);
  IF v_validos <> array_length(p_ids, 1) OR v_validos <> v_total THEN
    RAISE EXCEPTION 'A lista de motivos mudou enquanto você ordenava. Atualize a tela e tente de novo.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.crm_ponto_motivos m
     SET posicao = o.ord * 10, atualizado_em = now(), atualizado_por = auth.uid()
    FROM (SELECT x.id, x.ord FROM unnest(p_ids) WITH ORDINALITY AS x(id, ord)) o
   WHERE m.id = o.id AND m.tenant_id = v_tenant
     AND m.posicao IS DISTINCT FROM o.ord * 10;

  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), v_tenant, 'tenant', 'ponto_motivos_reordenar',
          jsonb_build_object('ordem', to_jsonb(p_ids)));

  RETURN jsonb_build_object('ok', true, 'itens', array_length(p_ids, 1));
END $fn$;

COMMENT ON FUNCTION public.ponto_motivos_reordenar(uuid[]) IS
  'Grava a ordem dos motivos de pausa (só o gestor da equipe). Recebe a lista COMPLETA do cliente na ordem nova; se não bater com a do banco, recusa e manda atualizar a tela.';
REVOKE ALL ON FUNCTION public.ponto_motivos_reordenar(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ponto_motivos_reordenar(uuid[]) TO authenticated, service_role;

-- =============================================================================
-- VERIFICAÇÃO (só leitura, depois de aplicar)
--
-- 1. Portas das funções novas: nenhuma aberta para anon; search_path fixo.
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--        has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
--        has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role,
--        p.proconfig, p.prosecdef
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND p.proname IN ('ponto_pausar','ponto_pausar_registrar','ponto_motivos_ativos',
--                      'ponto_minha_pausa','ponto_motivos_listar','ponto_motivo_criar',
--                      'ponto_motivo_editar','ponto_motivo_ativar','ponto_motivo_excluir',
--                      'ponto_motivos_reordenar','ponto_motivos_semear','ponto_motivo_icone_valido')
--  ORDER BY 1, 2;
-- -- esperado: anon=false em TODAS; authenticated=true só nas de tela
-- --           (ponto_pausar x2, ponto_motivos_ativos, ponto_minha_pausa,
-- --           ponto_motivos_listar, ponto_motivo_*, ponto_motivos_reordenar);
-- --           ponto_pausar_registrar / ponto_motivos_semear /
-- --           ponto_motivo_icone_valido = service_role só;
-- --           prosecdef=true e proconfig com search_path=public em todas.
--
-- 2. As DUAS assinaturas de ponto_pausar existem e NENHUMA tem default (é isso
--    que impede o "is not unique" do site antigo):
-- SELECT pg_get_function_identity_arguments(p.oid) AS args, p.pronargdefaults
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname='public' AND p.proname='ponto_pausar';
-- -- esperado: 2 linhas ('p_motivo text' e 'p_motivo text, p_detalhe text'),
-- --           pronargdefaults = 0 nas duas.
--
-- 3. O CHECK da lista fixa saiu e o de formato entrou:
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint WHERE conrelid='public.crm_ponto_eventos'::regclass AND contype='c';
-- -- esperado: sem crm_ponto_eventos_motivo_check; com
-- --           crm_ponto_eventos_motivo_chave_ck e crm_ponto_eventos_motivo_detalhe_ck.
--
-- 4. Semeadura e policies da tabela nova:
-- SELECT tenant_id, chave, rotulo, icone, posicao, ativo, exige_texto
--   FROM public.crm_ponto_motivos ORDER BY tenant_id, posicao;
-- -- esperado: 4 linhas por cliente com rodízio; exige_texto=true SÓ em 'outro'.
-- SELECT policyname, permissive, cmd FROM pg_policies
--  WHERE schemaname='public' AND tablename='crm_ponto_motivos' ORDER BY policyname;
-- -- esperado: 4 permissivas novas + 1 restritiva de isolamento. E o número de
-- -- policies das OUTRAS tabelas continua o mesmo de antes do deploy:
-- SELECT count(*) FROM pg_policies WHERE schemaname='public'
--  AND tablename IN ('crm_ponto_eventos','crm_rodizio_config','profiles','user_roles');
--
-- 5. O relatório do outro agente continua agrupando por chave (nada de texto
--    livre virando grupo):
-- SELECT motivo, count(*), count(motivo_detalhe) AS com_detalhe
--   FROM public.crm_ponto_eventos WHERE tipo='pausar' GROUP BY 1 ORDER BY 2 DESC;
--
-- =============================================================================
-- ENSAIO 1 — o caminho inteiro da SDR, com o gestor configurando antes.
-- Emula gestor e SDR trocando auth.uid() pelo request.jwt.claims, grava de
-- verdade e DESFAZ tudo no RAISE final (nenhuma linha sobra).
--
-- DO $t$
-- DECLARE
--   v_tenant  uuid := '00000000-0000-0000-0000-000000000010';
--   v_gestor  uuid := (SELECT gestor_user_id FROM public.crm_rodizio_config WHERE tenant_id = v_tenant);
--   v_sdr     uuid := (SELECT pf.id FROM public.profiles pf
--                       WHERE pf.tenant_id = v_tenant AND public.has_role(pf.id,'sdr'::app_role)
--                         AND COALESCE(pf.is_blocked,false) = false LIMIT 1);
--   v_id      uuid;
--   v_r       jsonb;
--   v_n       integer;
-- BEGIN
--   -- ---------- gestor
--   PERFORM set_config('request.jwt.claims', json_build_object('sub', v_gestor)::text, true);
--   RAISE NOTICE 'gestor? %', public.is_gestor_equipe();            -- esperado: t
--   RAISE NOTICE 'lista: %', (SELECT count(*) FROM public.ponto_motivos_listar());  -- 4 (+ órfãos)
--
--   v_r := public.ponto_motivo_criar('Banheiro', 'user', false, NULL);
--   v_id := (v_r->>'id')::uuid;
--   RAISE NOTICE 'criado: %', v_r;                                  -- chave 'banheiro'
--
--   BEGIN  -- chave duplicada
--     PERFORM public.ponto_motivo_criar('banheiro', 'user', false, NULL);
--     RAISE NOTICE 'FALHOU: aceitou chave duplicada';
--   EXCEPTION WHEN others THEN RAISE NOTICE 'duplicada recusada: %', SQLERRM;
--   END;
--
--   BEGIN  -- ícone que a tela não sabe desenhar
--     PERFORM public.ponto_motivo_criar('Teste', 'foguete', false, NULL);
--     RAISE NOTICE 'FALHOU: aceitou ícone inválido';
--   EXCEPTION WHEN others THEN RAISE NOTICE 'ícone recusado: %', SQLERRM;
--   END;
--
--   -- esvaziar a lista (desativa todos, o último tem de ser recusado)
--   FOR v_r IN SELECT to_jsonb(l) FROM public.ponto_motivos_listar() l WHERE l.id IS NOT NULL LOOP
--     BEGIN
--       PERFORM public.ponto_motivo_ativar((v_r->>'id')::uuid, false);
--     EXCEPTION WHEN others THEN RAISE NOTICE 'lista vazia recusada: %', SQLERRM;
--     END;
--   END LOOP;
--   SELECT count(*) INTO v_n FROM public.crm_ponto_motivos WHERE tenant_id = v_tenant AND ativo;
--   RAISE NOTICE 'ativos depois de tentar zerar: %', v_n;            -- esperado: 1
--
--   -- reordenar com a lista completa, e depois com lista pela metade
--   PERFORM public.ponto_motivos_reordenar(ARRAY(SELECT m.id FROM public.crm_ponto_motivos m
--                                                 WHERE m.tenant_id = v_tenant ORDER BY m.rotulo));
--   BEGIN
--     PERFORM public.ponto_motivos_reordenar(ARRAY[v_id]);
--     RAISE NOTICE 'FALHOU: aceitou ordem incompleta';
--   EXCEPTION WHEN others THEN RAISE NOTICE 'ordem incompleta recusada: %', SQLERRM;
--   END;
--
--   -- ---------- SDR
--   PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sdr)::text, true);
--   RAISE NOTICE 'motivos na tela dela: %', (SELECT string_agg(a.rotulo,', ' ORDER BY a.posicao)
--                                              FROM public.ponto_motivos_ativos() a);
--   PERFORM public.ponto_abrir();
--
--   BEGIN  -- motivo que exige texto, sem texto, pela porta NOVA
--     PERFORM public.ponto_pausar('outro', NULL);
--     RAISE NOTICE 'FALHOU: pausou em "outro" sem escrever o motivo';
--   EXCEPTION WHEN others THEN RAISE NOTICE 'texto exigido: %', SQLERRM;
--   END;
--   BEGIN  -- e com texto de enfeite ("...")
--     PERFORM public.ponto_pausar('outro', '...');
--     RAISE NOTICE 'FALHOU: aceitou "..." como motivo';
--   EXCEPTION WHEN others THEN RAISE NOTICE 'texto curto recusado: %', SQLERRM;
--   END;
--
--   v_r := public.ponto_pausar('outro', '  buscar documento no cartório  ');
--   RAISE NOTICE 'pausou: estado=% detalhe=%', v_r->>'estado', v_r->>'motivo_detalhe';
--   RAISE NOTICE 'minha pausa: %', public.ponto_minha_pausa();
--   RAISE NOTICE 'gravado: %', (SELECT jsonb_build_object('motivo', e.motivo, 'detalhe', e.motivo_detalhe)
--                                 FROM public.crm_ponto_eventos e
--                                WHERE e.user_id = v_sdr ORDER BY e.em DESC LIMIT 1);
--   PERFORM public.ponto_retomar();
--
--   -- porta ANTIGA (a tela publicada hoje): um argumento, inclusive em 'outro'
--   v_r := public.ponto_pausar('outro');
--   RAISE NOTICE 'porta antiga pausou: % (detalhe %)', v_r->>'estado', v_r->>'motivo_detalhe';
--   PERFORM public.ponto_retomar();
--
--   -- 'ligacao': é aqui que o CHECK antigo da tabela estourava
--   v_r := public.ponto_pausar('ligacao', NULL);
--   RAISE NOTICE 'ligação pausou: %', v_r->>'estado';
--   PERFORM public.ponto_retomar();
--   PERFORM public.ponto_encerrar();
--
--   BEGIN  -- motivo desativado
--     PERFORM public.ponto_pausar('cafe', NULL);
--   EXCEPTION WHEN others THEN RAISE NOTICE 'desativado recusado: %', SQLERRM;
--   END;
--
--   RAISE EXCEPTION 'ENSAIO DESFEITO';
-- END $t$;
--
-- RESULTADO ESPERADO: "criado" com chave banheiro; duplicada, ícone, lista
-- vazia, ordem incompleta, "outro" sem texto e "..." todos RECUSADOS com
-- mensagem em português; pausa de "outro" gravando motivo='outro' e
-- motivo_detalhe='buscar documento no cartório' (já sem os espaços); porta
-- antiga pausando com detalhe nulo; 'ligacao' aceita; e "ENSAIO DESFEITO" no
-- fim, com zero linha nova em crm_ponto_eventos e crm_ponto_motivos.
--
-- =============================================================================
-- ENSAIO 2 — o relatório do outro agente continua agrupável depois de tudo
-- isso (é o contrato entre as duas migrations).
--
-- DO $t$
-- DECLARE v_gestor uuid := (SELECT gestor_user_id FROM public.crm_rodizio_config
--                            WHERE tenant_id = '00000000-0000-0000-0000-000000000010');
-- BEGIN
--   PERFORM set_config('request.jwt.claims', json_build_object('sub', v_gestor)::text, true);
--   RAISE NOTICE 'pausas por motivo: %',
--     (SELECT jsonb_object_agg(x.motivo, x.n) FROM (
--        SELECT p.motivo, count(*) AS n
--          FROM public.ponto_pausas(current_date - 30, current_date) p GROUP BY 1) x);
--   RAISE EXCEPTION 'ENSAIO DESFEITO';
-- END $t$;
--
-- RESULTADO ESPERADO: um objeto com POUCAS chaves ('cafe', 'outro', 'ligacao'),
-- nunca uma chave por frase digitada — se aparecesse "buscar documento no
-- cartório" como motivo, o texto livre teria vazado para a coluna errada.
-- (Só roda depois que a migration 20260911060000_relatorio_de_ponto.sql, do
-- outro agente, estiver aplicada.)
-- =============================================================================
