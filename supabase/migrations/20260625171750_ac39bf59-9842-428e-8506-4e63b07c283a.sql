
-- Provision internal secret for the AI auto-send cron job
INSERT INTO public._internal_secrets(name, value)
VALUES ('ai_autosend_cron_token', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

-- Unschedule previous cron if exists
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-auto-send-suggestions') THEN
    PERFORM cron.unschedule('ai-auto-send-suggestions');
  END IF;
END $$;

-- Schedule the auto-send cron: every minute, fetches token from _internal_secrets
SELECT cron.schedule(
  'ai-auto-send-suggestions',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://oybroifaleftwrhnlhqc.supabase.co/functions/v1/auto-send-suggestions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM public._internal_secrets WHERE name = 'ai_autosend_cron_token')
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
