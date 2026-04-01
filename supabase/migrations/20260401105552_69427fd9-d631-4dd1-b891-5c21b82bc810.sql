
-- =============================================
-- CONFIG/STRUCTURE TABLES: restrict writes to admin/gerente
-- =============================================

-- crm_pipelines
DROP POLICY IF EXISTS "Authenticated users can insert crm_pipelines" ON public.crm_pipelines;
DROP POLICY IF EXISTS "Authenticated users can update crm_pipelines" ON public.crm_pipelines;
DROP POLICY IF EXISTS "Authenticated users can delete crm_pipelines" ON public.crm_pipelines;
CREATE POLICY "Admins and managers can insert crm_pipelines" ON public.crm_pipelines FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can update crm_pipelines" ON public.crm_pipelines FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente')) WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can delete crm_pipelines" ON public.crm_pipelines FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- crm_stages
DROP POLICY IF EXISTS "Authenticated users can insert crm_stages" ON public.crm_stages;
DROP POLICY IF EXISTS "Authenticated users can update crm_stages" ON public.crm_stages;
DROP POLICY IF EXISTS "Authenticated users can delete crm_stages" ON public.crm_stages;
CREATE POLICY "Admins and managers can insert crm_stages" ON public.crm_stages FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can update crm_stages" ON public.crm_stages FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente')) WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can delete crm_stages" ON public.crm_stages FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- crm_custom_fields
DROP POLICY IF EXISTS "Authenticated users can insert crm_custom_fields" ON public.crm_custom_fields;
DROP POLICY IF EXISTS "Authenticated users can update crm_custom_fields" ON public.crm_custom_fields;
DROP POLICY IF EXISTS "Authenticated users can delete crm_custom_fields" ON public.crm_custom_fields;
CREATE POLICY "Admins and managers can insert crm_custom_fields" ON public.crm_custom_fields FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can update crm_custom_fields" ON public.crm_custom_fields FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente')) WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can delete crm_custom_fields" ON public.crm_custom_fields FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- crm_automations
DROP POLICY IF EXISTS "Authenticated users can insert crm_automations" ON public.crm_automations;
DROP POLICY IF EXISTS "Authenticated users can update crm_automations" ON public.crm_automations;
DROP POLICY IF EXISTS "Authenticated users can delete crm_automations" ON public.crm_automations;
CREATE POLICY "Admins and managers can insert crm_automations" ON public.crm_automations FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can update crm_automations" ON public.crm_automations FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente')) WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can delete crm_automations" ON public.crm_automations FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- bots
DROP POLICY IF EXISTS "Authenticated users can insert bots" ON public.bots;
DROP POLICY IF EXISTS "Authenticated users can update bots" ON public.bots;
DROP POLICY IF EXISTS "Authenticated users can delete bots" ON public.bots;
CREATE POLICY "Admins and managers can insert bots" ON public.bots FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can update bots" ON public.bots FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente')) WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can delete bots" ON public.bots FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- bot_nodes
DROP POLICY IF EXISTS "Authenticated users can insert bot_nodes" ON public.bot_nodes;
DROP POLICY IF EXISTS "Authenticated users can update bot_nodes" ON public.bot_nodes;
DROP POLICY IF EXISTS "Authenticated users can delete bot_nodes" ON public.bot_nodes;
CREATE POLICY "Admins and managers can insert bot_nodes" ON public.bot_nodes FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can update bot_nodes" ON public.bot_nodes FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente')) WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can delete bot_nodes" ON public.bot_nodes FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- bot_node_outputs
DROP POLICY IF EXISTS "Authenticated users can insert bot_node_outputs" ON public.bot_node_outputs;
DROP POLICY IF EXISTS "Authenticated users can update bot_node_outputs" ON public.bot_node_outputs;
DROP POLICY IF EXISTS "Authenticated users can delete bot_node_outputs" ON public.bot_node_outputs;
CREATE POLICY "Admins and managers can insert bot_node_outputs" ON public.bot_node_outputs FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can update bot_node_outputs" ON public.bot_node_outputs FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente')) WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can delete bot_node_outputs" ON public.bot_node_outputs FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- stage_bot_config
DROP POLICY IF EXISTS "Authenticated users can insert stage_bot_config" ON public.stage_bot_config;
DROP POLICY IF EXISTS "Authenticated users can update stage_bot_config" ON public.stage_bot_config;
DROP POLICY IF EXISTS "Authenticated users can delete stage_bot_config" ON public.stage_bot_config;
CREATE POLICY "Admins and managers can insert stage_bot_config" ON public.stage_bot_config FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can update stage_bot_config" ON public.stage_bot_config FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente')) WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can delete stage_bot_config" ON public.stage_bot_config FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- crm_followup_configs
DROP POLICY IF EXISTS "Authenticated users can insert crm_followup_configs" ON public.crm_followup_configs;
DROP POLICY IF EXISTS "Authenticated users can update crm_followup_configs" ON public.crm_followup_configs;
DROP POLICY IF EXISTS "Authenticated users can delete crm_followup_configs" ON public.crm_followup_configs;
CREATE POLICY "Admins and managers can insert crm_followup_configs" ON public.crm_followup_configs FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can update crm_followup_configs" ON public.crm_followup_configs FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente')) WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can delete crm_followup_configs" ON public.crm_followup_configs FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- crm_whatsapp_templates
DROP POLICY IF EXISTS "Authenticated users can insert crm_whatsapp_templates" ON public.crm_whatsapp_templates;
DROP POLICY IF EXISTS "Authenticated users can update crm_whatsapp_templates" ON public.crm_whatsapp_templates;
DROP POLICY IF EXISTS "Authenticated users can delete crm_whatsapp_templates" ON public.crm_whatsapp_templates;
CREATE POLICY "Admins and managers can insert crm_whatsapp_templates" ON public.crm_whatsapp_templates FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can update crm_whatsapp_templates" ON public.crm_whatsapp_templates FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente')) WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can delete crm_whatsapp_templates" ON public.crm_whatsapp_templates FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- funnel_channels
DROP POLICY IF EXISTS "Authenticated users can insert funnel_channels" ON public.funnel_channels;
DROP POLICY IF EXISTS "Authenticated users can update funnel_channels" ON public.funnel_channels;
DROP POLICY IF EXISTS "Authenticated users can delete funnel_channels" ON public.funnel_channels;
CREATE POLICY "Admins and managers can insert funnel_channels" ON public.funnel_channels FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can update funnel_channels" ON public.funnel_channels FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente')) WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
CREATE POLICY "Admins and managers can delete funnel_channels" ON public.funnel_channels FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- =============================================
-- WORKFLOW TABLES: replace bare true with explicit auth check
-- =============================================

-- crm_leads
DROP POLICY IF EXISTS "Authenticated users can insert crm_leads" ON public.crm_leads;
DROP POLICY IF EXISTS "Authenticated users can update crm_leads" ON public.crm_leads;
DROP POLICY IF EXISTS "Authenticated users can delete crm_leads" ON public.crm_leads;
CREATE POLICY "Staff can insert crm_leads" ON public.crm_leads FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update crm_leads" ON public.crm_leads FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins and managers can delete crm_leads" ON public.crm_leads FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- messages
DROP POLICY IF EXISTS "Authenticated users can insert messages" ON public.messages;
DROP POLICY IF EXISTS "Authenticated users can update messages" ON public.messages;
DROP POLICY IF EXISTS "Authenticated users can delete messages" ON public.messages;
CREATE POLICY "Staff can insert messages" ON public.messages FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update messages" ON public.messages FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins and managers can delete messages" ON public.messages FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- crm_tasks
DROP POLICY IF EXISTS "Authenticated users can insert crm_tasks" ON public.crm_tasks;
DROP POLICY IF EXISTS "Authenticated users can update crm_tasks" ON public.crm_tasks;
DROP POLICY IF EXISTS "Authenticated users can delete crm_tasks" ON public.crm_tasks;
CREATE POLICY "Staff can insert crm_tasks" ON public.crm_tasks FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update crm_tasks" ON public.crm_tasks FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can delete crm_tasks" ON public.crm_tasks FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- crm_lead_custom_values
DROP POLICY IF EXISTS "Authenticated users can insert crm_lead_custom_values" ON public.crm_lead_custom_values;
DROP POLICY IF EXISTS "Authenticated users can update crm_lead_custom_values" ON public.crm_lead_custom_values;
DROP POLICY IF EXISTS "Authenticated users can delete crm_lead_custom_values" ON public.crm_lead_custom_values;
CREATE POLICY "Staff can insert crm_lead_custom_values" ON public.crm_lead_custom_values FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update crm_lead_custom_values" ON public.crm_lead_custom_values FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can delete crm_lead_custom_values" ON public.crm_lead_custom_values FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- crm_lead_stage_history
DROP POLICY IF EXISTS "Authenticated users can insert crm_lead_stage_history" ON public.crm_lead_stage_history;
DROP POLICY IF EXISTS "Authenticated users can update crm_lead_stage_history" ON public.crm_lead_stage_history;
DROP POLICY IF EXISTS "Authenticated users can delete crm_lead_stage_history" ON public.crm_lead_stage_history;
CREATE POLICY "Staff can insert crm_lead_stage_history" ON public.crm_lead_stage_history FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update crm_lead_stage_history" ON public.crm_lead_stage_history FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can delete crm_lead_stage_history" ON public.crm_lead_stage_history FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- crm_followup_queue
DROP POLICY IF EXISTS "Authenticated users can insert crm_followup_queue" ON public.crm_followup_queue;
DROP POLICY IF EXISTS "Authenticated users can update crm_followup_queue" ON public.crm_followup_queue;
DROP POLICY IF EXISTS "Authenticated users can delete crm_followup_queue" ON public.crm_followup_queue;
CREATE POLICY "Staff can insert crm_followup_queue" ON public.crm_followup_queue FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update crm_followup_queue" ON public.crm_followup_queue FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can delete crm_followup_queue" ON public.crm_followup_queue FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- bot_executions
DROP POLICY IF EXISTS "Authenticated users can insert bot_executions" ON public.bot_executions;
DROP POLICY IF EXISTS "Authenticated users can update bot_executions" ON public.bot_executions;
DROP POLICY IF EXISTS "Authenticated users can delete bot_executions" ON public.bot_executions;
CREATE POLICY "Staff can insert bot_executions" ON public.bot_executions FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update bot_executions" ON public.bot_executions FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can delete bot_executions" ON public.bot_executions FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- bot_execution_logs
DROP POLICY IF EXISTS "Authenticated users can insert bot_execution_logs" ON public.bot_execution_logs;
DROP POLICY IF EXISTS "Authenticated users can update bot_execution_logs" ON public.bot_execution_logs;
DROP POLICY IF EXISTS "Authenticated users can delete bot_execution_logs" ON public.bot_execution_logs;
CREATE POLICY "Staff can insert bot_execution_logs" ON public.bot_execution_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update bot_execution_logs" ON public.bot_execution_logs FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can delete bot_execution_logs" ON public.bot_execution_logs FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- pacientes
DROP POLICY IF EXISTS "Authenticated users can insert pacientes" ON public.pacientes;
DROP POLICY IF EXISTS "Authenticated users can update pacientes" ON public.pacientes;
DROP POLICY IF EXISTS "Authenticated users can delete pacientes" ON public.pacientes;
CREATE POLICY "Staff can insert pacientes" ON public.pacientes FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update pacientes" ON public.pacientes FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins and managers can delete pacientes" ON public.pacientes FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- orcamentos
DROP POLICY IF EXISTS "Authenticated users can insert orcamentos" ON public.orcamentos;
DROP POLICY IF EXISTS "Authenticated users can update orcamentos" ON public.orcamentos;
DROP POLICY IF EXISTS "Authenticated users can delete orcamentos" ON public.orcamentos;
CREATE POLICY "Staff can insert orcamentos" ON public.orcamentos FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update orcamentos" ON public.orcamentos FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins and managers can delete orcamentos" ON public.orcamentos FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- tratamentos
DROP POLICY IF EXISTS "Authenticated users can insert tratamentos" ON public.tratamentos;
DROP POLICY IF EXISTS "Authenticated users can update tratamentos" ON public.tratamentos;
DROP POLICY IF EXISTS "Authenticated users can delete tratamentos" ON public.tratamentos;
CREATE POLICY "Staff can insert tratamentos" ON public.tratamentos FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update tratamentos" ON public.tratamentos FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins and managers can delete tratamentos" ON public.tratamentos FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- pagamentos
DROP POLICY IF EXISTS "Authenticated users can insert pagamentos" ON public.pagamentos;
DROP POLICY IF EXISTS "Authenticated users can update pagamentos" ON public.pagamentos;
DROP POLICY IF EXISTS "Authenticated users can delete pagamentos" ON public.pagamentos;
CREATE POLICY "Staff can insert pagamentos" ON public.pagamentos FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update pagamentos" ON public.pagamentos FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins and managers can delete pagamentos" ON public.pagamentos FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- leads_diarios
DROP POLICY IF EXISTS "Authenticated users can insert leads_diarios" ON public.leads_diarios;
DROP POLICY IF EXISTS "Authenticated users can update leads_diarios" ON public.leads_diarios;
DROP POLICY IF EXISTS "Authenticated users can delete leads_diarios" ON public.leads_diarios;
CREATE POLICY "Staff can insert leads_diarios" ON public.leads_diarios FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update leads_diarios" ON public.leads_diarios FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins and managers can delete leads_diarios" ON public.leads_diarios FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

-- registros_diarios_atendimento
DROP POLICY IF EXISTS "Authenticated users can insert registros_diarios_atendimento" ON public.registros_diarios_atendimento;
DROP POLICY IF EXISTS "Authenticated users can update registros_diarios_atendimento" ON public.registros_diarios_atendimento;
DROP POLICY IF EXISTS "Authenticated users can delete registros_diarios_atendimento" ON public.registros_diarios_atendimento;
CREATE POLICY "Staff can insert registros_diarios_atendimento" ON public.registros_diarios_atendimento FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update registros_diarios_atendimento" ON public.registros_diarios_atendimento FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins and managers can delete registros_diarios_atendimento" ON public.registros_diarios_atendimento FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
