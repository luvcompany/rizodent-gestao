
CREATE TABLE public.tipos_procedimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  valor_referencia numeric DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tipos_procedimento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view tipos_procedimento"
  ON public.tipos_procedimento FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can manage tipos_procedimento"
  ON public.tipos_procedimento FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_tipos_procedimento_updated_at
  BEFORE UPDATE ON public.tipos_procedimento
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
