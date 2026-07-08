
-- Revert previous approach and use RESTRICTIVE policies to hide only the Pós-venda funnel
-- from users that don't have the posvenda role. This preserves visibility of every other
-- pipeline/stage/lead/message for CRC and Gerente users within their tenant.

-- 1) Restore tenant_isolation as FOR ALL on the four tables (matches the previous behavior
--    for INSERT/UPDATE/DELETE and re-enables SELECT scoped to the tenant).
DROP POLICY IF EXISTS tenant_isolation_ins ON public.crm_leads;
DROP POLICY IF EXISTS tenant_isolation_upd ON public.crm_leads;
DROP POLICY IF EXISTS tenant_isolation_del ON public.crm_leads;
DROP POLICY IF EXISTS tenant_isolation ON public.crm_leads;
CREATE POLICY tenant_isolation ON public.crm_leads
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_ins ON public.crm_pipelines;
DROP POLICY IF EXISTS tenant_isolation_upd ON public.crm_pipelines;
DROP POLICY IF EXISTS tenant_isolation_del ON public.crm_pipelines;
DROP POLICY IF EXISTS tenant_isolation ON public.crm_pipelines;
CREATE POLICY tenant_isolation ON public.crm_pipelines
  FOR ALL
  USING (tenant_id = current_tenant_id() OR has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (tenant_id = current_tenant_id() OR has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS tenant_isolation_ins ON public.crm_stages;
DROP POLICY IF EXISTS tenant_isolation_upd ON public.crm_stages;
DROP POLICY IF EXISTS tenant_isolation_del ON public.crm_stages;
DROP POLICY IF EXISTS tenant_isolation ON public.crm_stages;
CREATE POLICY tenant_isolation ON public.crm_stages
  FOR ALL
  USING (tenant_id = current_tenant_id() OR has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (tenant_id = current_tenant_id() OR has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS tenant_isolation_ins ON public.messages;
DROP POLICY IF EXISTS tenant_isolation_upd ON public.messages;
DROP POLICY IF EXISTS tenant_isolation_del ON public.messages;
DROP POLICY IF EXISTS tenant_isolation ON public.messages;
CREATE POLICY tenant_isolation ON public.messages
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- 2) RESTRICTIVE policies: hide the Pós-venda funnel and everything under it from
--    users that don't have the posvenda (or superadmin) role. RESTRICTIVE policies are
--    AND'd with permissive policies, so they act as a hard filter that no other
--    permissive policy can override.

-- Hide the posvenda pipeline itself
DROP POLICY IF EXISTS hide_posvenda_pipelines ON public.crm_pipelines;
CREATE POLICY hide_posvenda_pipelines ON public.crm_pipelines
  AS RESTRICTIVE
  FOR SELECT
  USING (
    COALESCE(is_posvenda, false) = false
    OR has_role(auth.uid(), 'posvenda'::app_role)
    OR has_role(auth.uid(), 'superadmin'::app_role)
  );

-- Hide stages that belong to a posvenda pipeline
DROP POLICY IF EXISTS hide_posvenda_stages ON public.crm_stages;
CREATE POLICY hide_posvenda_stages ON public.crm_stages
  AS RESTRICTIVE
  FOR SELECT
  USING (
    has_role(auth.uid(), 'posvenda'::app_role)
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR NOT EXISTS (
      SELECT 1 FROM public.crm_pipelines p
      WHERE p.id = crm_stages.pipeline_id
        AND COALESCE(p.is_posvenda, false) = true
    )
  );

-- Hide leads that sit inside a posvenda pipeline
DROP POLICY IF EXISTS hide_posvenda_leads ON public.crm_leads;
CREATE POLICY hide_posvenda_leads ON public.crm_leads
  AS RESTRICTIVE
  FOR SELECT
  USING (
    has_role(auth.uid(), 'posvenda'::app_role)
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR NOT EXISTS (
      SELECT 1 FROM public.crm_pipelines p
      WHERE p.id = crm_leads.pipeline_id
        AND COALESCE(p.is_posvenda, false) = true
    )
  );

-- Hide messages of leads that are inside a posvenda pipeline
DROP POLICY IF EXISTS hide_posvenda_messages ON public.messages;
CREATE POLICY hide_posvenda_messages ON public.messages
  AS RESTRICTIVE
  FOR SELECT
  USING (
    has_role(auth.uid(), 'posvenda'::app_role)
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR NOT EXISTS (
      SELECT 1
      FROM public.crm_leads l
      JOIN public.crm_pipelines p ON p.id = l.pipeline_id
      WHERE l.id = messages.lead_id
        AND COALESCE(p.is_posvenda, false) = true
    )
  );
