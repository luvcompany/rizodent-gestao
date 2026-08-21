-- Funil padrão por papel (recepcao/closer): criado automaticamente quando o papel é
-- atribuído a um usuário do tenant, e usado como destino do número conectado em
-- /crm/conexoes. Etapas com os NOMES que as automações procuram
-- (Agendado, Reagendar, Reagendado, Não compareceu, Contratado, Não contratado).
CREATE OR REPLACE FUNCTION public.ensure_role_default_pipeline(_tenant_id uuid, _role public.app_role)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_name text; v_color text;
BEGIN
  IF _tenant_id IS NULL OR _role NOT IN ('recepcao','closer') THEN RETURN NULL; END IF;
  SELECT p.id INTO v_id FROM public.crm_pipelines p
   WHERE p.tenant_id = _tenant_id AND p.allowed_roles IS NOT NULL AND _role = ANY(p.allowed_roles)
     AND COALESCE(p.is_posvenda, false) = false
   ORDER BY p.created_at LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF _role = 'closer' THEN v_name := 'Padrão Closer'; v_color := '#0ea5e9';
  ELSE v_name := 'Padrão Recepção'; v_color := '#f59e0b'; END IF;
  INSERT INTO public.crm_pipelines (tenant_id, name, color, description, allowed_roles, is_default, is_instagram, is_posvenda)
  VALUES (_tenant_id, v_name, v_color, 'Funil criado automaticamente para o papel ' || _role::text,
          ARRAY['crc','gerente', _role]::public.app_role[], false, false, false)
  RETURNING id INTO v_id;
  IF _role = 'closer' THEN
    INSERT INTO public.crm_stages (pipeline_id, tenant_id, name, color, position, is_won, is_lost) VALUES
      (v_id, _tenant_id, 'Novo lead',      '#6366f1', 0, false, false),
      (v_id, _tenant_id, 'Conversando',    '#3b82f6', 1, false, false),
      (v_id, _tenant_id, 'Agendado',       '#8b5cf6', 2, false, false),
      (v_id, _tenant_id, 'Não compareceu', '#f97316', 3, false, false),
      (v_id, _tenant_id, 'Contratado',     '#22c55e', 4, true,  false),
      (v_id, _tenant_id, 'Não contratado', '#ef4444', 5, false, true);
  ELSE
    INSERT INTO public.crm_stages (pipeline_id, tenant_id, name, color, position, is_won, is_lost) VALUES
      (v_id, _tenant_id, 'Novo lead',      '#6366f1', 0, false, false),
      (v_id, _tenant_id, 'Conversando',    '#3b82f6', 1, false, false),
      (v_id, _tenant_id, 'Agendado',       '#8b5cf6', 2, false, false),
      (v_id, _tenant_id, 'Reagendar',      '#eab308', 3, false, false),
      (v_id, _tenant_id, 'Reagendado',     '#a855f7', 4, false, false),
      (v_id, _tenant_id, 'Não compareceu', '#f97316', 5, false, false),
      (v_id, _tenant_id, 'Compareceu',     '#14b8a6', 6, false, false),
      (v_id, _tenant_id, 'Contratado',     '#22c55e', 7, true,  false),
      (v_id, _tenant_id, 'Não contratado', '#ef4444', 8, false, true);
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.ensure_role_default_pipeline(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_role_default_pipeline(uuid, public.app_role) TO service_role;

CREATE OR REPLACE FUNCTION public.user_role_cria_funil_padrao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid;
BEGIN
  IF NEW.role IN ('recepcao','closer') THEN
    SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = NEW.user_id;
    IF v_tenant IS NOT NULL THEN PERFORM public.ensure_role_default_pipeline(v_tenant, NEW.role); END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_user_role_cria_funil_padrao ON public.user_roles;
CREATE TRIGGER trg_user_role_cria_funil_padrao
AFTER INSERT OR UPDATE OF role ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.user_role_cria_funil_padrao();

-- Backfill: usuários closer/recepção que já existem ganham o funil agora.
SELECT public.ensure_role_default_pipeline(p.tenant_id, ur.role)
FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
WHERE ur.role IN ('recepcao','closer') AND p.tenant_id IS NOT NULL
GROUP BY p.tenant_id, ur.role;

NOTIFY pgrst, 'reload schema';