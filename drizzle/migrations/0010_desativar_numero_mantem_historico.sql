CREATE OR REPLACE FUNCTION public.integracao_whatsapp_excluida_desativa_numero()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_pnid text; v_num_id uuid;
BEGIN
  IF OLD.key NOT LIKE 'whatsapp_%' OR OLD.key = 'whatsapp_config' THEN RETURN OLD; END IF;
  v_pnid := COALESCE(OLD.config->>'phone_number_id', substring(OLD.key from 10));
  SELECT id INTO v_num_id FROM public.whatsapp_numbers WHERE phone_number_id = v_pnid;
  IF v_num_id IS NOT NULL THEN
    -- Só desativa: as permissões ficam, para o grupo continuar lendo o histórico.
    UPDATE public.whatsapp_numbers SET is_active = false, is_default = false WHERE id = v_num_id;
  END IF;
  RETURN OLD;
END;
$function$;