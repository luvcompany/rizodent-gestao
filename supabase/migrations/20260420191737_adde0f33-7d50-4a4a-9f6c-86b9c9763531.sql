-- Add columns for OAuth flow
ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS page_id text,
  ADD COLUMN IF NOT EXISTS long_lived_token_expires_at timestamp with time zone;

-- Unique constraint on instagram_account_id to support upsert
CREATE UNIQUE INDEX IF NOT EXISTS instagram_accounts_instagram_account_id_key
  ON public.instagram_accounts (instagram_account_id);

-- Enable required extensions for cron
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;