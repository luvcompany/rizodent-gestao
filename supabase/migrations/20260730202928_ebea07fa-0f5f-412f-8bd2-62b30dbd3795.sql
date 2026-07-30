CREATE OR REPLACE FUNCTION public.crm_lead_revert_or_delete(p_lead_id uuid, p_origem text DEFAULT 'paciente_delete')
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lead record;
  v_prev uuid;
  v_prev_pipeline uuid;
  v_has_conv boolean;
  v_res text;
  v_notify uuid;
BEGIN
  SELECT id, name, tenant_id, stage_id, pipeline_id, assigned_to INTO v_lead
  FROM public.crm_leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN RETURN 'nao_encontrado'; END IF;

  SELECT h.stage_id INTO v_prev
  FROM public.crm_lead_stage_history h
  WHERE h.lead_id = p_lead_id
    AND h.stage_id IS DISTINCT FROM v_lead.stage_id
  ORDER BY h.entered_at DESC
  LIMIT 1;

  IF v_prev IS NULL THEN
    SELECT h.from_stage_id INTO v_prev
    FROM public.crm_lead_stage_history h
    WHERE h.lead_id = p_lead_id
      AND h.from_stage_id IS NOT NULL
      AND h.from_stage_id IS DISTINCT FROM v_lead.stage_id
    ORDER BY h.entered_at DESC
    LIMIT 1;
  END IF;

  IF v_prev IS NOT NULL THEN
    SELECT pipeline_id INTO v_prev_pipeline FROM public.crm_stages WHERE id = v_prev;
    IF v_prev_pipeline IS NULL THEN
      v_prev := NULL;
    ELSE
      UPDATE public.crm_leads
      SET stage_id = v_prev, pipeline_id = v_prev_pipeline
      WHERE id = p_lead_id;
      v_res := 'movido';
      INSERT INTO public.crm_funil_cleanup_log (tenant_id, lead_id, lead_name, stage_from, stage_to, resultado, detalhe, origem)
      VALUES (v_lead.tenant_id, p_lead_id, v_lead.name, v_lead.stage_id, v_prev, v_res,
              (SELECT name FROM public.crm_stages WHERE id = v_prev), p_origem);
      RETURN v_res;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.lead_id = p_lead_id
      AND m.deleted_at IS NULL
      AND COALESCE(m.type, '') <> 'system'
      AND m.instagram_comment_id IS NULL
  ) INTO v_has_conv;

  IF v_has_conv THEN
    SELECT COALESCE(v_lead.assigned_to,
      (SELECT id FROM public.profiles WHERE tenant_id = v_lead.tenant_id ORDER BY created_at LIMIT 1))
    INTO v_notify;
    IF v_notify IS NOT NULL THEN
      INSERT INTO public.crm_notifications (user_id, lead_id, title, body, type, dedupe_key)
      VALUES (v_notify, p_lead_id, 'Conferir etapa do lead',
              'Paciente apagado; lead mantido por ter conversa — conferir etapa',
              'funil_integridade', 'funil_keep:' || p_lead_id::text)
      ON CONFLICT DO NOTHING;
    END IF;
    v_res := 'mantido';
    INSERT INTO public.crm_funil_cleanup_log (tenant_id, lead_id, lead_name, stage_from, stage_to, resultado, detalhe, origem)
    VALUES (v_lead.tenant_id, p_lead_id, v_lead.name, v_lead.stage_id, v_lead.stage_id, v_res, 'tem conversa real', p_origem);
    RETURN v_res;
  END IF;

  DELETE FROM public.crm_lead_pacientes WHERE lead_id = p_lead_id;
  DELETE FROM public.crm_lead_stage_history WHERE lead_id = p_lead_id;
  DELETE FROM public.crm_notifications WHERE lead_id = p_lead_id;
  DELETE FROM public.crm_tasks WHERE lead_id = p_lead_id;
  DELETE FROM public.crm_leads WHERE id = p_lead_id;
  v_res := 'apagado';
  INSERT INTO public.crm_funil_cleanup_log (tenant_id, lead_id, lead_name, stage_from, stage_to, resultado, detalhe, origem)
  VALUES (v_lead.tenant_id, p_lead_id, v_lead.name, v_lead.stage_id, NULL, v_res, 'sem etapa anterior e sem conversa', p_origem);
  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_lead_revert_or_delete(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_lead_revert_or_delete(uuid, text) TO service_role;