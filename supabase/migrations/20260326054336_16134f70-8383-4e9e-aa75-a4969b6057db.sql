
-- Add description and color to crm_pipelines
ALTER TABLE public.crm_pipelines ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.crm_pipelines ADD COLUMN IF NOT EXISTS color text DEFAULT '#6366f1';

-- Create funnel_channels table
CREATE TABLE IF NOT EXISTS public.funnel_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES public.crm_pipelines(id) ON DELETE CASCADE,
  channel_type text NOT NULL,
  channel_config jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.funnel_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view funnel_channels" ON public.funnel_channels FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert funnel_channels" ON public.funnel_channels FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update funnel_channels" ON public.funnel_channels FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete funnel_channels" ON public.funnel_channels FOR DELETE TO authenticated USING (true);
