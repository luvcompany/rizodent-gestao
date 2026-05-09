
CREATE OR REPLACE FUNCTION public.hard_delete_tenant(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_ids uuid[];
BEGIN
  -- Collect auth user ids that will need to be removed by the caller
  SELECT COALESCE(array_agg(id), '{}') INTO v_user_ids FROM public.profiles WHERE tenant_id = _tenant_id;

  -- Lead-scoped child tables (must come before crm_leads)
  DELETE FROM public.crm_lead_stage_history WHERE lead_id IN (SELECT id FROM public.crm_leads WHERE tenant_id = _tenant_id);
  DELETE FROM public.crm_lead_pacientes WHERE lead_id IN (SELECT id FROM public.crm_leads WHERE tenant_id = _tenant_id);
  DELETE FROM public.crm_lead_custom_values WHERE lead_id IN (SELECT id FROM public.crm_leads WHERE tenant_id = _tenant_id);
  DELETE FROM public.crm_followup_queue WHERE lead_id IN (SELECT id FROM public.crm_leads WHERE tenant_id = _tenant_id);
  DELETE FROM public.crm_automation_queue WHERE lead_id IN (SELECT id FROM public.crm_leads WHERE tenant_id = _tenant_id);
  DELETE FROM public.crm_automation_executions WHERE lead_id IN (SELECT id FROM public.crm_leads WHERE tenant_id = _tenant_id);
  DELETE FROM public.crm_broadcast_recipients WHERE lead_id IN (SELECT id FROM public.crm_leads WHERE tenant_id = _tenant_id);
  DELETE FROM public.ai_conversation_analysis WHERE lead_id IN (SELECT id FROM public.crm_leads WHERE tenant_id = _tenant_id);

  -- Bot-scoped child tables
  DELETE FROM public.bot_execution_logs WHERE execution_id IN (SELECT e.id FROM public.bot_executions e JOIN public.bots b ON b.id = e.bot_id WHERE b.tenant_id = _tenant_id);
  DELETE FROM public.bot_executions WHERE bot_id IN (SELECT id FROM public.bots WHERE tenant_id = _tenant_id);
  DELETE FROM public.bot_versions WHERE bot_id IN (SELECT id FROM public.bots WHERE tenant_id = _tenant_id);
  DELETE FROM public.bot_stage_triggers WHERE bot_id IN (SELECT id FROM public.bots WHERE tenant_id = _tenant_id);

  -- Tenant-scoped tables
  DELETE FROM public.crm_appointments WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_tasks WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_conversation_notes WHERE tenant_id = _tenant_id;
  DELETE FROM public.messages WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_leads WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_stages WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_pipelines WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_followup_configs WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_automations WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_custom_fields WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_broadcasts WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_quick_replies WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_whatsapp_templates WHERE tenant_id = _tenant_id;
  DELETE FROM public.bots WHERE tenant_id = _tenant_id;
  DELETE FROM public.pacientes WHERE tenant_id = _tenant_id;
  DELETE FROM public.clinicas WHERE tenant_id = _tenant_id;
  DELETE FROM public.tipos_procedimento WHERE tenant_id = _tenant_id;
  DELETE FROM public.ai_assistant_config WHERE tenant_id = _tenant_id;
  DELETE FROM public.dashboard_holidays WHERE tenant_id = _tenant_id;
  DELETE FROM public.funnel_channels WHERE tenant_id = _tenant_id;
  DELETE FROM public.ad_id_mapping WHERE tenant_id = _tenant_id;
  DELETE FROM public.integrations WHERE tenant_id = _tenant_id;
  DELETE FROM public.instagram_accounts WHERE tenant_id = _tenant_id;
  DELETE FROM public.access_logs WHERE tenant_id = _tenant_id;
  DELETE FROM public.user_roles WHERE tenant_id = _tenant_id;
  DELETE FROM public.profiles WHERE tenant_id = _tenant_id;
  DELETE FROM public.tenant_invoices WHERE tenant_id = _tenant_id;
  DELETE FROM public.tenant_subscriptions WHERE tenant_id = _tenant_id;
  DELETE FROM public.tenant_usage WHERE tenant_id = _tenant_id;

  -- Finally, the tenant row itself
  DELETE FROM public.tenants WHERE id = _tenant_id;

  RETURN jsonb_build_object('user_ids', to_jsonb(v_user_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.hard_delete_tenant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hard_delete_tenant(uuid) TO service_role;
