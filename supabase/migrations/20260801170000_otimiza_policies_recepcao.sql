-- Otimiza as três policies de escopo da Recepção criadas ANTES da medição de
-- desempenho (migração 20260731210100). Elas chamam has_role() por linha; as
-- criadas depois já usam (SELECT ...), que o Postgres avalia uma única vez por
-- consulta (InitPlan). Sem isso, toda leitura de messages/crm_leads paga a
-- checagem por linha — para TODOS os papéis, não só para a recepção.
--
-- Medição que motivou: varredura de messages (159 mil linhas) passou de 0,17 ms
-- para 2.799 ms quando a função é chamada por linha.
--
-- Só muda a FORMA de avaliar; a regra é idêntica.

DROP POLICY IF EXISTS recepcao_number_scope_messages ON public.messages;
CREATE POLICY recepcao_number_scope_messages ON public.messages
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'recepcao'::app_role))
    OR public.recepcao_pode_ver_lead(lead_id)
  );

DROP POLICY IF EXISTS recepcao_number_scope_leads ON public.crm_leads;
CREATE POLICY recepcao_number_scope_leads ON public.crm_leads
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'recepcao'::app_role))
    OR (whatsapp_number_id IS NOT NULL
        AND public.can_access_whatsapp_number(whatsapp_number_id))
  );

DROP POLICY IF EXISTS recepcao_number_scope_lead_update ON public.crm_leads;
CREATE POLICY recepcao_number_scope_lead_update ON public.crm_leads
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'recepcao'::app_role))
    OR (whatsapp_number_id IS NOT NULL
        AND public.can_access_whatsapp_number(whatsapp_number_id))
  );

DROP POLICY IF EXISTS recepcao_no_lead_delete ON public.crm_leads;
CREATE POLICY recepcao_no_lead_delete ON public.crm_leads
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT NOT public.has_role(auth.uid(), 'recepcao'::app_role)));
