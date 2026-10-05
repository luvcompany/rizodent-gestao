CREATE OR REPLACE FUNCTION public.normalize_lead_phone()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v text;
BEGIN
  IF NEW.phone IS NULL OR btrim(NEW.phone) = '' THEN NEW.phone := NULL; RETURN NEW; END IF;
  v := regexp_replace(NEW.phone, '[^0-9]', '', 'g');
  IF v = '' THEN NEW.phone := NULL; RETURN NEW; END IF;
  IF length(v) IN (11,12) AND left(v,1) = '0' THEN v := substr(v,2); END IF;
  IF length(v) IN (12,13) AND left(v,2) = '55' THEN v := substr(v,3);
  ELSIF length(v) NOT IN (10,11) THEN NEW.phone := v; RETURN NEW; END IF;
  IF length(v) = 11 AND substr(v,3,1) = '9' THEN v := left(v,2) || substr(v,4); END IF;
  NEW.phone := '55' || v;
  RETURN NEW;
END $$;
GRANT EXECUTE ON FUNCTION public.normalize_lead_phone() TO authenticated, service_role;
DROP TRIGGER IF EXISTS trg_normalize_lead_phone ON public.crm_leads;
CREATE TRIGGER trg_normalize_lead_phone BEFORE INSERT OR UPDATE OF phone ON public.crm_leads
FOR EACH ROW EXECUTE FUNCTION public.normalize_lead_phone();