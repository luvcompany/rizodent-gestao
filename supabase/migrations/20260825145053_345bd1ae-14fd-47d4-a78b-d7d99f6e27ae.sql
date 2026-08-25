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
        AND public.closer_pode_ver_lead(m.lead_id)
        AND public.recepcao_pode_ver_lead(m.lead_id)
    );
$$;
REVOKE ALL ON FUNCTION public.chat_media_belongs_to_current_tenant(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_media_belongs_to_current_tenant(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "chat-media owner scoped read" ON storage.objects;
DROP POLICY IF EXISTS "chat-media owner read" ON storage.objects;