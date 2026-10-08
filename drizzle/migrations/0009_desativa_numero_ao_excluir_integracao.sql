CREATE OR REPLACE FUNCTION public.integracao_whatsapp_excluida_desativa_numero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pnid text;
  v_num_id uuid;
BEGIN
  IF OLD.key NOT LIKE 'whatsapp_%' OR OLD.key = 'whatsapp_config' THEN
    RETURN OLD;
  END IF;
  v_pnid := COALESCE(OLD.config->>'phone_number_id', substring(OLD.key from 10));
  SELECT id INTO v_num_id FROM public.whatsapp_numbers WHERE phone_number_id = v_pnid;
  IF v_num_id IS NOT NULL THEN
    UPDATE public.whatsapp_numbers SET is_active = false, is_default = false WHERE id = v_num_id;
    DELETE FROM public.user_permission_overrides WHERE scope = 'whatsapp_number' AND resource_id = v_num_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_integracao_whatsapp_excluida ON public.integrations;
CREATE TRIGGER trg_integracao_whatsapp_excluida
AFTER DELETE ON public.integrations
FOR EACH ROW EXECUTE FUNCTION public.integracao_whatsapp_excluida_desativa_numero();