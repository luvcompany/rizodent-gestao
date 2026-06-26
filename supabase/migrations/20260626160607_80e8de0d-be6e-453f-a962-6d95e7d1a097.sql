
CREATE OR REPLACE FUNCTION public.auto_link_lead_to_paciente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_last8 text;
  v_pac_id uuid;
  v_count int;
BEGIN
  IF NEW.phone IS NULL OR NEW.paciente_id IS NOT NULL THEN RETURN NEW; END IF;
  v_last8 := right(regexp_replace(NEW.phone,'[^0-9]','','g'), 8);
  IF length(v_last8) < 8 THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_count
    FROM public.pacientes p
   WHERE p.tenant_id = NEW.tenant_id
     AND right(regexp_replace(p.telefone,'[^0-9]','','g'), 8) = v_last8
     AND NOT EXISTS (SELECT 1 FROM public.crm_lead_pacientes lp WHERE lp.paciente_id = p.id);

  IF v_count = 1 THEN
    SELECT p.id INTO v_pac_id
      FROM public.pacientes p
     WHERE p.tenant_id = NEW.tenant_id
       AND right(regexp_replace(p.telefone,'[^0-9]','','g'), 8) = v_last8
       AND NOT EXISTS (SELECT 1 FROM public.crm_lead_pacientes lp WHERE lp.paciente_id = p.id)
     LIMIT 1;

    INSERT INTO public.crm_lead_pacientes (lead_id, paciente_id, is_primary)
    VALUES (NEW.id, v_pac_id, true)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_link_paciente_to_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_last8 text;
  v_lead_id uuid;
  v_count int;
BEGIN
  IF NEW.telefone IS NULL THEN RETURN NEW; END IF;
  v_last8 := right(regexp_replace(NEW.telefone,'[^0-9]','','g'), 8);
  IF length(v_last8) < 8 THEN RETURN NEW; END IF;

  IF EXISTS (SELECT 1 FROM public.crm_lead_pacientes WHERE paciente_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.crm_leads l
   WHERE l.tenant_id = NEW.tenant_id
     AND l.paciente_id IS NULL
     AND right(regexp_replace(l.phone,'[^0-9]','','g'), 8) = v_last8;

  IF v_count = 1 THEN
    SELECT l.id INTO v_lead_id
      FROM public.crm_leads l
     WHERE l.tenant_id = NEW.tenant_id
       AND l.paciente_id IS NULL
       AND right(regexp_replace(l.phone,'[^0-9]','','g'), 8) = v_last8
     LIMIT 1;

    INSERT INTO public.crm_lead_pacientes (lead_id, paciente_id, is_primary)
    VALUES (v_lead_id, NEW.id, true)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;
