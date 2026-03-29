
CREATE TABLE public.crm_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  title text NOT NULL,
  type text NOT NULL DEFAULT 'personalizado',
  due_date timestamp with time zone NOT NULL,
  notes text,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view crm_tasks" ON public.crm_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert crm_tasks" ON public.crm_tasks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update crm_tasks" ON public.crm_tasks FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete crm_tasks" ON public.crm_tasks FOR DELETE TO authenticated USING (true);
