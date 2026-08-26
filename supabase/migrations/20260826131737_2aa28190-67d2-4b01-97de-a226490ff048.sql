-- Modelo sincronizado da Meta somia da tela de quem é dono do número.
CREATE OR REPLACE FUNCTION public.dono_restrito_do_numero(_number_id uuid)
RETURNS app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT CASE WHEN count(*) = 1 THEN min(papel) END
  FROM (
    SELECT DISTINCT ur.role AS papel
    FROM public.user_permission_overrides o
    JOIN public.user_roles ur ON ur.user_id = o.user_id
    WHERE o.scope = 'whatsapp_number'
      AND o.resource_id = _number_id::text
      AND o.granted
      AND ur.role IN ('closer'::app_role, 'recepcao'::app_role)
  ) papeis;
$fn$;

CREATE OR REPLACE FUNCTION public.carimba_dono_do_modelo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.owner_role IS NULL AND NEW.whatsapp_number_id IS NOT NULL THEN
    NEW.owner_role := public.dono_restrito_do_numero(NEW.whatsapp_number_id);
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_carimba_dono_do_modelo ON public.crm_whatsapp_templates;
CREATE TRIGGER trg_carimba_dono_do_modelo
  BEFORE INSERT OR UPDATE ON public.crm_whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION public.carimba_dono_do_modelo();

UPDATE public.crm_whatsapp_templates t
   SET owner_role = public.dono_restrito_do_numero(t.whatsapp_number_id)
 WHERE t.owner_role IS NULL
   AND t.whatsapp_number_id IS NOT NULL
   AND public.dono_restrito_do_numero(t.whatsapp_number_id) IS NOT NULL;

DROP POLICY IF EXISTS closer_so_itens_do_perfil_crm_whatsapp_templates ON public.crm_whatsapp_templates;
CREATE POLICY closer_so_itens_do_perfil_crm_whatsapp_templates
  ON public.crm_whatsapp_templates AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'closer'::app_role))
    OR owner_role = 'closer'::app_role
    OR ('closer'::app_role = ANY (COALESCE(shared_roles, '{}'::app_role[])))
    OR (whatsapp_number_id IS NOT NULL AND public.can_access_whatsapp_number(whatsapp_number_id))
  );

DROP POLICY IF EXISTS recepcao_so_itens_do_perfil_crm_whatsapp_templates ON public.crm_whatsapp_templates;
CREATE POLICY recepcao_so_itens_do_perfil_crm_whatsapp_templates
  ON public.crm_whatsapp_templates AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'recepcao'::app_role))
    OR owner_role = 'recepcao'::app_role
    OR ('recepcao'::app_role = ANY (COALESCE(shared_roles, '{}'::app_role[])))
    OR (whatsapp_number_id IS NOT NULL AND public.can_access_whatsapp_number(whatsapp_number_id))
  );