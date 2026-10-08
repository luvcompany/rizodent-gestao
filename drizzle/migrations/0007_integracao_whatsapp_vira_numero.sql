CREATE OR REPLACE FUNCTION public.integracao_whatsapp_sincroniza_numero()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c jsonb := NEW.config; pnid text := nullif(trim(NEW.config->>'phone_number_id'),'');
BEGIN
  IF NEW.key NOT LIKE 'whatsapp\_%' OR NEW.key = 'whatsapp_config' OR pnid IS NULL OR NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.whatsapp_numbers(tenant_id, phone_number_id, display_name, waba_id, token, app_id, app_secret, verify_token, is_active)
  VALUES (NEW.tenant_id, pnid, nullif(c->>'display_name',''), nullif(c->>'waba_id',''), nullif(c->>'token',''),
          nullif(c->>'app_id',''), nullif(c->>'app_secret',''), nullif(c->>'webhook_verify_token',''), coalesce(NEW.status,'') <> 'disabled')
  ON CONFLICT (phone_number_id) DO UPDATE SET
    display_name = coalesce(EXCLUDED.display_name, whatsapp_numbers.display_name),
    waba_id = coalesce(EXCLUDED.waba_id, whatsapp_numbers.waba_id),
    token = coalesce(EXCLUDED.token, whatsapp_numbers.token),
    app_id = coalesce(EXCLUDED.app_id, whatsapp_numbers.app_id),
    app_secret = coalesce(EXCLUDED.app_secret, whatsapp_numbers.app_secret),
    verify_token = coalesce(EXCLUDED.verify_token, whatsapp_numbers.verify_token),
    is_active = EXCLUDED.is_active
  WHERE whatsapp_numbers.tenant_id = NEW.tenant_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.integracao_whatsapp_sincroniza_numero() FROM public;
GRANT EXECUTE ON FUNCTION public.integracao_whatsapp_sincroniza_numero() TO authenticated, service_role;
DROP TRIGGER IF EXISTS trg_integracao_whatsapp_numero ON public.integrations;
CREATE TRIGGER trg_integracao_whatsapp_numero AFTER INSERT OR UPDATE OF config, status ON public.integrations
FOR EACH ROW EXECUTE FUNCTION public.integracao_whatsapp_sincroniza_numero();