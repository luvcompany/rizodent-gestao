CREATE OR REPLACE FUNCTION public.integracao_whatsapp_sincroniza_numero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c jsonb := NEW.config;
  pnid text := nullif(trim(NEW.config->>'phone_number_id'), '');
  v_mundo text := public.normaliza_mundo(NEW.owner_role);
  v_dono uuid;
BEGIN
  IF NEW.key NOT LIKE 'whatsapp\_%' OR pnid IS NULL OR NEW.tenant_id IS NULL OR pnid !~ '^[0-9]+$' THEN
    RETURN NEW;
  END IF;

  IF v_mundo IN ('closer', 'recepcao')
     AND coalesce(c->>'owner_user_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_dono := (c->>'owner_user_id')::uuid;
  END IF;

  INSERT INTO public.whatsapp_numbers(
    tenant_id,
    phone_number_id,
    display_name,
    waba_id,
    token,
    app_id,
    app_secret,
    verify_token,
    is_active,
    mundo,
    dono_user_id
  )
  VALUES (
    NEW.tenant_id,
    pnid,
    nullif(trim(c->>'display_name'), ''),
    nullif(c->>'waba_id', ''),
    nullif(coalesce(c->>'access_token', c->>'token'), ''),
    nullif(c->>'app_id', ''),
    nullif(c->>'app_secret', ''),
    nullif(c->>'webhook_verify_token', ''),
    coalesce(NEW.status, '') <> 'disabled',
    v_mundo,
    v_dono
  )
  ON CONFLICT (phone_number_id) DO UPDATE SET
    display_name = coalesce(EXCLUDED.display_name, whatsapp_numbers.display_name),
    waba_id = coalesce(EXCLUDED.waba_id, whatsapp_numbers.waba_id),
    token = coalesce(EXCLUDED.token, whatsapp_numbers.token),
    app_id = coalesce(EXCLUDED.app_id, whatsapp_numbers.app_id),
    app_secret = coalesce(EXCLUDED.app_secret, whatsapp_numbers.app_secret),
    verify_token = coalesce(EXCLUDED.verify_token, whatsapp_numbers.verify_token),
    is_active = EXCLUDED.is_active,
    is_default = CASE WHEN EXCLUDED.is_active THEN whatsapp_numbers.is_default ELSE false END,
    mundo = EXCLUDED.mundo,
    dono_user_id = coalesce(EXCLUDED.dono_user_id, whatsapp_numbers.dono_user_id)
  WHERE whatsapp_numbers.tenant_id = NEW.tenant_id;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.integracao_whatsapp_sincroniza_numero() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_whatsapp_sincroniza_numero() TO service_role;

COMMENT ON FUNCTION public.integracao_whatsapp_sincroniza_numero() IS
  'Espelha cada integração WhatsApp em whatsapp_numbers, incluindo o nome configurado do canal, sem alterar mundo, acesso ou histórico.';