
-- Add columns to crm_leads for bot automation
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS follow_up_count integer DEFAULT 0;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS automation_paused boolean DEFAULT false;

-- Bots table
CREATE TABLE IF NOT EXISTS public.bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.bots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view bots" ON public.bots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert bots" ON public.bots FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update bots" ON public.bots FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete bots" ON public.bots FOR DELETE TO authenticated USING (true);

-- Bot nodes table
CREATE TABLE IF NOT EXISTS public.bot_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid REFERENCES public.bots(id) ON DELETE CASCADE,
  type text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  position_x float DEFAULT 0,
  position_y float DEFAULT 0,
  is_start_node boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.bot_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view bot_nodes" ON public.bot_nodes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert bot_nodes" ON public.bot_nodes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update bot_nodes" ON public.bot_nodes FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete bot_nodes" ON public.bot_nodes FOR DELETE TO authenticated USING (true);

-- Bot node outputs table
CREATE TABLE IF NOT EXISTS public.bot_node_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid REFERENCES public.bot_nodes(id) ON DELETE CASCADE,
  label text NOT NULL,
  condition_type text NOT NULL,
  condition_value text,
  next_node_id uuid REFERENCES public.bot_nodes(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.bot_node_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view bot_node_outputs" ON public.bot_node_outputs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert bot_node_outputs" ON public.bot_node_outputs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update bot_node_outputs" ON public.bot_node_outputs FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete bot_node_outputs" ON public.bot_node_outputs FOR DELETE TO authenticated USING (true);

-- Stage bot config table
CREATE TABLE IF NOT EXISTS public.stage_bot_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid REFERENCES public.crm_stages(id) ON DELETE CASCADE,
  bot_id uuid REFERENCES public.bots(id) ON DELETE SET NULL,
  trigger_type text DEFAULT 'on_enter',
  active boolean DEFAULT true,
  is_final_stage boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(stage_id)
);
ALTER TABLE public.stage_bot_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view stage_bot_config" ON public.stage_bot_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert stage_bot_config" ON public.stage_bot_config FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update stage_bot_config" ON public.stage_bot_config FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete stage_bot_config" ON public.stage_bot_config FOR DELETE TO authenticated USING (true);

-- Bot executions table
CREATE TABLE IF NOT EXISTS public.bot_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid REFERENCES public.bots(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  current_node_id uuid REFERENCES public.bot_nodes(id) ON DELETE SET NULL,
  status text DEFAULT 'active',
  waiting_since timestamptz,
  timeout_at timestamptz,
  waiting_for text,
  started_at timestamptz DEFAULT now(),
  finished_at timestamptz,
  cancel_reason text
);
ALTER TABLE public.bot_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view bot_executions" ON public.bot_executions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert bot_executions" ON public.bot_executions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update bot_executions" ON public.bot_executions FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete bot_executions" ON public.bot_executions FOR DELETE TO authenticated USING (true);

-- Bot execution logs table
CREATE TABLE IF NOT EXISTS public.bot_execution_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid REFERENCES public.bot_executions(id) ON DELETE CASCADE,
  node_id uuid REFERENCES public.bot_nodes(id) ON DELETE SET NULL,
  action text,
  result text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.bot_execution_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view bot_execution_logs" ON public.bot_execution_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert bot_execution_logs" ON public.bot_execution_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update bot_execution_logs" ON public.bot_execution_logs FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete bot_execution_logs" ON public.bot_execution_logs FOR DELETE TO authenticated USING (true);
