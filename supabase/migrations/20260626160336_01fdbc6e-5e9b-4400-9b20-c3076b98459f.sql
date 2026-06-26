
-- Gera token único e armazena em _internal_secrets para o cron
INSERT INTO public._internal_secrets (name, value)
VALUES ('sync_templates_cron_token', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

-- Recria o cron usando x-cron-secret (sem JWT em texto plano)
SELECT cron.unschedule('sync-whatsapp-templates');

SELECT cron.schedule(
  'sync-whatsapp-templates',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://oybroifaleftwrhnlhqc.supabase.co/functions/v1/sync-whatsapp-templates-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM public._internal_secrets WHERE name = 'sync_templates_cron_token')
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
