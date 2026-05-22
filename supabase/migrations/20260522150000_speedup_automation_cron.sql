-- Aumenta a frequência do automation-engine de 5 minutos para 1 minuto.
-- Motivo: bots de follow-up com múltiplas mensagens dependem do cron para
-- processar os timeouts de wait_reply. Com 5 min de intervalo + limite de
-- 10 execuções por tick, follow-ups longos demoravam horas para progredir.
-- Combinado com o aumento do batch (10 → 100) na função, isso garante que
-- o sistema processe rapidamente filas grandes.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'automation-engine-cron') THEN
    PERFORM cron.unschedule('automation-engine-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'automation-engine-cron',
  '* * * * *',  -- a cada 1 minuto
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

-- Função SQL para recuperar manualmente leads travados em follow-up.
-- Pode ser chamada via dashboard SQL Editor quando o usuário detectar
-- leads parados: SELECT public.recover_stuck_bot_executions();
CREATE OR REPLACE FUNCTION public.recover_stuck_bot_executions()
RETURNS TABLE(
  cleared_active integer,
  completed_orphans integer,
  cleared_expired integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cleared_active integer;
  v_completed_orphans integer;
  v_cleared_expired integer;
BEGIN
  -- Active executions idle for >15 minutes
  WITH upd AS (
    UPDATE public.bot_executions
    SET status = 'error', completed_at = now(), timeout_at = NULL
    WHERE status = 'active' AND updated_at < now() - interval '15 minutes'
    RETURNING id
  ) SELECT count(*) INTO v_cleared_active FROM upd;

  -- waiting_reply with no timeout, older than 7 days
  WITH upd AS (
    UPDATE public.bot_executions
    SET status = 'completed', completed_at = now(), timeout_at = NULL
    WHERE status = 'waiting_reply' AND timeout_at IS NULL AND started_at < now() - interval '7 days'
    RETURNING id
  ) SELECT count(*) INTO v_completed_orphans FROM upd;

  -- waiting_reply with timeout expired > 6h ago
  WITH upd AS (
    UPDATE public.bot_executions
    SET status = 'error', completed_at = now(), timeout_at = NULL
    WHERE status = 'waiting_reply' AND timeout_at IS NOT NULL AND timeout_at < now() - interval '6 hours'
    RETURNING id
  ) SELECT count(*) INTO v_cleared_expired FROM upd;

  RETURN QUERY SELECT v_cleared_active, v_completed_orphans, v_cleared_expired;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recover_stuck_bot_executions() TO authenticated;
