-- Remove agendamento anterior de forma segura, ignorando se não existir
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup_system_logs_daily');
EXCEPTION WHEN OTHERS THEN
  -- job não existia; segue sem erro
END;
$$;

-- Função de limpeza
CREATE OR REPLACE FUNCTION public.cleanup_system_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Logs de execução de bots: manter 30 dias
  DELETE FROM public.bot_execution_logs WHERE created_at < now() - interval '30 days';

  -- Fila de automações já finalizadas: manter 30 dias
  DELETE FROM public.crm_automation_queue
  WHERE status IN ('cancelled', 'failed', 'expired', 'sent')
    AND updated_at < now() - interval '30 days';

  -- Detalhes de execução de jobs cron: manter 7 dias
  DELETE FROM cron.job_run_details WHERE start_time < now() - interval '7 days';

  -- Respostas HTTP internas do pg_net: manter 7 dias
  DELETE FROM net._http_response WHERE created < now() - interval '7 days';
END;
$$;

-- Agenda execução diária às 04:00 UTC
SELECT cron.schedule('cleanup_system_logs_daily', '0 4 * * *', 'SELECT public.cleanup_system_logs()');

COMMENT ON FUNCTION public.cleanup_system_logs() IS 'Rotina diária de limpeza de logs e filas antigas. Chamada pelo cron job cleanup_system_logs_daily.';
