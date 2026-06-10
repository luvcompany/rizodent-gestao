
-- 1. Add error_message column for visibility into queue failures
ALTER TABLE public.crm_automation_queue
  ADD COLUMN IF NOT EXISTS error_message text;

-- 2. Recover items stuck in "processing" so the new worker can retry them
UPDATE public.crm_automation_queue
   SET status = 'pending', updated_at = now()
 WHERE status = 'processing'
   AND updated_at < now() - interval '10 minutes';

-- 3. Schedule the new dedicated queue worker every minute
SELECT cron.unschedule('automation-queue-worker-cron')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'automation-queue-worker-cron');

SELECT cron.schedule(
  'automation-queue-worker-cron',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://oybroifaleftwrhnlhqc.supabase.co/functions/v1/automation-queue-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey',       'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95YnJvaWZhbGVmdHdyaG5saHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMzMzNzAsImV4cCI6MjA4ODgwOTM3MH0.taPn4xLjXxBH846R8sZ6APwoOptGkY-12pqKHCjboYs',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95YnJvaWZhbGVmdHdyaG5saHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMzMzNzAsImV4cCI6MjA4ODgwOTM3MH0.taPn4xLjXxBH846R8sZ6APwoOptGkY-12pqKHCjboYs'
    ),
    body := jsonb_build_object('source', 'cron')
  );
  $$
);
