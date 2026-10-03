CREATE OR REPLACE FUNCTION public.cleanup_old_completed_tasks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.crm_tasks
  WHERE status = 'done'
    AND updated_at < now() - interval '30 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_completed_tasks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_completed_tasks() TO service_role;

SELECT cron.schedule(
  'cleanup-old-completed-tasks',
  '0 3 * * *',
  $$SELECT public.cleanup_old_completed_tasks();$$
);