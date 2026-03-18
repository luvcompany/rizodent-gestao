
CREATE TABLE public.registros_diarios_atendimento (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  clinica_id UUID NOT NULL REFERENCES public.clinicas(id),
  leads_agendados_futuro INTEGER NOT NULL DEFAULT 0,
  leads_reagendados INTEGER NOT NULL DEFAULT 0,
  leads_reagendados_ligacao INTEGER NOT NULL DEFAULT 0,
  total_ligacoes INTEGER NOT NULL DEFAULT 0,
  ligacoes_atendidas INTEGER NOT NULL DEFAULT 0,
  agendamentos_por_ligacao INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(data, clinica_id)
);

ALTER TABLE public.registros_diarios_atendimento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view registros_diarios_atendimento" ON public.registros_diarios_atendimento FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert registros_diarios_atendimento" ON public.registros_diarios_atendimento FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update registros_diarios_atendimento" ON public.registros_diarios_atendimento FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete registros_diarios_atendimento" ON public.registros_diarios_atendimento FOR DELETE TO authenticated USING (true);
