CREATE OR REPLACE FUNCTION public.bloqueia_lead_sem_telefone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(btrim(NEW.phone),'') <> '' THEN RETURN NEW; END IF;
  IF coalesce(NEW.source,'') ILIKE '%insta%' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM crm_pipelines p WHERE p.id = NEW.pipeline_id AND p.is_instagram) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Lead sem telefone não pode ser criado. Informe o telefone.' USING ERRCODE = 'check_violation';
END $$;
GRANT EXECUTE ON FUNCTION public.bloqueia_lead_sem_telefone() TO authenticated, service_role;
DROP TRIGGER IF EXISTS trg_bloqueia_lead_sem_telefone ON public.crm_leads;
CREATE TRIGGER trg_bloqueia_lead_sem_telefone BEFORE INSERT ON public.crm_leads
FOR EACH ROW EXECUTE FUNCTION public.bloqueia_lead_sem_telefone();

CREATE OR REPLACE FUNCTION public.bloqueia_pagamento_sem_telefone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tel text;
BEGIN
  SELECT telefone INTO v_tel FROM pacientes WHERE id = NEW.paciente_id;
  IF coalesce(regexp_replace(v_tel,'\D','','g'),'') <> '' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN
    RAISE WARNING 'pagamento ignorado: paciente % sem telefone', NEW.paciente_id;
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'Paciente sem telefone: cadastre o telefone antes de lançar o pagamento.' USING ERRCODE = 'check_violation';
END $$;
GRANT EXECUTE ON FUNCTION public.bloqueia_pagamento_sem_telefone() TO authenticated, service_role;
DROP TRIGGER IF EXISTS a00_bloqueia_pagamento_sem_telefone ON public.pagamentos;
CREATE TRIGGER a00_bloqueia_pagamento_sem_telefone BEFORE INSERT ON public.pagamentos
FOR EACH ROW EXECUTE FUNCTION public.bloqueia_pagamento_sem_telefone();