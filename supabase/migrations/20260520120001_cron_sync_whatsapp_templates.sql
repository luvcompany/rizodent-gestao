-- Cron de sincronização automática de modelos WhatsApp com a Meta (a cada 5 min).
-- Requer extensões: pg_cron e pg_net (habilitadas no painel Supabase > Database > Extensions).
--
-- Como aplicar manualmente no SQL Editor do Supabase (caso a migration falhe por
-- pg_cron não estar habilitado):
--
--   1. Acesse: Supabase Dashboard → Database → Extensions
--   2. Habilite: pg_cron  e  pg_net
--   3. Cole e execute este SQL no SQL Editor

-- Habilita extensões (seguro: não falha se já estiverem ativas)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove job existente com o mesmo nome (idempotente)
SELECT cron.unschedule('sync-whatsapp-templates')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-whatsapp-templates');

-- Agenda sincronização a cada 5 minutos
SELECT cron.schedule(
  'sync-whatsapp-templates',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://oybroifaleftwrhnlhqc.supabase.co/functions/v1/sync-whatsapp-templates-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey',       'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95YnJvaWZhbGVmdHdyaG5saHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMzMzNzAsImV4cCI6MjA4ODgwOTM3MH0.taPn4xLjXxBH846R8sZ6APwoOptGkY-12pqKHCjboYs',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95YnJvaWZhbGVmdHdyaG5saHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMzMzNzAsImV4cCI6MjA4ODgwOTM3MH0.taPn4xLjXxBH846R8sZ6APwoOptGkY-12pqKHCjboYs'
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
