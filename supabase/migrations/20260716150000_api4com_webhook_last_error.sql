-- Diagnóstico do registro do webhook Api4Com: guarda o motivo da última falha
-- (status/corpo da resposta da Api4Com), sem expor o token. Usado pela aba
-- Telefonia e pela ação register_webhook do api4com-connect.
ALTER TABLE public.api4com_config ADD COLUMN IF NOT EXISTS webhook_last_error text;
