CREATE TABLE IF NOT EXISTS public.crm_automation_executions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  automation_id uuid NOT NULL REFERENCES public.crm_automations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  executed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_automation_executions_unique UNIQUE (automation_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_automation_executions_automation ON public.crm_automation_executions(automation_id);
CREATE INDEX IF NOT EXISTS idx_crm_automation_executions_lead ON public.crm_automation_executions(lead_id);

ALTER TABLE public.crm_automation_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view crm_automation_executions"
ON public.crm_automation_executions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff can insert crm_automation_executions"
ON public.crm_automation_executions FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and managers can delete crm_automation_executions"
ON public.crm_automation_executions FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));