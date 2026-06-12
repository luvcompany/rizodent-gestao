
-- 1) Prevent privilege escalation on user_roles: only superadmin can write superadmin role
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;

CREATE POLICY "Admins can insert roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'crc'::app_role)
    AND (role <> 'superadmin'::app_role OR has_role(auth.uid(), 'superadmin'::app_role))
  );

CREATE POLICY "Admins can update roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'crc'::app_role)
    AND (role <> 'superadmin'::app_role OR has_role(auth.uid(), 'superadmin'::app_role))
  )
  WITH CHECK (
    has_role(auth.uid(), 'crc'::app_role)
    AND (role <> 'superadmin'::app_role OR has_role(auth.uid(), 'superadmin'::app_role))
  );

CREATE POLICY "Admins can delete roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'crc'::app_role)
    AND (role <> 'superadmin'::app_role OR has_role(auth.uid(), 'superadmin'::app_role))
  );

-- 2) Tenant-scope chat-media uploads
DROP POLICY IF EXISTS "chat-media authenticated upload" ON storage.objects;

CREATE POLICY "chat-media tenant-scoped upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND auth.uid() IS NOT NULL
    AND public.chat_media_belongs_to_current_tenant(name)
  );
