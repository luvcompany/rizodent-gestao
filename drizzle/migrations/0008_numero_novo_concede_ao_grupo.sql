CREATE OR REPLACE FUNCTION public.integracao_whatsapp_sincroniza_numero()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c jsonb := NEW.config; pnid text := nullif(trim(NEW.config->>'phone_number_id'),''); v_num uuid;
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

  SELECT id INTO v_num FROM public.whatsapp_numbers WHERE phone_number_id = pnid AND tenant_id = NEW.tenant_id;
  -- Todo usuário do mesmo grupo do dono da conexão (CRC+SDR juntos; demais separados) recebe acesso ao número.
  IF v_num IS NOT NULL AND NEW.owner_role IS NOT NULL THEN
    INSERT INTO public.user_permission_overrides (user_id, scope, resource_id, granted, created_by)
    SELECT DISTINCT p.id, 'whatsapp_number', v_num::text, true, auth.uid()
    FROM public.profiles p JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.tenant_id = NEW.tenant_id
      AND (public.integration_world(ur.role::text) = public.integration_world(NEW.owner_role)
           OR ur.role IN ('gerente'::app_role, 'superadmin'::app_role))
    ON CONFLICT (user_id, scope, resource_id) DO UPDATE SET granted = true;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.integracao_whatsapp_sincroniza_numero() FROM public;
GRANT EXECUTE ON FUNCTION public.integracao_whatsapp_sincroniza_numero() TO authenticated, service_role;
DROP TRIGGER IF EXISTS trg_integracao_whatsapp_numero ON public.integrations;
CREATE TRIGGER trg_integracao_whatsapp_numero AFTER INSERT OR UPDATE OF config, status, owner_role ON public.integrations
FOR EACH ROW EXECUTE FUNCTION public.integracao_whatsapp_sincroniza_numero();