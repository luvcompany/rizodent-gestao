
CREATE OR REPLACE FUNCTION public.ensure_lead_for_pagamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_link boolean;
  v_pac record;
  v_new_lead_id uuid;
  v_pipeline_id uuid := 'a1b2c3d4-0001-4000-8000-000000000001';
  v_stage_id uuid := '15ee8d94-02c0-430b-89f4-96043a40c74e';
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM crm_lead_pacientes WHERE paciente_id = NEW.paciente_id
  ) INTO v_has_link;

  IF v_has_link THEN
    RETURN NEW;
  END IF;

  SELECT id, nome, telefone, cidade, origem
    INTO v_pac
    FROM pacientes WHERE id = NEW.paciente_id;

  IF v_pac.id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO crm_leads (name, phone, pipeline_id, stage_id, paciente_id, cidade, source, value)
  VALUES (v_pac.nome, v_pac.telefone, v_pipeline_id, v_stage_id, v_pac.id, v_pac.cidade,
          COALESCE(v_pac.origem, 'Retroativo'), 0)
  RETURNING id INTO v_new_lead_id;

  INSERT INTO crm_lead_pacientes (lead_id, paciente_id, is_primary)
  VALUES (v_new_lead_id, v_pac.id, true);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_lead_for_pagamento ON public.pagamentos;
CREATE TRIGGER trg_ensure_lead_for_pagamento
AFTER INSERT ON public.pagamentos
FOR EACH ROW
EXECUTE FUNCTION public.ensure_lead_for_pagamento();
