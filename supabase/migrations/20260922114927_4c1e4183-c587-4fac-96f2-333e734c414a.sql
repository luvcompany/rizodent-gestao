-- ============================================================================
-- 22/09/2026 — pedidos da gestão (Julia, 21/09/2026)
--
-- 1) Motivo da desqualificação. Quem move o lead para "Desqualificado" pela
--    tela escolhe o motivo (Currículo / propaganda, Sem interesse, Clicou
--    errado, Já é paciente, Outro: ...). Ele fica na PASSAGEM de etapa que o
--    gatilho sync_lead_stage_history abre — a tela grava depois do movimento,
--    na linha aberta do lead nessa etapa. Movidas do sistema ficam sem motivo.
--    As políticas de UPDATE existentes em crm_lead_stage_history (escopo por
--    papel: SDR só nos leads dela, closer/recepção no mundo delas) valem para
--    esta coluna também.
--
-- 2) relatorio_funis: "leads novos" deixa de contar o lead criado pela
--    conciliação do Dontus (source = 'kommo'). Esse lead nasce já em
--    Contratado no dia do pagamento — é paciente que fechou e faltava no CRM,
--    não contato novo. Mesma regra do front (src/lib/leadNovo.ts).
-- ============================================================================

ALTER TABLE public.crm_lead_stage_history
  ADD COLUMN IF NOT EXISTS motivo text;

ALTER TABLE public.crm_lead_stage_history
  DROP CONSTRAINT IF EXISTS crm_lead_stage_history_motivo_tamanho;
ALTER TABLE public.crm_lead_stage_history
  ADD CONSTRAINT crm_lead_stage_history_motivo_tamanho
  CHECK (motivo IS NULL OR char_length(motivo) BETWEEN 1 AND 250);

COMMENT ON COLUMN public.crm_lead_stage_history.motivo IS
  'Motivo escolhido na tela ao mover o lead para Desqualificado. NULL nas demais passagens e nas movidas do sistema.';

DO $migracao$
DECLARE
  d text := pg_get_functiondef('public.relatorio_funis(date, date)'::regprocedure);
  antes constant text := 'count(*) FILTER (WHERE l.created_at >= v_ini AND l.created_at < v_fim) AS leads_novos,';
  depois constant text := 'count(*) FILTER (WHERE l.created_at >= v_ini AND l.created_at < v_fim
                                    AND l.source IS DISTINCT FROM ''kommo'') AS leads_novos,';
BEGIN
  IF position('l.source IS DISTINCT FROM ''kommo''' IN d) > 0 THEN
    RETURN; -- já aplicada
  END IF;
  IF position(antes IN d) = 0 THEN
    RAISE EXCEPTION 'relatorio_funis mudou: trecho de leads_novos não encontrado';
  END IF;
  EXECUTE replace(d, antes, depois);
END
$migracao$;