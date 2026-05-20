-- Ao mover um lead para uma etapa que possui automação before_scheduled ativa,
-- confirma automaticamente os agendamentos pendentes desse lead.
-- Isso garante que o gatilho "X antes do agendamento" dispare corretamente,
-- já que a lógica exige status = 'confirmed'.

CREATE OR REPLACE FUNCTION public.auto_confirm_appointments_on_stage_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Só age quando a etapa realmente muda
  IF OLD.stage_id IS NOT DISTINCT FROM NEW.stage_id THEN
    RETURN NEW;
  END IF;

  -- Verifica se a nova etapa tem alguma automação before_scheduled ativa
  IF EXISTS (
    SELECT 1
    FROM public.crm_automations
    WHERE stage_id = NEW.stage_id
      AND trigger_type = 'before_scheduled'
      AND is_active = true
  ) THEN
    -- Confirma agendamentos pendentes deste lead
    UPDATE public.crm_appointments
    SET status = 'confirmed'
    WHERE lead_id = NEW.id
      AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_auto_confirm_appointments_on_stage_change ON public.crm_leads;

CREATE TRIGGER trg_auto_confirm_appointments_on_stage_change
AFTER UPDATE OF stage_id ON public.crm_leads
FOR EACH ROW
EXECUTE FUNCTION public.auto_confirm_appointments_on_stage_change();
