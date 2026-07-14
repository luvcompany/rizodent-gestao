-- ==========================================================================
-- FIX: follow-up (no_response) parava de disparar em revisitas de etapa
-- ==========================================================================
--
-- Sintoma: a automacao de follow-up (trigger_type='no_response', normalmente
-- action='move_stage' para uma etapa "Follow-Up") deixou de enfileirar para
-- varios leads. A funcao contabilizava "no_response: N" mas nada era gravado
-- em crm_automation_queue.
--
-- Causa raiz: o indice unico uniq_auto_queue_layer cobria
--   status IN ('pending','processing','sent').
-- O no_response usa layer_index = 0. Quando um lead REENTRAVA numa etapa depois
-- de ja ter recebido um follow-up, existia uma linha 'sent' antiga (layer 0).
-- O novo insert (tambem layer 0, status 'pending') COLIDIA com essa linha 'sent'
-- historica -> erro 23505. Como o insert do no_response nao tratava o erro, ele
-- falhava em silencio: o contador incrementava, mas a fila nao recebia a linha.
-- Resultado: o follow-up "sumia" justamente para os leads que reentravam.
--
-- Correcao: o indice unico deve impedir apenas DUPLICATAS EM ABERTO na fila
-- (pending/processing) -- essa e a protecao real contra corrida entre ticks do
-- cron / workers concorrentes. Linhas 'sent' sao historico e NAO devem ocupar o
-- slot unico, senao bloqueiam re-disparos legitimos em novos ciclos de etapa.
--
-- Observacoes de seguranca:
--  * Os envios (move_stage/send_template/send_bot) ja ocorrem ANTES do insert em
--    varias secoes, entao o indice nunca protegeu contra "envio duplicado" -- so
--    contra "linha duplicada". Remover 'sent' da cobertura nao cria risco novo de
--    envio dobrado.
--  * before_scheduled usa indices proprios (uniq_auto_queue_appt / _task).
--  * reengagement cria linhas 'pending' -> continua protegido pelo indice novo.
--
-- Este arquivo reproduz, de forma idempotente, a alteracao ja aplicada em
-- producao em 2026-07-14 (via MCP): cria o indice novo antes de dropar o antigo
-- para nunca ficar sem protecao durante o swap.

-- 1) Novo indice: unicidade apenas entre itens EM ABERTO na fila.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_auto_queue_layer_v2
  ON public.crm_automation_queue (automation_id, lead_id, layer_index)
  WHERE layer_index IS NOT NULL
    AND status IN ('pending','processing');

-- 2) Remove o indice antigo (que cobria 'sent' e bloqueava re-disparos).
DROP INDEX IF EXISTS uniq_auto_queue_layer;
