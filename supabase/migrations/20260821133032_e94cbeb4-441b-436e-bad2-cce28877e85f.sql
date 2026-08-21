CREATE OR REPLACE FUNCTION public.closer_pode_ver_lead(_lead_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    NOT public.has_role(auth.uid(), 'closer'::app_role)
    OR (
      _lead_id IS NOT NULL
      AND public.lead_whatsapp_number(_lead_id) IS NOT NULL
      AND public.can_access_whatsapp_number(public.lead_whatsapp_number(_lead_id))
    );
$$;
REVOKE ALL ON FUNCTION public.closer_pode_ver_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.closer_pode_ver_lead(uuid) TO authenticated, service_role;

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
       AND c.table_name <> 'messages'
       AND c.table_name NOT IN (
         'crm_automation_queue', 'bot_executions', 'ai_reply_suggestions',
         'crm_funil_cleanup_log', 'deleted_leads_backup', 'api4com_calls',
         'instagram_messages', 'whatsapp_calls', 'whatsapp_call_permissions',
         'ai_good_examples', 'ai_conversation_analysis'
       )
  LOOP
    pol := 'closer_escopo_numero_' || r.table_name;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, r.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING ((SELECT NOT public.has_role(auth.uid(), ''closer''::app_role)) '
      || '       OR public.closer_pode_ver_lead(lead_id)) '
      || 'WITH CHECK ((SELECT NOT public.has_role(auth.uid(), ''closer''::app_role)) '
      || '            OR public.closer_pode_ver_lead(lead_id))',
      pol, r.table_name);
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
  bloqueadas text[] := ARRAY[
    'pacientes', 'pagamentos', 'tratamentos', 'leads_diarios',
    'registros_diarios_atendimento', 'tipos_procedimento',
    'instagram_messages', 'ig_accounts', 'instagram_accounts',
    'whatsapp_calls', 'whatsapp_call_permissions', 'api4com_calls',
    'api4com_config', 'api4com_extensions',
    'ai_conversation_analysis', 'ai_good_examples', 'ai_assistant_rules',
    'ai_assistant_config',
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
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'closer_sem_acesso_' || t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        || 'USING ((SELECT NOT public.has_role(auth.uid(), ''closer''::app_role))) '
        || 'WITH CHECK ((SELECT NOT public.has_role(auth.uid(), ''closer''::app_role)))',
        'closer_sem_acesso_' || t, t);
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS closer_number_scope_leads ON public.crm_leads;
CREATE POLICY closer_number_scope_leads ON public.crm_leads
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'closer'::app_role))
         OR (whatsapp_number_id IS NOT NULL
             AND public.can_access_whatsapp_number(whatsapp_number_id)));

DROP POLICY IF EXISTS closer_number_scope_lead_update ON public.crm_leads;
CREATE POLICY closer_number_scope_lead_update ON public.crm_leads
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'closer'::app_role))
         OR (whatsapp_number_id IS NOT NULL
             AND public.can_access_whatsapp_number(whatsapp_number_id)));

DROP POLICY IF EXISTS closer_no_lead_delete ON public.crm_leads;
CREATE POLICY closer_no_lead_delete ON public.crm_leads
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'closer'::app_role)));

DROP POLICY IF EXISTS closer_number_scope_messages ON public.messages;
CREATE POLICY closer_number_scope_messages ON public.messages
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'closer'::app_role))
         OR public.closer_pode_ver_lead(lead_id));

DROP POLICY IF EXISTS closer_number_scope_messages_update ON public.messages;
CREATE POLICY closer_number_scope_messages_update ON public.messages
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'closer'::app_role))
         OR public.closer_pode_ver_lead(lead_id));

DROP POLICY IF EXISTS closer_number_scope_messages_insert ON public.messages;
CREATE POLICY closer_number_scope_messages_insert ON public.messages
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT NOT public.has_role(auth.uid(), 'closer'::app_role))
              OR public.closer_pode_ver_lead(lead_id));

DROP POLICY IF EXISTS closer_sem_delete_messages ON public.messages;
CREATE POLICY closer_sem_delete_messages ON public.messages
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'closer'::app_role)));

DO $$
DECLARE
  t text;
  com_dono text[] := ARRAY['crm_whatsapp_templates', 'bots', 'crm_broadcasts', 'crm_quick_replies'];
BEGIN
  FOREACH t IN ARRAY com_dono LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'closer_so_itens_do_perfil_' || t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated '
        || 'USING ( (SELECT NOT public.has_role(auth.uid(), ''closer''::app_role)) '
        || '        OR owner_role = ''closer''::app_role '
        || '        OR ''closer''::app_role = ANY(COALESCE(shared_roles, ''{}''::app_role[])) )',
        'closer_so_itens_do_perfil_' || t, t);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.rpt_resolve_tenant()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_tenant     uuid;
  v_jwt_role   text;
  v_guc_tenant text;
  v_ativos     int;
BEGIN
  IF auth.uid() IS NOT NULL AND (
       public.has_role(auth.uid(), 'recepcao'::app_role)
       OR public.has_role(auth.uid(), 'closer'::app_role)
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
$fn$;

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
       WHEN 'closer'     THEN 2
       WHEN 'gerente'    THEN 3
       WHEN 'superadmin' THEN 99
       WHEN 'crc_legacy' THEN 99
       ELSE 99
     END
     LIMIT 1;
    IF v_role IN ('crc', 'posvenda', 'gerente', 'recepcao', 'closer') THEN
      NEW.owner_role := v_role;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

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
  IF _role NOT IN ('crc'::app_role, 'gerente'::app_role, 'posvenda'::app_role,
                   'recepcao'::app_role, 'closer'::app_role) THEN
    RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = _user_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'usuario_sem_cliente' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id AND tenant_id = v_tenant;
  INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES (_user_id, _role, v_tenant);
END $$;

DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY['crm_pipelines', 'crm_stages', 'crm_automations', 'funnel_channels'];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'recepcao_closer_ins_' || t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated '
        || 'WITH CHECK (public.has_role(auth.uid(), ''recepcao''::app_role) '
        || '            OR public.has_role(auth.uid(), ''closer''::app_role))',
        'recepcao_closer_ins_' || t, t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'recepcao_closer_upd_' || t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
        || 'USING (public.has_role(auth.uid(), ''recepcao''::app_role) '
        || '       OR public.has_role(auth.uid(), ''closer''::app_role)) '
        || 'WITH CHECK (public.has_role(auth.uid(), ''recepcao''::app_role) '
        || '            OR public.has_role(auth.uid(), ''closer''::app_role))',
        'recepcao_closer_upd_' || t, t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'recepcao_closer_del_' || t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated '
        || 'USING (public.has_role(auth.uid(), ''recepcao''::app_role) '
        || '       OR public.has_role(auth.uid(), ''closer''::app_role))',
        'recepcao_closer_del_' || t, t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';