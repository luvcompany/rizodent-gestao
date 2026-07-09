
DROP POLICY IF EXISTS "Authenticated can view ad_id_mapping" ON public.ad_id_mapping;
DROP POLICY IF EXISTS "Authenticated can view ai_assistant_config" ON public.ai_assistant_config;
DROP POLICY IF EXISTS "Authenticated users can view bot_execution_logs" ON public.bot_execution_logs;
DROP POLICY IF EXISTS "Authenticated users can view bot_executions" ON public.bot_executions;
DROP POLICY IF EXISTS "Authenticated users can view bot_stage_triggers" ON public.bot_stage_triggers;
DROP POLICY IF EXISTS "Authenticated users can view bot_versions" ON public.bot_versions;
DROP POLICY IF EXISTS "Authenticated users can view clinicas" ON public.clinicas;
DROP POLICY IF EXISTS "Authenticated can view crm_automation_executions" ON public.crm_automation_executions;
DROP POLICY IF EXISTS "Authenticated users can view crm_automation_queue" ON public.crm_automation_queue;
DROP POLICY IF EXISTS "Authenticated users can view crm_automations" ON public.crm_automations;
DROP POLICY IF EXISTS "Authenticated can view crm_broadcast_recipients" ON public.crm_broadcast_recipients;
DROP POLICY IF EXISTS "Authenticated users can view crm_conversation_notes" ON public.crm_conversation_notes;
DROP POLICY IF EXISTS "Authenticated users can view crm_custom_fields" ON public.crm_custom_fields;
DROP POLICY IF EXISTS "Authenticated users can view crm_followup_configs" ON public.crm_followup_configs;
DROP POLICY IF EXISTS "Authenticated users can view crm_followup_queue" ON public.crm_followup_queue;
DROP POLICY IF EXISTS "Authenticated users can view crm_lead_custom_values" ON public.crm_lead_custom_values;
DROP POLICY IF EXISTS "Authenticated can view crm_lead_pacientes" ON public.crm_lead_pacientes;
DROP POLICY IF EXISTS "Authenticated users can view crm_lead_stage_history" ON public.crm_lead_stage_history;
DROP POLICY IF EXISTS "Authenticated can view dashboard_holidays" ON public.dashboard_holidays;
DROP POLICY IF EXISTS "Authenticated users can view funnel_channels" ON public.funnel_channels;
DROP POLICY IF EXISTS "Authenticated users can view leads_diarios" ON public.leads_diarios;
DROP POLICY IF EXISTS "Authenticated users can view pacientes" ON public.pacientes;
DROP POLICY IF EXISTS "Authenticated users can view pagamentos" ON public.pagamentos;
DROP POLICY IF EXISTS "Authenticated users can view registros_diarios_atendimento" ON public.registros_diarios_atendimento;
DROP POLICY IF EXISTS "Authenticated users can view tipos_procedimento" ON public.tipos_procedimento;
DROP POLICY IF EXISTS "Authenticated users can view tratamentos" ON public.tratamentos;
-- Note: "auth_view_plans" on plans is intentionally kept — plans is a global catalog.
