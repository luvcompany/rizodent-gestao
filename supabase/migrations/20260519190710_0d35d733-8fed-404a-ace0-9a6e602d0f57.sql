CREATE OR REPLACE FUNCTION public.update_whatsapp_template_sharing(
  _template_id uuid,
  _owner_role public.app_role,
  _shared_roles public.app_role[] DEFAULT '{}'::public.app_role[]
)
RETURNS public.crm_whatsapp_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _template public.crm_whatsapp_templates;
  _tenant_id uuid;
  _can_manage boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  _tenant_id := public.current_tenant_id();

  SELECT * INTO _template
  FROM public.crm_whatsapp_templates
  WHERE id = _template_id
    AND (tenant_id = _tenant_id OR public.has_role(auth.uid(), 'superadmin'::public.app_role));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modelo não encontrado';
  END IF;

  _can_manage :=
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR public.has_role(auth.uid(), 'gerente'::public.app_role)
    OR (
      (
        public.has_role(auth.uid(), 'crc'::public.app_role)
        OR public.has_role(auth.uid(), 'posvenda'::public.app_role)
      )
      AND (
        _template.owner_role IS NULL
        OR public.has_role(auth.uid(), _template.owner_role)
        OR public.user_has_any_role(auth.uid(), _template.shared_roles)
      )
    );

  IF NOT _can_manage THEN
    RAISE EXCEPTION 'Sem permissão para alterar este modelo';
  END IF;

  IF _owner_role = 'superadmin'::public.app_role OR 'superadmin'::public.app_role = ANY(COALESCE(_shared_roles, '{}'::public.app_role[])) THEN
    RAISE EXCEPTION 'Superadmin não deve ser usado como visibilidade do modelo';
  END IF;

  UPDATE public.crm_whatsapp_templates
  SET owner_role = _owner_role,
      shared_roles = COALESCE(array_remove(_shared_roles, _owner_role), '{}'::public.app_role[]),
      updated_at = now()
  WHERE id = _template_id
  RETURNING * INTO _template;

  RETURN _template;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_whatsapp_template_sharing(uuid, public.app_role, public.app_role[]) TO authenticated;