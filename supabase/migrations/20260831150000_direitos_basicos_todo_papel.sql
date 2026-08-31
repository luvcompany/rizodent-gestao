-- Direitos básicos de TODO papel (decisão do dono, 31/08/2026):
-- "Permitir a criação, edição e exclusão de leads, tarefas, agendamentos,
--  bots, modelos, funis, etapas, transmissões. Essas funções são principais
--  e todo usuário deve ter."
--
-- O que esta migração muda — e o que ela NÃO muda:
--   MUDA  quem pode executar a ação (todo papel operacional passa a poder);
--   NÃO MUDA o alcance: cada papel continua preso ao próprio mundo
--   (closer/recepção ao número deles, pós-venda ao funil dela, todos ao
--   próprio tenant). As RESTRICTIVE de escopo continuam valendo — liberar a
--   AÇÃO não abre DADO nenhum.
--
-- Estado que a auditoria encontrou: funis, etapas, transmissões, modelos e a
-- criação/edição de leads, tarefas e agendamentos já eram de todos (com
-- escopo). As quatro lacunas reais estão abaixo.

-- ------------------------------------------------- 1. excluir lead
-- Antes: crc e closer (decisão de 26/08). Agora: os quatro papéis
-- operacionais, cada um no que alcança (funil + número + conta de IG).
DROP POLICY IF EXISTS operacao_apaga_leads ON public.crm_leads;
CREATE POLICY operacao_apaga_leads ON public.crm_leads
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'crc'::app_role)
      OR public.has_role(auth.uid(), 'closer'::app_role)
      OR public.has_role(auth.uid(), 'recepcao'::app_role)
      OR public.has_role(auth.uid(), 'posvenda'::app_role)
    )
    AND public.can_access_pipeline(pipeline_id)
    AND public.can_access_whatsapp_number(whatsapp_number_id)
    AND public.can_access_instagram_account(ig_account_uuid)
  );

-- O bloqueio total da recepção sai; entra o bloqueio de ESCOPO, idêntico ao
-- do closer. O IS NOT NULL é o que impede o mundo legado de vazar
-- (can_access_whatsapp_number(NULL) responde TRUE por definição).
DROP POLICY IF EXISTS recepcao_no_lead_delete ON public.crm_leads;
DROP POLICY IF EXISTS recepcao_number_scope_lead_delete ON public.crm_leads;
CREATE POLICY recepcao_number_scope_lead_delete ON public.crm_leads
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'recepcao'::app_role))
    OR (whatsapp_number_id IS NOT NULL AND public.can_access_whatsapp_number(whatsapp_number_id))
  );

-- ------------------------------------------------- 2. excluir agendamento
-- Antes: só gerente/superadmin. Agora: todos (as RESTRICTIVE de tenant e de
-- escopo por número continuam por cima). A PROTEÇÃO DA RÉGUA fica no gatilho
-- abaixo: agendamento com desfecho final (compareceu/faltou/fechou/remarcado)
-- é história de indicador — apagar isso é ação de gerente, senão o
-- no-show "melhora" na borracha.
DROP POLICY IF EXISTS "Managers can delete crm_appointments" ON public.crm_appointments;
CREATE POLICY "Staff can delete crm_appointments" ON public.crm_appointments
  FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.protege_desfecho_no_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF OLD.status IN ('contracted', 'not_contracted', 'no_show', 'rescheduled')
     AND NOT (public.has_role(auth.uid(), 'gerente'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role))
  THEN
    RAISE EXCEPTION 'Agendamento com desfecho registrado não pode ser excluído — isso apagaria o histórico dos indicadores. Peça a um gerente.';
  END IF;
  RETURN OLD;
END $fn$;

DROP TRIGGER IF EXISTS trg_protege_desfecho_no_delete ON public.crm_appointments;
CREATE TRIGGER trg_protege_desfecho_no_delete
  BEFORE DELETE ON public.crm_appointments
  FOR EACH ROW EXECUTE FUNCTION public.protege_desfecho_no_delete();

-- ------------------------------------------------- 3. tarefa avulsa
-- A tarefa SEM lead (avulsa) era negada a closer e recepção porque o escopo
-- exigia "pode ver o lead" — e lead nenhum não passa. Tarefa avulsa é do
-- tenant, não de um mundo: entra na exceção. Tarefa DE lead segue presa ao
-- número, como antes.
DROP POLICY IF EXISTS closer_escopo_numero_crm_tasks ON public.crm_tasks;
CREATE POLICY closer_escopo_numero_crm_tasks ON public.crm_tasks
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'closer'::app_role))
    OR lead_id IS NULL
    OR public.closer_pode_ver_lead(lead_id)
  )
  WITH CHECK (
    (SELECT NOT public.has_role(auth.uid(), 'closer'::app_role))
    OR lead_id IS NULL
    OR public.closer_pode_ver_lead(lead_id)
  );

DROP POLICY IF EXISTS recepcao_escopo_numero_crm_tasks ON public.crm_tasks;
CREATE POLICY recepcao_escopo_numero_crm_tasks ON public.crm_tasks
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'recepcao'::app_role))
    OR lead_id IS NULL
    OR public.recepcao_pode_ver_lead(lead_id)
  )
  WITH CHECK (
    (SELECT NOT public.has_role(auth.uid(), 'recepcao'::app_role))
    OR lead_id IS NULL
    OR public.recepcao_pode_ver_lead(lead_id)
  );

-- ------------------------------------------------- 4. bots: gerência alcança tudo
-- Cada papel continua mexendo só nos bots do próprio perfil (mundo), mas
-- gerente e superadmin — que administram o sistema — passam a alcançar
-- qualquer bot do tenant. Antes nem eles conseguiam editar o bot de um
-- closer, e a tela dizia "salvo".
DROP POLICY IF EXISTS tenant_edita_bots ON public.bots;
CREATE POLICY tenant_edita_bots ON public.bots
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (owner_role IS NULL OR public.has_role(auth.uid(), owner_role)
         OR public.user_has_any_role(auth.uid(), shared_roles)
         OR public.has_role(auth.uid(), 'gerente'::app_role)
         OR public.has_role(auth.uid(), 'superadmin'::app_role))
  )
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_apaga_bots ON public.bots;
CREATE POLICY tenant_apaga_bots ON public.bots
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (owner_role IS NULL OR public.has_role(auth.uid(), owner_role)
         OR public.user_has_any_role(auth.uid(), shared_roles)
         OR public.has_role(auth.uid(), 'gerente'::app_role)
         OR public.has_role(auth.uid(), 'superadmin'::app_role))
  );
