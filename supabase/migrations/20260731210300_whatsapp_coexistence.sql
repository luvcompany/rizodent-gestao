-- Coexistência: número ativo ao mesmo tempo no app WhatsApp Business (celular) e
-- na Cloud API. O modo é escolhido no início do Embedded Signup e precisa
-- sobreviver até o callback (é ele quem dispara o sync de histórico/contatos).
ALTER TABLE public.whatsapp_oauth_states
  ADD COLUMN IF NOT EXISTS coexistence boolean NOT NULL DEFAULT false;

-- Marca o número como coexistente (usado pela UI e para saber que mensagens
-- podem chegar por smb_message_echoes, não só por messages).
ALTER TABLE public.whatsapp_numbers
  ADD COLUMN IF NOT EXISTS is_coexistence boolean NOT NULL DEFAULT false;

-- Mensagens espelhadas do app do celular: o wamid vem do aparelho e a direção é
-- outbound, mas quem escreveu foi a atendente no WhatsApp — não o CRM.
-- Coluna informativa (nullable) para a UI distinguir sem quebrar nada existente.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS from_device boolean NOT NULL DEFAULT false;

GRANT SELECT (id, tenant_id, phone_number_id, display_name, phone_e164, waba_id, app_id, is_active, is_default, is_coexistence, created_at, updated_at)
  ON public.whatsapp_numbers TO authenticated;
