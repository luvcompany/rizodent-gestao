
-- Create orcamentos table
CREATE TABLE public.orcamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id uuid NOT NULL REFERENCES public.pacientes(id) ON DELETE CASCADE,
  valor_orcado numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'aberto',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.orcamentos ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view orcamentos" ON public.orcamentos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert orcamentos" ON public.orcamentos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update orcamentos" ON public.orcamentos FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete orcamentos" ON public.orcamentos FOR DELETE TO authenticated USING (true);

-- Add orcamento_id to tratamentos and pagamentos
ALTER TABLE public.tratamentos ADD COLUMN orcamento_id uuid REFERENCES public.orcamentos(id) ON DELETE SET NULL;
ALTER TABLE public.pagamentos ADD COLUMN orcamento_id uuid REFERENCES public.orcamentos(id) ON DELETE SET NULL;

-- Migrate existing data: create one orcamento per patient that has valor_orcado > 0
INSERT INTO public.orcamentos (paciente_id, valor_orcado, status)
SELECT p.id, COALESCE(p.valor_orcado, 0),
  CASE 
    WHEN COALESCE(p.valor_orcado, 0) > 0 
      AND COALESCE((SELECT SUM(pg.valor) FROM public.pagamentos pg WHERE pg.paciente_id = p.id), 0) >= COALESCE(p.valor_orcado, 0)
    THEN 'concluido' 
    ELSE 'aberto' 
  END
FROM public.pacientes p
WHERE COALESCE(p.valor_orcado, 0) > 0;

-- Link existing tratamentos to the orcamento
UPDATE public.tratamentos t
SET orcamento_id = (SELECT o.id FROM public.orcamentos o WHERE o.paciente_id = t.paciente_id ORDER BY o.created_at ASC LIMIT 1);

-- Link existing pagamentos to the orcamento
UPDATE public.pagamentos pg
SET orcamento_id = (SELECT o.id FROM public.orcamentos o WHERE o.paciente_id = pg.paciente_id ORDER BY o.created_at ASC LIMIT 1);

-- Remove valor_orcado from pacientes
ALTER TABLE public.pacientes DROP COLUMN valor_orcado;

-- Add updated_at trigger
CREATE TRIGGER update_orcamentos_updated_at BEFORE UPDATE ON public.orcamentos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable realtime for orcamentos
ALTER PUBLICATION supabase_realtime ADD TABLE public.orcamentos;
