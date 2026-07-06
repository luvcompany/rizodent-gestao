-- Fase 0 Bloco 4.1: flags para identificar pipeline default, Instagram, pós-venda, stage de ganho e timezone do tenant

ALTER TABLE public.crm_pipelines
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_instagram boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_posvenda boolean NOT NULL DEFAULT false;

ALTER TABLE public.crm_stages
  ADD COLUMN IF NOT EXISTS is_won boolean NOT NULL DEFAULT false;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Sao_Paulo';
