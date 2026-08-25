-- Fase 6: fechamento do isolamento por número e políticas restritivas.

-- 1) Messages: remover política permissiva ampla que concorria com as regras por número.
DROP POLICY IF EXISTS tenant_isolation ON public.messages;

-- 2) Storage chat-media: match exato do objeto + tenant + escopo do lead/número.
CREATE OR REPLACE FUNCTION public.chat_media_belongs_to_current_tenant(_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.tenant_id = public.current_tenant_id()
        AND m.media_url IS NOT NULL
        AND (
          split_part(m.media_url, '?', 1) = _object_name
          OR right(split_part(m.media_url, '?', 1), length('/chat-media/' || _object_name)) = '/chat-media/' || _object_name
        )
        AND public.closer_pode_ver_lead(m.lead_id)
        AND public.recepcao_pode_ver_lead(m.lead_id)
    );
$$;
REVOKE ALL ON FUNCTION public.chat_media_belongs_to_current_tenant(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_media_belongs_to_current_tenant(text) TO authenticated, service_role;

-- 3) Storage call-recordings: acesso por tenant + call/lead/número, incluindo o momento
-- antes do recording_url ser gravado na linha (o caminho contém tenant/call-id).
CREATE OR REPLACE FUNCTION public.call_recording_belongs_to_current_tenant(_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH parsed AS (
    SELECT substring(_object_name from '/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[0-9]+(?:-(?:agent|lead))?\.webm$')::uuid AS call_id
  )
  SELECT
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR EXISTS (
      SELECT 1
      FROM public.whatsapp_calls c
      LEFT JOIN parsed p ON true
      WHERE c.tenant_id = public.current_tenant_id()
        AND (
          c.id = p.call_id
          OR split_part(c.recording_url, '?', 1) = _object_name
          OR split_part(c.recording_url_agent, '?', 1) = _object_name
          OR split_part(c.recording_url_lead, '?', 1) = _object_name
          OR right(split_part(c.recording_url, '?', 1), length('/call-recordings/' || _object_name)) = '/call-recordings/' || _object_name
          OR right(split_part(c.recording_url_agent, '?', 1), length('/call-recordings/' || _object_name)) = '/call-recordings/' || _object_name
          OR right(split_part(c.recording_url_lead, '?', 1), length('/call-recordings/' || _object_name)) = '/call-recordings/' || _object_name
        )
        AND public.closer_pode_ver_lead(c.lead_id)
        AND public.recepcao_pode_ver_lead(c.lead_id)
    );
$$;
REVOKE ALL ON FUNCTION public.call_recording_belongs_to_current_tenant(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.call_recording_belongs_to_current_tenant(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "call recordings select same tenant" ON storage.objects;
CREATE POLICY "call recordings select same tenant"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'call-recordings'
  AND public.call_recording_belongs_to_current_tenant(name)
);

DROP POLICY IF EXISTS "call recordings update same tenant" ON storage.objects;
CREATE POLICY "call recordings update same tenant"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'call-recordings'
  AND public.call_recording_belongs_to_current_tenant(name)
)
WITH CHECK (
  bucket_id = 'call-recordings'
  AND public.call_recording_belongs_to_current_tenant(name)
);

DROP POLICY IF EXISTS "call recordings delete gerente/superadmin" ON storage.objects;
CREATE POLICY "call recordings delete gerente/superadmin"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'call-recordings'
  AND public.call_recording_belongs_to_current_tenant(name)
  AND (public.has_role(auth.uid(), 'gerente'::public.app_role) OR public.has_role(auth.uid(), 'superadmin'::public.app_role))
);

-- 4) crm_leads: carimbo servidor-side do número para closer/recepção.
CREATE OR REPLACE FUNCTION public.stamp_crm_lead_whatsapp_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_scoped_role boolean := false;
  v_number_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_tenant_id := public.current_tenant_id();
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := v_tenant_id;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_user_id
      AND ur.role IN ('closer'::public.app_role, 'recepcao'::public.app_role)
  ) INTO v_scoped_role;

  IF NEW.whatsapp_number_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_numbers w
      WHERE w.id = NEW.whatsapp_number_id
        AND w.tenant_id = NEW.tenant_id
        AND w.is_active = true
    ) THEN
      RAISE EXCEPTION 'Número de WhatsApp inválido para este lead';
    END IF;

    IF v_scoped_role AND NOT public.can_access_whatsapp_number(NEW.whatsapp_number_id) THEN
      RAISE EXCEPTION 'Sem acesso a este número de WhatsApp';
    END IF;
    RETURN NEW;
  END IF;

  IF v_scoped_role THEN
    SELECT w.id
      INTO v_number_id
      FROM public.whatsapp_numbers w
      JOIN public.user_permission_overrides upo
        ON upo.scope = 'whatsapp_number'
       AND upo.resource_id = w.id::text
       AND upo.user_id = v_user_id
       AND upo.granted = true
     WHERE w.tenant_id = NEW.tenant_id
       AND w.is_active = true
     ORDER BY w.is_default DESC, w.created_at ASC
     LIMIT 1;

    IF v_number_id IS NULL THEN
      RAISE EXCEPTION 'Usuário sem número de WhatsApp concedido';
    END IF;

    NEW.whatsapp_number_id := v_number_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_crm_lead_whatsapp_number ON public.crm_leads;
CREATE TRIGGER trg_stamp_crm_lead_whatsapp_number
BEFORE INSERT ON public.crm_leads
FOR EACH ROW
EXECUTE FUNCTION public.stamp_crm_lead_whatsapp_number();

-- 5) ai_reply_suggestions: escopo restritivo por mundo/número do lead.
DROP POLICY IF EXISTS ai_reply_suggestions_closer_number_scope ON public.ai_reply_suggestions;
CREATE POLICY ai_reply_suggestions_closer_number_scope
ON public.ai_reply_suggestions
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.closer_pode_ver_lead(lead_id))
WITH CHECK (public.closer_pode_ver_lead(lead_id));

DROP POLICY IF EXISTS ai_reply_suggestions_recepcao_number_scope ON public.ai_reply_suggestions;
CREATE POLICY ai_reply_suggestions_recepcao_number_scope
ON public.ai_reply_suggestions
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.recepcao_pode_ver_lead(lead_id))
WITH CHECK (public.recepcao_pode_ver_lead(lead_id));

-- 6) bot_executions: escopo restritivo por mundo/número do lead.
DROP POLICY IF EXISTS bot_executions_closer_number_scope ON public.bot_executions;
CREATE POLICY bot_executions_closer_number_scope
ON public.bot_executions
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.closer_pode_ver_lead(lead_id))
WITH CHECK (public.closer_pode_ver_lead(lead_id));

DROP POLICY IF EXISTS bot_executions_recepcao_number_scope ON public.bot_executions;
CREATE POLICY bot_executions_recepcao_number_scope
ON public.bot_executions
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.recepcao_pode_ver_lead(lead_id))
WITH CHECK (public.recepcao_pode_ver_lead(lead_id));

-- 7) deleted_leads_backup: lixeira restrita ao gerente do tenant e superadmin.
DROP POLICY IF EXISTS "tenant_select_backup" ON public.deleted_leads_backup;
CREATE POLICY "tenant_select_backup"
ON public.deleted_leads_backup
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'superadmin'::public.app_role)
  OR (public.has_role(auth.uid(), 'gerente'::public.app_role) AND tenant_id = public.current_tenant_id())
);

DROP POLICY IF EXISTS "tenant_update_backup" ON public.deleted_leads_backup;
CREATE POLICY "tenant_update_backup"
ON public.deleted_leads_backup
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'superadmin'::public.app_role)
  OR (public.has_role(auth.uid(), 'gerente'::public.app_role) AND tenant_id = public.current_tenant_id())
)
WITH CHECK (
  public.has_role(auth.uid(), 'superadmin'::public.app_role)
  OR (public.has_role(auth.uid(), 'gerente'::public.app_role) AND tenant_id = public.current_tenant_id())
);

DROP POLICY IF EXISTS "tenant_delete_backup" ON public.deleted_leads_backup;
CREATE POLICY "tenant_delete_backup"
ON public.deleted_leads_backup
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'superadmin'::public.app_role)
  OR (public.has_role(auth.uid(), 'gerente'::public.app_role) AND tenant_id = public.current_tenant_id())
);

-- 8) transfer_lead_to_whatsapp: não permite mesclar/mover lead fora do mundo autorizado.
CREATE OR REPLACE FUNCTION public.transfer_lead_to_whatsapp(p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead    record;
  v_phone   text;
  v_dup_id  uuid;
  v_caller_tenant uuid;
BEGIN
  SELECT id, tenant_id, phone, whatsapp_number_id INTO v_lead FROM public.crm_leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN
    RETURN jsonb_build_object('error', 'lead_not_found');
  END IF;

  SELECT tenant_id INTO v_caller_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_caller_tenant IS NULL OR v_caller_tenant <> v_lead.tenant_id THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  IF NOT (public.closer_pode_ver_lead(p_lead_id) AND public.recepcao_pode_ver_lead(p_lead_id)) THEN
    RETURN jsonb_build_object('error', 'forbidden_number_scope');
  END IF;

  v_phone := regexp_replace(COALESCE(v_lead.phone, ''), '\D', '', 'g');
  IF v_phone = '' THEN
    RETURN jsonb_build_object('error', 'no_phone');
  END IF;

  -- Cada número é um mundo: só mescla duplicado do MESMO mundo
  -- (NULL = mundo legado / número principal).
  SELECT dup.id INTO v_dup_id
  FROM public.crm_leads dup
  WHERE dup.tenant_id = v_lead.tenant_id
    AND dup.id <> p_lead_id
    AND COALESCE(dup.is_blocked, false) = false
    AND regexp_replace(COALESCE(dup.phone, ''), '\D', '', 'g') = v_phone
    AND COALESCE(dup.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(v_lead.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY dup.created_at ASC
  LIMIT 1;

  IF v_dup_id IS NOT NULL THEN
    UPDATE public.messages   SET lead_id = p_lead_id WHERE lead_id = v_dup_id;
    UPDATE public.crm_tasks  SET lead_id = p_lead_id WHERE lead_id = v_dup_id;
    UPDATE public.crm_leads
       SET is_blocked = true, blocked_at = now(), updated_at = now()
     WHERE id = v_dup_id;
  END IF;

  UPDATE public.crm_leads
     SET active_channel = 'whatsapp', updated_at = now()
   WHERE id = p_lead_id;

  RETURN jsonb_build_object('ok', true, 'merged', v_dup_id IS NOT NULL, 'merged_lead_id', v_dup_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.transfer_lead_to_whatsapp(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_lead_to_whatsapp(uuid) TO authenticated, service_role;