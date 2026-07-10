-- ============================================================================
-- Realtime na tabela de permissões de ligação
-- ============================================================================
-- A resposta do cliente ao pedido de permissão (aceitar/recusar no WhatsApp) é
-- gravada em whatsapp_call_permissions pelo trigger record_call_permission_reply
-- (migração 20260710120000). Sem realtime nesta tabela, o time só descobria a
-- resposta abrindo a conversa. Aqui a incluímos na publicação supabase_realtime
-- para que o front (WhatsappCallContext) notifique na hora (toast) quando o
-- cliente autoriza ou recusa ligações.
--
-- Mudança ADITIVA e reversível: não altera dados nem colunas, só passa a
-- transmitir os eventos da tabela. A RLS de SELECT por tenant já existe, então o
-- realtime respeita o isolamento (cada tenant só recebe suas próprias linhas).
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'whatsapp_call_permissions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_call_permissions;
  END IF;
END$$;
