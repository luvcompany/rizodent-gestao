ALTER TABLE public.crm_notifications ADD COLUMN IF NOT EXISTS dedupe_key text;
CREATE UNIQUE INDEX IF NOT EXISTS crm_notifications_dedupe_key_uniq
  ON public.crm_notifications (dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pagamentos_dontus_key_uniq
  ON public.pagamentos (dontus_key) WHERE dontus_key IS NOT NULL;