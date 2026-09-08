-- Limpeza do histórico de etapas (segunda parte da auditoria de 08/09/2026).
-- Separada da migration anterior porque apaga dados: 25.626 linhas duplicadas
-- (mesmo lead, mesma etapa, menos de 5 s de diferença — o front e o gatilho
-- gravavam a mesma passagem) e 6.402 leads com mais de uma etapa "aberta".
-- Aplicar SÓ com o OK explícito do dono.

-- Limpeza do passado: de duas linhas iguais (mesmo lead, mesma etapa, menos
-- de 5 s entre elas) fica a primeira. Depois, cada linha fecha na entrada da
-- seguinte, para nenhum lead ter duas etapas "abertas".
WITH ordenado AS (
  SELECT id, entered_at,
         lag(entered_at) OVER (PARTITION BY lead_id, stage_id ORDER BY entered_at, id) AS anterior
  FROM public.crm_lead_stage_history
)
DELETE FROM public.crm_lead_stage_history h
 USING ordenado o
 WHERE h.id = o.id AND o.anterior IS NOT NULL AND o.entered_at - o.anterior < interval '5 seconds';

WITH seq AS (
  SELECT id, lead(entered_at) OVER (PARTITION BY lead_id ORDER BY entered_at, id) AS prox
  FROM public.crm_lead_stage_history
)
UPDATE public.crm_lead_stage_history h
   SET exited_at = s.prox
  FROM seq s
 WHERE h.id = s.id AND s.prox IS NOT NULL AND (h.exited_at IS NULL OR h.exited_at > s.prox);
