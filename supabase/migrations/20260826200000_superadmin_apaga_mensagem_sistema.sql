-- A matriz completa papel × operação (varredura de 26/08) expôs um padrão de
-- DESCUIDO nas permissões antigas, com prova no próprio texto: várias policies
-- dizem "crc OR gerente OR crc" — o segundo crc era para ser superadmin. O
-- efeito prático: o DONO do sistema (superadmin) clicava em excluir/salvar,
-- a tela dizia "pronto" e o banco devolvia zero linhas em silêncio.
--
-- Esta migração conserta SÓ esse padrão: inclui o superadmin (e, onde o nome
-- da policy já dizia "Admins", o gerente) nas permissões que o esqueceram.
-- NADA muda para crc, pós-venda, closer ou recepção — os bloqueios de
-- propósito (histórico do número, escopo por funil) continuam exatamente
-- como estavam.

-- ---------------------------------------------------------------- messages
-- O superadmin não conseguia excluir a confirmação de agendamento no chat.
-- Closer e recepção continuam SEM apagar mensagem (RESTRICTIVE de propósito).
DROP POLICY IF EXISTS "Admins and managers can delete messages" ON public.messages;
CREATE POLICY "Admins and managers can delete messages" ON public.messages
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'crc'::app_role)
    OR public.has_role(auth.uid(), 'gerente'::app_role)
    OR public.has_role(auth.uid(), 'superadmin'::app_role)
  );

-- ------------------------------------------------- histórico de etapa
-- Não existia NENHUMA policy de UPDATE: o fechamento da entrada anterior
-- (exited_at), feito pelas telas ao mover o lead, falhava em silêncio para
-- TODOS os papéis — 8.741 entradas abertas nos últimos 30 dias. O INSERT já
-- é "qualquer logado" e quem segura o escopo são as RESTRICTIVE (tenant +
-- closer/recepção por número), que valem para ALL e portanto também aqui.
DROP POLICY IF EXISTS "Staff can update crm_lead_stage_history" ON public.crm_lead_stage_history;
CREATE POLICY "Staff can update crm_lead_stage_history" ON public.crm_lead_stage_history
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ------------------------------------- o "crc OR gerente OR crc" literal
DROP POLICY IF EXISTS "Admins managers crc can insert ai_assistant_config" ON public.ai_assistant_config;
CREATE POLICY "Admins managers crc can insert ai_assistant_config" ON public.ai_assistant_config
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "Admins managers crc can update ai_assistant_config" ON public.ai_assistant_config;
CREATE POLICY "Admins managers crc can update ai_assistant_config" ON public.ai_assistant_config
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "Admins managers crc can delete ai_assistant_config" ON public.ai_assistant_config;
CREATE POLICY "Admins managers crc can delete ai_assistant_config" ON public.ai_assistant_config
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "Admins managers crc can delete bot_executions" ON public.bot_executions;
CREATE POLICY "Admins managers crc can delete bot_executions" ON public.bot_executions
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "Admins managers crc can insert bot_versions" ON public.bot_versions;
CREATE POLICY "Admins managers crc can insert bot_versions" ON public.bot_versions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "Admins managers crc can delete bot_versions" ON public.bot_versions;
CREATE POLICY "Admins managers crc can delete bot_versions" ON public.bot_versions
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "Admins managers crc can insert crm_followup_configs" ON public.crm_followup_configs;
CREATE POLICY "Admins managers crc can insert crm_followup_configs" ON public.crm_followup_configs
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "Admins managers crc can update crm_followup_configs" ON public.crm_followup_configs;
CREATE POLICY "Admins managers crc can update crm_followup_configs" ON public.crm_followup_configs
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "Admins managers crc can delete crm_followup_configs" ON public.crm_followup_configs;
CREATE POLICY "Admins managers crc can delete crm_followup_configs" ON public.crm_followup_configs
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

-- ------------------------- "Admins and managers" sem o admin de verdade
DROP POLICY IF EXISTS "Admins and managers can delete pacientes" ON public.pacientes;
CREATE POLICY "Admins and managers can delete pacientes" ON public.pacientes
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "Admins and managers can delete pagamentos" ON public.pagamentos;
CREATE POLICY "Admins and managers can delete pagamentos" ON public.pagamentos
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "Admins and managers can delete tratamentos" ON public.tratamentos;
CREATE POLICY "Admins and managers can delete tratamentos" ON public.tratamentos
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "Admins and managers can delete leads_diarios" ON public.leads_diarios;
CREATE POLICY "Admins and managers can delete leads_diarios" ON public.leads_diarios
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "Admins and managers can delete registros_diarios_atendimento" ON public.registros_diarios_atendimento;
CREATE POLICY "Admins and managers can delete registros_diarios_atendimento" ON public.registros_diarios_atendimento
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "Admins and managers can insert dashboard_holidays" ON public.dashboard_holidays;
CREATE POLICY "Admins and managers can insert dashboard_holidays" ON public.dashboard_holidays
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "Admins and managers can update dashboard_holidays" ON public.dashboard_holidays;
CREATE POLICY "Admins and managers can update dashboard_holidays" ON public.dashboard_holidays
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "Admins and managers can delete dashboard_holidays" ON public.dashboard_holidays;
CREATE POLICY "Admins and managers can delete dashboard_holidays" ON public.dashboard_holidays
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

-- --------------------------- unidades e procedimentos: "Admins" só tinha crc
-- O dono cadastra unidade e procedimento pela própria conta (superadmin) e a
-- tela oferece os botões — o banco negava em silêncio.
DROP POLICY IF EXISTS "Admins can manage clinicas" ON public.clinicas;
CREATE POLICY "Admins can manage clinicas" ON public.clinicas
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "Admins can manage tipos_procedimento" ON public.tipos_procedimento;
CREATE POLICY "Admins can manage tipos_procedimento" ON public.tipos_procedimento
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'crc'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));
