-- =============================================================================
-- Fechar o EXECUTE das funções SECURITY DEFINER que não têm guarda nenhuma
-- dentro e, por isso, não deveriam atender pela API (auditoria de 09/09/2026).
-- A revogação do item 1 é DEFENSIVA: fecha por precaução, sem depender de qual
-- é o estado dos privilégios no banco hoje.
--
-- O DEFEITO, QUE É UM PADRÃO E NÃO UM CASO ISOLADO:
-- função SECURITY DEFINER roda com os poderes do dono do banco — ignora RLS e
-- vê todos os clientes. Quando essa mesma função também tem GRANT EXECUTE para
-- o papel "authenticated" e NÃO confere nada no começo do corpo (auth.uid(),
-- papel, tenant), ela deixa de ser "função interna" e passa a ser um endpoint
-- aberto a quem tem qualquer login: a pessoa manda
-- POST /rest/v1/rpc/<nome> e o PostgREST executa. Não precisa de tela, nem de
-- rota liberada no app, nem de permissão nenhuma no produto — a porta é a API.
--
-- É A TERCEIRA VEZ que esse mesmo padrão é varrido neste projeto:
--   1ª  20260801160000_fecha_funcoes_para_anon.sql — 74 funções DEFINER
--       executáveis por anon (a chave que vai no bundle do site);
--   2ª  20260908150000_sdr_fase1_papel_e_equipe.sql — as portas abertas a
--       authenticated (admin_api_unread_leads_base, match_good_examples,
--       crm_usage_metrics…), achadas quando o papel sdr entrou;
--   3ª  esta.
-- Ele volta porque a varredura conserta o estado, não a causa: no Postgres,
-- função nova nasce com EXECUTE para PUBLIC (e PUBLIC inclui anon e
-- authenticated), e um DROP + CREATE posterior devolve esse default a uma função
-- que já havia sido fechada. Regra desta casa, daqui para frente: função DEFINER
-- nasce com REVOKE de PUBLIC/anon/authenticated e GRANT só para service_role; se
-- ela precisa mesmo ser chamada por gente logada, carrega a guarda de
-- papel/tenant no PRIMEIRO comando do corpo — não na tela, que não é fronteira.
--
-- POR QUE ESTE ARQUIVO REVOGA "DE NOVO", E POR QUE ISSO NÃO QUEBRA NADA:
-- os REVOKE do item 1 são DEFENSIVOS e idempotentes — não afirmam que a função
-- está aberta hoje, garantem que ela não fique aberta amanhã. No Postgres,
-- DROP + CREATE devolve o EXECUTE default do PUBLIC (e PUBLIC inclui anon e
-- authenticated), então a revogação precisa se repetir a cada mudança de
-- assinatura; repetir um REVOKE já aplicado é inofensivo.
-- Conferido pela auditoria de 09/09/2026: nenhuma dessas funções aparece em
-- policy e todos os chamadores internos são SECURITY DEFINER. Ou seja:
--   • nenhuma destas funções é usada dentro de policy de RLS (se fosse, revogar
--     de authenticated derrubaria o SELECT de quem depende da policy);
--   • todo chamador interno é ele mesmo SECURITY DEFINER — e dentro de uma
--     função DEFINER o EXECUTE da função interna é conferido contra o DONO dela,
--     não contra quem chamou. Por isso os gatilhos continuam funcionando:
--     carimba_dono_do_modelo → dono_restrito_do_numero,
--     trg_notify_dashboard_* / notify_dashboard_message → notify_dashboard_event;
--   • os chamadores de fora do banco usam SERVICE_ROLE_KEY (edge functions
--     instagram-webhook e instagram-lite-webhook → ensure_instagram_pipeline;
--     daily-backup → backup_list_tables) ou são crons do pg_cron, que rodam como
--     postgres. service_role continua com EXECUTE em todas.
--
-- >>> AÇÃO DO DONO, FORA DO BANCO: ROTACIONAR A CHAVE DO RIZODENT VISION <<<
-- O corpo de notify_dashboard_event trazia a chave do header x-ingest-secret
-- ESCRITA EM TEXTO PURO. Definição de função é leitura livre (pg_proc /
-- pg_get_functiondef): qualquer login — e no caso de quem tem acesso a dump,
-- ninguém sequer precisa de login — lê a chave. Ela está no repositório, no
-- dump e em TODOS os backups já feitos. O item 3 desta migration para de usar o
-- literal e passa a ler a chave de public._internal_secrets, mas isso NÃO
-- desfaz o vazamento: a chave antiga precisa ser TROCADA no Rizodent Vision e a
-- nova cadastrada em _internal_secrets (instruções no item 3). Enquanto a nova
-- não estiver cadastrada, a função não envia evento nenhum e registra a falha
-- em public.access_logs (evento 'vision_ingest_sem_segredo', no máximo uma
-- linha a cada 6 horas) além do RAISE WARNING — de propósito: é melhor o painel
-- ficar sem atualizar do que seguir autenticando com uma chave que está
-- publicada em backup.
-- =============================================================================


-- =============================================================================
-- 1) FECHAR O EXECUTE: REVOKE de PUBLIC/anon/authenticated, service_role fica.
--    Cada bloco é envolvido em IF to_regprocedure(...) IS NOT NULL para a
--    migration não quebrar se a função não existir neste ambiente. Repetir o
--    REVOKE é inofensivo — e é necessário mesmo onde alguma migration antiga já
--    revogou, porque um DROP + CREATE posterior devolve o EXECUTE ao PUBLIC
--    (o default do Postgres) — é assim que uma função já fechada volta a ficar
--    aberta, e é por isso que a revogação é repetida aqui por precaução.
-- =============================================================================

-- watchdog_reenqueue_missing_bots(): rede de segurança do motor de automação —
-- enfileira em crm_automation_queue o bot que deveria ter disparado, de TODAS as
-- clínicas. É trabalho de cron. Fechada aqui por precaução: com EXECUTE para
-- authenticated, qualquer login dispara bots (mensagem de verdade no WhatsApp)
-- para leads de qualquer cliente. DROP + CREATE devolve o EXECUTE default do
-- PUBLIC, então a revogação se repete a cada mudança de assinatura.
DO $do$
BEGIN
  IF to_regprocedure('public.watchdog_reenqueue_missing_bots()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.watchdog_reenqueue_missing_bots() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.watchdog_reenqueue_missing_bots() TO service_role;
  END IF;
END $do$;

-- recover_stuck_bot_executions(): manutenção do motor — marca como erro e limpa
-- execuções de bot travadas (de todas as clínicas) e devolve as contagens.
-- Fechada aqui por precaução: chamada por gente logada = matar a conversa de bot
-- em andamento de outro cliente. DROP + CREATE devolve o EXECUTE default do
-- PUBLIC, então a revogação se repete a cada mudança de assinatura.
DO $do$
BEGIN
  IF to_regprocedure('public.recover_stuck_bot_executions()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.recover_stuck_bot_executions() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.recover_stuck_bot_executions() TO service_role;
  END IF;
END $do$;

-- ensure_instagram_pipeline(_tenant_id): acha ou CRIA o funil "Instagram" (com
-- as etapas) do tenant que vem POR PARÂMETRO. Quem chama são os webhooks do
-- Instagram, com service role. Fechada aqui por precaução: aberta a
-- authenticated, ela é um jeito de criar funil e etapas dentro da clínica de
-- outra pessoa só sabendo o uuid dela. DROP + CREATE devolve o EXECUTE default
-- do PUBLIC, então a revogação se repete a cada mudança de assinatura.
DO $do$
BEGIN
  IF to_regprocedure('public.ensure_instagram_pipeline(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.ensure_instagram_pipeline(uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.ensure_instagram_pipeline(uuid) TO service_role;
  END IF;
END $do$;

-- recalculate_all_lead_scores() — a versão SEM ARGUMENTO: recalcula o score de
-- TODOS os leads de TODAS as clínicas de uma vez. É varredura de manutenção, não
-- tem dono nem recorte; com EXECUTE para authenticated, qualquer login dispara
-- em rajada e derruba o banco para todo mundo. Fechada aqui por precaução —
-- DROP + CREATE devolve o EXECUTE default do PUBLIC, então a revogação se repete
-- a cada mudança de assinatura.
-- ATENÇÃO: a irmã COM argumento, recalculate_all_lead_scores(integer), trabalha
-- em lotes, TEM guarda interna e É usada — NÃO é tocada aqui de propósito.
DO $do$
BEGIN
  IF to_regprocedure('public.recalculate_all_lead_scores()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.recalculate_all_lead_scores() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.recalculate_all_lead_scores() TO service_role;
  END IF;
END $do$;

-- backup_list_tables(): lista as tabelas do schema public com a coluna de
-- ordenação de cada uma. É insumo do daily-backup (service role). Para quem está
-- logado é o mapa do banco inteiro do produto — inclusive tabelas que a pessoa
-- não deveria nem saber que existem. Fechada aqui por precaução; DROP + CREATE
-- devolve o EXECUTE default do PUBLIC, então a revogação se repete a cada
-- mudança de assinatura.
DO $do$
BEGIN
  IF to_regprocedure('public.backup_list_tables()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.backup_list_tables() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.backup_list_tables() TO service_role;
  END IF;
END $do$;

-- notify_dashboard_event(text,text,text): avisa o painel Rizodent Vision de
-- lead/agendamento/conversa. Só os gatilhos a chamam. Aberta a authenticated,
-- qualquer login injeta evento falso no painel que o dono usa para decidir —
-- por isso é fechada por precaução (e DROP + CREATE, como o do item 3, devolve
-- o EXECUTE default do PUBLIC: a revogação se repete a cada recriação).
-- O REVOKE dela está no ITEM 3, logo DEPOIS do CREATE OR REPLACE que tira a
-- chave do corpo — assim a ordem fica explícita e não depende de o
-- CREATE OR REPLACE preservar privilégios.

-- pacientes_whatsapp_direto(uuid[]): de uma lista de pacientes, diz quais NÃO
-- contam como marketing (usada no relatório de faturamento). Recebe os ids por
-- parâmetro e não confere tenant nenhum: aberta a quem tem login, dá para sondar
-- paciente de outra clínica, id a id, e saber se ele é paciente de lá. Fechada
-- aqui por precaução; DROP + CREATE devolve o EXECUTE default do PUBLIC, então a
-- revogação se repete a cada mudança de assinatura.
DO $do$
BEGIN
  IF to_regprocedure('public.pacientes_whatsapp_direto(uuid[])') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.pacientes_whatsapp_direto(uuid[]) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.pacientes_whatsapp_direto(uuid[]) TO service_role;
  END IF;
END $do$;

-- dono_restrito_do_numero(uuid): devolve o papel (closer ou recepção) que é dono
-- exclusivo de um número de WhatsApp. Serve ao gatilho carimba_dono_do_modelo,
-- que é DEFINER e continua chamando. Ela nasceu em 26/08, DEPOIS da varredura de
-- 01/08 — ou seja, nenhuma migration anterior tirou dela o EXECUTE default do
-- PUBLIC, e PUBLIC inclui ANON: sem login nenhum, quem tivesse o uuid de um
-- número descobriria de que papel ele é, em qualquer clínica. Fechada aqui por
-- precaução, inclusive para anon; DROP + CREATE devolve esse default, então a
-- revogação se repete a cada mudança de assinatura. Função interna de gatilho
-- não tem por que atender pela API.
DO $do$
BEGIN
  IF to_regprocedure('public.dono_restrito_do_numero(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.dono_restrito_do_numero(uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.dono_restrito_do_numero(uuid) TO service_role;
  END IF;
END $do$;


-- =============================================================================
-- 2) generate_tenant_invoices(): NÃO se revoga — o painel do superadmin a chama
--    (src/pages/admin/AdminPanel.tsx, botão "gerar faturas do mês"). O problema
--    era outro: sendo DEFINER e sem guarda, QUALQUER login gerava as faturas de
--    TODAS as clínicas da plataforma (linhas em tenant_invoices, dinheiro à
--    vista para o dono do produto) antes do dia 1.
--    Corpo copiado do vigente (20260715040000_admin_wave23_backend.sql); a única
--    mudança é a guarda no começo. auth.uid() NULO = cron do pg_cron / service
--    role: continua passando, porque é assim que a fatura nasce todo dia 1.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.generate_tenant_invoices()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _ref_month date := date_trunc('month', now())::date;
  _inserted  int;
BEGIN
  -- Gente logada: só o administrador da plataforma. Servidor (auth.uid() nulo):
  -- passa, é o cron mensal.
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'superadmin'::app_role) THEN
    RAISE EXCEPTION 'Só o administrador da plataforma gera faturas.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.tenant_invoices (tenant_id, reference_month, amount, status)
  SELECT
    ts.tenant_id,
    _ref_month,
    COALESCE(p.monthly_price, ts.amount, 0),
    'open'
  FROM public.tenant_subscriptions ts
  JOIN public.tenants t ON t.id = ts.tenant_id
  LEFT JOIN public.plans p ON p.id = ts.plan_id
  WHERE ts.status = 'active'
    AND t.deleted_at IS NULL
  ON CONFLICT (tenant_id, reference_month) DO NOTHING;

  GET DIAGNOSTICS _inserted = ROW_COUNT;
  RETURN _inserted;
END;
$fn$;
-- authenticated continua com EXECUTE de propósito (o painel do superadmin usa),
-- agora com a guarda dentro. service_role explícito: a versão anterior só
-- revogava de PUBLIC/anon e dependia do grant embutido do PUBLIC.
REVOKE ALL ON FUNCTION public.generate_tenant_invoices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_tenant_invoices() TO authenticated, service_role;


-- =============================================================================
-- 3) notify_dashboard_event(text,text,text): tirar a chave do corpo.
--    Antes, o header x-ingest-secret era um literal dentro da função — ou seja,
--    a chave do Rizodent Vision estava legível para qualquer um que lesse a
--    definição (pg_get_functiondef é leitura livre) e está em todos os backups.
--    Agora a chave vem de public._internal_secrets (mesmo cofre já usado pelos
--    tokens de cron: colunas name/value, RLS ligada e sem policy — só o dono do
--    banco, via função DEFINER, e o service_role leem).
--    Sem segredo cadastrado a função NÃO envia nada: ela é chamada por gatilho de
--    INSERT de lead/agendamento/mensagem e não pode, em nenhuma hipótese,
--    quebrar a gravação do dado do cliente. Nesse caso ela grava a falha em
--    public.access_logs (context 'admin', event 'vision_ingest_sem_segredo', no
--    máximo uma linha a cada 6 horas) além do RAISE WARNING — porque WARNING de
--    gatilho fica só no log do Postgres e ninguém lê.
--
--    >>> O DONO PRECISA FAZER ISTO, NESTA ORDEM <<<
--    (a) gerar uma chave NOVA no Rizodent Vision e invalidar a antiga lá
--        (a antiga vazou: está no repositório e nos backups);
--    (b) cadastrar a nova no cofre, rodando no SQL Editor do Supabase — NUNCA
--        num arquivo do repositório, nunca no chat:
--          INSERT INTO public._internal_secrets (name, value)
--          VALUES ('vision_ingest_secret', '<COLE AQUI A CHAVE NOVA>')
--          ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;
--    (c) conferir com o bloco de VERIFICAÇÃO do fim deste arquivo (ele mostra só
--        o tamanho do valor, nunca o valor).
--    Entre publicar esta migration e o passo (b) o painel Vision para de receber
--    evento novo (e nasce um 'vision_ingest_sem_segredo' em access_logs a cada 6
--    horas). É a troca consciente: painel atrasado em vez de chave vazada em uso.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.notify_dashboard_event(
  p_tipo text,
  p_cidade text,
  p_source text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE
  v_secret text;
BEGIN
  -- Leitura do cofre também protegida: se a tabela/linha faltar, o gatilho que
  -- chamou não pode cair por causa disso.
  BEGIN
    SELECT s.value INTO v_secret
      FROM public._internal_secrets s
     WHERE s.name = 'vision_ingest_secret';
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;

  IF NULLIF(btrim(COALESCE(v_secret, '')), '') IS NULL THEN
    RAISE WARNING 'notify_dashboard_event: segredo vision_ingest_secret ausente em public._internal_secrets — evento "%" NÃO enviado ao Rizodent Vision (cadastre a chave nova; a antiga vazou no corpo da função).', p_tipo;
    -- O DEFEITO QUE ISTO CORRIGE: sem o segredo cadastrado a função só fazia
    -- RAISE WARNING, e WARNING de gatilho vive no log do Postgres, que ninguém
    -- abre. Resultado: o painel Vision podia passar dias sem receber evento
    -- nenhum e a falha era INVISÍVEL — o próprio passo (b) do item 3 esquecido
    -- não aparecia em lugar algum do produto. Agora a falha fica em lugar
    -- durável (public.access_logs), que o dono já consulta.
    -- Só uma linha a cada 6 horas: este gatilho roda em CADA lead, agendamento e
    -- mensagem — sem o limite, o registro da falha viraria um carimbo por INSERT
    -- e inchava a tabela justamente enquanto o segredo estivesse faltando.
    BEGIN
      INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
      SELECT NULL::uuid, NULL::uuid, 'admin', 'vision_ingest_sem_segredo',
             jsonb_build_object(
               'tipo', p_tipo,
               'motivo', 'segredo vision_ingest_secret ausente em public._internal_secrets',
               'efeito', 'evento não enviado ao Rizodent Vision'
             )
       WHERE NOT EXISTS (
         SELECT 1
           FROM public.access_logs al
          WHERE al.event = 'vision_ingest_sem_segredo'
            AND al.created_at > now() - interval '6 hours'
       );
    EXCEPTION WHEN OTHERS THEN
      -- Nem o registro da falha pode derrubar o INSERT do cliente: se access_logs
      -- estiver indisponível, sobra o WARNING acima e a gravação do lead segue.
      NULL;
    END;
    RETURN;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := 'https://rizodent-vision.lovable.app/api/public/ingest-crm-event',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ingest-secret', v_secret
      ),
      body := jsonb_build_object(
        'tipo', p_tipo,
        'cidade', p_cidade,
        'source', p_source,
        'ts', now()
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$fn$;
-- Fecha DEPOIS de recriar (item 1 explica o porquê de estar aqui e não lá).
REVOKE ALL ON FUNCTION public.notify_dashboard_event(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_dashboard_event(text, text, text) TO service_role;


-- =============================================================================
-- 4) equipe_encerrar_sessoes / equipe_redistribuir_leads: a chamada de servidor
--    não dizia de qual clínica é o alvo.
--    O DEFEITO: as duas só conferem gestor+tenant quando auth.uid() NÃO é nulo.
--    Com service role (auth.uid() nulo) elas aceitavam qualquer p_user_id que
--    fosse SDR de QUALQUER clínica — derrubar sessão e redistribuir os leads de
--    uma SDR de outro cliente dependia só de saber o uuid dela. Quem chama pelo
--    servidor é a edge function admin-manage-user, que sabe o tenant do alvo
--    (targetTenant, lido do profile) e simplesmente não o passava.
--    A REGRA NOVA: parâmetro OPCIONAL p_tenant no fim. auth.uid() nulo sem
--    p_tenant = recusa; p_tenant diferente do tenant do alvo = recusa. Para
--    humano logado nada muda (a checagem de gestor + current_tenant_id continua
--    valendo e p_tenant é ignorado).
--    Corpos copiados de 20260909220000_equipe_editar_excluir.sql; a única
--    mudança é o ramo ELSE do auth.uid() IS NOT NULL.
--
-- ############################################################################
-- ATENÇÃO: PUBLICAÇÃO COORDENADA — A MIGRATION E A EDGE FUNCTION ANDAM JUNTAS.
-- ARQUIVO: supabase/functions/admin-manage-user/index.ts
-- ESSA FUNCTION RODA COM SERVICE ROLE (auth.uid() NULO), OU SEJA, CAI NO RAMO
-- NOVO. AS DUAS CHAMADAS PRECISAM FICAR EXATAMENTE ASSIM (targetTenant é a
-- variável QUE A PRÓPRIA FUNCTION JÁ CALCULA: o tenant do profile do alvo, o
-- mesmo que ela já usa nos access_logs — NUNCA o tenant_id que veio no corpo da
-- requisição):
--   await admin.rpc("equipe_encerrar_sessoes", { p_user_id: user_id, p_tenant: targetTenant });
--   await admin.rpc("equipe_redistribuir_leads", { p_user_id: user_id, p_destino: dest, p_motivo: ..., p_tenant: targetTenant });
--
-- O QUE ACONTECE DE FATO NA JANELA DE PUBLICAÇÃO — migration aplicada e a
-- function AINDA NA VERSÃO PUBLICADA ANTIGA, sem p_tenant (o arquivo do
-- repositório já passa p_tenant nas duas ações; quem o editou foi outro agente
-- desta rodada, e é o DEPLOY que falta) — E É AQUI QUE ESTE COMENTÁRIO MENTIA,
-- dizendo que "as duas ações param com erro visível". As duas ações NÃO se
-- comportam igual:
--   • EXCLUIR A SDR (action "delete"): a function CONFERE o erro da RPC
--     equipe_redistribuir_leads e devolve 400 sem apagar nada. Falha ruidosa,
--     visível na tela, sem estrago — é o caso bom.
--   • TROCAR O E-MAIL DA SDR (action "set_email"): a function ENGOLE o erro. No
--     bloco de set_email de supabase/functions/admin-manage-user/index.ts a
--     chamada é `const { data: n, error: sErr } = await admin.rpc(...)` seguida
--     de `if (!sErr && typeof n === "number") sessoes = n;` — o sErr não é
--     testado em nenhum outro lugar e a resposta continua ok:true (com
--     sessoes_encerradas: null). Ou seja: nessa janela o e-mail do login É
--     TROCADO no Auth e as SESSÕES DA PESSOA ANTERIOR NÃO SÃO ENCERRADAS, SEM
--     NENHUM SINAL NA TELA. Trocar de SDR sem derrubar a sessão da anterior é
--     exatamente o que essa ação existe para evitar: a pessoa que saiu continua
--     lendo e atendendo os leads pelo token que já tem.
--     OUTRO AGENTE ESTÁ, NESTA MESMA RODADA, TORNANDO ESSA FALHA FATAL (RESPOSTA
--     409) NA EDGE FUNCTION, para que o silêncio deixe de ser possível. Eu não
--     editei a edge function.
--
-- SE A FUNCTION FOR DEPLOYADA ANTES DESTA MIGRATION, O ERRO É O OPOSTO E TAMBÉM
-- QUEBRA ("function ... does not exist", porque o p_tenant ainda não existe na
-- assinatura). MERGE NÃO DEPLOYA EDGE FUNCTION: publicar é passo à parte.
-- ORDEM OBRIGATÓRIA:
--   (1) APLICAR ESTA MIGRATION;
--   (2) PUBLICAR admin-manage-user (o deploy da edge function);
--   (3) SÓ ENTÃO TESTAR TROCAR O E-MAIL DA SDR E EXCLUIR A SDR.
-- NÃO TESTE ENTRE (1) E (2): o teste de trocar e-mail "passa" e deixa a sessão
-- antiga viva. A janela entre (1) e (2) deve ser de minutos.
-- SE, DEPOIS DE APLICAR, O ERRO FOR "could not find function ... in the schema
-- cache", É O POSTGREST COM O CACHE VELHO: NOTIFY pgrst, 'reload schema';
-- ############################################################################
-- =============================================================================

-- Assinaturas antigas saem antes (mudou a lista de parâmetros).
DROP FUNCTION IF EXISTS public.equipe_encerrar_sessoes(uuid);
DROP FUNCTION IF EXISTS public.equipe_redistribuir_leads(uuid, text, text);

-- ---------------------------------------------------------------- encerrar sessões
CREATE OR REPLACE FUNCTION public.equipe_encerrar_sessoes(p_user_id uuid, p_tenant uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_n integer := 0; v_tenant uuid;
BEGIN
  IF p_user_id IS NULL THEN RETURN 0; END IF;
  v_tenant := public.equipe_sdr_exclusiva(p_user_id);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Esta pessoa não é uma SDR (ou tem outro papel além de SDR).' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL THEN
    IF p_user_id = auth.uid() OR NOT public.is_gestor_equipe() OR public.current_tenant_id() IS DISTINCT FROM v_tenant THEN
      RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
    END IF;
  ELSE
    -- Servidor (service role / cron): não há sessão para dizer a clínica, então
    -- quem chama tem de DECLARAR qual é — e ela precisa ser a do alvo. Sem isto,
    -- service role derrubava a sessão de SDR de qualquer cliente.
    IF p_tenant IS NULL THEN
      RAISE EXCEPTION 'Chamada de servidor precisa informar a clínica.' USING ERRCODE = '22023';
    END IF;
    IF p_tenant IS DISTINCT FROM v_tenant THEN
      RAISE EXCEPTION 'A clínica informada não é a desta SDR.' USING ERRCODE = '42501';
    END IF;
  END IF;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), v_tenant, CASE WHEN auth.uid() IS NULL THEN 'admin' ELSE 'tenant' END, 'sdr_sessoes_encerradas',
          jsonb_build_object('target', p_user_id, 'sessoes', v_n, 'tenant_informado', p_tenant));
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.equipe_encerrar_sessoes(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipe_encerrar_sessoes(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------- redistribuir os leads dela
CREATE OR REPLACE FUNCTION public.equipe_redistribuir_leads(p_user_id uuid, p_destino text DEFAULT 'auto', p_motivo text DEFAULT NULL, p_tenant uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET lock_timeout TO '5s' AS $fn$
DECLARE
  v_tenant uuid; cfg public.crm_rodizio_config; v_gestor uuid; v_nome text; v_quem text; v_extra text;
  v_ids uuid[]; v_cargas integer[]; v_ponteiro uuid; v_alvo uuid; v_alvo_nome text; v_i integer;
  l public.crm_leads; v_run uuid := gen_random_uuid(); v_lead_nome text;
  v_rodizio boolean; v_fechado boolean; v_moveu_rodizio boolean := false;
  v_n_rod integer := 0; v_n_gestor integer := 0; v_reservas integer := 0; v_destinos jsonb := '{}'::jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Informe a SDR.' USING ERRCODE = '22023';
  END IF;
  v_tenant := public.equipe_sdr_exclusiva(p_user_id);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Esta pessoa não é uma SDR (ou tem outro papel além de SDR).' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL THEN
    IF p_user_id = auth.uid() OR NOT public.is_gestor_equipe() OR public.current_tenant_id() IS DISTINCT FROM v_tenant THEN
      RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
    END IF;
  ELSE
    -- Mesma regra do encerrar_sessoes, e aqui pesa mais: sem o recorte, service
    -- role movia TODOS os leads de uma SDR de outro cliente para o rodízio/gestor
    -- de lá, com livro e notificação, sem ninguém ter pedido.
    IF p_tenant IS NULL THEN
      RAISE EXCEPTION 'Chamada de servidor precisa informar a clínica.' USING ERRCODE = '22023';
    END IF;
    IF p_tenant IS DISTINCT FROM v_tenant THEN
      RAISE EXCEPTION 'A clínica informada não é a desta SDR.' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_destino IS NULL OR p_destino NOT IN ('auto', 'rodizio', 'gestor') THEN
    RAISE EXCEPTION 'Destino inválido: use auto, rodizio ou gestor.' USING ERRCODE = '22023';
  END IF;

  -- Mutex do motor: a mesma linha que rodizio_processar_lead trava.
  SELECT * INTO cfg FROM public.crm_rodizio_config WHERE tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR cfg.gestor_user_id IS NULL THEN
    RAISE EXCEPTION 'Rodízio sem gestor nomeado nesta clínica: não há para quem devolver os leads.' USING ERRCODE = '22023';
  END IF;
  v_gestor := cfg.gestor_user_id;
  v_nome := public.rodizio_nome(p_user_id);
  v_quem := CASE WHEN auth.uid() IS NULL THEN 'pelo administrador' ELSE 'por ' || public.rodizio_nome(auth.uid()) END;
  v_extra := COALESCE(' — ' || NULLIF(btrim(p_motivo), ''), '');

  SELECT array_agg(p.user_id ORDER BY p.ordem), array_agg(p.carga ORDER BY p.ordem)
    INTO v_ids, v_cargas
    FROM public.rodizio_pool(v_tenant) p WHERE p.user_id <> p_user_id;
  v_rodizio := v_ids IS NOT NULL AND (p_destino = 'rodizio' OR (p_destino = 'auto' AND cfg.modo = 'ligado'));
  IF p_destino = 'rodizio' AND NOT v_rodizio THEN
    RAISE EXCEPTION 'Nenhuma outra SDR elegível no rodízio (ativa e desbloqueada).' USING ERRCODE = '22023';
  END IF;
  v_ponteiro := CASE WHEN cfg.ponteiro_user_id = p_user_id THEN NULL ELSE cfg.ponteiro_user_id END;

  -- Caminho autorizado da regra universal de propriedade (trg_zz_propriedade_lead).
  PERFORM set_config('rodizio.autorizado', 'sim', true);

  -- 1. Ela sai do rodízio antes de qualquer movimento (nada novo cai nela no meio).
  UPDATE public.crm_rodizio_membros SET ativo = false WHERE tenant_id = v_tenant AND user_id = p_user_id;
  UPDATE public.crm_rodizio_config SET ponteiro_user_id = NULL WHERE tenant_id = v_tenant AND ponteiro_user_id = p_user_id;

  -- 2. Reservas pendentes para ela: desfaz; em modo ligado o motor refaz entre as demais.
  FOR l IN
    SELECT * FROM public.crm_leads
     WHERE tenant_id = v_tenant AND rodizio_reservado_para = p_user_id AND distribuido_em IS NULL
  LOOP
    UPDATE public.crm_leads SET rodizio_reservado_para = NULL, rodizio_reservado_em = NULL WHERE id = l.id;
    PERFORM public.rodizio_livro(l, p_user_id, NULL, 'manual', 'reserva desfeita: ' || v_nome || ' saiu da equipe ' || v_quem, v_run);
    IF cfg.modo = 'ligado' THEN
      PERFORM public.rodizio_processar_lead(l.id, 'reserva refeita (' || v_nome || ' saiu da equipe)', v_run);
    END IF;
    v_reservas := v_reservas + 1;
  END LOOP;

  -- 3. Os leads de que ela é dona.
  FOR l IN
    SELECT * FROM public.crm_leads
     WHERE tenant_id = v_tenant AND assigned_to = p_user_id
     ORDER BY last_inbound_at DESC NULLS LAST, created_at
  LOOP
    v_lead_nome := COALESCE(NULLIF(btrim(l.name), ''), 'Lead');
    -- Ciclo já encerrado (etapa do administrador, ou entrega pendente na carência) → administrador, sempre.
    v_fechado := EXISTS (SELECT 1 FROM public.crm_stages s WHERE s.id = l.stage_id AND NOT COALESCE(s.visivel_para_sdr, true))
              OR EXISTS (SELECT 1 FROM public.crm_entregas_gestor e WHERE e.lead_id = l.id);
    v_alvo := NULL;
    IF v_rodizio AND NOT v_fechado THEN
      v_alvo := public.rodizio_escolher(v_ids, v_cargas, v_ponteiro);
    END IF;

    IF v_alvo IS NOT NULL THEN
      SELECT i INTO v_i FROM generate_subscripts(v_ids, 1) AS i WHERE v_ids[i] = v_alvo LIMIT 1;
      v_cargas[v_i] := COALESCE(v_cargas[v_i], 0) + 1;   -- reveza dentro desta operação
      v_ponteiro := v_alvo; v_moveu_rodizio := true;
      v_alvo_nome := public.rodizio_nome(v_alvo);
      UPDATE public.crm_leads
         SET assigned_to = v_alvo, distribuido_em = now(),
             rodizio_reservado_para = NULL, rodizio_reservado_em = NULL, updated_at = now()
       WHERE id = l.id AND assigned_to = p_user_id;
      BEGIN
        UPDATE public.crm_tasks SET assigned_to = v_alvo WHERE lead_id = l.id AND assigned_to = p_user_id;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'equipe_redistribuir_leads: tarefas do lead % não seguiram (%)', l.id, SQLERRM;
      END;
      PERFORM public.rodizio_livro(l, p_user_id, v_alvo, 'manual',
        'redistribuição: ' || v_nome || ' saiu da equipe ' || v_quem || ' → ' || v_alvo_nome || v_extra, v_run);
      PERFORM public.rodizio_msg_sistema(l.id, v_tenant,
        '🔀 Lead passou de ' || v_nome || ' para ' || v_alvo_nome || ' (' || v_nome || ' saiu da equipe)');
      PERFORM public.rodizio_notifica(v_alvo, l.id, 'Lead recebido', v_lead_nome || ' era de ' || v_nome || ', que saiu da equipe.');
      v_destinos := v_destinos || jsonb_build_object(v_alvo_nome, COALESCE((v_destinos->>v_alvo_nome)::integer, 0) + 1);
      v_n_rod := v_n_rod + 1;
    ELSE
      UPDATE public.crm_leads
         SET assigned_to = v_gestor, distribuido_em = NULL,
             rodizio_reservado_para = NULL, rodizio_reservado_em = NULL, updated_at = now()
       WHERE id = l.id AND assigned_to = p_user_id;
      BEGIN
        UPDATE public.crm_tasks SET assigned_to = v_gestor WHERE lead_id = l.id AND assigned_to = p_user_id;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'equipe_redistribuir_leads: tarefas do lead % não seguiram (%)', l.id, SQLERRM;
      END;
      DELETE FROM public.crm_entregas_gestor WHERE lead_id = l.id;
      PERFORM public.rodizio_livro(l, p_user_id, v_gestor, 'manual',
        'redistribuição: ' || v_nome || ' saiu da equipe ' || v_quem || ' → administrador'
        || CASE WHEN v_fechado THEN ' (ciclo já encerrado)' ELSE '' END || v_extra, v_run);
      PERFORM public.rodizio_msg_sistema(l.id, v_tenant,
        '🔀 Lead passou de ' || v_nome || ' para o administrador (' || v_nome || ' saiu da equipe)');
      v_n_gestor := v_n_gestor + 1;
    END IF;
  END LOOP;
  IF v_moveu_rodizio THEN
    UPDATE public.crm_rodizio_config SET ponteiro_user_id = v_ponteiro WHERE tenant_id = v_tenant;
  END IF;

  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), v_tenant, CASE WHEN auth.uid() IS NULL THEN 'admin' ELSE 'tenant' END, 'sdr_redistribuir_leads',
          jsonb_build_object('target', p_user_id, 'target_nome', v_nome, 'destino', p_destino,
                             'para_rodizio', v_n_rod, 'para_gestor', v_n_gestor, 'reservas', v_reservas, 'run_id', v_run,
                             'tenant_informado', p_tenant));
  RETURN jsonb_build_object('leads', v_n_rod + v_n_gestor, 'para_rodizio', v_n_rod, 'para_gestor', v_n_gestor,
                            'reservas_refeitas', v_reservas, 'destinos', v_destinos, 'run_id', v_run);
END $fn$;
REVOKE ALL ON FUNCTION public.equipe_redistribuir_leads(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipe_redistribuir_leads(uuid, text, text, uuid) TO authenticated, service_role;


-- =============================================================================
-- 5) relatorio_funis(date,date): dois vazamentos no relatório "Comparar funis".
--    Corpo copiado de 20260910002000_relatorio_funis.sql, com duas correções:
--    (a) FUNIL DA PÓS-VENDA APARECIA PARA QUEM NÃO É PÓS-VENDA. O produto todo
--        esconde funil is_posvenda de quem não tem o papel (is_posvenda_pipeline
--        nas policies), mas este relatório é DEFINER e listava crm_pipelines
--        inteiro: o crc/gerente lia base, agendamentos, faltas e RECEITA da
--        pós-venda numa tabela. Agora só passa funil que não é pós-venda, salvo
--        para quem tem o papel posvenda ou é superadmin.
--    (b) A CTE "vinc" ESCOLHIA O VÍNCULO PACIENTE→LEAD SEM RECORTE DE CLIENTE.
--        crm_lead_pacientes era lida inteira: se o mesmo paciente_id tivesse
--        vínculo em duas clínicas, o DISTINCT ON podia eleger o lead da OUTRA e
--        o pagamento sumia do relatório de quem o recebeu (ou, no espelho,
--        entrava no de quem não recebeu). O JOIN com crm_leads lx exigindo
--        lx.tenant_id = v_tenant faz a escolha acontecer só entre vínculos deste
--        cliente. O filtro de tenant na CTE pag continua onde estava.
--    Mesma assinatura, mesmos REVOKE/GRANT.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.relatorio_funis(p_de date, p_ate date)
RETURNS TABLE(
  pipeline_id uuid, nome text, posicao integer,
  leads_total integer, leads_novos integer,
  agendamentos integer, compareceram integer, faltas integer, contratados integer,
  contratados_etapa integer, receita numeric, pagantes integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid := public.current_tenant_id(); v_tz text; v_ini timestamptz; v_fim timestamptz;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN RETURN; END IF;
  IF NOT (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role)
          OR public.has_role(auth.uid(), 'superadmin'::app_role)) THEN
    RAISE EXCEPTION 'Este relatório é da gestão.' USING ERRCODE = '42501';
  END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN
    RAISE EXCEPTION 'Período inválido.' USING ERRCODE = '22023';
  END IF;
  v_tz := public.rodizio_tz(v_tenant);
  v_ini := (p_de::timestamp) AT TIME ZONE v_tz;
  v_fim := ((p_ate + 1)::timestamp) AT TIME ZONE v_tz;

  RETURN QUERY
  WITH vinc AS (
    -- (b) só vínculos cujo lead é DESTE cliente: sem isto o DISTINCT ON podia
    -- eleger o vínculo de outra clínica e mandar o pagamento para o funil errado.
    SELECT DISTINCT ON (lp.paciente_id) lp.paciente_id, lp.lead_id
      FROM public.crm_lead_pacientes lp
      JOIN public.crm_leads lx ON lx.id = lp.lead_id AND lx.tenant_id = v_tenant
     ORDER BY lp.paciente_id, lp.is_primary DESC NULLS LAST, lp.created_at
  ), pag AS (
    SELECT l.pipeline_id, sum(pg.valor) AS receita, count(DISTINCT pg.paciente_id) AS pagantes
      FROM public.pagamentos pg
      JOIN vinc v ON v.paciente_id = pg.paciente_id
      JOIN public.crm_leads l ON l.id = v.lead_id AND l.tenant_id = v_tenant
     WHERE pg.data_pagamento BETWEEN p_de AND p_ate
       AND COALESCE(pg.recorrencia_orto, false) = false
       AND COALESCE(pg.nao_marketing, false) = false
     GROUP BY l.pipeline_id
  ), ag AS (
    SELECT l.pipeline_id,
           count(*) FILTER (WHERE COALESCE(a.status, '') <> 'cancelled') AS agendamentos,
           count(*) FILTER (WHERE a.status IN ('contracted', 'not_contracted')) AS compareceram,
           count(*) FILTER (WHERE a.status = 'no_show') AS faltas,
           count(*) FILTER (WHERE a.status = 'contracted') AS contratados
      FROM public.crm_appointments a
      JOIN public.crm_leads l ON l.id = a.lead_id AND l.tenant_id = v_tenant
     WHERE a.scheduled_date BETWEEN p_de AND p_ate
     GROUP BY l.pipeline_id
  ), ld AS (
    SELECT l.pipeline_id,
           count(*) AS leads_total,
           count(*) FILTER (WHERE l.created_at >= v_ini AND l.created_at < v_fim) AS leads_novos,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.crm_stages s
              WHERE s.id = l.stage_id
                AND (COALESCE(s.is_won, false) OR public.normaliza_nome_etapa(s.name) = 'contratado'))) AS contratados_etapa
      FROM public.crm_leads l
     WHERE l.tenant_id = v_tenant
     GROUP BY l.pipeline_id
  )
  SELECT p.id, p.name, p.position,
         COALESCE(ld.leads_total, 0)::integer, COALESCE(ld.leads_novos, 0)::integer,
         COALESCE(ag.agendamentos, 0)::integer, COALESCE(ag.compareceram, 0)::integer,
         COALESCE(ag.faltas, 0)::integer, COALESCE(ag.contratados, 0)::integer,
         COALESCE(ld.contratados_etapa, 0)::integer,
         COALESCE(pag.receita, 0)::numeric, COALESCE(pag.pagantes, 0)::integer
    FROM public.crm_pipelines p
    LEFT JOIN ld  ON ld.pipeline_id = p.id
    LEFT JOIN ag  ON ag.pipeline_id = p.id
    LEFT JOIN pag ON pag.pipeline_id = p.id
   WHERE p.tenant_id = v_tenant
     -- (a) funil de pós-venda só para quem é da pós-venda (ou superadmin).
     AND (NOT COALESCE(p.is_posvenda, false)
          OR public.has_role(auth.uid(), 'posvenda'::app_role)
          OR public.has_role(auth.uid(), 'superadmin'::app_role))
   ORDER BY p.position NULLS LAST, p.created_at;
END $fn$;
REVOKE ALL ON FUNCTION public.relatorio_funis(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_funis(date, date) TO authenticated, service_role;


-- =============================================================================
-- 6) VERIFICAÇÃO (só leitura — nada aqui altera nada; rodar no SQL Editor)
-- =============================================================================
-- 6.1 As portas fecharam? Esperado: authenticated_executa = false e
--     anon_executa = false em TODAS; service_role_executa = true.
-- SELECT f::text AS funcao,
--        has_function_privilege('authenticated', f::oid, 'EXECUTE') AS authenticated_executa,
--        has_function_privilege('anon',          f::oid, 'EXECUTE') AS anon_executa,
--        has_function_privilege('service_role',  f::oid, 'EXECUTE') AS service_role_executa
--   FROM unnest(ARRAY[
--          to_regprocedure('public.watchdog_reenqueue_missing_bots()'),
--          to_regprocedure('public.recover_stuck_bot_executions()'),
--          to_regprocedure('public.ensure_instagram_pipeline(uuid)'),
--          to_regprocedure('public.recalculate_all_lead_scores()'),
--          to_regprocedure('public.backup_list_tables()'),
--          to_regprocedure('public.notify_dashboard_event(text,text,text)'),
--          to_regprocedure('public.pacientes_whatsapp_direto(uuid[])'),
--          to_regprocedure('public.dono_restrito_do_numero(uuid)')
--        ]) AS f
--  WHERE f IS NOT NULL;
--
-- 6.2 O que continua ABERTO de propósito (as duas com guarda dentro):
--     esperado authenticated_executa = true nas duas.
-- SELECT f::text AS funcao, has_function_privilege('authenticated', f::oid, 'EXECUTE') AS authenticated_executa
--   FROM unnest(ARRAY[
--          to_regprocedure('public.recalculate_all_lead_scores(integer)'),
--          to_regprocedure('public.generate_tenant_invoices()')
--        ]) AS f
--  WHERE f IS NOT NULL;
--
-- 6.3 Nenhuma policy depende das funções fechadas (é o que faz o REVOKE ser
--     seguro). Esperado: ZERO linhas.
-- SELECT schemaname, tablename, policyname
--   FROM pg_policies
--  WHERE COALESCE(qual, '') || COALESCE(with_check, '') ~
--        'watchdog_reenqueue_missing_bots|recover_stuck_bot_executions|ensure_instagram_pipeline|backup_list_tables|notify_dashboard_event|pacientes_whatsapp_direto|dono_restrito_do_numero';
--
-- 6.4 A chave saiu do corpo da função? Esperado:
--     le_do_cofre = true e ainda_tem_chave_em_texto = false.
-- SELECT pg_get_functiondef(to_regprocedure('public.notify_dashboard_event(text,text,text)')::oid) LIKE '%_internal_secrets%' AS le_do_cofre,
--        pg_get_functiondef(to_regprocedure('public.notify_dashboard_event(text,text,text)')::oid) ~ '''[0-9a-f]{24,}''' AS ainda_tem_chave_em_texto;
--
-- 6.5 A chave NOVA já está cadastrada? (mostra só o tamanho — nunca o valor).
--     Zero linhas = o painel Vision NÃO está recebendo evento; ver item 3.
-- SELECT name, length(value) AS tamanho_do_valor, created_at
--   FROM public._internal_secrets WHERE name = 'vision_ingest_secret';
--
-- 6.5b A função já reclamou de segredo ausente? Cada linha aqui é uma janela de
--      até 6 horas em que o painel Vision NÃO recebeu evento. Esperado depois do
--      passo (b): nenhuma linha nova.
-- SELECT created_at, metadata
--   FROM public.access_logs
--  WHERE event = 'vision_ingest_sem_segredo'
--  ORDER BY created_at DESC LIMIT 20;
--
-- 6.6 Assinaturas novas das RPCs da equipe. Esperado exatamente
--     equipe_encerrar_sessoes(uuid,uuid) e
--     equipe_redistribuir_leads(uuid,text,text,uuid) — as antigas (uuid) e
--     (uuid,text,text) NÃO devem aparecer.
-- SELECT p.oid::regprocedure::text AS assinatura
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND p.proname IN ('equipe_encerrar_sessoes', 'equipe_redistribuir_leads')
--  ORDER BY 1;
--
-- 6.7 As guardas estão dentro dos corpos? Esperado true nas quatro colunas.
-- SELECT pg_get_functiondef(to_regprocedure('public.generate_tenant_invoices()')::oid) LIKE '%superadmin%' AS fatura_so_superadmin,
--        pg_get_functiondef(to_regprocedure('public.equipe_encerrar_sessoes(uuid,uuid)')::oid) LIKE '%precisa informar a clínica%' AS sessoes_exige_tenant,
--        pg_get_functiondef(to_regprocedure('public.equipe_redistribuir_leads(uuid,text,text,uuid)')::oid) LIKE '%precisa informar a clínica%' AS redistribuir_exige_tenant,
--        pg_get_functiondef(to_regprocedure('public.relatorio_funis(date,date)')::oid) LIKE '%is_posvenda%' AS funis_esconde_posvenda;
--
-- 6.8 Ensaio da guarda de servidor, sem risco: rodando SEM JWT (SQL Editor /
--     service role) e SEM p_tenant, a chamada tem de FALHAR com "Chamada de
--     servidor precisa informar a clínica." — e é justamente por falhar que nada
--     é apagado. Se ela devolver um número, a guarda não subiu.
-- SELECT public.equipe_encerrar_sessoes('<uuid de uma SDR>');
--     NÃO passe p_tenant neste ensaio: com o tenant correto ela FAZ o serviço e
--     derruba de verdade as sessões da pessoa.
