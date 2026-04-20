-- Garantir extensões para cron
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remover job anterior se existir
DO $$
BEGIN
  PERFORM cron.unschedule('instagram-refresh-tokens-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 09:00 horário de Brasília (UTC-3) = 12:00 UTC
SELECT cron.schedule(
  'instagram-refresh-tokens-daily',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://oybroifaleftwrhnlhqc.supabase.co/functions/v1/instagram-refresh-tokens',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95YnJvaWZhbGVmdHdyaG5saHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMzMzNzAsImV4cCI6MjA4ODgwOTM3MH0.taPn4xLjXxBH846R8sZ6APwoOptGkY-12pqKHCjboYs"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);