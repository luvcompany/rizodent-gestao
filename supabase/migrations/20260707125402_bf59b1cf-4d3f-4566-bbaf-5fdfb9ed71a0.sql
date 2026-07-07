-- Backfill retroativo dos timestamps derivados de mensagens no crm_leads.
-- Recalcula first_inbound_at e last_inbound_at a partir da tabela messages,
-- corrigindo leads que ficaram sem esses campos ou com valores desatualizados
-- (afeta as métricas de tempo de resposta e atendimento nos relatórios).

WITH agg AS (
  SELECT
    lead_id,
    MIN(created_at) AS first_in,
    MAX(created_at) AS last_in
  FROM public.messages
  WHERE direction = 'inbound'
    AND lead_id IS NOT NULL
    AND deleted_at IS NULL
  GROUP BY lead_id
)
UPDATE public.crm_leads l
SET
  first_inbound_at = agg.first_in,
  last_inbound_at  = GREATEST(COALESCE(l.last_inbound_at, agg.last_in), agg.last_in)
FROM agg
WHERE l.id = agg.lead_id
  AND (
    l.first_inbound_at IS NULL
    OR l.first_inbound_at <> agg.first_in
    OR l.last_inbound_at IS NULL
    OR l.last_inbound_at < agg.last_in
  );