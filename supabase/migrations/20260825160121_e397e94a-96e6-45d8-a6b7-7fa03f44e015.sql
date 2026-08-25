-- Leitura imediata pelo dono do arquivo: necessária para createSignedUrl logo
-- após o upload, antes de a mensagem existir. Não vaza entre mundos: o dono é
-- quem subiu (mídia recebida entra pelo service_role).
DROP POLICY IF EXISTS "chat-media owner read" ON storage.objects;
CREATE POLICY "chat-media owner read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-media' AND owner_id = (auth.uid())::text);

-- Upload aceita o formato novo (tenant/user/...) e o formato legado do app
-- (audio|image|video|document|sticker|file)/arquivo — enquanto o bundle antigo
-- estiver publicado. Mantém a exigência de usuário autenticado e tenant válido.
DROP POLICY IF EXISTS "chat-media tenant-user scoped upload" ON storage.objects;
DROP POLICY IF EXISTS "chat-media scoped upload" ON storage.objects;
CREATE POLICY "chat-media scoped upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-media'
  AND auth.uid() IS NOT NULL
  AND current_tenant_id() IS NOT NULL
  AND (
    name LIKE (current_tenant_id()::text || '/' || (auth.uid())::text || '/%')
    OR name ~ '^(audio|image|video|document|sticker|file)/[^/]+$'
  )
);