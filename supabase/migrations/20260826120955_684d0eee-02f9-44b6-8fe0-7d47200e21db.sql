CREATE OR REPLACE FUNCTION public.concede_numero_aos_gerais()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  INSERT INTO public.user_permission_overrides (user_id, scope, resource_id, granted, created_by)
  SELECT DISTINCT p.id, 'whatsapp_number', NEW.id::text, true, auth.uid()
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE p.tenant_id = NEW.tenant_id
    AND ur.role NOT IN ('closer'::app_role, 'recepcao'::app_role)
  ON CONFLICT (user_id, scope, resource_id) DO UPDATE SET granted = true;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_concede_numero_aos_gerais ON public.whatsapp_numbers;
CREATE TRIGGER trg_concede_numero_aos_gerais
  AFTER INSERT ON public.whatsapp_numbers
  FOR EACH ROW EXECUTE FUNCTION public.concede_numero_aos_gerais();

CREATE OR REPLACE FUNCTION public.concede_numeros_ao_novo_usuario()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid;
BEGIN
  IF NEW.role IN ('closer'::app_role, 'recepcao'::app_role) THEN RETURN NEW; END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = NEW.user_id;
  IF v_tenant IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.user_permission_overrides (user_id, scope, resource_id, granted, created_by)
  SELECT NEW.user_id, 'whatsapp_number', w.id::text, true, auth.uid()
  FROM public.whatsapp_numbers w
  WHERE w.tenant_id = v_tenant AND w.is_active
  ON CONFLICT (user_id, scope, resource_id) DO UPDATE SET granted = true;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_concede_numeros_ao_novo_usuario ON public.user_roles;
CREATE TRIGGER trg_concede_numeros_ao_novo_usuario
  AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.concede_numeros_ao_novo_usuario();

INSERT INTO public.user_permission_overrides (user_id, scope, resource_id, granted)
SELECT DISTINCT p.id, 'whatsapp_number', w.id::text, true
FROM public.profiles p
JOIN public.user_roles ur ON ur.user_id = p.id
JOIN public.whatsapp_numbers w ON w.tenant_id = p.tenant_id AND w.is_active
WHERE ur.role NOT IN ('closer'::app_role, 'recepcao'::app_role)
ON CONFLICT (user_id, scope, resource_id) DO UPDATE SET granted = true;