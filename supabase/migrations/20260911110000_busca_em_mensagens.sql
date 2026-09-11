-- =============================================================================
-- Busca por CONTEÚDO DE MENSAGEM que realmente devolve todos os leads.
--
-- PEDIDO DO DONO (11/09/2026), palavras dele: "quando pesquiso por alguma
-- mensagem específica, ele só mostra na lista se a última mensagem do lead tem
-- aquele texto. E não puxa o geral. Existem muito mais leads que enviaram
-- alguma mensagem contendo site, mas o CRM não mostra. Isso deve ser aplicado
-- pra qualquer outra palavra que eu quiser pesquisar também, não só para site."
--
-- A CAUSA, medida no banco de produção em 11/09/2026:
--
--   A tela JÁ TENTA buscar dentro do texto das mensagens (src/pages/
--   CrmConversas.tsx, efeito "Server-side search inside message content"). Ela
--   faz .from("messages").ilike("content", "%termo%").limit(500). Só que essa
--   consulta sai do navegador com a RLS ligada, e public.messages tem 255.506
--   linhas do cliente e OITO policies de leitura:
--
--     permissiva : "Authenticated users can view messages"
--                  tenant_id = current_tenant_id()
--                  AND can_access_whatsapp_number(whatsapp_number_id)
--     restritivas: tenant_isolation_restrictive
--                  tenant_hard_isolation_messages
--                  posvenda_escopo_funil_messages
--                  hide_posvenda_messages
--                  closer_number_scope_messages
--                  recepcao_number_scope_messages
--                  sdr_escopo_messages_select
--
--   Quatro delas (is_posvenda_lead, closer_pode_ver_lead,
--   recepcao_pode_ver_lead, sdr_pode_ver_lead) são chamadas de função POR LINHA.
--   O planejador as junta ao filtro do Bitmap Heap Scan, e o ILIKE deixa de ser
--   um recorte barato pelo índice trigram para virar uma varredura com função
--   por linha. Sem RLS a mesma consulta leva 2,2 ms; com a RLS aplicada ela não
--   termina (foi cancelada duas vezes na apuração). A tela recebe o erro, faz
--   `return` em silêncio, e a busca por mensagem simplesmente NÃO ACONTECE:
--   sobram só os leads achados por nome, telefone e ÚLTIMA mensagem — que é
--   exatamente o sintoma que o dono descreve ("só mostra se a última mensagem
--   tem aquele texto").
--
--   Números do termo "site" no tenant Rizodent: 133 mensagens, 115 leads
--   distintos. Pela última mensagem só 5 apareceriam. O dono viu 2.
--
-- A SAÍDA: uma função SECURITY DEFINER. Ela roda o ILIKE SEM a RLS linha a
-- linha (portanto pelo índice messages_content_trgm_idx, que é o ponto), e
-- aplica a visibilidade UMA VEZ, no fim, sobre o conjunto já reduzido a UM
-- registro por lead. É a mesma régua das policies, reproduzida abaixo — e
-- reproduzida CHAMANDO AS MESMAS FUNÇÕES, não reescrevendo o critério à mão,
-- para que qualquer mudança futura nas policies continue valendo aqui.
--
-- A TRADUÇÃO, policy por policy:
--
--   tenant_isolation_restrictive      -> m.tenant_id = v_tenant, sempre.
--   tenant_hard_isolation_messages       (o recorte por cliente é inegociável:
--                                         v_tenant vem de current_tenant_id(),
--                                         nunca de parâmetro)
--
--   "Authenticated users can view      -> v_todos_numeros (gerente/superadmin)
--   messages" (can_access_whatsapp_       ou whatsapp_number_id IS NULL ou
--   number)                               número dentro de v_numeros. Note que
--                                         esse filtro é POR MENSAGEM e por isso
--                                         entra no varrimento, ANTES de escolher
--                                         a mensagem mais recente do lead: um
--                                         lead com mensagens em duas conexões
--                                         tem de ser representado pela mensagem
--                                         da conexão que a pessoa enxerga.
--
--   sdr_escopo_messages_select        -> sdr_pode_ver_lead(lead_id), só quando
--                                        quem chama é SDR.
--   closer_number_scope_messages      -> closer_pode_ver_lead(lead_id), idem.
--   recepcao_number_scope_messages    -> recepcao_pode_ver_lead(lead_id), idem.
--   posvenda_escopo_funil_messages    -> pipeline do lead em can_access_pipeline,
--                                        só quando quem chama é pós-venda.
--   hide_posvenda_messages            -> NOT is_posvenda_lead(lead_id) para quem
--                                        não é pós-venda nem superadmin.
--
--   Gestão (crc, gerente, superadmin) não tem nenhum desses papéis, logo os
--   predicados colapsam em constantes e nenhuma função por linha é chamada —
--   fora o is_posvenda_lead, que vale para todo mundo que não é pós-venda.
--
--   As policies de INSERT/UPDATE/DELETE de public.messages não entram aqui:
--   esta função só lê.
--
-- DESEMPENHO (EXPLAIN ANALYZE em produção, 11/09/2026, tenant Rizodent):
--
--   termo "site"    -> Bitmap Index Scan on messages_content_trgm_idx,
--                      135 linhas no índice, 133 na heap, 115 leads,
--                      Execution Time: 2,45 ms
--   termo "bom dia" -> 9.007 no índice, 8.428 na heap, 4.848 leads, 273 ms
--   termo "com"     -> 19.908 no índice, 19.727 na heap, 6.750 leads, 221 ms
--
--   O "com" é o pior caso realista (trigrama comuníssimo) e ainda assim fica em
--   ~0,2 s. O que segura isso é o CTE ser MATERIALIZED de propósito: sem essa
--   palavra o planejador empurra is_posvenda_lead para dentro do varrimento e a
--   função passa a rodar uma vez por MENSAGEM (8.830 chamadas no "bom dia") em
--   vez de uma vez por LEAD (4.848).
--
--   NÃO há statement_timeout dentro da função, de propósito: o timeout é armado
--   quando a instrução começa, então um SET no corpo não afeta a chamada em
--   curso — seria enfeite. A trava real já existe e é do banco: o papel
--   `authenticated` tem statement_timeout=8s (pg_db_role_setting, conferido em
--   11/09/2026). Se algum termo patológico passar disso, a RPC morre sozinha, a
--   tela cai no caminho antigo e ninguém fica com a aba travada.
--
-- UM REGISTRO POR LEAD, não por mensagem: era o limite de 500 LINHAS DE
-- MENSAGEM do front que podia cortar leads (um lead falador consome 30 linhas
-- do orçamento sozinho). Aqui o DISTINCT ON já entrega o lead uma vez só, com a
-- ocorrência mais recente, e o teto de 500 passa a ser 500 LEADS.
--
-- MENSAGEM APAGADA fica de fora (deleted_at IS NOT NULL). Não é regra de
-- visibilidade, é regra de produto: o chat renderiza essas como "🚫 Mensagem
-- removida", sem o texto. Trazer o lead por um texto que ele não vai conseguir
-- ver na conversa é entregar um resultado sem explicação. No termo "site" isso
-- não muda nada (zero apagadas entre as 133).
--
-- O QUE ESTA MIGRATION NÃO FAZ: não cria, não altera e não remove nenhuma
-- policy, nenhum índice e nenhuma coluna. Só adiciona uma função nova.
-- =============================================================================

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
       AND m.content ILIKE v_padrao ESCAPE '\'
       AND (
             v_todos_numeros
             OR m.whatsapp_number_id IS NULL
             OR m.whatsapp_number_id = ANY (v_numeros)
           )
     ORDER BY m.lead_id, m.created_at DESC
  ),
  visiveis AS (
    -- Passo 2: a régua das policies, uma vez por lead.
    SELECT a.id_lead, a.conteudo, a.momento
      FROM achados a
     WHERE (NOT v_sdr      OR public.sdr_pode_ver_lead(a.id_lead))
       AND (NOT v_closer   OR public.closer_pode_ver_lead(a.id_lead))
       AND (NOT v_recepcao OR public.recepcao_pode_ver_lead(a.id_lead))
       AND (
             NOT v_posvenda
             OR EXISTS (
                  SELECT 1
                    FROM public.crm_leads l
                   WHERE l.id = a.id_lead
                     AND public.can_access_pipeline(l.pipeline_id)
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
             greatest(1, nullif(strpos(lower(z.txt), lower(v_termo)), 0) - 45) AS inicio
        FROM (
          SELECT btrim(regexp_replace(coalesce(t.conteudo, ''), '\s+', ' ', 'g')) AS txt
        ) z
    ) s
   ORDER BY t.momento DESC;
END;
$function$;

COMMENT ON FUNCTION public.buscar_leads_por_mensagem(text, integer) IS
  'Busca um termo dentro do texto de public.messages e devolve UM registro por lead '
  '(a ocorrência mais recente), com um trecho em volta do termo. SECURITY DEFINER '
  'para o ILIKE usar messages_content_trgm_idx sem a RLS linha a linha; a visibilidade '
  'é aplicada uma única vez no fim, reproduzindo as 8 policies de leitura de '
  'public.messages. Recorte por cliente sempre por current_tenant_id().';

REVOKE ALL ON FUNCTION public.buscar_leads_por_mensagem(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.buscar_leads_por_mensagem(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.buscar_leads_por_mensagem(text, integer) TO authenticated, service_role;
