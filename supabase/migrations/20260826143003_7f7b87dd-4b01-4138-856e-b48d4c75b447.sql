-- Etapa 34: quem pode apagar lead

-- 1) Permissão PERMISSIVA para crc e closer apagarem leads, com as mesmas condições da leitura
CREATE POLICY "operacao_apaga_leads" ON public.crm_leads
  FOR DELETE
  TO authenticated
  USING (
    (tenant_id = public.current_tenant_id())
    AND (
      public.has_role(auth.uid(), 'crc'::public.app_role)
      OR public.has_role(auth.uid(), 'closer'::public.app_role)
    )
    AND public.can_access_pipeline(pipeline_id)
    AND public.can_access_whatsapp_number(whatsapp_number_id)
    AND public.can_access_instagram_account(ig_account_uuid)
  );

-- 2) Remove a antiga policy que vedava todo delete para closer
DROP POLICY IF EXISTS "closer_no_lead_delete" ON public.crm_leads;

-- 3) Nova RESTRICTIVE: closer só apaga leads carimbados a um número (mundo do número)
CREATE POLICY "closer_number_scope_lead_delete" ON public.crm_leads
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (
    (NOT public.has_role(auth.uid(), 'closer'::public.app_role))
    OR (whatsapp_number_id IS NOT NULL)
  );

-- 4) Nova RESTRICTIVE: crc não apaga leads de funil pós-venda
CREATE POLICY "hide_posvenda_lead_delete" ON public.crm_leads
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'posvenda'::public.app_role)
    OR public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR (pipeline_id IS NULL)
    OR (NOT public.is_posvenda_pipeline(pipeline_id))
    OR (NOT public.has_role(auth.uid(), 'crc'::public.app_role))
  );