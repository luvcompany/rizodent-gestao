-- Módulo de agendamento da Bia (human-in-the-loop, genérico/multi-tenant)
-- 1) clinicas: mapa genérico cidade/unidade -> modelo de agendamento por tenant.
--    (clinicas já liga tenant_id + cidade + endereço; aqui só adicionamos qual
--     template de confirmação de agendamento usar para aquela unidade.)
ALTER TABLE public.clinicas
  ADD COLUMN IF NOT EXISTS appointment_template_name text;

COMMENT ON COLUMN public.clinicas.appointment_template_name IS
  'Nome base do template WhatsApp de confirmação de agendamento desta unidade (ex.: agendamento_itabuna). A Bia/UI resolve o template pela cidade do lead via esta coluna. NULL = sem template configurado (cai no seletor manual).';

-- 2) ai_reply_suggestions: nova action "schedule" (a Bia PROPÕE um agendamento).
--    Aditivo e retrocompatível: reply/handoff continuam iguais.
ALTER TABLE public.ai_reply_suggestions DROP CONSTRAINT IF EXISTS ai_reply_suggestions_action_chk;
ALTER TABLE public.ai_reply_suggestions
  ADD CONSTRAINT ai_reply_suggestions_action_chk
  CHECK (action IN ('reply', 'handoff', 'schedule'));

-- Colunas do agendamento proposto (só populadas quando action='schedule').
ALTER TABLE public.ai_reply_suggestions ADD COLUMN IF NOT EXISTS suggested_date date;
ALTER TABLE public.ai_reply_suggestions ADD COLUMN IF NOT EXISTS suggested_time time without time zone;

-- 3) Correção de bug latente: a UI grava status 'dismissed' (AiSuggestionStrip.dismiss)
--    e passamos a gravar 'scheduled' (desfecho do card de agendamento), mas o CHECK
--    atual não permite nenhum dos dois -> o UPDATE falhava silenciosamente.
ALTER TABLE public.ai_reply_suggestions DROP CONSTRAINT IF EXISTS ai_reply_suggestions_status_chk;
ALTER TABLE public.ai_reply_suggestions
  ADD CONSTRAINT ai_reply_suggestions_status_chk
  CHECK (status IN ('pending', 'sent', 'discarded', 'dismissed', 'auto_sent', 'superseded', 'scheduled'));
