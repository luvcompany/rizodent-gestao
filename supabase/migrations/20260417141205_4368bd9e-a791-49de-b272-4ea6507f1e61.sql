
CREATE TABLE public.dashboard_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL,
  descricao text,
  clinica_id uuid REFERENCES public.clinicas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (data, clinica_id)
);

CREATE INDEX idx_dashboard_holidays_data ON public.dashboard_holidays(data);

ALTER TABLE public.dashboard_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view dashboard_holidays"
  ON public.dashboard_holidays FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins and managers can insert dashboard_holidays"
  ON public.dashboard_holidays FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));

CREATE POLICY "Admins and managers can update dashboard_holidays"
  ON public.dashboard_holidays FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));

CREATE POLICY "Admins and managers can delete dashboard_holidays"
  ON public.dashboard_holidays FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));
