-- Agenda o automation-engine para rodar a cada 5 minutos.
-- Isso habilita os gatilhos: before_scheduled, lead_stale, no_show,
-- progressive_reengagement, no_response e processamento da fila pendente.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'automation-engine-cron') THEN
    PERFORM cron.unschedule('automation-engine-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'automation-engine-cron',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://oybroifaleftwrhnlhqc.supabase.co/functions/v1/automation-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey',       'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95YnJvaWZhbGVmdHdyaG5saHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMzMzNzAsImV4cCI6MjA4ODgwOTM3MH0.taPn4xLjXxBH846R8sZ6APwoOptGkY-12pqKHCjboYs',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95YnJvaWZhbGVmdHdyaG5saHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMzMzNzAsImV4cCI6MjA4ODgwOTM3MH0.taPn4xLjXxBH846R8sZ6APwoOptGkY-12pqKHCjboYs'
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
