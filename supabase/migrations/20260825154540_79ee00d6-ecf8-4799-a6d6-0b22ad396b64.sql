-- Etapa 25 / Fase 6B: fechamentos pontuais de isolamento por número.

-- 1) chat-media: leitura precisa respeitar tenant + número + escopo do lead.
-- Mantém o ramo de leitura imediata do próprio upload; não altera policies de INSERT/upload.
CREATE OR REPLACE FUNCTION public.chat_media_belongs_to_current_tenant(_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR (
      auth.uid() IS NOT NULL
      AND public.current_tenant_id() IS NOT NULL
      AND _object_name LIKE (public.current_tenant_id()::text || '/' || auth.uid()::text || '/%')
    )
    OR EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.tenant_id = public.current_tenant_id()
        AND m.media_url IS NOT NULL
        AND (
          split_part(m.media_url, '?', 1) = _object_name
          OR right(split_part(m.media_url, '?', 1), length('/chat-media/' || _object_name)) = '/chat-media/' || _object_name
        )
        AND public.can_access_whatsapp_number(m.whatsapp_number_id)
        AND public.closer_pode_ver_lead(m.lead_id)
        AND public.recepcao_pode_ver_lead(m.lead_id)
    );
$$;
REVOKE ALL ON FUNCTION public.chat_media_belongs_to_current_tenant(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_media_belongs_to_current_tenant(text) TO authenticated, service_role;

-- 2) call-recordings: leitura/update/delete precisam respeitar tenant + número + lead.
-- Não altera a policy de INSERT existente.
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
        AND public.can_access_whatsapp_number(c.whatsapp_number_id)
        AND public.closer_pode_ver_lead(c.lead_id)
        AND public.recepcao_pode_ver_lead(c.lead_id)
    );
$$;
REVOKE ALL ON FUNCTION public.call_recording_belongs_to_current_tenant(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.call_recording_belongs_to_current_tenant(text) TO authenticated, service_role;

-- 3) transfer_lead_to_whatsapp: guard explícito do mundo do chamador.
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

  IF NOT public.can_access_whatsapp_number(v_lead.whatsapp_number_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
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

-- 4) deleted_leads_backup: bloqueio restritivo por mundo para closer/recepção.
DROP POLICY IF EXISTS deleted_leads_backup_number_scope_select ON public.deleted_leads_backup;
CREATE POLICY deleted_leads_backup_number_scope_select
ON public.deleted_leads_backup
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  (
    NOT public.has_role(auth.uid(), 'closer'::public.app_role)
    AND NOT public.has_role(auth.uid(), 'recepcao'::public.app_role)
  )
  OR (
    NULLIF(lead_snapshot->>'whatsapp_number_id', '') IS NOT NULL
    AND (lead_snapshot->>'whatsapp_number_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.can_access_whatsapp_number((lead_snapshot->>'whatsapp_number_id')::uuid)
  )
);

DROP POLICY IF EXISTS deleted_leads_backup_number_scope_update ON public.deleted_leads_backup;
CREATE POLICY deleted_leads_backup_number_scope_update
ON public.deleted_leads_backup
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  (
    NOT public.has_role(auth.uid(), 'closer'::public.app_role)
    AND NOT public.has_role(auth.uid(), 'recepcao'::public.app_role)
  )
  OR (
    NULLIF(lead_snapshot->>'whatsapp_number_id', '') IS NOT NULL
    AND (lead_snapshot->>'whatsapp_number_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.can_access_whatsapp_number((lead_snapshot->>'whatsapp_number_id')::uuid)
  )
)
WITH CHECK (
  (
    NOT public.has_role(auth.uid(), 'closer'::public.app_role)
    AND NOT public.has_role(auth.uid(), 'recepcao'::public.app_role)
  )
  OR (
    NULLIF(lead_snapshot->>'whatsapp_number_id', '') IS NOT NULL
    AND (lead_snapshot->>'whatsapp_number_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.can_access_whatsapp_number((lead_snapshot->>'whatsapp_number_id')::uuid)
  )
);

DROP POLICY IF EXISTS deleted_leads_backup_number_scope_delete ON public.deleted_leads_backup;
CREATE POLICY deleted_leads_backup_number_scope_delete
ON public.deleted_leads_backup
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
  (
    NOT public.has_role(auth.uid(), 'closer'::public.app_role)
    AND NOT public.has_role(auth.uid(), 'recepcao'::public.app_role)
  )
  OR (
    NULLIF(lead_snapshot->>'whatsapp_number_id', '') IS NOT NULL
    AND (lead_snapshot->>'whatsapp_number_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.can_access_whatsapp_number((lead_snapshot->>'whatsapp_number_id')::uuid)
  )
);