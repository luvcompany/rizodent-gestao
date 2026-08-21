REVOKE EXECUTE ON FUNCTION public.chat_media_object_owned_by(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_media_object_owned_by(text, uuid) TO service_role;