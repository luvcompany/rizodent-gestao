
-- 1. crm_pipelines
CREATE TABLE public.crm_pipelines (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_pipelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view crm_pipelines" ON public.crm_pipelines FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert crm_pipelines" ON public.crm_pipelines FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update crm_pipelines" ON public.crm_pipelines FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete crm_pipelines" ON public.crm_pipelines FOR DELETE TO authenticated USING (true);

-- 2. crm_stages
CREATE TABLE public.crm_stages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_id uuid NOT NULL REFERENCES public.crm_pipelines(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6366f1',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view crm_stages" ON public.crm_stages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert crm_stages" ON public.crm_stages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update crm_stages" ON public.crm_stages FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete crm_stages" ON public.crm_stages FOR DELETE TO authenticated USING (true);

-- 3. crm_leads
CREATE TABLE public.crm_leads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_id uuid NOT NULL REFERENCES public.crm_pipelines(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES public.crm_stages(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  tags text[] DEFAULT '{}',
  source text,
  value numeric DEFAULT 0,
  has_task boolean NOT NULL DEFAULT false,
  task_overdue boolean NOT NULL DEFAULT false,
  notes text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view crm_leads" ON public.crm_leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert crm_leads" ON public.crm_leads FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update crm_leads" ON public.crm_leads FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete crm_leads" ON public.crm_leads FOR DELETE TO authenticated USING (true);

-- 4. crm_automations
CREATE TABLE public.crm_automations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  stage_id uuid NOT NULL REFERENCES public.crm_stages(id) ON DELETE CASCADE,
  trigger_type text NOT NULL DEFAULT 'on_enter',
  action_type text NOT NULL,
  action_config jsonb DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_automations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view crm_automations" ON public.crm_automations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert crm_automations" ON public.crm_automations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update crm_automations" ON public.crm_automations FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete crm_automations" ON public.crm_automations FOR DELETE TO authenticated USING (true);

-- 5. crm_whatsapp_templates
CREATE TABLE public.crm_whatsapp_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'UTILITY',
  language text NOT NULL DEFAULT 'pt_BR',
  status text NOT NULL DEFAULT 'PENDING',
  header_type text,
  header_content text,
  body_text text,
  footer_text text,
  buttons jsonb,
  meta_template_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_whatsapp_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view crm_whatsapp_templates" ON public.crm_whatsapp_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert crm_whatsapp_templates" ON public.crm_whatsapp_templates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update crm_whatsapp_templates" ON public.crm_whatsapp_templates FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete crm_whatsapp_templates" ON public.crm_whatsapp_templates FOR DELETE TO authenticated USING (true);
