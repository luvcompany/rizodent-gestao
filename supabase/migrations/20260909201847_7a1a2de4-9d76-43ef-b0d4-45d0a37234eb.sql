-- Ajuste depois do ensaio P2 de 09/09: com carência 0, o comparecimento
-- entregava o lead ao administrador ANTES de refletir a etapa, e o lead ficava
-- em "Compareceu" (ou na etapa antiga) em vez de "Não contratado". Ordem nova
-- no gatilho: agenda/entrega → etapa (Compareceu/Contratado) → se entregou na
-- hora, "Não contratado" quando a consulta segue sem contrato. A RPC da SDR
-- relê o lead depois do gatilho e só mexe na etapa se ele ainda estiver numa
-- etapa visível.

CREATE OR REPLACE FUNCTION public.sdr_comparecimento_entrega()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE l public.crm_leads; v_stage uuid; v_res text;
BEGIN
  IF NEW.lead_id IS NULL OR NEW.status NOT IN ('contracted', 'not_contracted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  BEGIN
    SELECT * INTO l FROM public.crm_leads WHERE id = NEW.lead_id;
    IF NOT FOUND OR l.assigned_to IS NULL OR NOT public.has_role(l.assigned_to, 'sdr'::app_role) THEN RETURN NEW; END IF;
    v_res := public.sdr_agenda_entrega_ao_gestor(NEW.lead_id,
      'compareceu em ' || to_char(NEW.scheduled_date, 'DD/MM') || ' (' || NEW.status || ')', '✅ Compareceu', NEW.id);
    -- Reflete no funil (Compareceu / Contratado) se o lead ainda está numa etapa visível para a SDR.
    SELECT * INTO l FROM public.crm_leads WHERE id = NEW.lead_id;
    IF EXISTS (SELECT 1 FROM public.crm_stages s WHERE s.id = l.stage_id AND COALESCE(s.visivel_para_sdr, true)) THEN
      SELECT s.id INTO v_stage FROM public.crm_stages s
       WHERE s.pipeline_id = l.pipeline_id
         AND public.normaliza_nome_etapa(s.name) = CASE WHEN NEW.status = 'contracted' THEN 'contratado' ELSE 'compareceu' END
       ORDER BY s.position LIMIT 1;
      IF v_stage IS NOT NULL AND v_stage IS DISTINCT FROM l.stage_id THEN
        UPDATE public.crm_leads SET stage_id = v_stage, updated_at = now() WHERE id = l.id;
      END IF;
    END IF;
    -- Entregou na hora (carência 0): sem contrato → Não contratado, já com o administrador.
    IF v_res = 'entregue' THEN
      PERFORM public.sdr_pos_entrega_etapa(NEW.lead_id, NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sdr_comparecimento_entrega: % (lead %)', SQLERRM, NEW.lead_id;
  END;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.sdr_marcar_comparecimento(p_appointment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE a public.crm_appointments; l public.crm_leads; v_stage uuid; v_stage_nome text; v_nome text; n integer; v_movido boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'sdr'::app_role) THEN
    RAISE EXCEPTION 'Só a SDR usa esta ação.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO a FROM public.crm_appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consulta não encontrada.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id = a.lead_id;
  IF NOT FOUND OR l.assigned_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Este lead não é seu.' USING ERRCODE = '42501';
  END IF;
  IF a.status NOT IN ('confirmed', 'pending') THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'ja_tem_desfecho', 'status', a.status);
  END IF;
  -- O gatilho da consulta (sdr_comparecimento_entrega) agenda/entrega e move a etapa.
  UPDATE public.crm_appointments
     SET status = 'not_contracted', outcome_source = 'sdr', updated_at = now()
   WHERE id = a.id AND status IN ('confirmed', 'pending');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN jsonb_build_object('ok', false, 'motivo', 'ja_tem_desfecho'); END IF;

  -- Relê o lead: o gatilho pode já ter movido a etapa (e, com carência 0, entregue).
  SELECT * INTO l FROM public.crm_leads WHERE id = a.lead_id;
  IF EXISTS (SELECT 1 FROM public.crm_stages s WHERE s.id = l.stage_id AND COALESCE(s.visivel_para_sdr, true)) THEN
    SELECT s.id, s.name INTO v_stage, v_stage_nome FROM public.crm_stages s
     WHERE s.pipeline_id = l.pipeline_id AND public.normaliza_nome_etapa(s.name) = 'compareceu'
     ORDER BY s.position LIMIT 1;
    IF v_stage IS NULL THEN
      SELECT s.id, s.name INTO v_stage, v_stage_nome FROM public.crm_stages s
       WHERE s.pipeline_id = l.pipeline_id AND public.normaliza_nome_etapa(s.name) = 'nao contratado'
       ORDER BY s.position LIMIT 1;
    END IF;
    IF v_stage IS NOT NULL AND v_stage IS DISTINCT FROM l.stage_id THEN
      UPDATE public.crm_leads SET stage_id = v_stage, updated_at = now() WHERE id = l.id;
      v_movido := true;
    END IF;
  END IF;
  SELECT * INTO l FROM public.crm_leads WHERE id = a.lead_id;
  SELECT s.name INTO v_stage_nome FROM public.crm_stages s WHERE s.id = l.stage_id;
  SELECT COALESCE(NULLIF(btrim(p.nome), ''), p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  INSERT INTO public.messages (lead_id, tenant_id, direction, type, content, status)
  VALUES (l.id, l.tenant_id, 'outbound', 'system',
          '✅ Compareceu em ' || to_char(a.scheduled_date, 'DD/MM') || ' — marcado por ' || COALESCE(v_nome, 'SDR')
          || COALESCE(' · etapa ' || v_stage_nome, ''), 'system');
  RETURN jsonb_build_object('ok', true, 'lead_id', l.id, 'stage_id', CASE WHEN v_movido THEN v_stage ELSE NULL END,
                            'stage_nome', v_stage_nome, 'phone', l.phone);
END $fn$;