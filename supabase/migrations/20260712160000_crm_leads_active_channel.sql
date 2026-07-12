-- ============================================================================
-- Canal de atendimento canônico do lead
-- ============================================================================
-- Hoje o canal (WhatsApp x Instagram) é sempre INFERIDO (instagram_user_id,
-- pipeline, source...), nunca armazenado. Esta coluna passa a ser a fonte da
-- verdade quando o atendimento troca de canal (ex.: transferir um lead do
-- Instagram para o WhatsApp mantendo a mesma conversa).
--
-- NULL = comportamento legado (inferência atual via helper getLeadChannel), então
-- não altera nenhum lead existente. Valores válidos: 'whatsapp' | 'instagram'.
-- Aditiva e segura.
-- ============================================================================

ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS active_channel text
  CHECK (active_channel IN ('whatsapp', 'instagram'));
