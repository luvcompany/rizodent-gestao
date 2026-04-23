-- Função: auto-confirma agendamentos pendentes quando lead entra em etapa "Contratado(s)"
CREATE OR REPLACE FUNCTION public.auto_confirm_appointments_on_contracted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage_name text;
  v_normalized text;
  v_is_contracted boolean := false;
BEGIN
  -- Só age quando stage_id mudou
  IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_stage_name FROM public.crm_stages WHERE id = NEW.stage_id;
  IF v_stage_name IS NULL THEN
    RETURN NEW;
  END IF;

  -- Normaliza: minúsculas, sem acentos
  v_normalized := lower(translate(v_stage_name,
    'ÁÀÃÂÄáàãâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÕÔÖóòõôöÚÙÛÜúùûüÇç',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'));

  -- Aceita "contratado" ou "contratados", mas exclui "nao contratado"
  IF (v_normalized = 'contratado' OR v_normalized = 'contratados'
      OR (v_normalized LIKE '%contrat%' AND v_normalized NOT LIKE '%nao contrat%'))
  THEN
    v_is_contracted := true;
  END IF;

  IF NOT v_is_contracted THEN
    RETURN NEW;
  END IF;

  -- Atualiza todos os agendamentos pendentes/confirmados deste lead para 'contracted'
  UPDATE public.crm_appointments
     SET status = 'contracted',
         confirmed_at = COALESCE(confirmed_at, now()),
         updated_at = now()
   WHERE lead_id = NEW.id
     AND status NOT IN ('contracted', 'no_show', 'not_contracted');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_confirm_appointments_on_contracted ON public.crm_leads;
CREATE TRIGGER trg_auto_confirm_appointments_on_contracted
AFTER UPDATE OF stage_id ON public.crm_leads
FOR EACH ROW
EXECUTE FUNCTION public.auto_confirm_appointments_on_contracted();