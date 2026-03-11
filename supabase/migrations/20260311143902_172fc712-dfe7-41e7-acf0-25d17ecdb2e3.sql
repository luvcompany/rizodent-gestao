
-- Tabela de leads diários (funil de vendas)
CREATE TABLE public.leads_diarios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  clinica_id UUID NOT NULL REFERENCES public.clinicas(id),
  leads_novos INTEGER NOT NULL DEFAULT 0,
  agendaram INTEGER NOT NULL DEFAULT 0,
  faltaram INTEGER NOT NULL DEFAULT 0,
  contrataram INTEGER NOT NULL DEFAULT 0,
  nao_contrataram INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(data, clinica_id)
);

-- RLS
ALTER TABLE public.leads_diarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view leads_diarios"
  ON public.leads_diarios FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert leads_diarios"
  ON public.leads_diarios FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update leads_diarios"
  ON public.leads_diarios FOR UPDATE TO authenticated
  USING (true);

-- Trigger updated_at
CREATE TRIGGER update_leads_diarios_updated_at
  BEFORE UPDATE ON public.leads_diarios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
