
-- Custom fields definition (shared across all leads)
CREATE TABLE public.crm_custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  field_type text NOT NULL DEFAULT 'text',
  options jsonb DEFAULT '[]'::jsonb,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_custom_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view crm_custom_fields"
  ON public.crm_custom_fields FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert crm_custom_fields"
  ON public.crm_custom_fields FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update crm_custom_fields"
  ON public.crm_custom_fields FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete crm_custom_fields"
  ON public.crm_custom_fields FOR DELETE TO authenticated USING (true);

-- Custom field values per lead
CREATE TABLE public.crm_lead_custom_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES public.crm_custom_fields(id) ON DELETE CASCADE,
  value text,
  UNIQUE (lead_id, field_id)
);

ALTER TABLE public.crm_lead_custom_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view crm_lead_custom_values"
  ON public.crm_lead_custom_values FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert crm_lead_custom_values"
  ON public.crm_lead_custom_values FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update crm_lead_custom_values"
  ON public.crm_lead_custom_values FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete crm_lead_custom_values"
  ON public.crm_lead_custom_values FOR DELETE TO authenticated USING (true);

-- Lead stage history for time tracking
CREATE TABLE public.crm_lead_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES public.crm_stages(id) ON DELETE CASCADE,
  entered_at timestamptz NOT NULL DEFAULT now(),
  exited_at timestamptz,
  changed_by uuid
);

ALTER TABLE public.crm_lead_stage_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view crm_lead_stage_history"
  ON public.crm_lead_stage_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert crm_lead_stage_history"
  ON public.crm_lead_stage_history FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update crm_lead_stage_history"
  ON public.crm_lead_stage_history FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete crm_lead_stage_history"
  ON public.crm_lead_stage_history FOR DELETE TO authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_lead_stage_history;
