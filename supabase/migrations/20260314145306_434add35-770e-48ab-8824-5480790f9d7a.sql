
-- Add valor_orcado column to pacientes table
ALTER TABLE public.pacientes ADD COLUMN valor_orcado numeric DEFAULT 0;

-- Migrate existing data: sum valor_orcado from tratamentos per patient
UPDATE public.pacientes p
SET valor_orcado = COALESCE((
  SELECT SUM(COALESCE(t.valor_orcado, 0))
  FROM public.tratamentos t
  WHERE t.paciente_id = p.id
), 0);

-- Remove valor_orcado and valor_contratado from tratamentos (no longer needed there)
ALTER TABLE public.tratamentos DROP COLUMN valor_orcado;
ALTER TABLE public.tratamentos DROP COLUMN valor_contratado;
