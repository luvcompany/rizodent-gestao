-- Remove orphan cron (bot-engine has no check_timeouts handler; logic lives in automation-engine)
SELECT cron.unschedule('bot-engine-check-timeouts');

-- Reanima execuções de bot já vencidas para que o automation-engine as processe no próximo tick
UPDATE public.bot_executions
   SET timeout_at = now()
 WHERE status = 'waiting_reply'
   AND timeout_at IS NOT NULL
   AND timeout_at < now() + interval '5 minutes';