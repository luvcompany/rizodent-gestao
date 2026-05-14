-- =========================================================
-- 1) DB trigger: enqueue on_enter / on_create_or_enter automations
--    quando o stage_id de um lead muda (ou ao criar com stage)
-- =========================================================
CREATE OR REPLACE FUNCTION public.enqueue_stage_entry_automations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auto record;
BEGIN
  IF NEW.stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  FOR v_auto IN
    SELECT id, action_type, action_config
      FROM public.crm_automations
     WHERE is_active = true
       AND stage_id = NEW.stage_id
       AND trigger_type IN ('on_enter', 'on_create_or_enter')
  LOOP
    -- Evita duplicar: só insere se não há item pendente para o mesmo lead/automação
    IF NOT EXISTS (
      SELECT 1 FROM public.crm_automation_queue
       WHERE lead_id = NEW.id
         AND automation_id = v_auto.id
         AND status = 'pending'
    ) THEN
      INSERT INTO public.crm_automation_queue
        (automation_id, lead_id, action_type, action_config, scheduled_at, status, layer_index)
      VALUES
        (v_auto.id, NEW.id, v_auto.action_type, v_auto.action_config, now(), 'pending', 0);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_stage_entry_automations ON public.crm_leads;
CREATE TRIGGER trg_enqueue_stage_entry_automations
AFTER INSERT OR UPDATE OF stage_id ON public.crm_leads
FOR EACH ROW EXECUTE FUNCTION public.enqueue_stage_entry_automations();

-- =========================================================
-- 2) Watchdog diário (03:00 UTC): leads em etapa com automação
--    send_bot, sem bot ativo e sem item pendente -> reenfileira
-- =========================================================
CREATE OR REPLACE FUNCTION public.watchdog_reenqueue_missing_bots()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH inserted AS (
    INSERT INTO public.crm_automation_queue
      (automation_id, lead_id, action_type, action_config, scheduled_at, status, layer_index)
    SELECT a.id, l.id, a.action_type, a.action_config, now(), 'pending', 0
      FROM public.crm_leads l
      JOIN public.crm_automations a
        ON a.stage_id = l.stage_id
       AND a.is_active = true
       AND a.action_type = 'send_bot'
       AND a.trigger_type IN ('on_enter','on_create_or_enter')
     WHERE NOT EXISTS (
            SELECT 1 FROM public.bot_executions be
             WHERE be.lead_id = l.id
               AND be.bot_id = (a.action_config->>'bot_id')::uuid
               AND be.status IN ('active','waiting_reply')
           )
       AND NOT EXISTS (
            SELECT 1 FROM public.crm_automation_queue q
             WHERE q.lead_id = l.id
               AND q.automation_id = a.id
               AND q.status = 'pending'
           )
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM inserted;

  RAISE NOTICE 'watchdog_reenqueue_missing_bots: enfileirados %', v_inserted;
  RETURN v_inserted;
END;
$$;

-- Agendamento diário às 03:00 UTC (00:00 BRT)
SELECT cron.unschedule('watchdog-reenqueue-missing-bots-daily')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'watchdog-reenqueue-missing-bots-daily');

SELECT cron.schedule(
  'watchdog-reenqueue-missing-bots-daily',
  '0 3 * * *',
  $$ SELECT public.watchdog_reenqueue_missing_bots(); $$
);