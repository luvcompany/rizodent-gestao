-- Rodízio de SDRs — Fase 1: o papel "sdr" ganha vida e a aba Equipe ganha banco.
--
-- O QUE ESTA MIGRATION FAZ (nada aqui altera policy existente; só cria objetos
-- novos ou substitui funções que JÁ enumeram papéis — regra do dono):
--
--   1. crm_rodizio_config.gestor_user_id (quem gere a equipe no tenant) +
--      funções sdr_pode_ver_lead(_lead_id) e is_gestor_equipe().
--   2. Acesso BASE do sdr (policies PERMISSIVE novas + concessões automáticas):
--      overrides de funil para os funis gerais do tenant (trigger em user_roles
--      e em crm_pipelines), exclusão de lead no molde de operacao_apaga_leads,
--      leitura dos itens do mundo crc em bots/respostas/modelos. Transmissões
--      (crm_broadcasts) NÃO: o contrato só compartilha bots, modelos, respostas
--      e automações, e uma transmissão do crc alcança leads de outras donas —
--      fica no bloqueio total (3.8) e o broadcast-engine recusa a SDR.
--   3. ESCOPO do sdr (policies RESTRICTIVE novas, inertes para os outros
--      papéis): a SDR só alcança leads de que é DONA (crm_leads.assigned_to =
--      auth.uid()) e o que pende deles (inclusive bot_execution_logs, via
--      bot_executions.lead_id); bloqueio total em 32 tabelas: as 28 em que
--      closer/recepção também são bloqueados + crm_broadcasts,
--      rpt_baseline_anuncio, crm_funnel_custom_reports e ad_account_map
--      (relatórios e mapa de contas de anúncio abertos a qualquer papel do
--      tenant — brecha que closer/recepção também têm e que fica registrada
--      para a fase de isolamento deles). Mais o bloqueio de ESCRITA em
--      funnel_channels (3.9), que decide o roteamento dos leads novos.
--      Três gatilhos em crm_leads: carimbar a dona ao criar, impedir a SDR de
--      transferir lead e impedir a SDR de reescrever distribuido_em
--      (métrica "leads hoje").
--   4. Funções de busca SECURITY DEFINER (que NÃO passam pela RLS) ganham o
--      ramo do sdr: get_conversation_leads, get_lead_for_conversation,
--      get_leads_for_calendar, transfer_lead_to_whatsapp,
--      chat_media_belongs_to_current_tenant,
--      call_recording_belongs_to_current_tenant, rpt_resolve_tenant,
--      check_duplicate_phone (2 assinaturas) e get_lead_stage_history_names
--      (linha do tempo de etapas). Fecha as portas pré-existentes
--      admin_api_unread_leads_base e match_good_examples (só service_role) e
--      põe o mesmo veto de relatórios de rpt_resolve_tenant em
--      crm_usage_metrics e crm_template_usage_counts. Cria
--      posvenda_padrao_do_tenant (o destinatário do botão "Enviar para
--      Pós-venda" sem abrir user_roles) — o único caminho de saída do lead da
--      SDR, que sem isso não renderizava na tela.
--   5. Helpers de usuário: set_owner_role_from_user (sdr cria no mundo crc),
--      tenant_set_user_role (aceita sdr; não reaplica papel igual),
--      concede_numeros_ao_novo_usuario (sdr recebe SÓ o número principal),
--      concede_numero_aos_gerais (número novo não vai para a SDR).
--   6. RPCs da aba Equipe: equipe_listar, equipe_bloquear, equipe_rodizio.
--   7. Leitura de crm_rodizio_membros / crm_ponto_eventos pela SDR: JÁ existe
--      desde a Fase 0 (rodizio_membros_le e ponto_le têm "OR user_id =
--      auth.uid()") — nada a duplicar.
--
-- ORDEM DE PUBLICAÇÃO: este arquivo tem timestamp 150000 de propósito — vem
-- DEPOIS de 20260908140000 (varredura) e 20260908140100 (folha de agosto),
-- que são publicações separadas, autorizadas à parte (docs/PUBLICAR-PENDENTE.md).
-- Nada aqui depende delas.
--
-- LADO DAS EDGE FUNCTIONS (revisão da Fase 1): a RLS abaixo não alcança o que
-- roda com service role. Por isso supabase/functions/_shared/authz.ts passa a
-- conhecer o papel sdr (assertLeadInTenant/assertMessageInTenant/
-- assertNumberAccess exigem lead dela; assertLeadOwnership usa
-- sdr_pode_ver_lead com o JWT dela) e transfer-lead devolve 403 'SDR não
-- transfere lead'. Publicar as functions junto com esta migration.
--
-- DECISÃO DOCUMENTADA — criar usuária e redefinir senha NÃO viram RPC:
--   Criar uma conta e trocar a senha de outra pessoa exigem a Auth Admin API
--   (auth.users é gerido pelo GoTrue; gravar encrypted_password/identities à
--   mão é território não suportado). O projeto já tem a porta certa — a edge
--   function admin-manage-user (createUser + must_change_password=true no
--   perfil e no user_metadata; reset_password reativa a troca obrigatória).
--   Portanto:
--     • equipe_criar_sdr      → NÃO existe. O front chama admin-manage-user
--       {action:'create', email, nome, password, role:'sdr'}; a função,
--       estendida nesta fase, aceita o gestor (is_gestor_equipe() via RPC com
--       o JWT dele), força tenant = tenant do gestor e papel = 'sdr'.
--     • equipe_redefinir_senha → NÃO existe. admin-manage-user
--       {action:'reset_password', user_id, password}; para o gestor, o alvo
--       precisa ser do tenant dele e ter SÓ o papel sdr.
--     • equipe_bloquear e equipe_rodizio → RPCs abaixo (bloqueio = o mesmo
--       par que a edge function usa: auth.users.banned_until + profiles.
--       is_blocked; current_tenant_id() devolve NULL para bloqueado, então a
--       RLS fecha tudo no mesmo instante).
--   A senha temporária é digitada pelo gestor no formulário e vai direto para
--   a edge function (TLS); nunca é gerada, devolvida ou logada.
--
-- DECISÕES FECHADAS NA REVISÃO DA FASE 1 (mudanças de comportamento que
-- alcançam outros papéis — declaradas aqui de propósito):
--   • tenant_set_user_role (5.2) deixa de fazer DELETE+INSERT SÓ quando o papel
--     pedido é 'sdr' e a usuária já tem exatamente esse papel (senão o DELETE
--     a tiraria do rodízio). Para crc, gerente, pós-venda, recepção e closer o
--     comportamento continua o de produção — DELETE+INSERT sempre —, inclusive
--     o efeito colateral de que reaplicar o papel re-dispara
--     concede_numeros_ao_novo_usuario e recompõe overrides de número
--     revogados. Nada muda para papel nenhum além do sdr.
--     O set_role da edge function admin-manage-user tinha o MESMO atalho valendo
--     para todos os papéis (reaplicar 'crc' deixaria de recompor os overrides de
--     número revogados e de gravar o log user_set_role); o cerco ao papel 'sdr'
--     já foi aplicado lá (supabase/functions/admin-manage-user/index.ts, ramo
--     action === 'set_role'), então os dois caminhos concordam.
--   • admin-set-user-blocked: o gate is_gestor_equipe() vale APENAS quando o
--     ALVO tem papel 'sdr'. Para todo alvo que não é SDR o comportamento de
--     produção é preservado DE PROPÓSITO — o crc do mesmo cliente continua
--     bloqueando e desbloqueando como sempre —, porque tirar essa rota dele
--     seria "papel existente passando a poder MENOS".
--     RESIDUAL CONHECIDO, registrado aqui em vez de escondido: o usuário do
--     Meta App Review (f9042a25-…, crc) CONTINUA podendo bloquear/desbloquear
--     usuários não-SDR do tenant Rizodent por esta function. Fechar essa porta
--     é assunto da fase de isolamento do crc, não desta.
--     A ordem de publicação, por isso, NÃO é crítica: sem a RPC no banco o ramo
--     do alvo SDR nem é alcançado (sem a Fase 1 não existe usuária com papel
--     'sdr'), e o resto da function não depende dela.
--   • is_gestor_equipe() (bloco 1) é superadmin OU gestor_user_id nomeado — sem
--     ramo "é gerente". Foi assim que se manteve a regra da fase: a função é a
--     porta de admin-manage-user {create, reset_password} (criar conta no Auth,
--     trocar senha de terceiro), e um ramo por papel entregaria esse poder novo
--     a todo gerente de todo cliente. Nenhum gerente perde nada: a aba Equipe e
--     as RPCs equipe_* são objetos NOVOS desta fase, que ninguém alcançava
--     antes. Para dar a aba a um gerente, o superadmin o nomeia
--     (UPDATE crm_rodizio_config.gestor_user_id).
--   • admin_api_unread_leads_base(uuid) (4.7) perde o EXECUTE de authenticated.
--     Hoje, em produção, `authenticated` PODE chamá-la (conferido 08/09/2026),
--     então crc, gerente, pós-venda, recepção e closer perdem uma RPC — é
--     "papel existente podendo menos", declarado aqui de propósito. Impacto
--     funcional nulo: o único chamador é supabase/functions/admin-api
--     (index.ts:295), com cliente de service role; grep em src/ e no resto de
--     supabase/functions/ não achou outro uso.
--   • match_good_examples(vector,int,uuid,text,text) (4.11) idem: SECURITY
--     DEFINER, sem checagem de papel nem de tenant (filter_tenant é parâmetro
--     do chamador) e devolvendo trechos reais de conversa. Único chamador:
--     generate-reply-suggestion (index.ts:562, cliente de service role).
--   • crm_usage_metrics e crm_template_usage_counts (4.12) passam a recusar o
--     papel sdr, como rpt_resolve_tenant já fazia (4.6). Para os demais papéis
--     o corpo é bit a bit o de produção.
--   • equipe_bloquear (6) grava auth.users.banned_until por SQL, com os
--     privilégios que o dono da migration (postgres) tem em produção
--     (conferido 08/09/2026). É o mesmo par que a Auth Admin API grava
--     (ban + profiles.is_blocked); risco assumido: se o GoTrue mudar o
--     significado da coluna, o ban deixa de valer — profiles.is_blocked
--     continua fechando a RLS e derrubando a sessão pelo ProtectedRoute.
--   • get_lead_stage_history_names (4.10) passa a ter ramo de papel. É a única
--     função substituída aqui que NÃO enumerava papéis antes; a exceção à
--     regra do dono foi autorizada na revisão desta fase, porque era o par
--     natural da brecha do check_duplicate_phone (id na mão → histórico de
--     etapas do lead de outra dona). Corpo copiado de produção, com uma única
--     cláusula a mais; para todo papel que não é sdr o plano é o mesmo.
--   • Residual conhecido: check_duplicate_phone ainda devolve o lead_id de
--     lead de outra dona (decisão: só o id, sem nome, dona, funil ou etapa) —
--     é o que permite ao front dizer "telefone já cadastrado" sem expor a
--     dona. Com a guarda de 4.10, esse id deixa de abrir o histórico do lead.
--
-- PRÉ-REQUISITO: 20260901220000 (enum 'sdr') e 20260901220100 (fundações).
-- ROLLBACK: DROP das policies sdr_* / sdr_sem_* / sdr_base_*, dos gatilhos
-- trg_sdr_*, das funções sdr_* / equipe_* / is_gestor_equipe /
-- posvenda_padrao_do_tenant e da coluna
-- gestor_user_id; as funções substituídas voltam pela versão anterior
-- (todas continuam valendo para os demais papéis mesmo com o ramo sdr).
-- Os REVOKEs de 4.7/4.11 NÃO voltam sozinhos: para desfazer,
-- GRANT EXECUTE ... TO authenticated de novo (mas leia a justificativa antes).

SET LOCAL lock_timeout = '5s';

-- ============================================================ 1. gestor + funções-base
-- Quem gere a equipe NÃO pode derivar de "é crc": o usuário do Meta App Review
-- também é crc e não pode ter poder de gestão. Coluna deny-write (a tabela não
-- tem policy de escrita; só o servidor/superadmin grava).
ALTER TABLE public.crm_rodizio_config
  ADD COLUMN IF NOT EXISTS gestor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.crm_rodizio_config
   SET gestor_user_id = 'd9b27aa3-049e-4ec9-9ae3-fb160a9544fa'   -- rizodentvca2@gmail.com (crc)
 WHERE tenant_id = '00000000-0000-0000-0000-000000000010'
   AND gestor_user_id IS NULL;

-- "É dona deste lead?" — lead do tenant atual com assigned_to = auth.uid().
-- SEM guarda de papel de propósito (o contrato define a semântica pura);
-- toda policy e toda função abaixo aplicam a guarda "NOT has_role(sdr) OR ..."
-- explicitamente, então o resultado para os demais papéis é sempre inerte.
-- SECURITY DEFINER: a consulta interna em crm_leads roda como dono da função
-- e não recursa na RLS de crm_leads.
CREATE OR REPLACE FUNCTION public.sdr_pode_ver_lead(_lead_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT _lead_id IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.crm_leads l
        WHERE l.id = _lead_id
          AND l.assigned_to = auth.uid()
          AND l.tenant_id = public.current_tenant_id()
     );
$fn$;

-- Gestor da equipe: superadmin OU o gestor_user_id NOMEADO no tenant atual.
-- Bloqueado não passa (current_tenant_id() devolve NULL).
--
-- SEM ramo "é gerente" de propósito (decisão da revisão da Fase 1): esta função
-- é a porta de admin-manage-user {create, reset_password}, ou seja, criar conta
-- no Auth e trocar a senha de outra pessoa. Um ramo por PAPEL daria esse poder,
-- de uma vez, a todo gerente de todo cliente — poder que o gerente não tem hoje
-- (a function era exclusiva do superadmin), contra a regra da fase ("nenhum
-- papel existente pode passar a poder mais NEM menos do que hoje"). Gerente vira
-- gestor da equipe do mesmo jeito que o admin CRC: quando o superadmin o nomeia
-- (UPDATE crm_rodizio_config.gestor_user_id), o que é uma decisão por pessoa e
-- por cliente, auditável na tabela.
CREATE OR REPLACE FUNCTION public.is_gestor_equipe()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'superadmin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.crm_rodizio_config c
       WHERE c.tenant_id = public.current_tenant_id()
         AND c.gestor_user_id = auth.uid()
    )
  );
$fn$;

REVOKE ALL ON FUNCTION public.is_gestor_equipe() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_gestor_equipe() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.sdr_pode_ver_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sdr_pode_ver_lead(uuid) TO authenticated, service_role;

-- ============================================================ 2. acesso BASE do sdr
-- 2.1 Funil. can_access_pipeline (e a policy de crm_pipelines, e a lista de
-- get_conversation_leads) só liberam funil com allowed_roles NULL para
-- crc/gerente — a SDR entra por OVERRIDE (scope 'pipeline', granted=true),
-- que tem precedência nas três leituras e no filtro defensivo do front.
-- NÃO alteramos allowed_roles do Funil Principal: o front e
-- appointmentScheduling.ts tratam "allowed_roles vazio" como o próprio Funil
-- Principal, e preencher a lista tiraria o funil do crc/gerente.
-- Concedido automaticamente: todo funil GERAL do tenant (allowed_roles NULL,
-- não pós-venda, não Instagram) — o lead da SDR continua visível quando o crc
-- o move para "Não Compareceu"/"Nutrição". Revogar um funil da SDR (override
-- granted=false vence) é feito pelo SUPERADMIN, na tela de permissões do
-- painel (UserPermissionsSheet em AdminClienteDetalhe) — o admin CRC não tem
-- essa tela nesta fase. ON CONFLICT DO NOTHING respeita decisão anterior.
CREATE OR REPLACE FUNCTION public.sdr_prepara_novo_membro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid;
BEGIN
  IF NEW.role <> 'sdr'::app_role THEN RETURN NEW; END IF;
  -- tenant vem do PERFIL (set_tenant_id_default cai no tenant Rizodent quando
  -- o servidor não manda tenant_id — o perfil é a fonte confiável).
  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = NEW.user_id;
  IF v_tenant IS NULL THEN v_tenant := NEW.tenant_id; END IF;
  IF v_tenant IS NULL THEN RETURN NEW; END IF;

  -- Membro do rodízio nasce INATIVO: o gestor liga pela aba Equipe.
  INSERT INTO public.crm_rodizio_membros (tenant_id, user_id, ativo)
  VALUES (v_tenant, NEW.user_id, false)
  ON CONFLICT (tenant_id, user_id) DO NOTHING;

  INSERT INTO public.user_permission_overrides (user_id, scope, resource_id, granted, created_by)
  SELECT NEW.user_id, 'pipeline', p.id::text, true, auth.uid()
    FROM public.crm_pipelines p
   WHERE p.tenant_id = v_tenant
     AND p.allowed_roles IS NULL
     AND NOT COALESCE(p.is_posvenda, false)
     AND NOT COALESCE(p.is_instagram, false)
  ON CONFLICT (user_id, scope, resource_id) DO NOTHING;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_sdr_prepara_novo_membro ON public.user_roles;
CREATE TRIGGER trg_sdr_prepara_novo_membro
  AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.sdr_prepara_novo_membro();

-- Papel sdr removido (promoção/troca de papel) → sai do rodízio (fica
-- inativa, a linha não é apagada para não perder peso/histórico).
-- CONSTRAINT TRIGGER DEFERRED: tenant_set_user_role e o set_role da edge
-- function fazem DELETE de todos os papéis + INSERT do novo. Um gatilho AFTER
-- DELETE comum dispararia no meio e desligaria do rodízio quem apenas teve o
-- papel 'sdr' reaplicado. Adiado para o commit, ele só age se, no fim da
-- transação, a usuária de fato não tiver mais o papel sdr.
CREATE OR REPLACE FUNCTION public.sdr_desativa_membro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF OLD.role = 'sdr'::app_role
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = OLD.user_id AND ur.role = 'sdr'::app_role
     ) THEN
    UPDATE public.crm_rodizio_membros SET ativo = false WHERE user_id = OLD.user_id;
  END IF;
  RETURN OLD;
END $fn$;

DROP TRIGGER IF EXISTS trg_sdr_desativa_membro ON public.user_roles;
CREATE CONSTRAINT TRIGGER trg_sdr_desativa_membro
  AFTER DELETE ON public.user_roles
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.sdr_desativa_membro();

-- Funil geral criado depois → as SDRs do tenant ganham o override na hora
-- (mesmo espírito de concede_numero_aos_gerais).
CREATE OR REPLACE FUNCTION public.sdr_concede_funil_novo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.allowed_roles IS NOT NULL
     OR COALESCE(NEW.is_posvenda, false)
     OR COALESCE(NEW.is_instagram, false)
     OR NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.user_permission_overrides (user_id, scope, resource_id, granted, created_by)
  SELECT DISTINCT ur.user_id, 'pipeline', NEW.id::text, true, auth.uid()
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE ur.role = 'sdr'::app_role
     AND p.tenant_id = NEW.tenant_id
  ON CONFLICT (user_id, scope, resource_id) DO NOTHING;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_sdr_concede_funil_novo ON public.crm_pipelines;
CREATE TRIGGER trg_sdr_concede_funil_novo
  AFTER INSERT ON public.crm_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.sdr_concede_funil_novo();

-- 2.2 Excluir lead: única PERMISSIVE de crm_leads que cita closer/recepção
-- (operacao_apaga_leads, decisão do dono de 31/08: "todo usuário"). Cópia
-- para o sdr; o alcance (só lead dela) vem da RESTRICTIVE do bloco 3.
DROP POLICY IF EXISTS sdr_base_crm_leads_delete ON public.crm_leads;
CREATE POLICY sdr_base_crm_leads_delete ON public.crm_leads
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (SELECT public.has_role(auth.uid(), 'sdr'::app_role))
    AND public.can_access_pipeline(pipeline_id)
    AND public.can_access_whatsapp_number(whatsapp_number_id)
    AND public.can_access_instagram_account(ig_account_uuid)
  );

-- 2.3 Recursos compartilhados por owner_role. As permissivas "visible by role"
-- só liberam owner_role IS NULL, o próprio papel ou shared_roles — a SDR não
-- é 'crc', então NÃO veria o acervo do crc. Base nova: itens owner_role='crc'
-- do tenant. (Os itens NULL já passam pela permissiva existente.)
-- Transmissões (crm_broadcasts) ficam FORA: não são compartilhadas pelo
-- contrato e uma transmissão alcança leads de outras donas (bloqueio em 3.8).
-- Funis/etapas/automações: leitura já é do tenant ou via override do funil —
-- nada a criar; a escrita não alcança a SDR (crm_pipelines/crm_stages exigem
-- papel de gestão nas permissivas).
-- CANAIS (funnel_channels) são a EXCEÇÃO e por isso ganham bloqueio explícito
-- no 3.9: ali as permissivas tenant_cria/edita/apaga_funnel_channels pedem só
-- (tenant_id = current_tenant_id() AND can_access_pipeline(pipeline_id)) — e
-- can_access_pipeline olha PRIMEIRO o user_override, justamente o que
-- sdr_prepara_novo_membro concede à SDR em todo funil geral. Sem o 3.9 ela
-- escreveria o canal do Funil Principal (leitura continua liberada).
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bots','crm_quick_replies','crm_whatsapp_templates'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS sdr_base_%1$s_select ON public.%1$I', t);
    EXECUTE format($p$
      CREATE POLICY sdr_base_%1$s_select ON public.%1$I
        FOR SELECT TO authenticated
        USING (
          (SELECT public.has_role(auth.uid(), 'sdr'::app_role))
          AND tenant_id = (SELECT public.current_tenant_id())
          AND owner_role = 'crc'::app_role
        )$p$, t);
  END LOOP;
END $do$;

-- Respostas rápidas: o front insere só {title, content}; created_by ficava
-- NULL. Gatilho novo e inofensivo (só preenche quando vazio) — é o que permite
-- amarrar UPDATE/DELETE da SDR ao "criado por ela" no bloco 3.
CREATE OR REPLACE FUNCTION public.quick_reply_carimba_autor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_quick_reply_carimba_autor ON public.crm_quick_replies;
CREATE TRIGGER trg_quick_reply_carimba_autor
  BEFORE INSERT ON public.crm_quick_replies
  FOR EACH ROW EXECUTE FUNCTION public.quick_reply_carimba_autor();

-- ============================================================ 3. ESCOPO do sdr (RESTRICTIVE)
-- Molde idêntico ao closer_number_scope_* / recepcao_*: InitPlan
-- "(SELECT NOT has_role(sdr)) OR <escopo>" — para quem não é sdr a primeira
-- metade é TRUE e a policy não muda nada.

-- 3.1 crm_leads — eixo: assigned_to = auth.uid(). Diferença deliberada em
-- relação ao closer: UPDATE tem WITH CHECK (a SDR não passa o lead adiante
-- pelo front) e INSERT exige que o lead nasça dela (o gatilho abaixo carimba).
-- O WITH CHECK também prende o lead ao mundo dela ("cada número é um mundo"):
-- sem isso a SDR gravaria whatsapp_number_id/ig_account_uuid de um número que
-- não tem (a permissiva só exige can_access_pipeline e o carimbo
-- stamp_crm_lead_whatsapp_number só valida closer/recepção) e empurraria o
-- lead para o mundo do closer — que passaria a ver a conversa inteira.
DROP POLICY IF EXISTS sdr_escopo_crm_leads_select ON public.crm_leads;
CREATE POLICY sdr_escopo_crm_leads_select ON public.crm_leads
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR assigned_to = auth.uid());

DROP POLICY IF EXISTS sdr_escopo_crm_leads_insert ON public.crm_leads;
CREATE POLICY sdr_escopo_crm_leads_insert ON public.crm_leads
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
    OR (assigned_to = auth.uid()
        AND public.can_access_whatsapp_number(whatsapp_number_id)
        AND public.can_access_instagram_account(ig_account_uuid))
  );

DROP POLICY IF EXISTS sdr_escopo_crm_leads_update ON public.crm_leads;
CREATE POLICY sdr_escopo_crm_leads_update ON public.crm_leads
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR assigned_to = auth.uid())
  WITH CHECK (
    (SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
    OR (assigned_to = auth.uid()
        AND public.can_access_whatsapp_number(whatsapp_number_id)
        AND public.can_access_instagram_account(ig_account_uuid))
  );

DROP POLICY IF EXISTS sdr_escopo_crm_leads_delete ON public.crm_leads;
CREATE POLICY sdr_escopo_crm_leads_delete ON public.crm_leads
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR assigned_to = auth.uid());

-- Lead criado pela SDR nasce dela (assigned_to NULL → auth.uid()); o WITH
-- CHECK acima é avaliado DEPOIS dos gatilhos BEFORE, então passa.
-- distribuido_em = agora: "leads de hoje" da aba Equipe conta este lead.
CREATE OR REPLACE FUNCTION public.sdr_carimba_dona()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.assigned_to IS NULL
     AND public.has_role(auth.uid(), 'sdr'::app_role) THEN
    NEW.assigned_to := auth.uid();
    NEW.distribuido_em := COALESCE(NEW.distribuido_em, now());
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_sdr_carimba_dona ON public.crm_leads;
CREATE TRIGGER trg_sdr_carimba_dona
  BEFORE INSERT ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.sdr_carimba_dona();

-- Trava contra "puxar"/"devolver" lead: transferência é do rodízio/servidor ou
-- do crc (e vai para o livro crm_lead_atribuicoes). A RLS já negaria (WITH
-- CHECK), o gatilho dá a mensagem clara.
CREATE OR REPLACE FUNCTION public.sdr_nao_transfere_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND auth.uid() IS NOT NULL
     AND public.has_role(auth.uid(), 'sdr'::app_role) THEN
    RAISE EXCEPTION 'SDR não transfere lead' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_sdr_nao_transfere_lead ON public.crm_leads;
CREATE TRIGGER trg_sdr_nao_transfere_lead
  BEFORE UPDATE OF assigned_to ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.sdr_nao_transfere_lead();

-- distribuido_em é "quando o rodízio (ou o gestor) entregou o lead à dona":
-- alimenta leads_hoje de equipe_listar e, na Fase 2, a régua do rodízio. A
-- SDR pode editar o próprio lead por UPDATE comum, então sem esta trava ela
-- inflaria a própria métrica reescrevendo leads antigos com distribuido_em =
-- now(). Só distribuido_em: conversa_fechada_em fica livre (o botão "Fechar
-- conversa" da Fase 2 é dela). Servidor/crc/gestor seguem livres.
CREATE OR REPLACE FUNCTION public.sdr_nao_altera_distribuicao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.distribuido_em IS DISTINCT FROM OLD.distribuido_em
     AND auth.uid() IS NOT NULL
     AND public.has_role(auth.uid(), 'sdr'::app_role) THEN
    RAISE EXCEPTION 'SDR não altera a data de distribuição do lead' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_sdr_nao_altera_distribuicao ON public.crm_leads;
CREATE TRIGGER trg_sdr_nao_altera_distribuicao
  BEFORE UPDATE OF distribuido_em ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.sdr_nao_altera_distribuicao();

-- 3.2 messages — por comando, como o closer. trg_enforce_message_tenant
-- obriga lead_id; o "lead_id IS NULL OR" fica só por simetria com o contrato.
DROP POLICY IF EXISTS sdr_escopo_messages_select ON public.messages;
CREATE POLICY sdr_escopo_messages_select ON public.messages
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR lead_id IS NULL OR public.sdr_pode_ver_lead(lead_id));

DROP POLICY IF EXISTS sdr_escopo_messages_insert ON public.messages;
CREATE POLICY sdr_escopo_messages_insert ON public.messages
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR lead_id IS NULL OR public.sdr_pode_ver_lead(lead_id));

DROP POLICY IF EXISTS sdr_escopo_messages_update ON public.messages;
CREATE POLICY sdr_escopo_messages_update ON public.messages
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR lead_id IS NULL OR public.sdr_pode_ver_lead(lead_id));

DROP POLICY IF EXISTS sdr_sem_delete_messages ON public.messages;
CREATE POLICY sdr_sem_delete_messages ON public.messages
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)));

-- 3.3 crm_appointments — agendamento segue o lead (contrato). O crédito
-- (responsavel_credito_id) NÃO abre leitura aqui: métricas da SDR virão por
-- RPC própria em fase posterior (ver perguntas no relatório).
DROP POLICY IF EXISTS sdr_escopo_crm_appointments ON public.crm_appointments;
CREATE POLICY sdr_escopo_crm_appointments ON public.crm_appointments
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR public.sdr_pode_ver_lead(lead_id))
  WITH CHECK ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR public.sdr_pode_ver_lead(lead_id));

-- 3.4 crm_tasks — tarefa segue o lead (auditoria de 08/09); a permissiva
-- "assigned_to = auth.uid()" deixaria a SDR ver tarefa de lead que já não é
-- dela — a restritiva fecha. Tarefa sem lead (lead_id é NOT NULL hoje; fica
-- por simetria com o closer) só se for dela.
DROP POLICY IF EXISTS sdr_escopo_crm_tasks ON public.crm_tasks;
CREATE POLICY sdr_escopo_crm_tasks ON public.crm_tasks
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
    OR (lead_id IS NULL AND assigned_to = auth.uid())
    OR public.sdr_pode_ver_lead(lead_id)
  )
  WITH CHECK (
    (SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
    OR (lead_id IS NULL AND assigned_to = auth.uid())
    OR public.sdr_pode_ver_lead(lead_id)
  );

-- 3.5 crm_notifications — sem lead: só as próprias (rodízio/ponto vão avisar
-- "você recebeu 5 leads", "pausa longa"); com lead: só de lead dela (aviso de
-- lead que saiu dela some sozinho; ela ainda pode notificar o crc sobre um
-- lead DELA). As permissivas já limitam SELECT/UPDATE/DELETE a user_id =
-- auth.uid().
DROP POLICY IF EXISTS sdr_escopo_crm_notifications ON public.crm_notifications;
CREATE POLICY sdr_escopo_crm_notifications ON public.crm_notifications
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
    OR (lead_id IS NULL AND user_id = auth.uid())
    OR public.sdr_pode_ver_lead(lead_id)
  )
  WITH CHECK (
    (SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
    OR (lead_id IS NULL AND user_id = auth.uid())
    OR public.sdr_pode_ver_lead(lead_id)
  );

-- 3.6 Tabelas filhas do lead — a MESMA lista em que o closer tem
-- closer_escopo_numero_<t> / <t>_closer_number_scope (ALL), no mesmo molde.
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'crm_conversation_notes','crm_lead_stage_history','crm_lead_label_assignments',
    'crm_lead_custom_values','crm_lead_pacientes','crm_lead_instagram_identities',
    'crm_followup_queue','crm_automation_executions','crm_broadcast_recipients',
    'ai_reply_suggestions','bot_executions'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'sdr_escopo: tabela % não existe, pulando', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS sdr_escopo_%1$s ON public.%1$I', t);
    EXECUTE format($p$
      CREATE POLICY sdr_escopo_%1$s ON public.%1$I
        AS RESTRICTIVE FOR ALL TO authenticated
        USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR public.sdr_pode_ver_lead(lead_id))
        WITH CHECK ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR public.sdr_pode_ver_lead(lead_id))$p$, t);
  END LOOP;
END $do$;

-- crm_automation_queue: só SELECT (escrita é do servidor), como crm_aq_closer_number_scope.
DROP POLICY IF EXISTS sdr_escopo_crm_automation_queue ON public.crm_automation_queue;
CREATE POLICY sdr_escopo_crm_automation_queue ON public.crm_automation_queue
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR public.sdr_pode_ver_lead(lead_id));

-- bot_execution_logs: não tem lead_id — pende de bot_executions. A única
-- permissiva (bot_execution_logs_tenant_select) só exige bot do tenant, então
-- a SDR leria o passo a passo (details jsonb: mensagens e respostas) de leads
-- de TODAS as donas. Closer e recepção têm a mesma brecha (não estão
-- restritos aqui) — fica registrado para a fase de isolamento deles.
DO $do$
BEGIN
  IF to_regclass('public.bot_execution_logs') IS NULL THEN
    RAISE NOTICE 'sdr_escopo: tabela bot_execution_logs não existe, pulando';
    RETURN;
  END IF;
  DROP POLICY IF EXISTS sdr_escopo_bot_execution_logs ON public.bot_execution_logs;
  CREATE POLICY sdr_escopo_bot_execution_logs ON public.bot_execution_logs
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
      (SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
      OR EXISTS (SELECT 1 FROM public.bot_executions e
                  WHERE e.id = bot_execution_logs.execution_id
                    AND public.sdr_pode_ver_lead(e.lead_id))
    )
    WITH CHECK (
      (SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
      OR EXISTS (SELECT 1 FROM public.bot_executions e
                  WHERE e.id = bot_execution_logs.execution_id
                    AND public.sdr_pode_ver_lead(e.lead_id))
    );
END $do$;

-- 3.7 Recursos compartilhados: a SDR vive no mundo do crc — vê itens do crc,
-- os "gerais" (owner_role NULL) e o que for compartilhado com 'sdr'; nunca os
-- do closer/recepção/pós-venda (molde closer_so_itens_do_perfil_*).
-- (crm_broadcasts não entra: bloqueio total em 3.8.)
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bots','crm_quick_replies','crm_whatsapp_templates'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS sdr_escopo_%1$s ON public.%1$I', t);
    EXECUTE format($p$
      CREATE POLICY sdr_escopo_%1$s ON public.%1$I
        AS RESTRICTIVE FOR SELECT TO authenticated
        USING (
          (SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
          OR owner_role IS NULL
          OR owner_role = 'crc'::app_role
          OR 'sdr'::app_role = ANY (COALESCE(shared_roles, '{}'::app_role[]))
        )$p$, t);
  END LOOP;
END $do$;

-- Bots: SÓ leitura para a SDR. Diferente do closer (que escreve no mundo
-- dele), aqui o mundo é o do crc: um bot roda em todos os leads do número —
-- não só nos dela. (Transmissões: bloqueio total em 3.8.)
DO $do$
DECLARE t text; c text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bots'] LOOP
    FOREACH c IN ARRAY ARRAY['insert','update','delete'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS sdr_sem_%1$s_%2$s ON public.%2$I', c, t);
      IF c = 'insert' THEN
        EXECUTE format($p$CREATE POLICY sdr_sem_%1$s_%2$s ON public.%2$I AS RESTRICTIVE FOR INSERT TO authenticated
          WITH CHECK ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)))$p$, c, t);
      ELSE
        EXECUTE format($p$CREATE POLICY sdr_sem_%1$s_%2$s ON public.%2$I AS RESTRICTIVE FOR %3$s TO authenticated
          USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)))$p$, c, t, upper(c));
      END IF;
    END LOOP;
  END LOOP;
END $do$;

-- Respostas rápidas e modelos: a SDR cria (o item nasce no mundo crc — ver
-- set_owner_role_from_user no bloco 5) e só edita/apaga o que ela criou; o
-- acervo do crc fica intocável (as permissivas "Staff can ..." /
-- tenant_edita_templates deixariam apagar). Exigir owner_role='crc' no INSERT
-- falha fechado se o gatilho de owner_role sumir (nunca vira item "geral").
DROP POLICY IF EXISTS sdr_escopo_crm_quick_replies_insert ON public.crm_quick_replies;
CREATE POLICY sdr_escopo_crm_quick_replies_insert ON public.crm_quick_replies
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR (owner_role = 'crc'::app_role AND created_by = auth.uid()));
DROP POLICY IF EXISTS sdr_escopo_crm_quick_replies_update ON public.crm_quick_replies;
CREATE POLICY sdr_escopo_crm_quick_replies_update ON public.crm_quick_replies
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR created_by = auth.uid())
  WITH CHECK ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR (owner_role = 'crc'::app_role AND created_by = auth.uid()));
DROP POLICY IF EXISTS sdr_escopo_crm_quick_replies_delete ON public.crm_quick_replies;
CREATE POLICY sdr_escopo_crm_quick_replies_delete ON public.crm_quick_replies
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR created_by = auth.uid());

DROP POLICY IF EXISTS sdr_escopo_crm_whatsapp_templates_insert ON public.crm_whatsapp_templates;
CREATE POLICY sdr_escopo_crm_whatsapp_templates_insert ON public.crm_whatsapp_templates
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR (owner_role = 'crc'::app_role AND created_by_user_id = auth.uid()));
DROP POLICY IF EXISTS sdr_escopo_crm_whatsapp_templates_update ON public.crm_whatsapp_templates;
CREATE POLICY sdr_escopo_crm_whatsapp_templates_update ON public.crm_whatsapp_templates
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR created_by_user_id = auth.uid())
  WITH CHECK ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR (owner_role = 'crc'::app_role AND created_by_user_id = auth.uid()));
DROP POLICY IF EXISTS sdr_escopo_crm_whatsapp_templates_delete ON public.crm_whatsapp_templates;
CREATE POLICY sdr_escopo_crm_whatsapp_templates_delete ON public.crm_whatsapp_templates
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)) OR created_by_user_id = auth.uid());

-- 3.8 Bloqueio total — as 28 tabelas em que closer E recepção têm
-- <papel>_sem_acesso_<t> (listas conferidas idênticas em produção):
-- pacientes, pagamentos, relatórios/planilhas, IA, integrações, telefonia,
-- Instagram, logs, faturamento da plataforma. Mais QUATRO que a interseção
-- closer∩recepção não cobria (ninguém as restringiu antes):
--   • crm_broadcasts — transmissão do crc alcança leads de outras donas; o
--     contrato não a compartilha (crm_broadcast_recipients já está presa ao
--     lead dela em 3.6, e o broadcast-engine recusa a SDR);
--   • rpt_baseline_anuncio — baseline_tenant é PERMISSIVE FOR ALL por tenant
--     (a SDR leria E editaria faturamento por período);
--   • crm_funnel_custom_reports — metas/totais do funil ("tenant members read");
--   • ad_account_map — amarra conta de anúncio → unidade (tenant_id,
--     ad_account_id, ad_id_suffix, page_id, cidade, clinica_id, ativo) e
--     sustenta a atribuição de origem/cidade/anúncio do lead e o faturamento
--     por criativo. A única permissiva é 'tenant_isolation' FOR ALL por tenant,
--     SEM guarda de papel: qualquer usuária do cliente hoje LÊ, INSERE, ALTERA
--     e APAGA as 11 linhas — uma linha desativada distorce o relatório inteiro.
--     Estava fora desta lista embora ad_id_mapping, ad_creative_grupo e
--     ad_creative_override já estivessem.
--   As três últimas são brecha também para closer/recepção (ad_account_map
--   inclusive: o bloqueio da SDR não estava herdado de ninguém) — registrado
--   para a fase de isolamento desses papéis.
--   Mais DUAS acrescentadas na revisão: closer_pacientes e closer_pagamentos.
--   Hoje a SDR não as alcança, mas por ACIDENTE DE CONFIGURAÇÃO, não por
--   guarda de papel: a única permissiva das duas é <t>_numero FOR ALL com
--   "whatsapp_number_id IS NOT NULL AND can_access_whatsapp_number(...)", e a
--   Rizodent está com 0 linhas is_default em whatsapp_numbers — a SDR não ganha
--   override de número nenhum (5.3) e a policy nunca casa. No dia em que a
--   clínica marcar um número como principal, o próprio
--   concede_numeros_ao_novo_usuario concede esse override à SDR e as duas
--   tabelas abririam: nome/telefone de paciente e valor de pagamento
--   carimbados com aquele número. Eram as únicas tabelas de paciente/pagamento
--   do schema sem cerco de papel para o sdr (pacientes e pagamentos já
--   estavam). Nada do mundo dela vive ali — o painel de paciente/orçamento nem
--   é montado para a SDR (CrmConversa.tsx).
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'access_logs','ad_account_map','ad_creative_grupo','ad_creative_override','ad_id_mapping',
    'ai_assistant_config','ai_assistant_rules','ai_conversation_analysis','ai_good_examples',
    'api4com_calls','api4com_config','api4com_extensions','clinicas',
    'ig_accounts','instagram_accounts','instagram_messages','leads_diarios',
    'pacientes','pagamentos','registros_diarios_atendimento','tenant_api_keys',
    'tenant_invoices','tenant_meta_credentials','tenant_subscriptions','tenant_usage',
    'tipos_procedimento','tratamentos','whatsapp_call_permissions','whatsapp_calls',
    'crm_broadcasts','rpt_baseline_anuncio','crm_funnel_custom_reports',
    'closer_pacientes','closer_pagamentos'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'sdr_sem_acesso: tabela % não existe, pulando', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS sdr_sem_acesso_%1$s ON public.%1$I', t);
    EXECUTE format($p$
      CREATE POLICY sdr_sem_acesso_%1$s ON public.%1$I
        AS RESTRICTIVE FOR ALL TO authenticated
        USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)))
        WITH CHECK ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)))$p$, t);
  END LOOP;
END $do$;

-- 3.9 funnel_channels — ESCRITA fechada para a SDR (leitura continua, que é o
-- que a tela do funil precisa). Não é bloqueio total como o 3.8 de propósito.
--
-- Por que precisa de policy própria: as permissivas tenant_cria_/tenant_edita_/
-- tenant_apaga_funnel_channels exigem apenas
--   (tenant_id = current_tenant_id() AND can_access_pipeline(pipeline_id))
-- e can_access_pipeline avalia PRIMEIRO o user_override — exatamente o que
-- sdr_prepara_novo_membro grava (granted=true) para todo funil geral, o Funil
-- Principal incluído. Nenhuma RESTRICTIVE além de tenant_isolation/
-- tenant_hard_isolation existe nessa tabela (conferido em produção 08/09/2026).
--
-- O que estava em jogo: funnel_channels é a linha que o whatsapp-webhook lê
-- para decidir em que funil cai um lead que chega (index.ts:324-327 e
-- 1308-1318), que _shared/mundoNumero.ts usa para mapear integration_key →
-- phone_number_id → whatsapp_numbers.id, e que send-whatsapp-message consulta
-- para resolver a credencial (index.ts:420). Apagar a linha do Funil Principal
-- (channel_type='whatsapp', config {integration_key}) ou repontá-la para a
-- integração do closer mudaria o roteamento dos leads novos da clínica inteira.
DROP POLICY IF EXISTS sdr_sem_insert_funnel_channels ON public.funnel_channels;
CREATE POLICY sdr_sem_insert_funnel_channels ON public.funnel_channels
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)));
DROP POLICY IF EXISTS sdr_sem_update_funnel_channels ON public.funnel_channels;
CREATE POLICY sdr_sem_update_funnel_channels ON public.funnel_channels
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)));
DROP POLICY IF EXISTS sdr_sem_delete_funnel_channels ON public.funnel_channels;
CREATE POLICY sdr_sem_delete_funnel_channels ON public.funnel_channels
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)));

-- ============================================================ 4. funções de busca (SECURITY DEFINER, fora da RLS)
-- 4.1 get_conversation_leads — a lista da tela Conversas. É o ponto mais
-- crítico da fase: sem a cláusula da dona, a SDR veria TODOS os leads dos
-- funis liberados. Cópia da versão de produção + v_dona.
CREATE OR REPLACE FUNCTION public.get_conversation_leads(p_tenant_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20000)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_super boolean; v_crc boolean; v_gerente boolean; v_posvenda boolean; v_priv boolean;
  v_escopo_numero boolean;
  v_dona boolean;
  v_pipes uuid[];
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_super := has_role(v_uid, 'superadmin'::app_role);
  v_tenant := current_tenant_id();
  IF v_super AND p_tenant_id IS NOT NULL THEN v_tenant := p_tenant_id; END IF;
  IF v_tenant IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_crc := has_role(v_uid, 'crc'::app_role);
  v_gerente := has_role(v_uid, 'gerente'::app_role);
  v_posvenda := has_role(v_uid, 'posvenda'::app_role);
  v_priv := v_super OR v_crc OR v_gerente;
  v_escopo_numero := has_role(v_uid, 'closer'::app_role) OR has_role(v_uid, 'recepcao'::app_role);
  -- SDR: só leads de que é dona (Fase 1 do rodízio).
  v_dona := has_role(v_uid, 'sdr'::app_role);

  SELECT COALESCE(array_agg(p.id), ARRAY[]::uuid[]) INTO v_pipes
  FROM crm_pipelines p
  WHERE p.tenant_id = v_tenant
    AND COALESCE(
      user_override(v_uid, 'pipeline', p.id::text),
      v_super OR (p.allowed_roles IS NULL AND (v_crc OR v_gerente))
      OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = v_uid AND ur.role = ANY(p.allowed_roles))
    )
    AND ( v_posvenda OR v_super OR NOT COALESCE(p.is_posvenda, false) );

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.last_message_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT l.id, l.name, l.phone, l.instagram_user_id, l.active_channel,
      l.instagram_username, l.instagram_profile_pic_url, l.last_message,
      l.last_message_at, l.last_inbound_at, l.last_outbound_at, l.tags, l.source,
      l.stage_id, l.pipeline_id, l.created_at, l.updated_at, l.assigned_to,
      l.paciente_id, l.cidade, l.servico_interesse, l.imagem_origem, l.titulo_anuncio,
      l.descricao_anuncio, l.link_anuncio, l.ad_id, l.nome_anuncio, l.ad_account_id,
      l.ad_account_name, l.is_blocked,
      l.whatsapp_number_id,
      wn.display_name AS whatsapp_number_name
    FROM crm_leads l
    LEFT JOIN whatsapp_numbers wn ON wn.id = l.whatsapp_number_id
    WHERE l.tenant_id = v_tenant
      AND l.is_blocked = false
      AND ( v_super OR l.pipeline_id = ANY(v_pipes) )
      AND (
        CASE WHEN v_escopo_numero
          THEN l.whatsapp_number_id IS NOT NULL AND can_access_whatsapp_number(l.whatsapp_number_id)
          ELSE can_access_whatsapp_number(l.whatsapp_number_id)
        END
      )
      AND ( v_priv OR can_access_instagram_account(l.ig_account_uuid) )
      AND ( NOT v_dona OR l.assigned_to = v_uid )
    ORDER BY l.last_message_at DESC NULLS LAST
    LIMIT p_limit
  ) t;

  RETURN v_result;
END;
$function$;

-- 4.2 get_lead_for_conversation — ramo sdr (o pipeline continua exigido:
-- vem do override).
CREATE OR REPLACE FUNCTION public.get_lead_for_conversation(_lead_id uuid)
 RETURNS SETOF crm_leads
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.*
  FROM public.crm_leads l
  WHERE l.id = _lead_id
    AND l.tenant_id = public.current_tenant_id()
    AND public.can_access_whatsapp_number(l.whatsapp_number_id)
    AND public.can_access_pipeline(l.pipeline_id)
    AND (
      public.has_role(auth.uid(), 'crc'::app_role)
      OR public.has_role(auth.uid(), 'gerente'::app_role)
      OR public.has_role(auth.uid(), 'superadmin'::app_role)
      OR public.has_role(auth.uid(), 'posvenda'::app_role)
      OR (public.has_role(auth.uid(), 'sdr'::app_role) AND public.sdr_pode_ver_lead(l.id))
    );
$function$;

-- 4.3 get_leads_for_calendar — ramo sdr no molde do closer/recepção.
CREATE OR REPLACE FUNCTION public.get_leads_for_calendar(_lead_ids uuid[])
 RETURNS TABLE(id uuid, name text, cidade text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.id, l.name, l.cidade
  FROM public.crm_leads l
  WHERE l.id = ANY(_lead_ids)
    AND l.tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'superadmin'::app_role)
      OR public.has_role(auth.uid(), 'gerente'::app_role)
      OR ((public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'posvenda'::app_role))
          AND public.can_access_pipeline(l.pipeline_id)
          AND public.can_access_whatsapp_number(l.whatsapp_number_id))
      OR (public.has_role(auth.uid(), 'closer'::app_role) AND public.closer_pode_ver_lead(l.id))
      OR (public.has_role(auth.uid(), 'recepcao'::app_role) AND public.recepcao_pode_ver_lead(l.id))
      OR (public.has_role(auth.uid(), 'sdr'::app_role) AND public.sdr_pode_ver_lead(l.id))
    );
$function$;

-- 4.4 transfer_lead_to_whatsapp — a SDR só transfere lead dela e a mescla de
-- duplicado (que move mensagens/tarefas para o lead dela e bloqueia o outro,
-- com SECURITY DEFINER — a RLS e trg_sdr_nao_transfere_lead não atuam porque
-- assigned_to não muda) exige dup.assigned_to = auth.uid(): duplicado de OUTRA
-- dona e duplicado SEM dona (assigned_to NULL) ficam de fora. Sem essa
-- exigência a SDR puxaria para si as mensagens e tarefas de um lead que não é
-- dela (lead antigo, do funil Pós-venda ou aguardando o rodízio) e ainda o
-- deixaria marcado como bloqueado — some da tela de quem o tinha.
-- Quando existe duplicado no mesmo mundo mas ele não é dela, a função devolve
-- {"error":"duplicado_de_outra_dona"} e NÃO converte o lead às escondidas: o
-- front avisa e o crc resolve a duplicidade. Demais papéis: comportamento
-- idêntico ao de produção (v_sdr = false anula as duas cláusulas).
CREATE OR REPLACE FUNCTION public.transfer_lead_to_whatsapp(p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead    record;
  v_phone   text;
  v_dup_id  uuid;
  v_caller_tenant uuid;
  v_sdr     boolean := public.has_role(auth.uid(), 'sdr'::app_role);
BEGIN
  SELECT id, tenant_id, phone, whatsapp_number_id INTO v_lead FROM public.crm_leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN
    RETURN jsonb_build_object('error', 'lead_not_found');
  END IF;

  IF NOT public.can_access_whatsapp_number(v_lead.whatsapp_number_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT tenant_id INTO v_caller_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_caller_tenant IS NULL OR v_caller_tenant <> v_lead.tenant_id THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  IF NOT (public.closer_pode_ver_lead(p_lead_id) AND public.recepcao_pode_ver_lead(p_lead_id)) THEN
    RETURN jsonb_build_object('error', 'forbidden_number_scope');
  END IF;

  IF v_sdr AND NOT public.sdr_pode_ver_lead(p_lead_id) THEN
    RETURN jsonb_build_object('error', 'forbidden_number_scope');
  END IF;

  v_phone := regexp_replace(COALESCE(v_lead.phone, ''), '\D', '', 'g');
  IF v_phone = '' THEN
    RETURN jsonb_build_object('error', 'no_phone');
  END IF;

  -- Cada número é um mundo: só mescla duplicado do MESMO mundo
  -- (NULL = mundo legado / número principal).
  SELECT dup.id INTO v_dup_id
  FROM public.crm_leads dup
  WHERE dup.tenant_id = v_lead.tenant_id
    AND dup.id <> p_lead_id
    AND COALESCE(dup.is_blocked, false) = false
    AND regexp_replace(COALESCE(dup.phone, ''), '\D', '', 'g') = v_phone
    AND COALESCE(dup.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(v_lead.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND (NOT v_sdr OR dup.assigned_to = auth.uid())
  ORDER BY dup.created_at ASC
  LIMIT 1;

  -- Achado nenhum duplicado DELA: se existe um duplicado no mesmo mundo que
  -- pertence a outra dona (ou está sem dona), a SDR não mescla e também não
  -- converte o lead em silêncio — devolve erro claro para o front pedir ao crc.
  IF v_sdr AND v_dup_id IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.crm_leads dup
      WHERE dup.tenant_id = v_lead.tenant_id
        AND dup.id <> p_lead_id
        AND COALESCE(dup.is_blocked, false) = false
        AND regexp_replace(COALESCE(dup.phone, ''), '\D', '', 'g') = v_phone
        AND COALESCE(dup.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = COALESCE(v_lead.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) THEN
      RETURN jsonb_build_object('error', 'duplicado_de_outra_dona');
    END IF;
  END IF;

  IF v_dup_id IS NOT NULL THEN
    UPDATE public.messages   SET lead_id = p_lead_id WHERE lead_id = v_dup_id;
    UPDATE public.crm_tasks  SET lead_id = p_lead_id WHERE lead_id = v_dup_id;
    UPDATE public.crm_leads
       SET is_blocked = true, blocked_at = now(), updated_at = now()
     WHERE id = v_dup_id;
  END IF;

  UPDATE public.crm_leads
     SET active_channel = 'whatsapp', updated_at = now()
   WHERE id = p_lead_id;

  RETURN jsonb_build_object('ok', true, 'merged', v_dup_id IS NOT NULL, 'merged_lead_id', v_dup_id);
END;
$function$;

-- 4.5 Storage: mídia do chat e gravações só de lead dela (policies do bucket
-- chamam estas funções; a guarda NOT has_role(sdr) mantém os demais iguais).
CREATE OR REPLACE FUNCTION public.chat_media_belongs_to_current_tenant(_object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR (
      auth.uid() IS NOT NULL
      AND public.current_tenant_id() IS NOT NULL
      AND _object_name LIKE (public.current_tenant_id()::text || '/' || auth.uid()::text || '/%')
    )
    OR EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.tenant_id = public.current_tenant_id()
        AND m.media_url IS NOT NULL
        AND (
          split_part(m.media_url, '?', 1) = _object_name
          OR right(split_part(m.media_url, '?', 1), length('/chat-media/' || _object_name)) = '/chat-media/' || _object_name
        )
        AND public.can_access_whatsapp_number(m.whatsapp_number_id)
        AND public.closer_pode_ver_lead(m.lead_id)
        AND public.recepcao_pode_ver_lead(m.lead_id)
        AND (NOT public.has_role(auth.uid(), 'sdr'::public.app_role) OR public.sdr_pode_ver_lead(m.lead_id))
    );
$function$;

CREATE OR REPLACE FUNCTION public.call_recording_belongs_to_current_tenant(_object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH parsed AS (
    SELECT substring(_object_name from '/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[0-9]+(?:-(?:agent|lead))?\.webm$')::uuid AS call_id
  )
  SELECT
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR EXISTS (
      SELECT 1
      FROM public.whatsapp_calls c
      LEFT JOIN parsed p ON true
      WHERE c.tenant_id = public.current_tenant_id()
        AND (
          c.id = p.call_id
          OR split_part(c.recording_url, '?', 1) = _object_name
          OR split_part(c.recording_url_agent, '?', 1) = _object_name
          OR split_part(c.recording_url_lead, '?', 1) = _object_name
          OR right(split_part(c.recording_url, '?', 1), length('/call-recordings/' || _object_name)) = '/call-recordings/' || _object_name
          OR right(split_part(c.recording_url_agent, '?', 1), length('/call-recordings/' || _object_name)) = '/call-recordings/' || _object_name
          OR right(split_part(c.recording_url_lead, '?', 1), length('/call-recordings/' || _object_name)) = '/call-recordings/' || _object_name
        )
        AND public.can_access_whatsapp_number(c.whatsapp_number_id)
        AND public.closer_pode_ver_lead(c.lead_id)
        AND public.recepcao_pode_ver_lead(c.lead_id)
        AND (NOT public.has_role(auth.uid(), 'sdr'::public.app_role) OR public.sdr_pode_ver_lead(c.lead_id))
    );
$function$;

-- 4.6 rpt_resolve_tenant — relatórios não fazem parte do perfil da SDR
-- (mesma lista da recepção).
CREATE OR REPLACE FUNCTION public.rpt_resolve_tenant()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant     uuid;
  v_jwt_role   text;
  v_guc_tenant text;
  v_ativos     int;
BEGIN
  IF auth.uid() IS NOT NULL AND (
       public.has_role(auth.uid(), 'recepcao'::app_role)
       OR public.has_role(auth.uid(), 'closer'::app_role)
       OR public.has_role(auth.uid(), 'sdr'::app_role)
     ) THEN
    RAISE EXCEPTION 'Acesso negado: relatórios não fazem parte deste perfil'
      USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = auth.uid();
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION 'Usuário sem tenant associado';
    END IF;
    RETURN v_tenant;
  END IF;

  v_jwt_role := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  IF v_jwt_role = 'service_role'
     OR session_user IN ('postgres', 'supabase_admin', 'supabase_read_only_user') THEN

    v_guc_tenant := NULLIF(current_setting('app.tenant_id', true), '');
    IF v_guc_tenant IS NOT NULL THEN
      RETURN v_guc_tenant::uuid;
    END IF;

    SELECT count(*) INTO v_ativos FROM public.tenants t WHERE t.status = 'active';
    IF v_ativos = 1 THEN
      SELECT t.id INTO v_tenant FROM public.tenants t WHERE t.status = 'active';
      RETURN v_tenant;
    END IF;

    RAISE EXCEPTION 'Há % tenants ativos; defina o tenant com SET app.tenant_id = ''<uuid>''', v_ativos;
  END IF;

  RAISE EXCEPTION 'Não autenticado';
END;
$function$;

-- 4.7 admin_api_unread_leads_base(_tenant) — porta PRÉ-EXISTENTE: SECURITY
-- DEFINER, sem checagem de papel/tenant, devolve id/nome/telefone/assigned_to
-- de todos os leads com inbound não respondido do tenant PASSADO POR PARÂMETRO.
-- Só o admin-api (service role) a usa; 20260801160000 já a listava como
-- "service_only", mas em produção `authenticated` ainda tem EXECUTE (conferido
-- 08/09/2026). Qualquer usuária logada — a SDR inclusive — listaria leads de
-- outras donas e de outros clientes por POST /rest/v1/rpc/… . Fecha aqui.
DO $do$
BEGIN
  IF to_regprocedure('public.admin_api_unread_leads_base(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.admin_api_unread_leads_base(uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.admin_api_unread_leads_base(uuid) TO service_role;
  END IF;
END $do$;

-- 4.8 check_duplicate_phone — chamada pelo Kanban ao criar lead. SECURITY
-- DEFINER sem ramo sdr: devolvia nome/dona/funil/etapa de lead de OUTRA dona
-- só com o telefone. Para a SDR, lead que não é dela volta MASCARADO (só
-- lead_id; nome, dona, funil e etapa NULL): o front diz "telefone já
-- cadastrado" sem expor a dona e sem deixar criar duplicado. Demais papéis:
-- idêntico ao que está em produção. As duas assinaturas.
CREATE OR REPLACE FUNCTION public.check_duplicate_phone(p_phone text)
 RETURNS TABLE(lead_id uuid, lead_name text, assigned_to uuid, pipeline_name text, stage_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.id,
         CASE WHEN m.oculta THEN NULL ELSE l.name END,
         CASE WHEN m.oculta THEN NULL ELSE l.assigned_to END,
         CASE WHEN m.oculta THEN NULL ELSE p.name END,
         CASE WHEN m.oculta THEN NULL ELSE s.name END
  FROM public.crm_leads l
  CROSS JOIN LATERAL (
    SELECT public.has_role(auth.uid(), 'sdr'::public.app_role)
           AND l.assigned_to IS DISTINCT FROM auth.uid() AS oculta
  ) m
  LEFT JOIN public.crm_pipelines p ON p.id = l.pipeline_id
  LEFT JOIN public.crm_stages s ON s.id = l.stage_id
  WHERE l.phone = p_phone
    AND public.can_access_whatsapp_number(l.whatsapp_number_id)
    AND (
      l.tenant_id = public.current_tenant_id()
      OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
    )
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.check_duplicate_phone(p_phone text, _whatsapp_number_id uuid DEFAULT NULL)
 RETURNS TABLE(lead_id uuid, lead_name text, assigned_to uuid, pipeline_name text, stage_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.id,
         CASE WHEN m.oculta THEN NULL ELSE l.name END,
         CASE WHEN m.oculta THEN NULL ELSE l.assigned_to END,
         CASE WHEN m.oculta THEN NULL ELSE p.name END,
         CASE WHEN m.oculta THEN NULL ELSE s.name END
  FROM public.crm_leads l
  CROSS JOIN LATERAL (
    SELECT public.has_role(auth.uid(), 'sdr'::public.app_role)
           AND l.assigned_to IS DISTINCT FROM auth.uid() AS oculta
  ) m
  LEFT JOIN public.crm_pipelines p ON p.id = l.pipeline_id
  LEFT JOIN public.crm_stages s ON s.id = l.stage_id
  WHERE l.phone = p_phone
    AND COALESCE(l.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(_whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND public.can_access_whatsapp_number(l.whatsapp_number_id)
    AND (
      l.tenant_id = public.current_tenant_id()
      OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
    )
  LIMIT 1;
$function$;

-- A assinatura de 2 argumentos estava executável por PUBLIC/anon em produção
-- (a de 1 argumento não). Nenhuma tela chama sem login; fecha igual à outra.
REVOKE ALL ON FUNCTION public.check_duplicate_phone(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_duplicate_phone(text, uuid) TO authenticated, service_role;

-- 4.9 (VAGO) — aqui existia clinicas_agendamento_do_tenant, criada para o
-- cartão de agendamento (resolveAppointmentTemplate) conseguir o modelo de
-- confirmação sem abrir a tabela `clinicas` para a SDR. Foi RETIRADA na revisão
-- da Fase 1 por ser inalcançável: o único consumidor de resolveAppointmentTemplate
-- é o ScheduleSuggestionCard, e esse cartão só é montado dentro do
-- AiSuggestionStrip — que esta mesma fase esconde para a SDR (IA fora do perfil
-- dela). A barra que ela realmente usa para agendar, AppointmentConfirmBar, não
-- resolve nem envia modelo nenhum, para papel algum.
-- Ou seja: a RPC não resolvia o problema que dizia resolver, e ficaria como
-- objeto novo em produção sem um chamador. Dar o modelo de confirmação à SDR é
-- trabalho de PRODUTO (levar a resolução do modelo para o AppointmentConfirmBar,
-- que hoje não a tem para ninguém) — quando isso for feito, esta RPC volta.

-- 4.10 get_lead_stage_history_names — a linha do tempo de etapas do lead
-- (LeadStageTimeline). SECURITY DEFINER e, em produção, a ÚNICA guarda é
-- "o lead é do tenant atual": com um id de lead na mão (check_duplicate_phone
-- devolve o id de lead de outra dona), a SDR leria por onde aquele lead passou
-- no funil. Corpo copiado de produção; a única mudança é a última cláusula
-- (ramo sdr). Exceção consciente à regra "só substituir função que já enumera
-- papéis": está autorizada na revisão desta fase, e para todo papel que não
-- seja sdr o resultado é bit a bit o mesmo (NOT has_role(sdr) = TRUE).
CREATE OR REPLACE FUNCTION public.get_lead_stage_history_names(_lead_id uuid)
 RETURNS TABLE(id uuid, name text, color text, pipeline_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT s.id, s.name, s.color, s.pipeline_id
  FROM crm_stages s
  WHERE s.id IN (
    SELECT h.stage_id FROM crm_lead_stage_history h WHERE h.lead_id = _lead_id
    UNION
    SELECT h.from_stage_id FROM crm_lead_stage_history h WHERE h.lead_id = _lead_id AND h.from_stage_id IS NOT NULL
  )
  AND EXISTS (
    SELECT 1 FROM crm_leads l
    WHERE l.id = _lead_id AND l.tenant_id = current_tenant_id()
  )
  AND (
    NOT public.has_role(auth.uid(), 'sdr'::public.app_role)
    OR public.sdr_pode_ver_lead(_lead_id)
  );
$function$;

-- 4.11 match_good_examples — mesma classe de porta do 4.7. SECURITY DEFINER,
-- EXECUTE para authenticated (conferido em produção 08/09/2026), SEM checagem
-- de papel e SEM checagem de tenant: `filter_tenant` é um parâmetro OPCIONAL
-- que quem chama escolhe. Devolve `context` e `ideal_reply` de ai_good_examples
-- — trechos reais de conversa de lead. Pôr ai_good_examples no bloqueio total
-- (3.8) e barrar record-good-example NÃO fecha isso: a RPC contorna a RLS, e a
-- SDR leria os exemplos com um vetor de 1536 zeros — com filter_tenant NULL, os
-- de OUTROS clientes também.
-- Único chamador: supabase/functions/generate-reply-suggestion/index.ts:562,
-- com o cliente criado na linha 223 (SERVICE_KEY). Nenhuma tela do front chama
-- (grep em src só acha a assinatura em types.ts) — o REVOKE não quebra nada.
-- Tipo `vector` qualificado (public.vector, conferido em produção): o
-- search_path do runner de migration não é garantido, e sem a qualificação o
-- to_regprocedure poderia não resolver a assinatura e pular o REVOKE em
-- silêncio.
DO $do$
BEGIN
  IF to_regprocedure('public.match_good_examples(public.vector, integer, uuid, text, text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.match_good_examples(public.vector, integer, uuid, text, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.match_good_examples(public.vector, integer, uuid, text, text) TO service_role;
  END IF;
END $do$;

-- 4.12 crm_usage_metrics / crm_template_usage_counts — as duas RPCs de métrica
-- que escapavam da regra do 4.6 ("relatórios não fazem parte deste perfil").
-- Ambas são SECURITY DEFINER com EXECUTE para authenticated e sem guarda de
-- papel (conferido em produção 08/09/2026): a primeira devolve, do cliente
-- inteiro, execuções por bot, uso de IA, automações por tipo e transmissões com
-- sent_count; a segunda agrega public.messages de todo o tenant por nome de
-- modelo. A SDR chegava às duas por POST /rest/v1/rpc/… mesmo com
-- rpt_resolve_tenant recusando o papel dela — e a tela que consome a primeira
-- (CrmMetricas) nem está na allowlist de rotas dela.
-- Corpo copiado de produção (pg_get_functiondef); a ÚNICA mudança é a cláusula
-- do papel sdr. Mesma exceção consciente à regra "só substituir função que já
-- enumera papéis" já autorizada em 4.10 para get_lead_stage_history_names.
CREATE OR REPLACE FUNCTION public.crm_usage_metrics(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_from timestamptz := p_from::timestamp AT TIME ZONE 'America/Bahia';
  v_to   timestamptz := (p_to + 1)::timestamp AT TIME ZONE 'America/Bahia';
  v_span_days int := (p_to - p_from) + 1;
  v_trunc text := CASE WHEN v_span_days <= 92 THEN 'day' ELSE 'month' END;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'sdr'::app_role) THEN
    RAISE EXCEPTION 'Acesso negado: relatórios não fazem parte deste perfil'
      USING ERRCODE = '42501';
  END IF;

  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('error','no_tenant');
  END IF;

  WITH
  bot_data AS (
    SELECT b.name AS bot_name,
           date_trunc(v_trunc, be.started_at AT TIME ZONE 'America/Bahia') AS mes,
           count(*) AS total,
           count(*) FILTER (WHERE be.status='completed') AS concluidos
    FROM public.bot_executions be
    JOIN public.bots b ON b.id = be.bot_id
    WHERE be.started_at >= v_from AND be.started_at < v_to
      AND b.tenant_id = v_tenant
    GROUP BY 1,2
    ORDER BY 2,1
  ),
  ia_analysis AS (
    SELECT date_trunc(v_trunc, a.created_at AT TIME ZONE 'America/Bahia') AS mes,
           'analyze'::text AS mode,
           count(*) AS total,
           count(DISTINCT a.lead_id) AS leads
    FROM public.ai_conversation_analysis a
    JOIN public.crm_leads l ON l.id = a.lead_id
    WHERE a.created_at >= v_from AND a.created_at < v_to
      AND l.tenant_id = v_tenant
    GROUP BY 1
  ),
  ia_suggestions AS (
    SELECT date_trunc(v_trunc, s.created_at AT TIME ZONE 'America/Bahia') AS mes,
           COALESCE(s.status, 'suggested') AS mode,
           count(*) AS total,
           count(DISTINCT s.lead_id) AS leads
    FROM public.ai_reply_suggestions s
    JOIN public.crm_leads l ON l.id = s.lead_id
    WHERE s.created_at >= v_from AND s.created_at < v_to
      AND l.tenant_id = v_tenant
    GROUP BY 1,2
  ),
  ia_transcriptions AS (
    SELECT date_trunc(v_trunc, m.created_at AT TIME ZONE 'America/Bahia') AS mes,
           'transcribe'::text AS mode,
           count(*) AS total,
           count(DISTINCT m.lead_id) AS leads
    FROM public.messages m
    WHERE m.created_at >= v_from AND m.created_at < v_to
      AND m.tenant_id = v_tenant
      AND m.transcription IS NOT NULL
      AND length(m.transcription) > 0
    GROUP BY 1
  ),
  ia_good AS (
    SELECT date_trunc(v_trunc, g.created_at AT TIME ZONE 'America/Bahia') AS mes,
           'good_example'::text AS mode,
           count(*) AS total,
           count(DISTINCT g.lead_id) AS leads
    FROM public.ai_good_examples g
    WHERE g.created_at >= v_from AND g.created_at < v_to
      AND g.tenant_id = v_tenant
    GROUP BY 1
  ),
  ia_data AS (
    SELECT * FROM ia_analysis
    UNION ALL SELECT * FROM ia_suggestions
    UNION ALL SELECT * FROM ia_transcriptions
    UNION ALL SELECT * FROM ia_good
  ),
  auto_data AS (
    SELECT date_trunc(v_trunc, q.created_at AT TIME ZONE 'America/Bahia') AS mes,
           q.action_type,
           count(*) FILTER (WHERE q.status='sent') AS enviados,
           count(*) AS total
    FROM public.crm_automation_queue q
    JOIN public.crm_leads l ON l.id = q.lead_id
    WHERE q.created_at >= v_from AND q.created_at < v_to
      AND l.tenant_id = v_tenant
    GROUP BY 1,2
    ORDER BY 1,2
  ),
  bc_data AS (
    SELECT date_trunc(v_trunc, created_at AT TIME ZONE 'America/Bahia') AS mes,
           count(*) AS campanhas,
           coalesce(sum(sent_count),0) AS enviados
    FROM public.crm_broadcasts
    WHERE created_at >= v_from AND created_at < v_to
      AND tenant_id = v_tenant
    GROUP BY 1
    ORDER BY 1
  )
  SELECT jsonb_build_object(
    'respostas_por_bot', coalesce((SELECT jsonb_agg(to_jsonb(bot_data) ORDER BY mes) FROM bot_data), '[]'::jsonb),
    'uso_ia',            coalesce((SELECT jsonb_agg(to_jsonb(ia_data) ORDER BY mes) FROM ia_data),  '[]'::jsonb),
    'automacoes',        coalesce((SELECT jsonb_agg(to_jsonb(auto_data) ORDER BY mes) FROM auto_data),'[]'::jsonb),
    'broadcasts',        coalesce((SELECT jsonb_agg(to_jsonb(bc_data) ORDER BY mes) FROM bc_data),  '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_template_usage_counts(_tenant_id uuid)
 RETURNS TABLE(template_name text, usage_count bigint, last_used_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT trim(substring(content from '^📋 Template:\s*(.+)$')) AS template_name,
         count(*)::bigint AS usage_count, max(created_at) AS last_used_at
  FROM public.messages
  WHERE tenant_id = CASE WHEN public.has_role(auth.uid(), 'superadmin'::app_role) THEN _tenant_id ELSE public.current_tenant_id() END
    AND direction = 'outbound' AND content LIKE '📋 Template:%' AND deleted_at IS NULL
    AND NOT public.has_role(auth.uid(), 'sdr'::public.app_role)
  GROUP BY 1
  HAVING trim(substring(content from '^📋 Template:\s*(.+)$')) IS NOT NULL
$function$;

-- 4.13 posvenda_padrao_do_tenant — o destinatário do botão "Enviar para
-- Pós-venda" (SendToPosvendaButton). O componente descobria quem é a pós-venda
-- com um SELECT direto em user_roles, e as ÚNICAS policies de SELECT dessa
-- tabela em produção são "Users can view own roles" (auth.uid() = user_id) e
-- "Tenant admins view roles in tenant" (só crc/gerente): a SDR enxerga apenas a
-- própria linha, a consulta volta vazia e o botão nem chega a renderizar
-- (`if (!posvendaUser) return null`). Sem isto, a exceção construída no
-- transfer-lead ("pode encaminhar para posvenda") é inalcançável e o ÚNICO
-- caminho de saída do lead da SDR não existe na tela.
-- Molde de closer_clinicas_do_tenant: SECURITY
-- DEFINER, só o tenant atual, só nome e id — sem abrir user_roles para ninguém.
-- SÓ PARA A SDR (has_role(sdr) no WHERE): closer e recepção também voltam vazio
-- do SELECT em user_roles e HOJE não veem o botão "Enviar para Pós-venda". Sem
-- esta cláusula a RPC (SECURITY DEFINER, EXECUTE para authenticated) faria o
-- botão aparecer para eles — papel existente passando a poder MAIS, o que esta
-- fase proíbe — e ainda entregaria por REST quem é a pós-venda do cliente, que
-- a RLS de user_roles esconde deles. crc, gerente e a própria pós-venda
-- resolvem o destinatário pela consulta direta e nunca chegam aqui.
CREATE OR REPLACE FUNCTION public.posvenda_padrao_do_tenant()
RETURNS TABLE(id uuid, nome text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT p.id, p.nome
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'posvenda'::app_role
   WHERE auth.uid() IS NOT NULL
     AND public.has_role(auth.uid(), 'sdr'::public.app_role)
     AND p.tenant_id IS NOT NULL
     AND p.tenant_id = public.current_tenant_id()
     AND NOT COALESCE(p.is_blocked, false)
   ORDER BY p.nome
   LIMIT 5;
$fn$;
REVOKE ALL ON FUNCTION public.posvenda_padrao_do_tenant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.posvenda_padrao_do_tenant() TO authenticated, service_role;

-- 4.14 duas portas SECURITY DEFINER que contornavam o bloqueio total do 3.8
-- (mesma classe de 4.7 e 4.11): integracoes_visiveis entrega à SDR o que a
-- tabela `integrations` nega a ela (inclusive a conexão do número do closer) e
-- closer_clinicas_do_tenant devolve `clinicas`, que está na lista bloqueada.
-- Corpo copiado de produção, com uma única cláusula a mais; nenhuma tela que a
-- SDR alcança usa as duas, então ela não perde nada que tivesse.
CREATE OR REPLACE FUNCTION public.integracoes_visiveis()
 RETURNS TABLE(id uuid, key text, status text, display_name text, phone_number_id text, waba_id text, criado_em timestamp with time zone)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT i.id, i.key, i.status,
         COALESCE(i.config->>'display_name', i.key) AS display_name,
         i.config->>'phone_number_id' AS phone_number_id,
         i.config->>'waba_id' AS waba_id,
         i.created_at
    FROM public.integrations i
   WHERE i.tenant_id = public.current_tenant_id()
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'sdr'::public.app_role)
   ORDER BY i.created_at;
$function$;

CREATE OR REPLACE FUNCTION public.closer_clinicas_do_tenant()
 RETURNS TABLE(id uuid, nome text, cidade text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT c.id, c.nome, c.cidade
  FROM public.clinicas c
  WHERE c.tenant_id = public.current_tenant_id()
    AND c.ativa
    AND auth.uid() IS NOT NULL
    AND NOT public.has_role(auth.uid(), 'sdr'::public.app_role)
  ORDER BY c.nome;
$function$;

-- ============================================================ 5. helpers de usuário
-- 5.1 set_owner_role_from_user — item criado pela SDR nasce no mundo do crc
-- (owner_role='crc'): agendamento/tarefa/resposta/modelo dela aparecem para o
-- crc como hoje; entre SDRs quem separa é a restritiva por dona (as
-- permissivas "visible by role" passam por owner_role, então as duas camadas
-- são necessárias).
CREATE OR REPLACE FUNCTION public.set_owner_role_from_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role public.app_role;
BEGIN
  IF NEW.owner_role IS NULL AND auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role
      FROM public.user_roles
     WHERE user_id = auth.uid()
     ORDER BY CASE role
       WHEN 'crc'        THEN 1
       WHEN 'posvenda'   THEN 2
       WHEN 'recepcao'   THEN 2
       WHEN 'closer'     THEN 2
       WHEN 'sdr'        THEN 2
       WHEN 'gerente'    THEN 3
       WHEN 'superadmin' THEN 99
       WHEN 'crc_legacy' THEN 99
       ELSE 99
     END
     LIMIT 1;
    IF v_role = 'sdr' THEN
      NEW.owner_role := 'crc';
    ELSIF v_role IN ('crc', 'posvenda', 'gerente', 'recepcao', 'closer') THEN
      NEW.owner_role := v_role;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 5.2 tenant_set_user_role — aceita 'sdr' (continua só-superadmin).
CREATE OR REPLACE FUNCTION public.tenant_set_user_role(_user_id uuid, _role app_role)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'superadmin'::app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'nao_pode_alterar_o_proprio_papel' USING ERRCODE = '42501';
  END IF;
  IF public.has_role(_user_id, 'superadmin'::app_role) THEN
    RAISE EXCEPTION 'nao_pode_alterar_papel_de_superadmin' USING ERRCODE = '42501';
  END IF;
  IF _role NOT IN ('crc'::app_role, 'gerente'::app_role, 'posvenda'::app_role,
                   'recepcao'::app_role, 'closer'::app_role, 'sdr'::app_role) THEN
    RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = _user_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'usuario_sem_cliente' USING ERRCODE = '42501';
  END IF;
  -- Retorno antecipado SÓ para 'sdr'. Reaplicar o mesmo papel sdr não pode
  -- refazer o DELETE+INSERT: o DELETE desligaria a usuária do rodízio e o
  -- INSERT rodaria de novo os gatilhos de entrada. Para TODOS os outros papéis
  -- fica o comportamento de produção (DELETE+INSERT sempre), inclusive o efeito
  -- colateral de que reaplicar o papel recompõe os overrides de número
  -- revogados (concede_numeros_ao_novo_usuario) — hoje é assim que o superadmin
  -- devolve um número a um crc, e esta fase não pode tirar poder de papel algum.
  IF _role = 'sdr'::app_role
     AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.tenant_id = v_tenant AND ur.role = 'sdr'::app_role)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.tenant_id = v_tenant AND ur.role <> 'sdr'::app_role) THEN
    RETURN;
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id AND tenant_id = v_tenant;
  INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES (_user_id, _role, v_tenant);
END $function$;

-- 5.3 concede_numeros_ao_novo_usuario — a SDR recebe SÓ o número principal.
-- Critério (leitor 'banco'): o "número principal" da Rizodent NÃO tem linha em
-- whatsapp_numbers — é o mundo legado (whatsapp_number_id NULL), que
-- can_access_whatsapp_number(NULL) libera para qualquer autenticado, sem
-- override. Quando a clínica tiver o principal cadastrado, ele é a linha
-- is_default=true: essa (e só essa) é concedida — nunca um número que
-- pertença a closer/recepção. Na Rizodent hoje: nenhuma linha (default=0) →
-- a SDR não ganha override algum, e é isso que a deixa no mundo principal.
CREATE OR REPLACE FUNCTION public.concede_numeros_ao_novo_usuario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid;
BEGIN
  IF NEW.role IN ('closer'::app_role, 'recepcao'::app_role) THEN RETURN NEW; END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = NEW.user_id;
  IF v_tenant IS NULL THEN RETURN NEW; END IF;
  IF NEW.role = 'sdr'::app_role THEN
    INSERT INTO public.user_permission_overrides (user_id, scope, resource_id, granted, created_by)
    SELECT NEW.user_id, 'whatsapp_number', w.id::text, true, auth.uid()
    FROM public.whatsapp_numbers w
    WHERE w.tenant_id = v_tenant AND w.is_active AND w.is_default
      AND NOT EXISTS (
        SELECT 1 FROM public.user_permission_overrides o
        JOIN public.user_roles ur ON ur.user_id = o.user_id
        WHERE o.scope='whatsapp_number' AND o.resource_id = w.id::text AND o.granted
          AND ur.role IN ('closer'::app_role, 'recepcao'::app_role)
      )
    ON CONFLICT (user_id, scope, resource_id) DO UPDATE SET granted = true;
    RETURN NEW;
  END IF;
  INSERT INTO public.user_permission_overrides (user_id, scope, resource_id, granted, created_by)
  SELECT NEW.user_id, 'whatsapp_number', w.id::text, true, auth.uid()
  FROM public.whatsapp_numbers w
  WHERE w.tenant_id = v_tenant AND w.is_active
    AND NOT EXISTS (
      SELECT 1 FROM public.user_permission_overrides o
      JOIN public.user_roles ur ON ur.user_id = o.user_id
      WHERE o.scope='whatsapp_number' AND o.resource_id = w.id::text AND o.granted
        AND ur.role IN ('closer'::app_role, 'recepcao'::app_role)
    )
  ON CONFLICT (user_id, scope, resource_id) DO UPDATE SET granted = true;
  RETURN NEW;
END $function$;

-- 5.4 concede_numero_aos_gerais — número novo não vai para a SDR (ela é do
-- principal; o crc concede outro número à mão se quiser).
CREATE OR REPLACE FUNCTION public.concede_numero_aos_gerais()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_dono_restrito boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('closer'::app_role, 'recepcao'::app_role, 'sdr'::app_role)
  ) INTO v_dono_restrito;
  IF v_dono_restrito THEN RETURN NEW; END IF;
  INSERT INTO public.user_permission_overrides (user_id, scope, resource_id, granted, created_by)
  SELECT DISTINCT p.id, 'whatsapp_number', NEW.id::text, true, auth.uid()
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE p.tenant_id = NEW.tenant_id
    AND ur.role NOT IN ('closer'::app_role, 'recepcao'::app_role, 'sdr'::app_role)
  ON CONFLICT (user_id, scope, resource_id) DO UPDATE SET granted = true;
  RETURN NEW;
END $function$;

-- ============================================================ 6. RPCs da aba Equipe
-- Todas SECURITY DEFINER, 'sem permissão' se NOT is_gestor_equipe(), e só
-- alcançam usuárias do tenant atual cujo ÚNICO papel é sdr (um crc/gerente/
-- closer/recepção/pós-venda/superadmin nunca é alvo por esta porta).

-- Alvo válido: perfil no tenant atual + só papel sdr. Devolve o e-mail (ou
-- NULL se não é alvo válido).
CREATE OR REPLACE FUNCTION public.equipe_alvo_sdr(p_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT p.email
    FROM public.profiles p
   WHERE p.id = p_user_id
     AND p.tenant_id IS NOT NULL
     AND p.tenant_id = public.current_tenant_id()
     AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'sdr'::app_role)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role <> 'sdr'::app_role);
$fn$;
REVOKE ALL ON FUNCTION public.equipe_alvo_sdr(uuid) FROM PUBLIC, anon, authenticated;

-- leads_hoje = leads de que ela é dona e que chegaram a ela hoje (fuso da
-- clínica, America/Bahia): distribuido_em (rodízio / criação pela própria SDR)
-- ou, na falta, created_at.
CREATE OR REPLACE FUNCTION public.equipe_listar()
RETURNS TABLE(
  user_id uuid, nome text, email text, bloqueado boolean, no_rodizio boolean,
  criado_em timestamptz, ultimo_login timestamptz, leads_hoje integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_hoje date := (now() AT TIME ZONE 'America/Bahia')::date;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT p.id,
         p.nome,
         p.email,
         COALESCE(p.is_blocked, false),
         COALESCE(m.ativo, false),
         p.created_at,
         p.last_login_at,
         (SELECT count(*)::integer
            FROM public.crm_leads l
           WHERE l.tenant_id = v_tenant
             AND l.assigned_to = p.id
             AND (COALESCE(l.distribuido_em, l.created_at) AT TIME ZONE 'America/Bahia')::date = v_hoje)
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'sdr'::app_role
    LEFT JOIN public.crm_rodizio_membros m ON m.tenant_id = v_tenant AND m.user_id = p.id
   WHERE p.tenant_id = v_tenant
     -- Mesmo critério de equipe_alvo_sdr (papel EXCLUSIVAMENTE sdr): listar
     -- quem as outras RPCs recusam encheria a tela de botões que só falham.
     AND NOT EXISTS (SELECT 1 FROM public.user_roles ur2
                      WHERE ur2.user_id = p.id AND ur2.role <> 'sdr'::app_role)
   ORDER BY p.nome;
END $fn$;

-- Bloquear = o mesmo par que admin-manage-user usa: ban no Auth (token novo
-- recusado; o access token vivo expira em ≤1h) + profiles.is_blocked
-- (current_tenant_id() → NULL → toda RLS responde vazio NA HORA e o
-- ProtectedRoute faz signOut). Bloqueada sai do rodízio (ativo=false) para
-- não receber lead; desbloquear NÃO religa o rodízio (o gestor decide).
CREATE OR REPLACE FUNCTION public.equipe_bloquear(p_user_id uuid, p_bloquear boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_email text;
BEGIN
  -- Cada recusa com o seu motivo: "sem permissão" para as três cobria causas
  -- diferentes e o gestor via duas palavras sem saber o que fazer.
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Não é possível bloquear a própria conta.' USING ERRCODE = '42501';
  END IF;
  v_email := public.equipe_alvo_sdr(p_user_id);
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Esta pessoa não é uma SDR desta clínica (ou tem outro papel além de SDR).' USING ERRCODE = '42501';
  END IF;

  UPDATE auth.users
     SET banned_until = CASE WHEN p_bloquear THEN now() + interval '100 years' ELSE NULL END
   WHERE id = p_user_id;

  UPDATE public.profiles
     SET is_blocked = p_bloquear,
         blocked_at = CASE WHEN p_bloquear THEN now() ELSE NULL END,
         blocked_by = CASE WHEN p_bloquear THEN auth.uid() ELSE NULL END
   WHERE id = p_user_id;

  IF p_bloquear THEN
    UPDATE public.crm_rodizio_membros SET ativo = false WHERE user_id = p_user_id;
  END IF;

  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), public.current_tenant_id(), 'tenant',
          CASE WHEN p_bloquear THEN 'sdr_block' ELSE 'sdr_unblock' END,
          jsonb_build_object('target', p_user_id, 'target_email', v_email));
END $fn$;

-- Liga/desliga a SDR no rodízio (crm_rodizio_membros.ativo). Cria a linha se
-- ela ainda não existir (SDR anterior ao gatilho). Bloqueada não pode ser
-- ligada.
CREATE OR REPLACE FUNCTION public.equipe_rodizio(p_user_id uuid, p_ativo boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_email text;
BEGIN
  IF NOT public.is_gestor_equipe() THEN
    RAISE EXCEPTION 'Você não é o gestor da equipe desta clínica.' USING ERRCODE = '42501';
  END IF;
  v_email := public.equipe_alvo_sdr(p_user_id);
  IF v_email IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'Esta pessoa não é uma SDR desta clínica (ou tem outro papel além de SDR).' USING ERRCODE = '42501';
  END IF;
  IF p_ativo AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND COALESCE(p.is_blocked, false)) THEN
    RAISE EXCEPTION 'Conta bloqueada não entra no rodízio. Desbloqueie antes.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.crm_rodizio_membros (tenant_id, user_id, ativo)
  VALUES (v_tenant, p_user_id, p_ativo)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET ativo = EXCLUDED.ativo;

  INSERT INTO public.access_logs (user_id, tenant_id, context, event, metadata)
  VALUES (auth.uid(), v_tenant, 'tenant',
          CASE WHEN p_ativo THEN 'sdr_rodizio_on' ELSE 'sdr_rodizio_off' END,
          jsonb_build_object('target', p_user_id, 'target_email', v_email));
END $fn$;

REVOKE ALL ON FUNCTION public.equipe_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipe_listar() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.equipe_bloquear(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipe_bloquear(uuid, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.equipe_rodizio(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipe_rodizio(uuid, boolean) TO authenticated, service_role;

-- ============================================================ 7. rodízio/ponto para a SDR
-- Conferido em produção: rodizio_membros_le e ponto_le (Fase 0) já têm
-- "OR user_id = auth.uid()" — a SDR lê as próprias linhas; gestão lê tudo.
-- crm_rodizio_config continua só para gestão (crc/gerente/superadmin); a SDR
-- não precisa dela na Fase 1. Nada a criar.

-- ============================================================ VERIFICAÇÃO (rodar à mão, só leitura)
-- Antes de aplicar, guardar as linhas de base; depois, comparar.
--
-- (0) Base de referência — hash de TODAS as policies que não são do sdr e das
--     funções que esta migration NÃO toca. Deve ser idêntico antes/depois:
--   SELECT md5(string_agg(tablename||'|'||policyname||'|'||permissive||'|'||cmd||'|'||roles::text
--          ||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''), E'\n' ORDER BY tablename, policyname))
--     FROM pg_policies WHERE schemaname IN ('public','storage')
--      AND policyname NOT LIKE 'sdr_%';
--   -- (c) closer/recepção/pós-venda intactos: mesmo hash restrito a eles
--   SELECT md5(string_agg(tablename||'|'||policyname||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''), E'\n' ORDER BY 1))
--     FROM pg_policies WHERE schemaname='public'
--      AND (policyname LIKE 'closer%' OR policyname LIKE 'recepcao%' OR policyname LIKE '%closer_number_scope%'
--           OR policyname LIKE 'posvenda%' OR policyname LIKE 'hide_posvenda%');
--   -- funções que continuam iguais (closer_pode_ver_lead, recepcao_pode_ver_lead,
--   -- can_access_pipeline, can_access_whatsapp_number, stamp_crm_lead_whatsapp_number ...):
--   SELECT md5(string_agg(p.proname||pg_get_functiondef(p.oid), E'\n' ORDER BY p.proname))
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname IN ('closer_pode_ver_lead','recepcao_pode_ver_lead','can_access_pipeline',
--          'can_access_whatsapp_number','can_access_instagram_account','stamp_crm_lead_whatsapp_number',
--          'dono_restrito_do_numero','user_role_cria_funil_padrao','pipeline_inclui_papel_do_criador',
--          'funil_do_papel_do_usuario','ensure_role_default_pipeline','has_role','current_tenant_id','user_override');
--
-- (a) SDR sem leads vê 0 linhas. Criar a usuária pela aba Equipe (ou pelo
--     painel), pegar o id em profiles, e SIMULAR o JWT dela (sessão só leitura):
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claims', '{"sub":"<ID_DA_SDR>","role":"authenticated"}', true);
--   SELECT (SELECT count(*) FROM public.crm_leads)        AS leads,        -- 0
--          (SELECT count(*) FROM public.messages)         AS mensagens,    -- 0
--          (SELECT count(*) FROM public.crm_appointments) AS agendamentos, -- 0
--          (SELECT count(*) FROM public.crm_tasks)        AS tarefas,      -- 0
--          (SELECT jsonb_array_length(public.get_conversation_leads())) AS conversas, -- 0
--          (SELECT count(*) FROM public.pacientes)        AS pacientes,    -- 0
--          (SELECT count(*) FROM public.pagamentos)       AS pagamentos,   -- 0
--          (SELECT count(*) FROM public.crm_pipelines)    AS funis,        -- 7 (gerais do tenant)
--          (SELECT count(*) FROM public.crm_whatsapp_templates WHERE owner_role='crc') AS modelos_crc; -- 96
--   -- depois de o crc atribuir 1 lead a ela (UPDATE crm_leads SET assigned_to = <ID_DA_SDR> WHERE id = <LEAD>):
--   -- leads = 1, mensagens = as daquele lead, conversas = 1.
--   -- tentativa de "puxar" lead: UPDATE public.crm_leads SET assigned_to = '<ID_DA_SDR>' WHERE id = '<OUTRO_LEAD>';
--   --   → 0 linhas (RLS) — e, se o lead fosse visível, 'SDR não transfere lead' (gatilho).
--   ROLLBACK;
--
-- (b) O crc (d9b27aa3-…) continua vendo as mesmas contagens. Antes/depois,
--     com o JWT dele (mesmo molde acima): leads do tenant 9.364 (08/09/2026),
--     leads dele 7.610, get_conversation_leads igual, crm_appointments igual.
--   SELECT count(*) FROM public.crm_leads;                                -- igual ao "antes"
--   SELECT count(*) FROM public.crm_leads WHERE assigned_to = auth.uid();  -- igual ao "antes"
--   SELECT jsonb_array_length(public.get_conversation_leads());            -- igual ao "antes"
--   SELECT count(*) FROM public.crm_appointments;                          -- igual ao "antes"
--
-- (d) Gate do gestor: com o JWT do meta.review (f9042a25-…, crc):
--   SELECT public.is_gestor_equipe();   -- false
--   SELECT * FROM public.equipe_listar(); -- ERROR: sem permissão
--   com o JWT de rizodentvca2 (d9b27aa3-…, o gestor_user_id nomeado): true /
--   lista as SDRs.
--   com o JWT de um GERENTE não nomeado: false (o papel sozinho não basta —
--   ver a decisão do cabeçalho); nomeá-lo é UPDATE crm_rodizio_config
--   SET gestor_user_id = '<ID>' WHERE tenant_id = '<TENANT>'.
--
-- (e) Objetos criados — números RECONTADOS linha a linha neste arquivo em
--     08/09/2026, e não estimados. Todas as tabelas citadas nos laços existem
--     em produção (conferido na mesma data): se aparecer algum RAISE NOTICE
--     "tabela X não existe, pulando", o total cai e a conta abaixo não fecha.
--     Antes de aplicar, produção NÃO tem policy alguma cujo nome comece por
--     'sdr' nem gatilho trg_sdr_* / trg_quick_reply_* (conferido) — ou seja,
--     nenhum DROP ... IF EXISTS daqui derruba objeto de outro papel.
--   SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'sdr_%';   -- 75
--     nomeadas uma a uma (23): 1 sdr_base_crm_leads_delete + 4 crm_leads (3.1)
--       + 3 messages + 1 sdr_sem_delete_messages + 1 crm_appointments + 1 crm_tasks
--       + 1 crm_notifications + 1 crm_automation_queue + 1 bot_execution_logs
--       + 3 crm_quick_replies (insert/update/delete) + 3 crm_whatsapp_templates (idem)
--       + 3 sdr_sem_%_funnel_channels (3.9)
--     criadas por laço (52): 3 sdr_base_%_select (2.3) + 11 filhas do lead (3.6)
--       + 3 sdr_escopo_% de acervo (3.7) + 3 sdr_sem_%_bots + 32 sdr_sem_acesso_% (3.8)
--   SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
--     AND (tgname LIKE 'trg_sdr_%' OR tgname = 'trg_quick_reply_carimba_autor');            -- 7
--     (prepara_novo_membro, desativa_membro, concede_funil_novo em user_roles/
--      crm_pipelines; carimba_dona, nao_transfere_lead, nao_altera_distribuicao
--      em crm_leads; carimba_autor em crm_quick_replies)
--   -- 30 CREATE OR REPLACE FUNCTION: 14 objetos NOVOS (sdr_pode_ver_lead,
--   -- is_gestor_equipe, posvenda_padrao_do_tenant, equipe_alvo_sdr,
--   -- equipe_listar, equipe_bloquear, equipe_rodizio e as 7 funções de gatilho)
--   -- + 16 substituições de funções que já existiam (15 nomes; check_duplicate_phone
--   -- tem 2 assinaturas). Nenhum dos 14 novos existe em produção hoje (conferido).
--   SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'sdr_%crm_broadcasts%'; -- 1 (só sdr_sem_acesso)
--   SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='funnel_channels' AND policyname LIKE 'sdr_%'; -- 3 (insert/update/delete)
--   SELECT tgdeferrable, tginitdeferred FROM pg_trigger WHERE tgname='trg_sdr_desativa_membro'; -- t, t
--   SELECT has_function_privilege('authenticated','public.admin_api_unread_leads_base(uuid)','EXECUTE'); -- false
--   SELECT has_function_privilege('authenticated','public.match_good_examples(public.vector,integer,uuid,text,text)','EXECUTE'); -- false
--   SELECT has_function_privilege('anon','public.check_duplicate_phone(text,uuid)','EXECUTE');           -- false
--   SELECT count(*) FROM public.posvenda_padrao_do_tenant();      -- com o JWT da SDR: nº de pós-vendas do cliente (≥1)
--   -- e, na tela: o botão "Enviar para Pós-venda" precisa RENDERIZAR num lead
--   -- dela em etapa "Contratado", com o nome da pós-venda no rótulo.
--
-- (f) Mundo da SDR pelo lado dela — com o JWT de uma SDR e um lead DELA no número
--     principal (whatsapp_number_id NULL), tentar carimbar o número do closer:
--   UPDATE public.crm_leads SET whatsapp_number_id = '<NUMERO_DO_CLOSER>' WHERE id = '<LEAD_DELA>';
--   -- → erro de RLS (WITH CHECK de sdr_escopo_crm_leads_update).
--   -- check_duplicate_phone('<telefone de lead de outra dona>') → 1 linha só com lead_id (resto NULL).
--   -- UPDATE public.crm_leads SET distribuido_em = now() WHERE id = '<LEAD_DELA>';
--   --   → 'SDR não altera a data de distribuição do lead' (gatilho).
--   -- SELECT count(*) FROM public.crm_broadcasts;            -- 0
--   -- SELECT count(*) FROM public.rpt_baseline_anuncio;      -- 0
--   -- SELECT count(*) FROM public.crm_funnel_custom_reports; -- 0
--   -- SELECT count(*) FROM public.ad_account_map;            -- 0 (o crc continua vendo as 11)
--   -- canal do funil: LÊ, mas não escreve —
--   -- SELECT count(*) FROM public.funnel_channels;           -- os canais do tenant
--   -- UPDATE public.funnel_channels SET config = config WHERE pipeline_id = '<FUNIL PRINCIPAL>';
--   --   → 0 linhas (sdr_sem_update_funnel_channels); com o JWT do crc, 1 linha.
--   -- métricas e RPCs fechadas:
--   -- SELECT public.crm_usage_metrics(current_date, current_date);  -- ERROR 42501
--   -- SELECT * FROM public.crm_template_usage_counts(NULL);         -- 0 linhas
--   -- SELECT * FROM public.match_good_examples(...);                -- ERROR: permission denied
--   -- SELECT count(*) FROM public.bot_execution_logs;        -- só execuções de leads dela
--   -- lead de OUTRA dona, id obtido pelo check_duplicate_phone:
--   -- SELECT count(*) FROM public.get_lead_stage_history_names('<LEAD_DE_OUTRA_DONA>'); -- 0
--   -- SELECT count(*) FROM public.get_lead_stage_history_names('<LEAD_DELA>');          -- as etapas do lead dela
--   -- com o JWT do crc, os dois ids devolvem o mesmo que antes da migration.
--
-- (g) transfer_lead_to_whatsapp com duplicado que não é dela: pegar um lead
--     DELA cujo telefone já exista em outro lead do mesmo mundo pertencente a
--     outro dono (ou sem dona) e, com o JWT dela:
--   SELECT public.transfer_lead_to_whatsapp('<LEAD_DELA>');
--     -- → {"error":"duplicado_de_outra_dona"}; conferir depois que o outro lead
--     --   continua is_blocked=false e que as mensagens dele NÃO mudaram de lead_id.
--     -- Com o duplicado sendo DELA: {"ok":true,"merged":true,...} como sempre.
--     -- Com o JWT do crc: resultado idêntico ao de produção (mescla normal).
--
-- (h) Papel reaplicado — tenant_set_user_role, como superadmin:
--     • SDR ativa no rodízio: SELECT public.tenant_set_user_role('<ID_DA_SDR>','sdr');
--       SELECT ativo FROM public.crm_rodizio_membros WHERE user_id='<ID_DA_SDR>'; -- continua true
--     • crc com um número revogado (override granted=false): reaplicar 'crc'
--       CONTINUA recompondo o override (granted=true), como em produção —
--       o retorno antecipado vale só para 'sdr'.
--       SELECT public.tenant_set_user_role('<ID_DO_CRC>','crc');
--       SELECT granted FROM public.user_permission_overrides
--        WHERE user_id='<ID_DO_CRC>' AND scope='whatsapp_number' AND resource_id='<NUMERO>'; -- true
