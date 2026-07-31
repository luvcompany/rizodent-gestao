-- ============================================================================
-- HARDENING 2/3 — O papel "recepcao" fica restrito ao que ele existe para fazer:
-- conversas do próprio número, disparos, modelos e bots. Nada de funil,
-- pacientes, financeiro, relatórios, agenda ou dados dos outros papéis.
-- ============================================================================
-- Achado da auditoria: o escopo da recepção só era aplicado em crm_leads e
-- messages (e só no SELECT). Todo o resto — pacientes, pagamentos, tratamentos,
-- agenda, tarefas, notas de conversa, histórico do lead, chamadas, DMs do
-- Instagram, backup de leads apagados — tinha policy que só conferia o tenant,
-- sem olhar o papel. Uma recepcionista lia 638 pacientes e 1.011 pagamentos.
--
-- Abordagem: policies RESTRICTIVE que NEGAM o papel recepcao nessas tabelas.
-- RESTRICTIVE entra por AND, então nenhuma policy permissiva futura fura.
-- Para todos os outros papéis o predicado curto-circuita em TRUE — zero efeito
-- sobre crc/gerente/posvenda/superadmin, que é o que roda hoje em produção.
-- ============================================================================

DO $$
DECLARE
  t text;
  -- Tabelas que a recepção NÃO deve acessar de forma alguma.
  bloqueadas text[] := ARRAY[
    -- clínico / financeiro
    'pacientes', 'pagamentos', 'tratamentos', 'leads_diarios',
    'registros_diarios_atendimento', 'clinicas', 'tipos_procedimento',
    -- funil e satélites do lead (conversas de outras unidades por via indireta)
    'crm_pipelines', 'crm_stages', 'crm_lead_stage_history',
    'crm_lead_custom_values', 'crm_lead_pacientes', 'crm_conversation_notes',
    'deleted_leads_backup', 'crm_custom_fields', 'crm_user_labels',
    'crm_lead_label_assignments',
    -- agenda e tarefas
    'crm_appointments', 'crm_tasks',
    -- outros canais e IA
    'instagram_messages', 'ig_accounts', 'instagram_accounts',
    'whatsapp_calls', 'whatsapp_call_permissions', 'api4com_calls',
    'ai_conversation_analysis', 'ai_good_examples', 'ai_assistant_rules',
    -- plataforma / auditoria
    'access_logs', 'integrations', 'tenant_meta_credentials', 'tenant_api_keys',
    'tenant_invoices', 'tenant_subscriptions', 'tenant_usage', 'ad_id_mapping',
    'dashboard_holidays', 'funnel_channels'
  ];
BEGIN
  FOREACH t IN ARRAY bloqueadas LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'recepcao_sem_acesso_' || t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        || 'USING (NOT has_role(auth.uid(), ''recepcao''::app_role)) '
        || 'WITH CHECK (NOT has_role(auth.uid(), ''recepcao''::app_role))',
        'recepcao_sem_acesso_' || t, t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- messages: o escopo por número cobria só SELECT. Sem isto, a recepção altera
-- e apaga mensagens de conversas que nem consegue ler (as policies de escrita
-- exigem apenas "estar logado").
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS recepcao_number_scope_messages_update ON public.messages;
CREATE POLICY recepcao_number_scope_messages_update ON public.messages
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    NOT has_role(auth.uid(), 'recepcao'::app_role)
    OR (lead_id IS NOT NULL
        AND public.lead_whatsapp_number(lead_id) IS NOT NULL
        AND public.can_access_whatsapp_number(public.lead_whatsapp_number(lead_id)))
  );

DROP POLICY IF EXISTS recepcao_sem_delete_messages ON public.messages;
CREATE POLICY recepcao_sem_delete_messages ON public.messages
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT has_role(auth.uid(), 'recepcao'::app_role));

-- Só pode escrever mensagem na conversa que enxerga.
DROP POLICY IF EXISTS recepcao_number_scope_messages_insert ON public.messages;
CREATE POLICY recepcao_number_scope_messages_insert ON public.messages
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    NOT has_role(auth.uid(), 'recepcao'::app_role)
    OR (lead_id IS NOT NULL
        AND public.lead_whatsapp_number(lead_id) IS NOT NULL
        AND public.can_access_whatsapp_number(public.lead_whatsapp_number(lead_id)))
  );

-- ---------------------------------------------------------------------------
-- Relatórios e faturamento: toda a família rpt_* resolve o cliente por
-- rpt_resolve_tenant(). Fechar aqui cobre rpt_faturamento, rpt_ticket_medio,
-- rpt_contratados, rpt_kpis_agendamentos e as demais de uma vez — em vez de
-- alterar uma a uma e esquecer alguma no caminho.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpt_resolve_tenant()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid;
BEGIN
  -- Recepção não vê relatório, faturamento nem ticket médio.
  IF auth.uid() IS NOT NULL AND has_role(auth.uid(), 'recepcao'::app_role) THEN
    RAISE EXCEPTION 'Acesso negado: relatórios não fazem parte do perfil Recepção'
      USING ERRCODE = '42501';
  END IF;
  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = auth.uid();
  RETURN v_tenant;
END $$;

-- ---------------------------------------------------------------------------
-- tenant_set_user_role: correção de dois furos encontrados na auditoria.
-- (a) o crc de uma clínica conseguia apagar o papel de um superadmin da
--     plataforma (o DELETE não olhava quem era o alvo);
-- (b) um gerente podia promover a si mesmo a crc.
-- Como a gestão de usuários passou a viver só no painel do superadmin, a função
-- fica restrita a superadmin — o que elimina a classe inteira de problema.
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
