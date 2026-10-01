CREATE OR REPLACE FUNCTION public.cancel_followup_on_stage_exit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_motivo text;
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.stage_id IS NULL OR NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  v_motivo := 'lead saiu da etapa ' || OLD.stage_id::text || ' para ' || coalesce(NEW.stage_id::text, 'nenhuma');

  -- Bots iniciados por automação da etapa anterior que aguardam o próximo disparo.
  -- 'active' fica de fora: é o próprio bot rodando (ele pode mover o lead no meio do fluxo).
  UPDATE public.bot_executions e
     SET status = 'cancelled',
         completed_at = now(),
         timeout_at = null,
         variables = coalesce(e.variables, '{}'::jsonb)
                     || jsonb_build_object('__cancelado_motivo', v_motivo,
                                           '__cancelado_para_etapa', NEW.stage_id,
                                           '__cancelado_em', now())
    FROM public.crm_automations a
   WHERE e.lead_id = NEW.id
     AND e.status = 'waiting_reply'
     AND a.id = e.started_by_automation_id
     AND a.stage_id = OLD.stage_id
     AND coalesce(e.variables->>'__etapa_do_bot', '') IS DISTINCT FROM NEW.stage_id::text;

  -- Envios pendentes enfileirados pela entrada na etapa anterior.
  UPDATE public.crm_automation_queue q
     SET status = 'cancelled',
         error_message = v_motivo,
         updated_at = now()
    FROM public.crm_automations a
   WHERE q.lead_id = NEW.id
     AND q.status = 'pending'
     AND a.id = q.automation_id
     AND a.stage_id = OLD.stage_id
     AND a.trigger_type IN ('on_enter', 'on_create_or_enter');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_followup_on_stage_exit ON public.crm_leads;
CREATE TRIGGER trg_cancel_followup_on_stage_exit
AFTER UPDATE OF stage_id ON public.crm_leads
FOR EACH ROW EXECUTE FUNCTION public.cancel_followup_on_stage_exit();