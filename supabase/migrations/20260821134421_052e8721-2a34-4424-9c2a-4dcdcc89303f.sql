CREATE OR REPLACE FUNCTION public.can_access_whatsapp_number(_number_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    _number_id IS NULL
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR has_role(auth.uid(), 'crc'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR has_role(auth.uid(), 'posvenda'::app_role)
    OR (
      COALESCE(public.user_override(auth.uid(), 'whatsapp_number', _number_id::text), false)
      AND EXISTS (SELECT 1 FROM public.whatsapp_numbers w
                   WHERE w.id = _number_id
                     AND w.tenant_id = public.current_tenant_id())
    );
$$;

CREATE OR REPLACE FUNCTION public.can_access_instagram_account(_account_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    _account_id IS NULL
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR has_role(auth.uid(), 'crc'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR (
      COALESCE(public.user_override(auth.uid(), 'instagram_account', _account_id::text), false)
      AND EXISTS (SELECT 1 FROM public.ig_accounts a
                   WHERE a.id = _account_id
                     AND a.tenant_id = public.current_tenant_id())
    );
$$;

CREATE OR REPLACE FUNCTION public.can_access_pipeline(_pipeline_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    CASE
      WHEN EXISTS (SELECT 1 FROM public.crm_pipelines p0
                    WHERE p0.id = _pipeline_id
                      AND p0.tenant_id = public.current_tenant_id())
      THEN public.user_override(auth.uid(), 'pipeline', _pipeline_id::text)
      ELSE NULL
    END,
    has_role(auth.uid(), 'superadmin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.crm_pipelines p
      WHERE p.id = _pipeline_id
        AND (
          (p.allowed_roles IS NULL
            AND (
              has_role(auth.uid(), 'crc'::app_role)
              OR has_role(auth.uid(), 'gerente'::app_role)
            ))
          OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role = ANY(p.allowed_roles)
          )
        )
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.pipeline_inclui_papel_do_criador()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_role public.app_role;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  FOR v_role IN
    SELECT role FROM public.user_roles
     WHERE user_id = auth.uid() AND role IN ('recepcao'::app_role, 'closer'::app_role)
  LOOP
    IF NEW.allowed_roles IS NULL THEN
      NEW.allowed_roles := ARRAY['crc'::app_role, 'gerente'::app_role, v_role];
    ELSIF NOT (v_role = ANY(NEW.allowed_roles)) THEN
      NEW.allowed_roles := NEW.allowed_roles || v_role;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pipeline_inclui_papel_do_criador ON public.crm_pipelines;
CREATE TRIGGER trg_pipeline_inclui_papel_do_criador
BEFORE INSERT ON public.crm_pipelines
FOR EACH ROW EXECUTE FUNCTION public.pipeline_inclui_papel_do_criador();

NOTIFY pgrst, 'reload schema';