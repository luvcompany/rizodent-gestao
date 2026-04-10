
CREATE TABLE public.crm_automation_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  automation_id uuid NOT NULL REFERENCES public.crm_automations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  action_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'::text,
  layer_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_automation_queue_status_scheduled ON public.crm_automation_queue(status, scheduled_at);
CREATE INDEX idx_automation_queue_lead ON public.crm_automation_queue(lead_id);

ALTER TABLE public.crm_automation_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view crm_automation_queue"
  ON public.crm_automation_queue FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Staff can insert crm_automation_queue"
  ON public.crm_automation_queue FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Staff can update crm_automation_queue"
  ON public.crm_automation_queue FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Staff can delete crm_automation_queue"
  ON public.crm_automation_queue FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_crm_automation_queue_updated_at
  BEFORE UPDATE ON public.crm_automation_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
