
-- Direct tenant_id
DROP POLICY IF EXISTS ad_id_mapping_tenant_select ON public.ad_id_mapping;
CREATE POLICY ad_id_mapping_tenant_select ON public.ad_id_mapping
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role) OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS ai_assistant_config_tenant_select ON public.ai_assistant_config;
CREATE POLICY ai_assistant_config_tenant_select ON public.ai_assistant_config
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role) OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS clinicas_tenant_select ON public.clinicas;
CREATE POLICY clinicas_tenant_select ON public.clinicas
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role) OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS crm_automations_tenant_select ON public.crm_automations;
CREATE POLICY crm_automations_tenant_select ON public.crm_automations
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role) OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS crm_conversation_notes_tenant_select ON public.crm_conversation_notes;
CREATE POLICY crm_conversation_notes_tenant_select ON public.crm_conversation_notes
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role) OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS crm_custom_fields_tenant_select ON public.crm_custom_fields;
CREATE POLICY crm_custom_fields_tenant_select ON public.crm_custom_fields
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role) OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS crm_followup_configs_tenant_select ON public.crm_followup_configs;
CREATE POLICY crm_followup_configs_tenant_select ON public.crm_followup_configs
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role) OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS dashboard_holidays_tenant_select ON public.dashboard_holidays;
CREATE POLICY dashboard_holidays_tenant_select ON public.dashboard_holidays
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role) OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS funnel_channels_tenant_select ON public.funnel_channels;
CREATE POLICY funnel_channels_tenant_select ON public.funnel_channels
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role) OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS pacientes_tenant_select ON public.pacientes;
CREATE POLICY pacientes_tenant_select ON public.pacientes
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role) OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tipos_procedimento_tenant_select ON public.tipos_procedimento;
CREATE POLICY tipos_procedimento_tenant_select ON public.tipos_procedimento
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role) OR tenant_id = current_tenant_id());

-- Scoped via clinicas.tenant_id
DROP POLICY IF EXISTS pagamentos_tenant_select ON public.pagamentos;
CREATE POLICY pagamentos_tenant_select ON public.pagamentos
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'superadmin'::app_role) OR EXISTS (
      SELECT 1 FROM public.clinicas c
      WHERE c.id = pagamentos.clinica_id AND c.tenant_id = current_tenant_id()
    )
  );

DROP POLICY IF EXISTS tratamentos_tenant_select ON public.tratamentos;
CREATE POLICY tratamentos_tenant_select ON public.tratamentos
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'superadmin'::app_role) OR EXISTS (
      SELECT 1 FROM public.clinicas c
      WHERE c.id = tratamentos.clinica_id AND c.tenant_id = current_tenant_id()
    )
  );

DROP POLICY IF EXISTS leads_diarios_tenant_select ON public.leads_diarios;
CREATE POLICY leads_diarios_tenant_select ON public.leads_diarios
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'superadmin'::app_role) OR EXISTS (
      SELECT 1 FROM public.clinicas c
      WHERE c.id = leads_diarios.clinica_id AND c.tenant_id = current_tenant_id()
    )
  );

DROP POLICY IF EXISTS registros_diarios_atendimento_tenant_select ON public.registros_diarios_atendimento;
CREATE POLICY registros_diarios_atendimento_tenant_select ON public.registros_diarios_atendimento
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'superadmin'::app_role) OR EXISTS (
      SELECT 1 FROM public.clinicas c
      WHERE c.id = registros_diarios_atendimento.clinica_id AND c.tenant_id = current_tenant_id()
    )
  );

-- Scoped via crm_leads.tenant_id (lead_id FK) — includes queues without tenant_id
DROP POLICY IF EXISTS crm_lead_pacientes_tenant_select ON public.crm_lead_pacientes;
CREATE POLICY crm_lead_pacientes_tenant_select ON public.crm_lead_pacientes
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'superadmin'::app_role) OR EXISTS (
      SELECT 1 FROM public.crm_leads l
      WHERE l.id = crm_lead_pacientes.lead_id AND l.tenant_id = current_tenant_id()
    )
  );

DROP POLICY IF EXISTS crm_lead_stage_history_tenant_select ON public.crm_lead_stage_history;
CREATE POLICY crm_lead_stage_history_tenant_select ON public.crm_lead_stage_history
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'superadmin'::app_role) OR EXISTS (
      SELECT 1 FROM public.crm_leads l
      WHERE l.id = crm_lead_stage_history.lead_id AND l.tenant_id = current_tenant_id()
    )
  );

DROP POLICY IF EXISTS crm_lead_custom_values_tenant_select ON public.crm_lead_custom_values;
CREATE POLICY crm_lead_custom_values_tenant_select ON public.crm_lead_custom_values
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'superadmin'::app_role) OR EXISTS (
      SELECT 1 FROM public.crm_leads l
      WHERE l.id = crm_lead_custom_values.lead_id AND l.tenant_id = current_tenant_id()
    )
  );

DROP POLICY IF EXISTS crm_broadcast_recipients_tenant_select ON public.crm_broadcast_recipients;
CREATE POLICY crm_broadcast_recipients_tenant_select ON public.crm_broadcast_recipients
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'superadmin'::app_role) OR EXISTS (
      SELECT 1 FROM public.crm_broadcasts b
      WHERE b.id = crm_broadcast_recipients.broadcast_id AND b.tenant_id = current_tenant_id()
    )
  );

DROP POLICY IF EXISTS crm_automation_executions_tenant_select ON public.crm_automation_executions;
CREATE POLICY crm_automation_executions_tenant_select ON public.crm_automation_executions
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'superadmin'::app_role) OR EXISTS (
      SELECT 1 FROM public.crm_leads l
      WHERE l.id = crm_automation_executions.lead_id AND l.tenant_id = current_tenant_id()
    )
  );

DROP POLICY IF EXISTS crm_automation_queue_tenant_select ON public.crm_automation_queue;
CREATE POLICY crm_automation_queue_tenant_select ON public.crm_automation_queue
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'superadmin'::app_role) OR EXISTS (
      SELECT 1 FROM public.crm_leads l
      WHERE l.id = crm_automation_queue.lead_id AND l.tenant_id = current_tenant_id()
    )
  );

DROP POLICY IF EXISTS crm_followup_queue_tenant_select ON public.crm_followup_queue;
CREATE POLICY crm_followup_queue_tenant_select ON public.crm_followup_queue
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'superadmin'::app_role) OR EXISTS (
      SELECT 1 FROM public.crm_leads l
      WHERE l.id = crm_followup_queue.lead_id AND l.tenant_id = current_tenant_id()
    )
  );

-- Bot tables scoped via bots.tenant_id
DROP POLICY IF EXISTS bot_versions_tenant_select ON public.bot_versions;
CREATE POLICY bot_versions_tenant_select ON public.bot_versions
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'superadmin'::app_role) OR EXISTS (
      SELECT 1 FROM public.bots b
      WHERE b.id = bot_versions.bot_id AND b.tenant_id = current_tenant_id()
    )
  );

DROP POLICY IF EXISTS bot_stage_triggers_tenant_select ON public.bot_stage_triggers;
CREATE POLICY bot_stage_triggers_tenant_select ON public.bot_stage_triggers
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'superadmin'::app_role) OR EXISTS (
      SELECT 1 FROM public.bots b
      WHERE b.id = bot_stage_triggers.bot_id AND b.tenant_id = current_tenant_id()
    )
  );

DROP POLICY IF EXISTS bot_executions_tenant_select ON public.bot_executions;
CREATE POLICY bot_executions_tenant_select ON public.bot_executions
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'superadmin'::app_role) OR EXISTS (
      SELECT 1 FROM public.bots b
      WHERE b.id = bot_executions.bot_id AND b.tenant_id = current_tenant_id()
    )
  );

DROP POLICY IF EXISTS bot_execution_logs_tenant_select ON public.bot_execution_logs;
CREATE POLICY bot_execution_logs_tenant_select ON public.bot_execution_logs
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'superadmin'::app_role) OR EXISTS (
      SELECT 1 FROM public.bot_executions e
      JOIN public.bots b ON b.id = e.bot_id
      WHERE e.id = bot_execution_logs.execution_id AND b.tenant_id = current_tenant_id()
    )
  );
