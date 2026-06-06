
-- 1) ai_conversation_analysis: replace permissive SELECT with tenant-scoped policy
DROP POLICY IF EXISTS "Authenticated can view ai_conversation_analysis" ON public.ai_conversation_analysis;
DROP POLICY IF EXISTS "Staff can insert ai_conversation_analysis" ON public.ai_conversation_analysis;
DROP POLICY IF EXISTS "Staff can update ai_conversation_analysis" ON public.ai_conversation_analysis;

CREATE POLICY "Tenant members can view ai_conversation_analysis"
  ON public.ai_conversation_analysis FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crm_leads l
    WHERE l.id = ai_conversation_analysis.lead_id
      AND l.tenant_id = public.current_tenant_id()
  ));

CREATE POLICY "Tenant members can insert ai_conversation_analysis"
  ON public.ai_conversation_analysis FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.crm_leads l
    WHERE l.id = ai_conversation_analysis.lead_id
      AND l.tenant_id = public.current_tenant_id()
  ));

CREATE POLICY "Tenant members can update ai_conversation_analysis"
  ON public.ai_conversation_analysis FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crm_leads l
    WHERE l.id = ai_conversation_analysis.lead_id
      AND l.tenant_id = public.current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.crm_leads l
    WHERE l.id = ai_conversation_analysis.lead_id
      AND l.tenant_id = public.current_tenant_id()
  ));

-- 2) crm_funnel_custom_reports: re-scope policies from public to authenticated
DROP POLICY IF EXISTS "tenant members delete funnel reports" ON public.crm_funnel_custom_reports;
DROP POLICY IF EXISTS "tenant members insert funnel reports" ON public.crm_funnel_custom_reports;
DROP POLICY IF EXISTS "tenant members read funnel reports"   ON public.crm_funnel_custom_reports;
DROP POLICY IF EXISTS "tenant members update funnel reports" ON public.crm_funnel_custom_reports;

CREATE POLICY "tenant members read funnel reports"
  ON public.crm_funnel_custom_reports FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "tenant members insert funnel reports"
  ON public.crm_funnel_custom_reports FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND user_id = auth.uid());

CREATE POLICY "tenant members update funnel reports"
  ON public.crm_funnel_custom_reports FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "tenant members delete funnel reports"
  ON public.crm_funnel_custom_reports FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- 3) Harden can_access_whatsapp_number / can_access_instagram_account: deny-by-default
CREATE OR REPLACE FUNCTION public.can_access_whatsapp_number(_number_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    _number_id IS NULL
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR has_role(auth.uid(), 'crc'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR COALESCE(public.user_override(auth.uid(), 'whatsapp_number', _number_id::text), false);
$$;

CREATE OR REPLACE FUNCTION public.can_access_instagram_account(_account_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    _account_id IS NULL
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR has_role(auth.uid(), 'crc'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR COALESCE(public.user_override(auth.uid(), 'instagram_account', _account_id::text), false);
$$;
