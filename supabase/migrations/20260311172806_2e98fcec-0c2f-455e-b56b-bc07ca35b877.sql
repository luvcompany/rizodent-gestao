
-- Add especialidade columns to tipos_procedimento
ALTER TABLE public.tipos_procedimento ADD COLUMN IF NOT EXISTS especialidade text;
ALTER TABLE public.tipos_procedimento ADD COLUMN IF NOT EXISTS especialidade_secundaria text;

-- Add especialidade to tratamentos for reporting
ALTER TABLE public.tratamentos ADD COLUMN IF NOT EXISTS especialidade text;
