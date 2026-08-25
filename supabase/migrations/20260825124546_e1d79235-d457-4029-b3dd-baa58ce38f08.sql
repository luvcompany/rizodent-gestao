ALTER TABLE public.bot_executions
  ADD COLUMN IF NOT EXISTS started_by_automation_id uuid REFERENCES public.crm_automations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bot_executions_started_by_automation_idx
  ON public.bot_executions (started_by_automation_id)
  WHERE started_by_automation_id IS NOT NULL;