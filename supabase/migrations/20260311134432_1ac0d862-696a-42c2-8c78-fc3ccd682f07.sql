-- Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'gerente', 'crc');

-- Timestamp update function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  cargo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- User roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Clinicas table
CREATE TABLE public.clinicas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  cidade TEXT NOT NULL,
  endereco TEXT,
  telefone TEXT,
  ativa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.clinicas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view clinicas" ON public.clinicas FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage clinicas" ON public.clinicas FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Pacientes table
CREATE TABLE public.pacientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL,
  email TEXT,
  cidade TEXT,
  origem TEXT,
  nome_anuncio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.pacientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view pacientes" ON public.pacientes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert pacientes" ON public.pacientes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update pacientes" ON public.pacientes FOR UPDATE TO authenticated USING (true);

CREATE TRIGGER update_pacientes_updated_at BEFORE UPDATE ON public.pacientes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tratamentos table
CREATE TABLE public.tratamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id UUID NOT NULL REFERENCES public.pacientes(id) ON DELETE CASCADE,
  clinica_id UUID NOT NULL REFERENCES public.clinicas(id),
  procedimento TEXT NOT NULL,
  valor_orcado NUMERIC(12,2) DEFAULT 0,
  valor_contratado NUMERIC(12,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ativo',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tratamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view tratamentos" ON public.tratamentos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert tratamentos" ON public.tratamentos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update tratamentos" ON public.tratamentos FOR UPDATE TO authenticated USING (true);

CREATE TRIGGER update_tratamentos_updated_at BEFORE UPDATE ON public.tratamentos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Pagamentos table
CREATE TABLE public.pagamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tratamento_id UUID NOT NULL REFERENCES public.tratamentos(id) ON DELETE CASCADE,
  paciente_id UUID NOT NULL REFERENCES public.pacientes(id),
  clinica_id UUID NOT NULL REFERENCES public.clinicas(id),
  valor NUMERIC(12,2) NOT NULL,
  forma_pagamento TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'primeiro',
  data_pagamento DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.pagamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view pagamentos" ON public.pagamentos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert pagamentos" ON public.pagamentos FOR INSERT TO authenticated WITH CHECK (true);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nome', NEW.email), NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Insert initial clinicas
INSERT INTO public.clinicas (nome, cidade) VALUES
  ('Clínica SP', 'São Paulo'),
  ('Clínica RJ', 'Rio de Janeiro'),
  ('Clínica BH', 'Belo Horizonte'),
  ('Clínica Curitiba', 'Curitiba'),
  ('Clínica Porto Alegre', 'Porto Alegre');