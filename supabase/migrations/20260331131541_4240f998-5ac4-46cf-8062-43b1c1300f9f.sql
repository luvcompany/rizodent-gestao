
-- Table 1: crm_followup_configs
CREATE TABLE public.crm_followup_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES public.crm_stages(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT false,
  disparo1_delay_minutes integer NOT NULL DEFAULT 10,
  disparo1_type text NOT NULL DEFAULT 'text',
  disparo1_content text,
  disparo1_template_id uuid REFERENCES public.crm_whatsapp_templates(id) ON DELETE SET NULL,
  disparo2_delay_minutes integer NOT NULL DEFAULT 120,
  disparo2_type text NOT NULL DEFAULT 'text',
  disparo2_content text,
  disparo2_template_id uuid REFERENCES public.crm_whatsapp_templates(id) ON DELETE SET NULL,
  move_to_stage_id uuid REFERENCES public.crm_stages(id) ON DELETE SET NULL,
  return_to_stage_id uuid REFERENCES public.crm_stages(id) ON DELETE SET NULL,
  stop_on_stages text[] DEFAULT '{}',
  max_attempts integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_followup_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view crm_followup_configs" ON public.crm_followup_configs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert crm_followup_configs" ON public.crm_followup_configs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update crm_followup_configs" ON public.crm_followup_configs FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete crm_followup_configs" ON public.crm_followup_configs FOR DELETE TO authenticated USING (true);

-- Table 2: crm_followup_queue
CREATE TABLE public.crm_followup_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES public.crm_stages(id) ON DELETE CASCADE,
  config_id uuid NOT NULL REFERENCES public.crm_followup_configs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'waiting_disparo1',
  attempt_count integer NOT NULL DEFAULT 0,
  disparo1_scheduled_at timestamptz,
  disparo1_sent_at timestamptz,
  disparo2_scheduled_at timestamptz,
  disparo2_sent_at timestamptz,
  last_lead_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_followup_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view crm_followup_queue" ON public.crm_followup_queue FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert crm_followup_queue" ON public.crm_followup_queue FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update crm_followup_queue" ON public.crm_followup_queue FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete crm_followup_queue" ON public.crm_followup_queue FOR DELETE TO authenticated USING (true);

-- Indexes
CREATE INDEX idx_followup_queue_lead_id ON public.crm_followup_queue(lead_id);
CREATE INDEX idx_followup_queue_stage_id ON public.crm_followup_queue(stage_id);
CREATE INDEX idx_followup_queue_status ON public.crm_followup_queue(status);
CREATE INDEX idx_followup_configs_stage_id ON public.crm_followup_configs(stage_id);
