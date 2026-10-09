-- 1) Devolve ao closer o acesso ao número antigo (histórico)
INSERT INTO public.user_permission_overrides(user_id, scope, resource_id, granted)
SELECT '2231410b-af52-4fe9-8285-d8acd1d258c9','whatsapp_number','5eef312f-a475-42f5-aa00-395d2c469c43',true
WHERE NOT EXISTS (SELECT 1 FROM public.user_permission_overrides WHERE user_id='2231410b-af52-4fe9-8285-d8acd1d258c9' AND scope='whatsapp_number' AND resource_id='5eef312f-a475-42f5-aa00-395d2c469c43');

-- 2) Nunca apagar acesso a número desativado/sem integração (preserva histórico e leads)
CREATE OR REPLACE FUNCTION public.preserva_acesso_numero_whatsapp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w record;
BEGIN
  IF OLD.scope <> 'whatsapp_number' THEN RETURN OLD; END IF;
  SELECT * INTO w FROM public.whatsapp_numbers WHERE id::text = OLD.resource_id;
  IF NOT FOUND THEN RETURN OLD; END IF;
  IF w.is_active = false OR NOT EXISTS (
       SELECT 1 FROM public.integrations i WHERE i.tenant_id = w.tenant_id AND i.key = 'whatsapp_'||w.phone_number_id) THEN
    RETURN NULL; -- ignora a exclusão
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_preserva_acesso_numero ON public.user_permission_overrides;
CREATE TRIGGER trg_preserva_acesso_numero BEFORE DELETE ON public.user_permission_overrides
FOR EACH ROW EXECUTE FUNCTION public.preserva_acesso_numero_whatsapp();

-- 3) Ao desativar um número, leads dele passam para outro número ativo do mesmo grupo
CREATE OR REPLACE FUNCTION public.realoca_leads_numero_desativado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE novo uuid;
BEGIN
  IF OLD.is_active = true AND NEW.is_active = false THEN
    SELECT w.id INTO novo FROM public.whatsapp_numbers w
     WHERE w.tenant_id = NEW.tenant_id AND w.is_active AND w.id <> NEW.id
       AND EXISTS (SELECT 1 FROM public.user_permission_overrides a
                    JOIN public.user_permission_overrides b ON b.user_id=a.user_id AND b.scope='whatsapp_number' AND b.resource_id=w.id::text AND b.granted
                   WHERE a.scope='whatsapp_number' AND a.resource_id=NEW.id::text AND a.granted)
     ORDER BY w.is_default DESC, w.created_at DESC LIMIT 1;
    IF novo IS NOT NULL THEN
      UPDATE public.crm_leads SET whatsapp_number_id = novo WHERE whatsapp_number_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_realoca_leads_numero_desativado ON public.whatsapp_numbers;
CREATE TRIGGER trg_realoca_leads_numero_desativado AFTER UPDATE OF is_active ON public.whatsapp_numbers
FOR EACH ROW EXECUTE FUNCTION public.realoca_leads_numero_desativado();

-- 4) Leads do closer passam para o número novo do closer
UPDATE public.crm_leads SET whatsapp_number_id='ffe670ec-2164-4101-ae14-aab7262e6cbc'
WHERE whatsapp_number_id='5eef312f-a475-42f5-aa00-395d2c469c43';