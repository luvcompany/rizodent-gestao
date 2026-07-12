-- ============================================================================
-- Classificação de etapa: Ganho / Perda / Aberta (genérico por tenant)
-- ============================================================================
-- crm_stages já tinha `is_won` (etapa de ganho). Adiciona `is_lost` (etapa de
-- perda) para permitir marcar cada etapa como Aberta (nenhuma flag), Ganho
-- (is_won) ou Perda (is_lost). Base para a Análise de Funil em Relatórios
-- (conversão por etapa, ganho × perda) e para o Kanban identificar ganho/perda
-- sem depender de heurística por nome.
--
-- Aditiva e segura: booleano NOT NULL com default false; não altera dados.
-- ============================================================================

ALTER TABLE public.crm_stages
  ADD COLUMN IF NOT EXISTS is_lost boolean NOT NULL DEFAULT false;
