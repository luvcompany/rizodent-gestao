INSERT INTO public._internal_secrets(name, value)
VALUES ('instagram_token_refresh_cron_token', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'instagram-refresh-tokens-daily') THEN
    PERFORM cron.unschedule('instagram-refresh-tokens-daily');
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'instagram-token-refresh') THEN
    PERFORM cron.unschedule('instagram-token-refresh');
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'instagram-token-refresh-daily') THEN
    PERFORM cron.unschedule('instagram-token-refresh-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'instagram-token-refresh-daily',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://oybroifaleftwrhnlhqc.supabase.co/functions/v1/instagram-token-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM public._internal_secrets WHERE name = 'instagram_token_refresh_cron_token')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);