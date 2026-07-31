-- ============================================================================
-- HARDENING 2/3 — Escopo do papel "recepcao".
-- ============================================================================
-- A Recepção usa: Conversas, Funil (Kanban), Integrações (conectar WhatsApp),
-- Bots, Modelos, Respostas Rápidas e Transmissão — sempre limitada ao NÚMERO
-- de WhatsApp da sua unidade.
--
-- O que ela NÃO acessa: prontuário/pacientes, financeiro, relatórios, outros
-- canais (Instagram/ligações), credenciais e trilha de auditoria.
--
-- Achado da auditoria: o escopo por número só existia em crm_leads e messages,
-- e só no SELECT. Uma recepcionista lia 638 pacientes e 1.011 pagamentos, via
-- faturamento e alterava mensagens de conversas que nem enxerga.
--
-- Abordagem: policies RESTRICTIVE (entram por AND, então nenhuma policy
-- permissiva — nem futura — fura). Para os outros papéis o predicado
-- curto-circuita em TRUE: zero efeito sobre crc/gerente/posvenda/superadmin.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Propagação do escopo por número para TUDO que pendura no lead.
--    Sem isto, a recepção veria pelo Kanban o histórico, as notas e os
--    agendamentos de leads das OUTRAS unidades — o dado escapa pela tabela
--    filha, não pela crm_leads.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recepcao_pode_ver_lead(_lead_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    NOT public.has_role(auth.uid(), 'recepcao'::app_role)
    OR (
      _lead_id IS NOT NULL
      AND public.lead_whatsapp_number(_lead_id) IS NOT NULL
      AND public.can_access_whatsapp_number(public.lead_whatsapp_number(_lead_id))
    );
$$;
REVOKE ALL ON FUNCTION public.recepcao_pode_ver_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recepcao_pode_ver_lead(uuid) TO authenticated, service_role;

DO $$
DECLARE r record; pol text;
BEGIN
  FOR r IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       AND t.table_type = 'BASE TABLE'
     WHERE c.column_name = 'lead_id' AND c.table_schema = 'public'
       -- messages tem regra própria (mais abaixo), com INSERT/UPDATE também.
       AND c.table_name <> 'messages'
  LOOP
    pol := 'recepcao_escopo_numero_' || r.table_name;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, r.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (public.recepcao_pode_ver_lead(lead_id)) '
      || 'WITH CHECK (public.recepcao_pode_ver_lead(lead_id))',
      pol, r.table_name);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Tabelas que a Recepção não acessa de jeito nenhum.
--    NOTA: crm_pipelines e crm_stages NÃO entram aqui — o Kanban faz parte do
--    trabalho da recepção. O que ela vê dentro dele já é filtrado pelo escopo
--    por número em crm_leads.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  bloqueadas text[] := ARRAY[
    -- prontuário e financeiro
    'pacientes', 'pagamentos', 'tratamentos', 'leads_diarios',
    'registros_diarios_atendimento', 'tipos_procedimento',
    -- outros canais (a recepção atende WhatsApp da sua unidade)
    'instagram_messages', 'ig_accounts', 'instagram_accounts',
    'whatsapp_calls', 'whatsapp_call_permissions', 'api4com_calls',
    'api4com_config', 'api4com_extensions',
    -- IA e análises
    'ai_conversation_analysis', 'ai_good_examples', 'ai_assistant_rules',
    'ai_assistant_config',
    -- plataforma, credenciais e auditoria
    'access_logs', 'tenant_meta_credentials', 'tenant_api_keys',
    'tenant_invoices', 'tenant_subscriptions', 'tenant_usage',
    'ad_id_mapping', 'ad_creative_grupo', 'ad_creative_override',
    'dontus_pacientes', 'dontus_lembretes', 'dontus_lembretes_runs',
    'dontus_unidades', 'clinicas'
  ];
BEGIN
  FOREACH t IN ARRAY bloqueadas LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'recepcao_sem_acesso_' || t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        || 'USING (NOT public.has_role(auth.uid(), ''recepcao''::app_role)) '
        || 'WITH CHECK (NOT public.has_role(auth.uid(), ''recepcao''::app_role))',
        'recepcao_sem_acesso_' || t, t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3) messages: o escopo por número cobria só SELECT. Sem isto, a recepção
--    altera e apaga mensagens de conversas que não consegue ler — as policies
--    de escrita exigem apenas "estar logado".
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS recepcao_number_scope_messages_update ON public.messages;
CREATE POLICY recepcao_number_scope_messages_update ON public.messages
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.recepcao_pode_ver_lead(lead_id));

DROP POLICY IF EXISTS recepcao_number_scope_messages_insert ON public.messages;
CREATE POLICY recepcao_number_scope_messages_insert ON public.messages
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.recepcao_pode_ver_lead(lead_id));

DROP POLICY IF EXISTS recepcao_sem_delete_messages ON public.messages;
CREATE POLICY recepcao_sem_delete_messages ON public.messages
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.has_role(auth.uid(), 'recepcao'::app_role));

-- ---------------------------------------------------------------------------
-- 4) Relatórios e faturamento: toda a família rpt_* resolve o cliente por
--    rpt_resolve_tenant(). Fechar aqui cobre faturamento, ticket médio, KPIs e
--    as demais de uma vez — em vez de alterar uma a uma e esquecer alguma.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpt_resolve_tenant()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'recepcao'::app_role) THEN
    RAISE EXCEPTION 'Acesso negado: relatórios não fazem parte do perfil Recepção'
      USING ERRCODE = '42501';
  END IF;
  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = auth.uid();
  RETURN v_tenant;
END $$;

-- ---------------------------------------------------------------------------
-- 5) Integrações: a Recepção precisa CONECTAR o WhatsApp da unidade, mas a
--    tabela `integrations` guarda o access_token da Meta dentro de um jsonb —
--    não dá para esconder por coluna. Solução: a tabela sai do alcance do app
--    (só crc/superadmin leem direto) e a Recepção passa a enxergar as conexões
--    por esta função, que devolve só o que a tela precisa, SEM segredo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.integracoes_visiveis()
RETURNS TABLE (
  id uuid,
  key text,
  status text,
  display_name text,
  phone_number_id text,
  waba_id text,
  criado_em timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT i.id, i.key, i.status,
         COALESCE(i.config->>'display_name', i.key) AS display_name,
         i.config->>'phone_number_id' AS phone_number_id,
         i.config->>'waba_id' AS waba_id,
         i.created_at
    FROM public.integrations i
   WHERE i.tenant_id = public.current_tenant_id()
     AND auth.uid() IS NOT NULL
   ORDER BY i.created_at;
$$;
REVOKE ALL ON FUNCTION public.integracoes_visiveis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integracoes_visiveis() TO authenticated, service_role;
COMMENT ON FUNCTION public.integracoes_visiveis() IS
  'Conexões do cliente SEM credenciais — usada pela tela de Conexões da Recepção.';

-- ---------------------------------------------------------------------------
-- 6) tenant_set_user_role: dois furos encontrados na auditoria — um crc podia
--    apagar o papel de um superadmin da plataforma, e um gerente podia
--    promover a si mesmo. Como a gestão de usuários passou a viver só no painel
--    do superadmin, a função fica restrita a ele.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tenant_set_user_role(_user_id uuid, _role app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
  IF _role NOT IN ('crc'::app_role, 'gerente'::app_role, 'posvenda'::app_role, 'recepcao'::app_role) THEN
    RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = _user_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'usuario_sem_cliente' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id AND tenant_id = v_tenant;
  INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES (_user_id, _role, v_tenant);
END $$;

-- ---------------------------------------------------------------------------
-- 7) Modelos, bots, transmissões e respostas rápidas de OUTROS perfis.
--
-- Sintoma relatado: a Recepção abria "Modelos" e via todos os modelos do
-- marketing (ofertas, resgate de leads, antes e depois...).
--
-- Duas causas, ambas tratadas aqui:
--   (a) a policy "visible by role" libera quando `owner_role IS NULL` — que é o
--       rótulo "Compartilhado" da tela. Como quase tudo foi criado sem dono,
--       valia para todo mundo, inclusive para um papel que nem existia quando
--       esses itens foram feitos.
--   (b) a trigger set_owner_role_from_user só carimbava crc/posvenda/gerente:
--       item criado pela recepção nasceria SEM dono, ou seja, visível a todos.
--
-- Regra nova para a Recepção: ela vê o que é dela ou o que foi explicitamente
-- compartilhado com o perfil dela (botão "Compartilhar" da tela). Fail-closed:
-- na dúvida, não aparece.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_owner_role_from_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
       WHEN 'gerente'    THEN 3
       WHEN 'superadmin' THEN 99
       WHEN 'crc_legacy' THEN 99
       ELSE 99
     END
     LIMIT 1;
    IF v_role IN ('crc', 'posvenda', 'gerente', 'recepcao') THEN
      NEW.owner_role := v_role;
    END IF;
    -- superadmin e demais: deixa NULL (compartilhado com todos)
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
  com_dono text[] := ARRAY['crm_whatsapp_templates', 'bots', 'crm_broadcasts', 'crm_quick_replies'];
BEGIN
  FOREACH t IN ARRAY com_dono LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'recepcao_so_itens_do_perfil_' || t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated '
        || 'USING ( NOT public.has_role(auth.uid(), ''recepcao''::app_role) '
        || '        OR owner_role = ''recepcao''::app_role '
        || '        OR ''recepcao''::app_role = ANY(COALESCE(shared_roles, ''{}''::app_role[])) )',
        'recepcao_so_itens_do_perfil_' || t, t);
    END IF;
  END LOOP;
END $$;
