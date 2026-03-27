ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS whatsapp_message_id text DEFAULT NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reply_to_message_id uuid DEFAULT NULL;