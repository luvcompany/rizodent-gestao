
-- 1) Storage: replace broad public SELECT with authenticated-only listing.
-- Direct file downloads on public buckets continue to work (bypass RLS).
DROP POLICY IF EXISTS "Public read access for avatars" ON storage.objects;
DROP POLICY IF EXISTS "tenant_logos_public_read" ON storage.objects;

CREATE POLICY "Authenticated can list avatars"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

CREATE POLICY "Authenticated can list tenant-logos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'tenant-logos');

-- 2) Revoke EXECUTE on internal SECURITY DEFINER functions exposed via PostgREST.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.check_duplicate_phone(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.recalculate_lead_score(uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.recalculate_all_lead_scores() FROM anon, authenticated, public;

-- Keep get_tenant_by_slug callable by anon (subdomain branding lookup).
-- Ensure execute is granted explicitly.
GRANT EXECUTE ON FUNCTION public.get_tenant_by_slug(text) TO anon, authenticated;
