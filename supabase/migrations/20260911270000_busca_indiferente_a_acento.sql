-- =============================================================================
-- A busca em mensagens deixa de se importar com acento.
--
-- O QUE FALTAVA. Depois que a busca começou a funcionar (20260911240000), ficou
-- registrada uma limitação: "orcamento" não achava "orçamento". Medido no tenant
-- Rizodent, o tamanho do buraco:
--     orçamento  447 leads   x  orcamento   8   (1,8%)
--     avaliação 2489 leads   x  avaliacao  14   (0,6%)
--     endereço   490 leads   x  endereco   10   (2,0%)
--     prótese    513 leads   x  protese    48   (9,4%)
-- 35,6% das mensagens do cliente (81.170 de 227.699) têm pelo menos um
-- caractere acentuado. Quem digita sem acento — a maioria, no celular — via
-- menos de 2% do que existe. O dono pediu que a busca valesse "pra qualquer
-- outra palavra que eu quiser pesquisar também"; em português isso inclui
-- palavra com acento.
--
-- ===================== POR QUE REGEX, E NÃO unaccent(content) ================
-- O caminho óbvio seria unaccent() dos dois lados. Ele EXIGE um índice de
-- expressão novo — gin (sem_acento(content) gin_trgm_ops) — sobre 255 mil
-- linhas, e criar esse índice trava public.messages, que é a tabela onde o
-- webhook do WhatsApp grava as mensagens que estão chegando. Tentei criar com
-- CREATE INDEX CONCURRENTLY e a conexão caiu duas vezes no meio, deixando
-- índice inválido (removido nas duas).
--
-- A saída foi melhor e mais barata: o índice trigram QUE JÁ EXISTE
-- (messages_content_trgm_idx) aceita expressão regular. Escrevendo o termo como
-- regex em que cada vogal aceita suas formas acentuadas, o planejador usa o
-- índice do mesmo jeito. Medido em produção ANTES de aplicar isto:
--
--   EXPLAIN ANALYZE ... WHERE content ~* 'or[cç][aá]mento'
--     ->  Bitmap Index Scan on messages_content_trgm_idx
--         Index Cond: (content ~* 'or[cç][aá]mento')
--         rows=552, Execution Time: 8.754 ms
--
-- Zero índice novo, zero trava, 8,7 ms.
--
-- ============================ O QUE CONTINUA DE FORA =========================
-- A transcrição dos áudios. São 7.088 áudios transcritos, de 2.176 leads, cujo
-- texto mora em messages.transcription — coluna que NÃO tem índice trigram.
-- Incluí-la sem índice faria a busca varrer as 255 mil linhas e estourar o
-- limite de 8 s da SDR; criar o índice tem o mesmo problema de trava descrito
-- acima. Fica para uma janela de baixo movimento, com o índice criado primeiro:
--     CREATE INDEX CONCURRENTLY messages_transcription_trgm_idx
--       ON public.messages USING gin (transcription gin_trgm_ops)
--       WHERE transcription IS NOT NULL;
-- (por uma conexão que aguente o tempo da construção — o MCP não aguenta).
-- =============================================================================


-- ============================ o termo vira uma expressão regular tolerante
CREATE OR REPLACE FUNCTION public.termo_regex_acento_indiferente(p_termo text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
DECLARE
  v_base text := public.sem_acento(lower(btrim(p_termo)));
  v_out  text := '';
  ch     text;
  i      integer;
BEGIN
  FOR i IN 1..char_length(v_base) LOOP
    ch := substr(v_base, i, 1);
    v_out := v_out || CASE ch
      WHEN 'a' THEN '[aáàâãä]'
      WHEN 'e' THEN '[eéèêë]'
      WHEN 'i' THEN '[iíìîï]'
      WHEN 'o' THEN '[oóòôõö]'
      WHEN 'u' THEN '[uúùûü]'
      WHEN 'c' THEN '[cç]'
      WHEN 'n' THEN '[nñ]'
      WHEN 'y' THEN '[yýÿ]'
      -- Metacaractere de regex vira literal: quem procura "100%" ou "(11)"
      -- procura o texto, não um padrão. O resto passa como está — escapar
      -- espaço ou acento produziria escape inválido.
      ELSE CASE WHEN ch ~ '[.^$*+?()\[\]{}|\\]' THEN '\' || ch ELSE ch END
    END;
  END LOOP;
  RETURN v_out;
END $fn$;

REVOKE ALL ON FUNCTION public.termo_regex_acento_indiferente(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.termo_regex_acento_indiferente(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.termo_regex_acento_indiferente(text) IS
  'Escreve o termo de busca como expressão regular em que cada vogal (mais c, n e y) aceita as formas acentuadas, para o ILIKE virar ~* e a busca deixar de depender de o usuário digitar o acento. Usa o índice trigram que já existe.';

CREATE OR REPLACE FUNCTION public.buscar_leads_por_mensagem(
  p_termo  text,
  p_limite integer DEFAULT 200
)
RETURNS TABLE(lead_id uuid, trecho text, quando timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid            uuid := auth.uid();
  v_tenant         uuid;
  v_termo          text;
  v_padrao         text;
  v_regex          text;   -- o mesmo termo, indiferente a acento
  v_limite         integer;
  v_sdr            boolean;
  v_closer         boolean;
  v_recepcao       boolean;
  v_posvenda       boolean;
  v_superadmin     boolean;
  v_todos_numeros  boolean;
  v_numeros        uuid[] := '{}'::uuid[];
BEGIN
  -- Sem sessão não há régua de visibilidade para aplicar: devolve vazio.
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  -- Menos de 3 caracteres o índice trigram não ajuda (um trigrama tem 3
  -- letras) e o resultado seria ruído. O front usa o mesmo piso.
  v_termo := btrim(coalesce(p_termo, ''));
  IF char_length(v_termo) < 3 THEN
    RETURN;
  END IF;

  -- O cliente vem SEMPRE da sessão, nunca de parâmetro.
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  v_limite := least(greatest(coalesce(p_limite, 200), 1), 500);

  -- Escapa os curingas do LIKE: quem procura "100%" ou "nome_do_arquivo"
  -- procura o texto literal, não um padrão.
  v_padrao := '%' ||
              replace(replace(replace(v_termo, '\', '\\'), '%', '\%'), '_', '\_') ||
              '%';

  -- O MESMO termo, escrito como expressão regular em que cada vogal (e o c e o
  -- n) aceita as formas acentuadas. Quem digita "orcamento" acha "orçamento" e
  -- vice-versa: são 552 mensagens contra as 8 que o ILIKE achava.
  -- POR QUE REGEX E NÃO unaccent(content): o índice trigram já existente
  -- (messages_content_trgm_idx) ACEITA regex — medido em produção, 552
  -- mensagens em 8,7 ms pelo Bitmap Index Scan. Indexar unaccent(content)
  -- exigiria um índice de expressão novo sobre 255 mil linhas, cuja criação
  -- trava a tabela que recebe o webhook do WhatsApp. Zero índice novo aqui.
  v_regex := public.termo_regex_acento_indiferente(v_termo);

  v_sdr        := public.has_role(v_uid, 'sdr'::app_role);
  v_closer     := public.has_role(v_uid, 'closer'::app_role);
  v_recepcao   := public.has_role(v_uid, 'recepcao'::app_role);
  v_posvenda   := public.has_role(v_uid, 'posvenda'::app_role);
  v_superadmin := public.has_role(v_uid, 'superadmin'::app_role);

  -- can_access_whatsapp_number() libera tudo para gerente e superadmin; para o
  -- resto, só os números do próprio cliente com liberação explícita. Resolvemos
  -- isso UMA vez, em lista, para o varrimento virar um `= ANY(...)` barato em
  -- vez de uma chamada de função por mensagem.
  v_todos_numeros := v_superadmin OR public.has_role(v_uid, 'gerente'::app_role);
  IF NOT v_todos_numeros THEN
    SELECT coalesce(array_agg(w.id), '{}'::uuid[])
      INTO v_numeros
      FROM public.whatsapp_numbers w
     WHERE w.tenant_id = v_tenant
       AND public.can_access_whatsapp_number(w.id);
  END IF;

  RETURN QUERY
  WITH achados AS MATERIALIZED (
    -- Passo 1 (sem RLS, pelo índice trigram): a ocorrência mais recente de cada
    -- lead. MATERIALIZED é obrigatório — ver a nota de desempenho no cabeçalho.
    SELECT DISTINCT ON (m.lead_id)
           m.lead_id    AS id_lead,
           m.content    AS conteudo,
           m.created_at AS momento
      FROM public.messages m
     WHERE m.tenant_id = v_tenant
       AND m.deleted_at IS NULL
       AND m.content ~* v_regex
       AND (
             v_todos_numeros
             OR m.whatsapp_number_id IS NULL
             OR m.whatsapp_number_id = ANY (v_numeros)
           )
       AND m.lead_id IS NOT NULL   -- sem isto, todas as mensagens órfãs viram
                                   -- UMA linha com lead_id nulo que o front
                                   -- descarta, gastando uma das 500 vagas
     ORDER BY m.lead_id, m.created_at DESC
  ),
  visiveis AS (
    -- Passo 2: a régua das policies, uma vez por lead.
    SELECT a.id_lead, a.conteudo, a.momento
      FROM achados a
     -- SDR: o JOIN direto no lugar da função por lead.
     -- sdr_pode_ver_lead é SECURITY DEFINER e faz um EXISTS por chamada; medida
     -- em produção com o papel da SDR, a busca ia a 3,7 s com o termo "com" e o
     -- statement_timeout de authenticated é 8 s — margem de 2,4x num cliente que
     -- tem 255 mil mensagens, e quem estoura cai no fallback do front, que roda
     -- a consulta velha e gasta outros 8 s. A pessoa esperaria uns 16 segundos e
     -- veria de novo o bug que o dono relatou.
     -- A régua é a MESMA da função (leia sdr_pode_ver_lead): lead dela, ou lead
     -- sem dona no funil do Instagram, sempre do próprio cliente. Escrita como
     -- JOIN, o planejador usa o índice de crm_leads em vez de chamar função
     -- 7.387 vezes.
     WHERE (NOT v_sdr
            OR EXISTS (
                 SELECT 1
                   FROM public.crm_leads l
                   LEFT JOIN public.crm_pipelines p ON p.id = l.pipeline_id
                  WHERE l.id = a.id_lead
                    AND l.tenant_id = v_tenant
                    AND (l.assigned_to = v_uid
                         OR (l.assigned_to IS NULL AND COALESCE(p.is_instagram, false)))
               ))
       AND (NOT v_closer   OR public.closer_pode_ver_lead(a.id_lead))
       AND (NOT v_recepcao OR public.recepcao_pode_ver_lead(a.id_lead))
       AND (
             NOT v_posvenda
             OR EXISTS (
                  SELECT 1
                    FROM public.crm_leads l
                   WHERE l.id = a.id_lead
                     AND public.can_access_pipeline(l.pipeline_id)
                     -- A policy da pós-venda diz só can_access_pipeline, MAS ela
                     -- é avaliada dentro da RLS, onde o SELECT em crm_leads passa
                     -- pela policy da própria tabela — que exige também o número
                     -- de WhatsApp e a conta de Instagram. Aqui a função é
                     -- DEFINER e o EXISTS roda SEM RLS, então os dois testes
                     -- precisam ser escritos à mão, senão a busca fica mais
                     -- permissiva que a tela. Hoje empata (quase todo lead tem os
                     -- dois campos nulos), e é por isso mesmo que passa
                     -- despercebido até o dia da segunda conexão.
                     AND public.can_access_whatsapp_number(l.whatsapp_number_id)
                     AND public.can_access_instagram_account(l.ig_account_uuid)
                )
           )
       AND (
             v_posvenda
             OR v_superadmin
             OR NOT public.is_posvenda_lead(a.id_lead)
           )
  ),
  topo AS (
    -- Passo 3: corta no teto ANTES de montar o trecho, para o regexp rodar em
    -- no máximo 500 linhas.
    SELECT v.id_lead, v.conteudo, v.momento
      FROM visiveis v
     ORDER BY v.momento DESC
     LIMIT v_limite
  )
  SELECT t.id_lead,
         (CASE WHEN s.inicio > 1 THEN '…' ELSE '' END)
         || substr(s.texto, s.inicio, 160)
         || (CASE WHEN char_length(s.texto) > s.inicio + 159 THEN '…' ELSE '' END),
         t.momento
    FROM topo t
    CROSS JOIN LATERAL (
      -- Uma linha só, sem quebras, e a janela começa ~45 caracteres antes do
      -- termo. Quando o termo não é localizável no texto normalizado (acento,
      -- curinga escapado), greatest(1, NULL) devolve 1 e o trecho começa do
      -- início — nunca erra, no pior caso mostra o começo da mensagem.
      SELECT z.txt AS texto,
             greatest(1, nullif(strpos(public.sem_acento(lower(z.txt)),
                                       public.sem_acento(lower(v_termo))), 0) - 45) AS inicio
        FROM (
          SELECT btrim(regexp_replace(coalesce(t.conteudo, ''), '\s+', ' ', 'g')) AS txt
        ) z
    ) s
   ORDER BY t.momento DESC;
END;
$function$;

COMMENT ON FUNCTION public.buscar_leads_por_mensagem(text, integer) IS
  'Busca um termo dentro do texto de public.messages, indiferente a acento, e devolve UM '
  'registro por lead (a ocorrência mais recente) com um trecho em volta do termo. '
  'SECURITY DEFINER para o índice trigram ser usado sem a RLS linha a linha; a '
  'visibilidade é aplicada uma única vez no fim, reproduzindo as 8 policies de leitura '
  'de public.messages. Recorte por cliente sempre por current_tenant_id().';

REVOKE ALL ON FUNCTION public.buscar_leads_por_mensagem(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buscar_leads_por_mensagem(text, integer) TO authenticated, service_role;

-- =============================================================================
-- VERIFICAÇÃO (só leitura, depois de aplicar)
--
-- 1) O regex sai bem formado?
-- SELECT public.termo_regex_acento_indiferente('orcamento') AS a,
--        public.termo_regex_acento_indiferente('100%')      AS b,
--        public.termo_regex_acento_indiferente('R$ 1')      AS c;
--
-- 2) Os dois sentidos devolvem o mesmo conjunto?
-- SELECT (SELECT count(*) FROM public.buscar_leads_por_mensagem('orcamento', 500)) AS sem_acento,
--        (SELECT count(*) FROM public.buscar_leads_por_mensagem('orçamento', 500)) AS com_acento,
--        (SELECT count(*) FROM public.buscar_leads_por_mensagem('ORCAMENTO', 500)) AS maiuscula;
--
-- 3) O índice continua sendo usado (não pode aparecer Seq Scan):
-- EXPLAIN ANALYZE SELECT count(*) FROM public.messages m
--  WHERE m.tenant_id='00000000-0000-0000-0000-000000000010'
--    AND m.content ~* public.termo_regex_acento_indiferente('orcamento');
--
-- 4) E continua rápido para a SDR, que tem 8 s de teto:
-- DO $t$
-- DECLARE t0 timestamptz; n integer; rep text := E'\n'; termo text;
-- BEGIN
--   PERFORM set_config('request.jwt.claims',
--     json_build_object('sub','9c32408d-d852-4c55-9637-b30a59a16c13','role','authenticated')::text, true);
--   EXECUTE 'SET LOCAL ROLE authenticated';
--   FOREACH termo IN ARRAY ARRAY['site','com','orcamento','orçamento','avaliacao'] LOOP
--     t0 := clock_timestamp();
--     SELECT count(*) INTO n FROM public.buscar_leads_por_mensagem(termo, 500);
--     rep := rep || termo || ': ' || n || ' leads em '
--         || round(extract(epoch from (clock_timestamp()-t0))*1000) || ' ms' || E'\n';
--   END LOOP;
--   EXECUTE 'RESET ROLE';
--   RAISE EXCEPTION '%', rep;
-- END $t$;
-- =============================================================================
