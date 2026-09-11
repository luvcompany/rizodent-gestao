-- =============================================================================
-- A busca em mensagens passa a ignorar acento e a enxergar o áudio transcrito.
--
-- O QUE FALTAVA. Depois que a busca começou a funcionar (20260911240000), duas
-- limitações ficaram registradas e não resolvidas:
--   * acento — "orcamento" não achava "orçamento". Medido no tenant Rizodent:
--     543 mensagens com a grafia acentuada contra 8 sem. Quem digita sem acento
--     (a maioria, no celular) via 8 de 551.
--   * áudio — 6.676 mensagens já transcritas ficavam fora da busca, porque o
--     texto delas mora em messages.transcription e a consulta só olhava content.
-- O dono tinha pedido que a busca valesse "pra qualquer outra palavra que eu
-- quiser pesquisar também" — em português, isso inclui palavra com acento.
--
-- COMO. public.sem_acento() (criada na 20260911260000) dos DOIS lados: no texto
-- e no termo. Assim é indiferente quem digitou o quê. Como cada caractere
-- acentuado vira exatamente um sem acento, as posições não mudam e o trecho
-- continua caindo em volta do termo.
--
-- ============================ A ORDEM IMPORTA ================================
-- Esta migration EXIGE que os dois índices de expressão já existam:
--     messages_content_sem_acento_trgm_idx
--     messages_transcription_sem_acento_trgm_idx
-- Eles são criados com CREATE INDEX CONCURRENTLY, que não roda dentro de
-- transação e por isso NÃO pode morar numa migration. Sem eles, o ILIKE sobre
-- sem_acento(content) não tem índice, varre as 255 mil linhas e estoura o
-- statement_timeout de 8 s do papel authenticated — ou seja, a busca voltaria a
-- ficar quebrada para a SDR, que é exatamente o defeito que acabou de ser
-- consertado. O bloco abaixo recusa a migration se eles não estiverem lá.
-- =============================================================================

DO $guarda$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public'
                    AND indexname = 'messages_content_sem_acento_trgm_idx') THEN
    RAISE EXCEPTION 'Falta o índice messages_content_sem_acento_trgm_idx. Crie os dois índices com CREATE INDEX CONCURRENTLY ANTES de aplicar esta migration (ver o cabeçalho).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public'
                    AND indexname = 'messages_transcription_sem_acento_trgm_idx') THEN
    RAISE EXCEPTION 'Falta o índice messages_transcription_sem_acento_trgm_idx. Crie os dois índices com CREATE INDEX CONCURRENTLY ANTES de aplicar esta migration (ver o cabeçalho).';
  END IF;
END $guarda$;

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
  v_padrao_sa      text;   -- o mesmo padrão, sem acento (ver migration 20260911260000)
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

  -- O MESMO padrão sem acento. Quem digita "orcamento" quer achar "orçamento"
  -- (543 mensagens contra 8) e quem digita "orçamento" quer achar as duas
  -- grafias. Como os dois lados passam por sem_acento(), a busca vira
  -- indiferente ao acento nos dois sentidos.
  v_padrao_sa := public.sem_acento(v_padrao);

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
           -- O trecho vem de ONDE casou. Se foi no áudio transcrito, o
           -- resultado diz isso: senão a SDR lê um trecho que não acha na
           -- conversa escrita e acha que a busca inventou.
           CASE WHEN public.sem_acento(coalesce(m.content, '')) ILIKE v_padrao_sa ESCAPE '\'
                THEN m.content
                ELSE '🎤 ' || coalesce(m.transcription, '')
           END          AS conteudo,
           m.created_at AS momento
      FROM public.messages m
     WHERE m.tenant_id = v_tenant
       AND m.deleted_at IS NULL
       AND (
             public.sem_acento(coalesce(m.content, '')) ILIKE v_padrao_sa ESCAPE '\'
             -- O texto dos áudios já transcritos entra na busca: são 6.676
             -- mensagens que até aqui ficavam invisíveis para quem procura.
             OR public.sem_acento(coalesce(m.transcription, '')) ILIKE v_padrao_sa ESCAPE '\'
           )
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
  'Busca um termo no texto de public.messages E na transcrição dos áudios, sem se '
  'importar com acento, e devolve UM registro por lead (a ocorrência mais recente) '
  'com um trecho em volta do termo. SECURITY DEFINER para usar os índices trigram '
  'sem a RLS linha a linha; a visibilidade é aplicada uma única vez no fim, '
  'reproduzindo as 8 policies de leitura de public.messages.';

REVOKE ALL ON FUNCTION public.buscar_leads_por_mensagem(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buscar_leads_por_mensagem(text, integer) TO authenticated, service_role;

-- =============================================================================
-- VERIFICAÇÃO (só leitura, depois de aplicar)
--
-- 1) Achou o que não achava? (esperado: muito mais que 8)
-- SELECT count(*) FROM public.buscar_leads_por_mensagem('orcamento', 500);
--
-- 2) Nos dois sentidos, o mesmo número:
-- SELECT (SELECT count(*) FROM public.buscar_leads_por_mensagem('orcamento', 500)) AS sem_acento,
--        (SELECT count(*) FROM public.buscar_leads_por_mensagem('orçamento', 500)) AS com_acento;
--
-- 3) E continua rápido para a SDR? (tem de ficar MUITO abaixo de 8 s)
-- DO $t$
-- DECLARE t0 timestamptz; n integer; rep text := E'\n';
-- BEGIN
--   PERFORM set_config('request.jwt.claims',
--     json_build_object('sub','9c32408d-d852-4c55-9637-b30a59a16c13','role','authenticated')::text, true);
--   EXECUTE 'SET LOCAL ROLE authenticated';
--   FOREACH rep IN ARRAY ARRAY['site','com','orcamento','orçamento'] LOOP END LOOP;
--   t0 := clock_timestamp();
--   SELECT count(*) INTO n FROM public.buscar_leads_por_mensagem('orcamento', 500);
--   rep := rep || 'orcamento: ' || n || ' em ' ||
--          round(extract(epoch from (clock_timestamp()-t0))*1000) || ' ms';
--   EXECUTE 'RESET ROLE';
--   RAISE EXCEPTION '%', rep;
-- END $t$;
-- =============================================================================
