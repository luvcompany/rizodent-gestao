-- Remove a tabela de orçamentos. Pagamentos perdem o vínculo orcamento_id (já é ON DELETE SET NULL).
ALTER TABLE public.pagamentos DROP COLUMN IF EXISTS orcamento_id;
ALTER TABLE public.tratamentos DROP COLUMN IF EXISTS orcamento_id;
DROP TABLE IF EXISTS public.orcamentos CASCADE;