-- ============================================================================
-- Bots multicanal: canais por bot (genérico)
-- ============================================================================
-- Cada bot passa a declarar em quais canais roda. O bot-engine só executa se o
-- canal do lead (whatsapp = tem phone; instagram = tem instagram_user_id) estiver
-- na lista. Default '{whatsapp}' preserva o comportamento atual de todos os bots.
-- ============================================================================

ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS channels text[] NOT NULL DEFAULT '{whatsapp}'::text[];
