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