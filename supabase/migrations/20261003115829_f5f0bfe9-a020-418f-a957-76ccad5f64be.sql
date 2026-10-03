CREATE OR REPLACE FUNCTION public.pagamento_orto_regra()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.dontus_key IS NULL
     AND upper(coalesce(NEW.especialidade,'')) LIKE '%ORTO%'
     AND coalesce(NEW.recorrencia_orto,false) = false
     AND EXISTS (SELECT 1 FROM public.pagamentos p
                  WHERE p.paciente_id = NEW.paciente_id
                    AND p.id <> NEW.id
                    AND upper(coalesce(p.especialidade,'')) LIKE '%ORTO%'
                    AND p.data_pagamento < NEW.data_pagamento) THEN
    NEW.recorrencia_orto := true;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pagamento_orto_regra() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_aaa_pagamento_orto_regra ON public.pagamentos;
CREATE TRIGGER trg_aaa_pagamento_orto_regra BEFORE INSERT OR UPDATE OF especialidade, recorrencia_orto, data_pagamento, paciente_id
  ON public.pagamentos FOR EACH ROW EXECUTE FUNCTION public.pagamento_orto_regra();

CREATE OR REPLACE FUNCTION public.auto_link_paciente_to_lead_on_pagamento()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_paciente record; v_clinica_nome text; v_tail text; v_lead record;
  v_lead_count int; v_multi_note text; v_user record; v_title text; v_body text;
BEGIN
  IF NEW.recorrencia_orto IS TRUE THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.crm_lead_pacientes WHERE paciente_id = NEW.paciente_id) THEN
    RETURN NEW;
  END IF;
  SELECT id, nome, telefone, tenant_id INTO v_paciente FROM public.pacientes WHERE id = NEW.paciente_id;
  IF v_paciente.id IS NULL OR v_paciente.tenant_id IS NULL THEN RETURN NEW; END IF;
  v_tail := regexp_replace(coalesce(v_paciente.telefone,''), '[^0-9]', '', 'g');
  IF length(v_tail) < 8 THEN RETURN NEW; END IF;
  v_tail := right(v_tail, 8);
  SELECT count(*) INTO v_lead_count FROM public.crm_leads l
   WHERE l.tenant_id = v_paciente.tenant_id AND l.whatsapp_number_id IS NULL
     AND right(regexp_replace(coalesce(l.phone,''), '[^0-9]', '', 'g'), 8) = v_tail;
  IF v_lead_count = 0 THEN RETURN NEW; END IF;
  SELECT l.id, l.name INTO v_lead FROM public.crm_leads l
   WHERE l.tenant_id = v_paciente.tenant_id AND l.whatsapp_number_id IS NULL
     AND right(regexp_replace(coalesce(l.phone,''), '[^0-9]', '', 'g'), 8) = v_tail
   ORDER BY l.created_at DESC LIMIT 1;
  INSERT INTO public.crm_lead_pacientes (lead_id, paciente_id, is_primary)
  VALUES (v_lead.id, v_paciente.id, true) ON CONFLICT (lead_id, paciente_id) DO NOTHING;
  SELECT nome INTO v_clinica_nome FROM public.clinicas WHERE id = NEW.clinica_id;
  v_multi_note := CASE WHEN v_lead_count > 1
    THEN format(' (havia %s leads com este telefone — vinculado ao mais recente)', v_lead_count) ELSE '' END;
  v_title := 'Paciente pago sem origem Kommo — vinculado por telefone';
  v_body := format('Paciente: %s%s%s | Telefone: %s | Lead: %s (id %s) | Valor: R$ %s | Data: %s | Clínica: %s%s',
    v_paciente.nome, E'\n', '', v_paciente.telefone, coalesce(v_lead.name, '—'), v_lead.id,
    to_char(NEW.valor, 'FM999G999G990D00'), to_char(NEW.data_pagamento, 'DD/MM/YYYY'),
    coalesce(v_clinica_nome, '—'), v_multi_note);
  FOR v_user IN SELECT DISTINCT p.id FROM public.profiles p JOIN public.user_roles ur ON ur.user_id = p.id
     WHERE p.tenant_id = v_paciente.tenant_id AND ur.role IN ('crc','gerente','superadmin')
  LOOP
    INSERT INTO public.crm_notifications (user_id, type, title, body, lead_id, is_read)
    VALUES (v_user.id, 'warning', v_title, v_body, v_lead.id, false);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$function$;