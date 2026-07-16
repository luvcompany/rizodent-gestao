-- ==========================================================================
-- Cron: polling do relatório de chamadas Api4Com (GET /api/v1/calls).
-- Rede de segurança do webhook: importa ligações que NÃO disparam o webhook
-- (as discadas manualmente na extensão). Roda a cada 3 min; dedup por call_id.
-- ==========================================================================

-- Token do cron (validado por authorizeInternal via x-cron-secret).
INSERT INTO public._internal_secrets (name, value)
VALUES ('api4com_poll_cron_token', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'api4com-poll-calls') THEN
    PERFORM cron.unschedule('api4com-poll-calls');
  END IF;
END $$;

SELECT cron.schedule(
  'api4com-poll-calls',
  '*/3 * * * *',  -- a cada 3 minutos
  $$
  SELECT net.http_post(
    url     := 'https://oybroifaleftwrhnlhqc.supabase.co/functions/v1/api4com-poll-calls',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM public._internal_secrets WHERE name = 'api4com_poll_cron_token')
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
