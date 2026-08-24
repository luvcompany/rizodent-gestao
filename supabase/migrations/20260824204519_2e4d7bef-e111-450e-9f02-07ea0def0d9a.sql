-- ATENÇÃO / MANUTENÇÃO FUTURA:
-- Se algum dia o número PRINCIPAL do tenant for cadastrado em public.whatsapp_numbers,
-- é OBRIGATÓRIO conceder o override 'whatsapp_number' desse número aos usuários com
-- papel 'crc' (e 'posvenda') ANTES do cadastro. Caso contrário, os leads NOVOS criados
-- já carimbados com esse whatsapp_number_id desaparecem da visão do crc/posvenda
-- (Conversas, Funil e contadores), pois eles deixaram de ser privilegiados aqui.

-- 1) can_access_whatsapp_number: crc e posvenda não são mais privilegiados
CREATE OR REPLACE FUNCTION public.can_access_whatsapp_number(_number_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    _number_id IS NULL
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR (
      COALESCE(public.user_override(auth.uid(), 'whatsapp_number', _number_id::text), false)
      AND EXISTS (SELECT 1 FROM public.whatsapp_numbers w
                   WHERE w.id = _number_id
                     AND w.tenant_id = public.current_tenant_id())
    );
$function$;

-- 2) get_conversation_leads: predicado de número aplicado a todos (a própria função
--    já libera NULL, gerente e superadmin).
CREATE OR REPLACE FUNCTION public.get_conversation_leads(p_tenant_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20000)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_super boolean; v_crc boolean; v_gerente boolean; v_posvenda boolean; v_priv boolean;
  v_pipes uuid[];
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_super := has_role(v_uid, 'superadmin'::app_role);
  v_tenant := current_tenant_id();
  IF v_super AND p_tenant_id IS NOT NULL THEN v_tenant := p_tenant_id; END IF;
  IF v_tenant IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_crc := has_role(v_uid, 'crc'::app_role);
  v_gerente := has_role(v_uid, 'gerente'::app_role);
  v_posvenda := has_role(v_uid, 'posvenda'::app_role);
  v_priv := v_super OR v_crc OR v_gerente;

  SELECT COALESCE(array_agg(p.id), ARRAY[]::uuid[]) INTO v_pipes
  FROM crm_pipelines p
  WHERE p.tenant_id = v_tenant
    AND COALESCE(
      user_override(v_uid, 'pipeline', p.id::text),
      v_super OR (p.allowed_roles IS NULL AND (v_crc OR v_gerente))
      OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = v_uid AND ur.role = ANY(p.allowed_roles))
    )
    AND ( v_posvenda OR v_super OR NOT COALESCE(p.is_posvenda, false) );

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.last_message_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT l.id, l.name, l.phone, l.instagram_user_id, l.active_channel,
      l.instagram_username, l.instagram_profile_pic_url, l.last_message,
      l.last_message_at, l.last_inbound_at, l.last_outbound_at, l.tags, l.source,
      l.stage_id, l.pipeline_id, l.created_at, l.updated_at, l.assigned_to,
      l.paciente_id, l.cidade, l.servico_interesse, l.imagem_origem, l.titulo_anuncio,
      l.descricao_anuncio, l.link_anuncio, l.ad_id, l.nome_anuncio, l.ad_account_id,
      l.ad_account_name, l.is_blocked
    FROM crm_leads l
    WHERE l.tenant_id = v_tenant
      AND l.is_blocked = false
      AND ( v_super OR l.pipeline_id = ANY(v_pipes) )
      AND can_access_whatsapp_number(l.whatsapp_number_id)
      AND ( v_priv OR can_access_instagram_account(l.ig_account_uuid) )
    ORDER BY l.last_message_at DESC NULLS LAST
    LIMIT p_limit
  ) t;

  RETURN v_result;
END;
$function$;

-- 3) get_lead_for_conversation
CREATE OR REPLACE FUNCTION public.get_lead_for_conversation(_lead_id uuid)
 RETURNS SETOF crm_leads
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.*
  FROM public.crm_leads l
  WHERE l.id = _lead_id
    AND l.tenant_id = public.current_tenant_id()
    AND public.can_access_whatsapp_number(l.whatsapp_number_id)
    AND (
      public.has_role(auth.uid(), 'crc'::app_role)
      OR public.has_role(auth.uid(), 'gerente'::app_role)
      OR public.has_role(auth.uid(), 'superadmin'::app_role)
      OR public.has_role(auth.uid(), 'posvenda'::app_role)
    );
$function$;

-- 4) check_duplicate_phone
CREATE OR REPLACE FUNCTION public.check_duplicate_phone(p_phone text)
 RETURNS TABLE(lead_id uuid, lead_name text, assigned_to uuid, pipeline_name text, stage_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.id, l.name, l.assigned_to,
         p.name AS pipeline_name,
         s.name AS stage_name
  FROM public.crm_leads l
  LEFT JOIN public.crm_pipelines p ON p.id = l.pipeline_id
  LEFT JOIN public.crm_stages s ON s.id = l.stage_id
  WHERE l.phone = p_phone
    AND public.can_access_whatsapp_number(l.whatsapp_number_id)
    AND (
      l.tenant_id = public.current_tenant_id()
      OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
    )
  LIMIT 1;
$function$;

-- 5) Defaults de funil não incluem mais 'crc'
CREATE OR REPLACE FUNCTION public.pipeline_inclui_papel_do_criador()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_role public.app_role;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  FOR v_role IN
    SELECT role FROM public.user_roles
     WHERE user_id = auth.uid() AND role IN ('recepcao'::app_role, 'closer'::app_role)
  LOOP
    IF NEW.allowed_roles IS NULL THEN
      NEW.allowed_roles := ARRAY['gerente'::app_role, v_role];
    ELSIF NOT (v_role = ANY(NEW.allowed_roles)) THEN
      NEW.allowed_roles := NEW.allowed_roles || v_role;
    END IF;
  END LOOP;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.ensure_role_default_pipeline(_tenant_id uuid, _role app_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          ARRAY['gerente', _role]::public.app_role[], false, false, false)
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
END $function$;

UPDATE public.crm_pipelines
   SET allowed_roles = array_remove(allowed_roles, 'crc'::app_role)
 WHERE allowed_roles && ARRAY['closer'::app_role, 'recepcao'::app_role]
   AND 'crc'::app_role = ANY(allowed_roles);