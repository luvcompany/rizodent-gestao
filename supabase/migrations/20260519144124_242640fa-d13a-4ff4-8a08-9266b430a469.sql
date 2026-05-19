
-- 1. Update can_access_pipeline so allowed_roles is respected even for admin/gerente
CREATE OR REPLACE FUNCTION public.can_access_pipeline(_pipeline_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    public.user_override(auth.uid(), 'pipeline', _pipeline_id::text),
    has_role(auth.uid(), 'superadmin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.crm_pipelines p
      WHERE p.id = _pipeline_id
        AND (
          (p.allowed_roles IS NULL
            AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role)))
          OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = ANY(p.allowed_roles)
          )
        )
    )
  );
$function$;

-- 2. Grant CRC parity with admin/gerente on operational tables

-- bots
DROP POLICY IF EXISTS "Admins and managers can delete bots" ON public.bots;
CREATE POLICY "Admins managers crc can delete bots" ON public.bots FOR DELETE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));
DROP POLICY IF EXISTS "Admins and managers can insert bots" ON public.bots;
CREATE POLICY "Admins managers crc can insert bots" ON public.bots FOR INSERT WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));
DROP POLICY IF EXISTS "Admins and managers can update bots" ON public.bots;
CREATE POLICY "Admins managers crc can update bots" ON public.bots FOR UPDATE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));

-- bot_stage_triggers
DROP POLICY IF EXISTS "Admins and managers can delete bot_stage_triggers" ON public.bot_stage_triggers;
CREATE POLICY "Admins managers crc can delete bot_stage_triggers" ON public.bot_stage_triggers FOR DELETE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));
DROP POLICY IF EXISTS "Admins and managers can insert bot_stage_triggers" ON public.bot_stage_triggers;
CREATE POLICY "Admins managers crc can insert bot_stage_triggers" ON public.bot_stage_triggers FOR INSERT WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));
DROP POLICY IF EXISTS "Admins and managers can update bot_stage_triggers" ON public.bot_stage_triggers;
CREATE POLICY "Admins managers crc can update bot_stage_triggers" ON public.bot_stage_triggers FOR UPDATE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));

-- bot_versions
DROP POLICY IF EXISTS "Admins and managers can delete bot_versions" ON public.bot_versions;
CREATE POLICY "Admins managers crc can delete bot_versions" ON public.bot_versions FOR DELETE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));
DROP POLICY IF EXISTS "Admins and managers can insert bot_versions" ON public.bot_versions;
CREATE POLICY "Admins managers crc can insert bot_versions" ON public.bot_versions FOR INSERT WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));

-- bot_executions
DROP POLICY IF EXISTS "Admins and managers can delete bot_executions" ON public.bot_executions;
CREATE POLICY "Admins managers crc can delete bot_executions" ON public.bot_executions FOR DELETE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));

-- bot_execution_logs
DROP POLICY IF EXISTS "Admins and managers can delete bot_execution_logs" ON public.bot_execution_logs;
CREATE POLICY "Admins managers crc can delete bot_execution_logs" ON public.bot_execution_logs FOR DELETE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));

-- crm_automations
DROP POLICY IF EXISTS "Admins and managers can delete crm_automations" ON public.crm_automations;
CREATE POLICY "Admins managers crc can delete crm_automations" ON public.crm_automations FOR DELETE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));
DROP POLICY IF EXISTS "Admins and managers can insert crm_automations" ON public.crm_automations;
CREATE POLICY "Admins managers crc can insert crm_automations" ON public.crm_automations FOR INSERT WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));
DROP POLICY IF EXISTS "Admins and managers can update crm_automations" ON public.crm_automations;
CREATE POLICY "Admins managers crc can update crm_automations" ON public.crm_automations FOR UPDATE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));

-- crm_automation_executions
DROP POLICY IF EXISTS "Admins and managers can delete crm_automation_executions" ON public.crm_automation_executions;
CREATE POLICY "Admins managers crc can delete crm_automation_executions" ON public.crm_automation_executions FOR DELETE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));

-- crm_custom_fields
DROP POLICY IF EXISTS "Admins and managers can delete crm_custom_fields" ON public.crm_custom_fields;
CREATE POLICY "Admins managers crc can delete crm_custom_fields" ON public.crm_custom_fields FOR DELETE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));
DROP POLICY IF EXISTS "Admins and managers can insert crm_custom_fields" ON public.crm_custom_fields;
CREATE POLICY "Admins managers crc can insert crm_custom_fields" ON public.crm_custom_fields FOR INSERT WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));
DROP POLICY IF EXISTS "Admins and managers can update crm_custom_fields" ON public.crm_custom_fields;
CREATE POLICY "Admins managers crc can update crm_custom_fields" ON public.crm_custom_fields FOR UPDATE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));

-- crm_followup_configs
DROP POLICY IF EXISTS "Admins and managers can delete crm_followup_configs" ON public.crm_followup_configs;
CREATE POLICY "Admins managers crc can delete crm_followup_configs" ON public.crm_followup_configs FOR DELETE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));
DROP POLICY IF EXISTS "Admins and managers can insert crm_followup_configs" ON public.crm_followup_configs;
CREATE POLICY "Admins managers crc can insert crm_followup_configs" ON public.crm_followup_configs FOR INSERT WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));
DROP POLICY IF EXISTS "Admins and managers can update crm_followup_configs" ON public.crm_followup_configs;
CREATE POLICY "Admins managers crc can update crm_followup_configs" ON public.crm_followup_configs FOR UPDATE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));

-- ai_assistant_config
DROP POLICY IF EXISTS "Admins/managers can delete ai_assistant_config" ON public.ai_assistant_config;
CREATE POLICY "Admins managers crc can delete ai_assistant_config" ON public.ai_assistant_config FOR DELETE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));
DROP POLICY IF EXISTS "Admins/managers can insert ai_assistant_config" ON public.ai_assistant_config;
CREATE POLICY "Admins managers crc can insert ai_assistant_config" ON public.ai_assistant_config FOR INSERT WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));
DROP POLICY IF EXISTS "Admins/managers can update ai_assistant_config" ON public.ai_assistant_config;
CREATE POLICY "Admins managers crc can update ai_assistant_config" ON public.ai_assistant_config FOR UPDATE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));

-- ai_conversation_analysis
DROP POLICY IF EXISTS "Admins/managers can delete ai_conversation_analysis" ON public.ai_conversation_analysis;
CREATE POLICY "Admins managers crc can delete ai_conversation_analysis" ON public.ai_conversation_analysis FOR DELETE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));

-- crm_lead_pacientes
DROP POLICY IF EXISTS "Admins and managers can delete crm_lead_pacientes" ON public.crm_lead_pacientes;
CREATE POLICY "Admins managers crc can delete crm_lead_pacientes" ON public.crm_lead_pacientes FOR DELETE USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'gerente'::app_role) OR has_role(auth.uid(),'crc'::app_role));
