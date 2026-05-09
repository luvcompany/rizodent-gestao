
-- ============ PROFILES ============
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
CREATE POLICY "Users view profiles in same tenant"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR tenant_id = public.current_tenant_id()
    OR public.has_role(auth.uid(), 'superadmin'::app_role)
  );

-- ============ TENANTS ============
DROP POLICY IF EXISTS "public_view_tenants" ON public.tenants;

CREATE OR REPLACE FUNCTION public.get_tenant_by_slug(_slug text)
RETURNS TABLE(id uuid, slug text, name text, logo_url text, primary_color text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, slug, name, logo_url, primary_color
  FROM public.tenants WHERE slug = _slug LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_tenant_by_slug(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_tenant_by_slug(text) TO anon, authenticated;

-- ============ USER_ROLES (prevent cross-tenant grants) ============
CREATE POLICY user_roles_same_tenant
  ON public.user_roles AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_roles.user_id
        AND p.tenant_id = public.current_tenant_id()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_roles.user_id
        AND p.tenant_id = public.current_tenant_id()
    )
  );

-- ============ INSTAGRAM ACCOUNTS / MESSAGES ============
ALTER TABLE public.instagram_accounts ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000010'::uuid;
UPDATE public.instagram_accounts SET tenant_id = '00000000-0000-0000-0000-000000000010'::uuid WHERE tenant_id IS NULL;

DROP POLICY IF EXISTS "Authenticated users can manage instagram_accounts" ON public.instagram_accounts;
DROP POLICY IF EXISTS "Authenticated can view instagram_accounts" ON public.instagram_accounts;
DROP POLICY IF EXISTS "Authenticated users can view instagram_accounts" ON public.instagram_accounts;

CREATE POLICY ig_accounts_admin_select ON public.instagram_accounts
  FOR SELECT TO authenticated
  USING (
    (tenant_id = public.current_tenant_id()
      AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'gerente'::app_role)))
    OR public.has_role(auth.uid(),'superadmin'::app_role)
  );
CREATE POLICY ig_accounts_admin_modify ON public.instagram_accounts
  FOR ALL TO authenticated
  USING (
    (tenant_id = public.current_tenant_id()
      AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'gerente'::app_role)))
    OR public.has_role(auth.uid(),'superadmin'::app_role)
  )
  WITH CHECK (
    (tenant_id = public.current_tenant_id()
      AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'gerente'::app_role)))
    OR public.has_role(auth.uid(),'superadmin'::app_role)
  );
CREATE POLICY ig_accounts_tenant_isolation ON public.instagram_accounts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.has_role(auth.uid(),'superadmin'::app_role))
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.has_role(auth.uid(),'superadmin'::app_role));

-- instagram_messages: scope by parent lead's tenant_id
CREATE POLICY ig_messages_tenant_isolation ON public.instagram_messages
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR lead_id IS NULL
    OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = instagram_messages.lead_id AND l.tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR lead_id IS NULL
    OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = instagram_messages.lead_id AND l.tenant_id = public.current_tenant_id())
  );

-- ============ pagamentos / tratamentos via clinicas ============
CREATE POLICY pagamentos_tenant_isolation ON public.pagamentos
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clinicas c WHERE c.id = pagamentos.clinica_id AND c.tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clinicas c WHERE c.id = pagamentos.clinica_id AND c.tenant_id = public.current_tenant_id())
  );

CREATE POLICY tratamentos_tenant_isolation ON public.tratamentos
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clinicas c WHERE c.id = tratamentos.clinica_id AND c.tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clinicas c WHERE c.id = tratamentos.clinica_id AND c.tenant_id = public.current_tenant_id())
  );

CREATE POLICY leads_diarios_tenant_isolation ON public.leads_diarios
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clinicas c WHERE c.id = leads_diarios.clinica_id AND c.tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clinicas c WHERE c.id = leads_diarios.clinica_id AND c.tenant_id = public.current_tenant_id())
  );

CREATE POLICY rda_tenant_isolation ON public.registros_diarios_atendimento
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clinicas c WHERE c.id = registros_diarios_atendimento.clinica_id AND c.tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clinicas c WHERE c.id = registros_diarios_atendimento.clinica_id AND c.tenant_id = public.current_tenant_id())
  );

-- ============ Lead-scoped child tables ============
CREATE POLICY crm_lsh_tenant_isolation ON public.crm_lead_stage_history
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_lead_stage_history.lead_id AND l.tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_lead_stage_history.lead_id AND l.tenant_id = public.current_tenant_id())
  );

CREATE POLICY crm_lp_tenant_isolation ON public.crm_lead_pacientes
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_lead_pacientes.lead_id AND l.tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_lead_pacientes.lead_id AND l.tenant_id = public.current_tenant_id())
  );

CREATE POLICY crm_lcv_tenant_isolation ON public.crm_lead_custom_values
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_lead_custom_values.lead_id AND l.tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_lead_custom_values.lead_id AND l.tenant_id = public.current_tenant_id())
  );

CREATE POLICY crm_ae_tenant_isolation ON public.crm_automation_executions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_automation_executions.lead_id AND l.tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_automation_executions.lead_id AND l.tenant_id = public.current_tenant_id())
  );

CREATE POLICY crm_aq_tenant_isolation ON public.crm_automation_queue
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_automation_queue.lead_id AND l.tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_automation_queue.lead_id AND l.tenant_id = public.current_tenant_id())
  );

CREATE POLICY crm_fq_tenant_isolation ON public.crm_followup_queue
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_followup_queue.lead_id AND l.tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.id = crm_followup_queue.lead_id AND l.tenant_id = public.current_tenant_id())
  );

CREATE POLICY crm_br_tenant_isolation ON public.crm_broadcast_recipients
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_broadcasts b WHERE b.id = crm_broadcast_recipients.broadcast_id AND b.tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.crm_broadcasts b WHERE b.id = crm_broadcast_recipients.broadcast_id AND b.tenant_id = public.current_tenant_id())
  );

-- ============ Bot tables ============
CREATE POLICY bot_executions_tenant_isolation ON public.bot_executions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.bots b WHERE b.id = bot_executions.bot_id AND b.tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.bots b WHERE b.id = bot_executions.bot_id AND b.tenant_id = public.current_tenant_id())
  );

CREATE POLICY bot_versions_tenant_isolation ON public.bot_versions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.bots b WHERE b.id = bot_versions.bot_id AND b.tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (SELECT 1 FROM public.bots b WHERE b.id = bot_versions.bot_id AND b.tenant_id = public.current_tenant_id())
  );

CREATE POLICY bot_exec_logs_tenant_isolation ON public.bot_execution_logs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.bot_executions e
      JOIN public.bots b ON b.id = e.bot_id
      WHERE e.id = bot_execution_logs.execution_id
        AND b.tenant_id = public.current_tenant_id()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(),'superadmin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.bot_executions e
      JOIN public.bots b ON b.id = e.bot_id
      WHERE e.id = bot_execution_logs.execution_id
        AND b.tenant_id = public.current_tenant_id()
    )
  );

-- ============ Storage: chat-media tighten SELECT to authenticated only ============
DROP POLICY IF EXISTS "Authenticated users can view chat media" ON storage.objects;
CREATE POLICY "Authenticated users can view chat media"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chat-media' AND auth.uid() IS NOT NULL);
