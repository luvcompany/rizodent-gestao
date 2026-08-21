CREATE OR REPLACE FUNCTION public.chat_media_object_owned_by(_name text, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'chat-media'
      AND o.name = _name
      AND _user_id IS NOT NULL
      AND (o.owner_id = _user_id::text OR o.owner = _user_id)
  )
$$;

REVOKE ALL ON FUNCTION public.chat_media_object_owned_by(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_media_object_owned_by(text, uuid) TO service_role;