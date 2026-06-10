
CREATE OR REPLACE FUNCTION public.chat_media_belongs_to_current_tenant(_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.messages m
       WHERE m.tenant_id = public.current_tenant_id()
         AND m.media_url IS NOT NULL
         AND position(_object_name in m.media_url) > 0
    );
$$;

REVOKE EXECUTE ON FUNCTION public.chat_media_belongs_to_current_tenant(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_media_belongs_to_current_tenant(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Authenticated users can view chat media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload chat media" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete chat media" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update chat media" ON storage.objects;

CREATE POLICY "chat-media tenant-scoped read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'chat-media'
  AND public.chat_media_belongs_to_current_tenant(name)
);

CREATE POLICY "chat-media authenticated upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'chat-media'
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "chat-media tenant-scoped update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'chat-media'
  AND public.chat_media_belongs_to_current_tenant(name)
  AND (
    public.has_role(auth.uid(), 'crc'::public.app_role)
    OR public.has_role(auth.uid(), 'gerente'::public.app_role)
    OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
  )
)
WITH CHECK (
  bucket_id = 'chat-media'
  AND public.chat_media_belongs_to_current_tenant(name)
);

CREATE POLICY "chat-media tenant-scoped delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'chat-media'
  AND public.chat_media_belongs_to_current_tenant(name)
  AND (
    public.has_role(auth.uid(), 'crc'::public.app_role)
    OR public.has_role(auth.uid(), 'gerente'::public.app_role)
    OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
  )
);

DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;

CREATE POLICY "Admins can update profiles in their tenant"
ON public.profiles FOR UPDATE
TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'crc'::public.app_role)
    OR public.has_role(auth.uid(), 'gerente'::public.app_role)
  )
  AND tenant_id = public.current_tenant_id()
)
WITH CHECK (
  (
    public.has_role(auth.uid(), 'crc'::public.app_role)
    OR public.has_role(auth.uid(), 'gerente'::public.app_role)
  )
  AND tenant_id = public.current_tenant_id()
);

CREATE POLICY "Superadmin can update any profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'superadmin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role));
