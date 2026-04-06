
-- Create appointments table
CREATE TABLE public.crm_appointments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.crm_tasks(id) ON DELETE SET NULL,
  scheduled_date DATE NOT NULL,
  scheduled_time TIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  notes TEXT,
  confirmed_by UUID,
  confirmed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.crm_appointments ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view crm_appointments"
  ON public.crm_appointments FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Staff can insert crm_appointments"
  ON public.crm_appointments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Staff can update crm_appointments"
  ON public.crm_appointments FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Staff can delete crm_appointments"
  ON public.crm_appointments FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Timestamp trigger
CREATE TRIGGER update_crm_appointments_updated_at
  BEFORE UPDATE ON public.crm_appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_crm_appointments_lead_id ON public.crm_appointments(lead_id);
CREATE INDEX idx_crm_appointments_scheduled_date ON public.crm_appointments(scheduled_date);
CREATE INDEX idx_crm_appointments_status ON public.crm_appointments(status);
