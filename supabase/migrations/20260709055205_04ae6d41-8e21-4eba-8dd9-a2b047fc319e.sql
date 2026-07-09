
CREATE OR REPLACE FUNCTION public.hard_delete_tenant(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_ids uuid[];
  v_lead_ids uuid[];
  v_bot_ids uuid[];
  v_clinic_ids uuid[];
  v_paciente_ids uuid[];
  v_pipeline_ids uuid[];
  v_leftover_count int;
  r record;
BEGIN
  SELECT COALESCE(array_agg(id), '{}') INTO v_user_ids FROM public.profiles WHERE tenant_id = _tenant_id;
  SELECT COALESCE(array_agg(id), '{}') INTO v_lead_ids FROM public.crm_leads WHERE tenant_id = _tenant_id;
  SELECT COALESCE(array_agg(id), '{}') INTO v_bot_ids FROM public.bots WHERE tenant_id = _tenant_id;
  SELECT COALESCE(array_agg(id), '{}') INTO v_clinic_ids FROM public.clinicas WHERE tenant_id = _tenant_id;
  SELECT COALESCE(array_agg(id), '{}') INTO v_paciente_ids FROM public.pacientes WHERE tenant_id = _tenant_id;
  SELECT COALESCE(array_agg(id), '{}') INTO v_pipeline_ids FROM public.crm_pipelines WHERE tenant_id = _tenant_id;

  BEGIN
    SELECT COALESCE(array_agg(DISTINCT u.id), v_user_ids) INTO v_user_ids
    FROM auth.users u
    WHERE u.id = ANY(v_user_ids)
       OR (u.raw_user_meta_data ->> 'tenant_id') = _tenant_id::text;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Lead-scoped
  DELETE FROM public.crm_lead_stage_history WHERE lead_id = ANY(v_lead_ids);
  DELETE FROM public.crm_lead_pacientes WHERE lead_id = ANY(v_lead_ids) OR paciente_id = ANY(v_paciente_ids);
  DELETE FROM public.crm_lead_custom_values WHERE lead_id = ANY(v_lead_ids);
  DELETE FROM public.crm_lead_instagram_identities WHERE lead_id = ANY(v_lead_ids);
  DELETE FROM public.crm_lead_label_assignments WHERE lead_id = ANY(v_lead_ids);
  DELETE FROM public.crm_followup_queue WHERE lead_id = ANY(v_lead_ids);
  DELETE FROM public.crm_automation_queue WHERE lead_id = ANY(v_lead_ids);
  DELETE FROM public.crm_automation_executions WHERE lead_id = ANY(v_lead_ids);
  DELETE FROM public.crm_broadcast_recipients WHERE lead_id = ANY(v_lead_ids);
  DELETE FROM public.ai_conversation_analysis WHERE lead_id = ANY(v_lead_ids);
  DELETE FROM public.ai_good_examples WHERE lead_id = ANY(v_lead_ids);
  DELETE FROM public.ai_reply_suggestions WHERE lead_id = ANY(v_lead_ids);
  DELETE FROM public.crm_notifications WHERE lead_id = ANY(v_lead_ids);

  -- Bot-scoped
  DELETE FROM public.bot_execution_logs WHERE execution_id IN (SELECT id FROM public.bot_executions WHERE bot_id = ANY(v_bot_ids));
  DELETE FROM public.bot_executions WHERE bot_id = ANY(v_bot_ids) OR lead_id = ANY(v_lead_ids);
  DELETE FROM public.bot_versions WHERE bot_id = ANY(v_bot_ids);
  DELETE FROM public.bot_stage_triggers WHERE bot_id = ANY(v_bot_ids);

  -- Clinic/patient-scoped (these tables don't have tenant_id)
  DELETE FROM public.pagamentos WHERE clinica_id = ANY(v_clinic_ids) OR paciente_id = ANY(v_paciente_ids);
  DELETE FROM public.tratamentos WHERE clinica_id = ANY(v_clinic_ids) OR paciente_id = ANY(v_paciente_ids);
  DELETE FROM public.leads_diarios WHERE clinica_id = ANY(v_clinic_ids);
  DELETE FROM public.registros_diarios_atendimento WHERE clinica_id = ANY(v_clinic_ids);

  -- Pipeline-scoped
  DELETE FROM public.crm_funnel_custom_reports WHERE pipeline_id = ANY(v_pipeline_ids);

  -- Tenant-scoped direct deletes
  DELETE FROM public.crm_appointments WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_tasks WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_conversation_notes WHERE tenant_id = _tenant_id;
  DELETE FROM public.instagram_messages WHERE tenant_id = _tenant_id;
  DELETE FROM public.messages WHERE tenant_id = _tenant_id;
  DELETE FROM public.deleted_leads_backup WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_leads WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_stages WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_pipelines WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_followup_configs WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_automations WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_custom_fields WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_broadcasts WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_quick_replies WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_whatsapp_templates WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_user_labels WHERE tenant_id = _tenant_id;
  DELETE FROM public.crm_funnel_custom_reports WHERE tenant_id = _tenant_id;
  DELETE FROM public.bots WHERE tenant_id = _tenant_id;
  DELETE FROM public.pacientes WHERE tenant_id = _tenant_id;
  DELETE FROM public.clinicas WHERE tenant_id = _tenant_id;
  DELETE FROM public.tipos_procedimento WHERE tenant_id = _tenant_id;
  DELETE FROM public.ai_assistant_config WHERE tenant_id = _tenant_id;
  DELETE FROM public.ai_assistant_rules WHERE tenant_id = _tenant_id;
  DELETE FROM public.ai_good_examples WHERE tenant_id = _tenant_id;
  DELETE FROM public.ai_reply_suggestions WHERE tenant_id = _tenant_id;
  DELETE FROM public.dashboard_holidays WHERE tenant_id = _tenant_id;
  DELETE FROM public.funnel_channels WHERE tenant_id = _tenant_id;
  DELETE FROM public.ad_id_mapping WHERE tenant_id = _tenant_id;
  DELETE FROM public.integrations WHERE tenant_id = _tenant_id;
  DELETE FROM public.instagram_accounts WHERE tenant_id = _tenant_id;
  DELETE FROM public.instagram_oauth_states WHERE tenant_id = _tenant_id;
  DELETE FROM public.ig_accounts WHERE tenant_id = _tenant_id;
  DELETE FROM public.tenant_meta_credentials WHERE tenant_id = _tenant_id;
  DELETE FROM public.tenant_api_keys WHERE tenant_id = _tenant_id;
  DELETE FROM public.tenant_invoices WHERE tenant_id = _tenant_id;
  DELETE FROM public.tenant_subscriptions WHERE tenant_id = _tenant_id;
  DELETE FROM public.tenant_usage WHERE tenant_id = _tenant_id;
  DELETE FROM public.whatsapp_numbers WHERE tenant_id = _tenant_id;
  DELETE FROM public.whatsapp_oauth_states WHERE tenant_id = _tenant_id;
  DELETE FROM public.whatsapp_template_logs WHERE tenant_id = _tenant_id;
  DELETE FROM public.access_logs WHERE tenant_id = _tenant_id;
  DELETE FROM public.user_roles WHERE tenant_id = _tenant_id;
  DELETE FROM public.profiles WHERE tenant_id = _tenant_id;
  DELETE FROM public.tenants WHERE id = _tenant_id;

  -- Sanity check
  FOR r IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='tenant_id'
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = $1', r.table_name)
      INTO v_leftover_count USING _tenant_id;
    IF v_leftover_count > 0 THEN
      RAISE EXCEPTION 'hard_delete_tenant: sobrou % linhas em public.% para tenant %', v_leftover_count, r.table_name, _tenant_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('user_ids', v_user_ids);
END;
$function$;

-- Clean up the leftover Luv Agency tenant
DO $$
DECLARE
  v_result jsonb;
  v_uid uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = '766c90d2-713f-4a5a-b3a5-25face9cb2b1') THEN
    v_result := public.hard_delete_tenant('766c90d2-713f-4a5a-b3a5-25face9cb2b1');
    FOR v_uid IN SELECT (jsonb_array_elements_text(v_result->'user_ids'))::uuid LOOP
      BEGIN
        DELETE FROM auth.users WHERE id = v_uid;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END LOOP;
  END IF;
END $$;
