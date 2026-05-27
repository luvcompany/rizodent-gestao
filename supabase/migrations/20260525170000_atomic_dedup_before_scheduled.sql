-- Bug: o gatilho before_scheduled (X horas antes do agendamento) podia
-- disparar 2+ vezes para o mesmo lead/agendamento. Causa raiz:
--
-- A janela "withinWindow" tem ~2h de largura (scheduledAt-2h até scheduledAt+90s).
-- O cron roda a cada 1 min, então dentro da janela há ~120 ticks. A dedup
-- atual é check-then-insert:
--   1) SELECT existing FROM crm_automation_queue WHERE automation_id=X AND lead_id=Y
--   2) IF none → fire action (chama WhatsApp API)
--   3) INSERT queue row
--
-- Se um tick fica >60s processando (muitos agendamentos), o próximo tick
-- entra em paralelo. AMBOS chegam ao passo 1 sem encontrar nada, AMBOS
-- chamam a API, AMBOS inserem. Resultado: lead recebe a mesma mensagem 2x.
--
-- Fix: dedup atômico via UNIQUE INDEX. Coluna `appointment_id` na queue +
-- partial unique em (automation_id, appointment_id). O insert vira a
-- operação de "claim": só um worker consegue, o outro recebe 23505 e pula.

ALTER TABLE public.crm_automation_queue
  ADD COLUMN IF NOT EXISTS appointment_id uuid,
  ADD COLUMN IF NOT EXISTS task_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_auto_queue_appt
  ON public.crm_automation_queue (automation_id, appointment_id)
  WHERE appointment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_auto_queue_task
  ON public.crm_automation_queue (automation_id, task_id)
  WHERE task_id IS NOT NULL;
