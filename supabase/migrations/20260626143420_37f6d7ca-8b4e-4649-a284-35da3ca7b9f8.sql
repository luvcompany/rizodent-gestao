
-- =====================================================
-- Auto-vínculo lead <-> paciente por telefone (últimos 8 dígitos)
-- =====================================================

CREATE OR REPLACE FUNCTION public.auto_link_paciente_to_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last8 text;
  v_lead_id uuid;
  v_count int;
BEGIN
  IF NEW.telefone IS NULL THEN RETURN NEW; END IF;
  v_last8 := right(regexp_replace(NEW.telefone,'[^0-9]','','g'), 8);
  IF length(v_last8) < 8 THEN RETURN NEW; END IF;

  -- Já tem vínculo? sai
  IF EXISTS (SELECT 1 FROM public.crm_lead_pacientes WHERE paciente_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  SELECT count(*), min(l.id)
    INTO v_count, v_lead_id
    FROM public.crm_leads l
   WHERE l.tenant_id = NEW.tenant_id
     AND l.paciente_id IS NULL
     AND right(regexp_replace(l.phone,'[^0-9]','','g'), 8) = v_last8;

  IF v_count = 1 THEN
    INSERT INTO public.crm_lead_pacientes (lead_id, paciente_id, is_primary)
    VALUES (v_lead_id, NEW.id, true)
    ON CONFLICT DO NOTHING;
    RAISE NOTICE '[AUTO-LINK pac->lead] paciente=% lead=% tel=%', NEW.id, v_lead_id, NEW.telefone;
  ELSE
    RAISE NOTICE '[AUTO-LINK pac->lead] paciente=% tel=% candidatos=% (sem vínculo)', NEW.id, NEW.telefone, v_count;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_link_paciente_to_lead ON public.pacientes;
CREATE TRIGGER trg_auto_link_paciente_to_lead
AFTER INSERT OR UPDATE OF telefone ON public.pacientes
FOR EACH ROW EXECUTE FUNCTION public.auto_link_paciente_to_lead();

-- Simétrico: ao criar lead, tenta vincular paciente único existente
CREATE OR REPLACE FUNCTION public.auto_link_lead_to_paciente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last8 text;
  v_pac_id uuid;
  v_count int;
BEGIN
  IF NEW.phone IS NULL OR NEW.paciente_id IS NOT NULL THEN RETURN NEW; END IF;
  v_last8 := right(regexp_replace(NEW.phone,'[^0-9]','','g'), 8);
  IF length(v_last8) < 8 THEN RETURN NEW; END IF;

  SELECT count(*), min(p.id)
    INTO v_count, v_pac_id
    FROM public.pacientes p
   WHERE p.tenant_id = NEW.tenant_id
     AND right(regexp_replace(p.telefone,'[^0-9]','','g'), 8) = v_last8
     AND NOT EXISTS (SELECT 1 FROM public.crm_lead_pacientes lp WHERE lp.paciente_id = p.id);

  IF v_count = 1 THEN
    INSERT INTO public.crm_lead_pacientes (lead_id, paciente_id, is_primary)
    VALUES (NEW.id, v_pac_id, true)
    ON CONFLICT DO NOTHING;
    RAISE NOTICE '[AUTO-LINK lead->pac] lead=% paciente=% tel=%', NEW.id, v_pac_id, NEW.phone;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_link_lead_to_paciente ON public.crm_leads;
CREATE TRIGGER trg_auto_link_lead_to_paciente
AFTER INSERT ON public.crm_leads
FOR EACH ROW EXECUTE FUNCTION public.auto_link_lead_to_paciente();

-- =====================================================
-- BACKFILL: vincula pacientes existentes sem lead (esperado: 3)
-- =====================================================
DO $$
DECLARE
  r record;
  v_count_created int := 0;
BEGIN
  FOR r IN
    WITH pacs AS (
      SELECT p.id as pac_id, p.tenant_id, p.telefone,
             right(regexp_replace(p.telefone,'[^0-9]','','g'),8) as last8
        FROM public.pacientes p
       WHERE p.telefone IS NOT NULL
         AND length(regexp_replace(p.telefone,'[^0-9]','','g')) >= 8
         AND NOT EXISTS (SELECT 1 FROM public.crm_lead_pacientes lp WHERE lp.paciente_id = p.id)
    )
    SELECT pacs.pac_id, pacs.tenant_id, pacs.telefone,
           (SELECT l.id FROM public.crm_leads l
              WHERE l.tenant_id = pacs.tenant_id
                AND l.paciente_id IS NULL
                AND right(regexp_replace(l.phone,'[^0-9]','','g'),8) = pacs.last8
              LIMIT 2) as lead_id,
           (SELECT count(*) FROM public.crm_leads l
              WHERE l.tenant_id = pacs.tenant_id
                AND l.paciente_id IS NULL
                AND right(regexp_replace(l.phone,'[^0-9]','','g'),8) = pacs.last8) as cnt
      FROM pacs
  LOOP
    IF r.cnt = 1 AND r.lead_id IS NOT NULL THEN
      INSERT INTO public.crm_lead_pacientes (lead_id, paciente_id, is_primary)
      VALUES (r.lead_id, r.pac_id, true)
      ON CONFLICT DO NOTHING;
      v_count_created := v_count_created + 1;
      RAISE NOTICE '[BACKFILL] paciente=% lead=% tel=%', r.pac_id, r.lead_id, r.telefone;
    END IF;
  END LOOP;
  RAISE NOTICE '[BACKFILL] Total de vínculos criados: %', v_count_created;
END $$;
