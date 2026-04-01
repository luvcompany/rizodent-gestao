
-- Tabela principal de bots
CREATE TABLE public.bots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft',
  flow_json jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  current_version integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.bots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view bots" ON public.bots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and managers can insert bots" ON public.bots FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));
CREATE POLICY "Admins and managers can update bots" ON public.bots FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));
CREATE POLICY "Admins and managers can delete bots" ON public.bots FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));

CREATE TRIGGER update_bots_updated_at BEFORE UPDATE ON public.bots FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela de versões publicadas
CREATE TABLE public.bot_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_id uuid NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  version integer NOT NULL,
  flow_json jsonb NOT NULL,
  published_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(bot_id, version)
);

ALTER TABLE public.bot_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view bot_versions" ON public.bot_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and managers can insert bot_versions" ON public.bot_versions FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));
CREATE POLICY "Admins and managers can delete bot_versions" ON public.bot_versions FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));

-- Tabela de execuções
CREATE TABLE public.bot_executions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_id uuid NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  bot_version_id uuid REFERENCES public.bot_versions(id) ON DELETE SET NULL,
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  current_node_id text,
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone
);

ALTER TABLE public.bot_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view bot_executions" ON public.bot_executions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert bot_executions" ON public.bot_executions FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Staff can update bot_executions" ON public.bot_executions FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins and managers can delete bot_executions" ON public.bot_executions FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));

CREATE TRIGGER update_bot_executions_updated_at BEFORE UPDATE ON public.bot_executions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela de logs de execução
CREATE TABLE public.bot_execution_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES public.bot_executions(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  action text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_execution_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view bot_execution_logs" ON public.bot_execution_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert bot_execution_logs" ON public.bot_execution_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins and managers can delete bot_execution_logs" ON public.bot_execution_logs FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));

-- Tabela de gatilhos por etapa do Kanban
CREATE TABLE public.bot_stage_triggers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  stage_id uuid NOT NULL REFERENCES public.crm_stages(id) ON DELETE CASCADE,
  bot_id uuid NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  trigger_type text NOT NULL DEFAULT 'on_enter',
  delay_minutes integer NOT NULL DEFAULT 0,
  conditions jsonb DEFAULT '{}'::jsonb,
  priority integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_stage_triggers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view bot_stage_triggers" ON public.bot_stage_triggers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and managers can insert bot_stage_triggers" ON public.bot_stage_triggers FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));
CREATE POLICY "Admins and managers can update bot_stage_triggers" ON public.bot_stage_triggers FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));
CREATE POLICY "Admins and managers can delete bot_stage_triggers" ON public.bot_stage_triggers FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));

CREATE TRIGGER update_bot_stage_triggers_updated_at BEFORE UPDATE ON public.bot_stage_triggers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Index para buscas frequentes
CREATE INDEX idx_bot_executions_lead_id ON public.bot_executions(lead_id);
CREATE INDEX idx_bot_executions_status ON public.bot_executions(status);
CREATE INDEX idx_bot_execution_logs_execution_id ON public.bot_execution_logs(execution_id);
CREATE INDEX idx_bot_stage_triggers_stage_id ON public.bot_stage_triggers(stage_id);

-- Habilitar realtime para execuções (status do bot no chat)
ALTER PUBLICATION supabase_realtime ADD TABLE public.bot_executions;
