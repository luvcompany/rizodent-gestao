DROP POLICY IF EXISTS tenant_isolation ON public.clinicas;
CREATE POLICY tenant_isolation ON public.clinicas
AS RESTRICTIVE FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON public.pacientes;
CREATE POLICY tenant_isolation ON public.pacientes
AS RESTRICTIVE FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON public.tipos_procedimento;
CREATE POLICY tenant_isolation ON public.tipos_procedimento
AS RESTRICTIVE FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON public.dashboard_holidays;
CREATE POLICY tenant_isolation ON public.dashboard_holidays
AS RESTRICTIVE FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON public.ad_id_mapping;
CREATE POLICY tenant_isolation ON public.ad_id_mapping
AS RESTRICTIVE FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON public.crm_appointments;
CREATE POLICY tenant_isolation ON public.crm_appointments
AS RESTRICTIVE FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS crm_lsh_tenant_isolation ON public.crm_lead_stage_history;
CREATE POLICY crm_lsh_tenant_isolation ON public.crm_lead_stage_history
AS RESTRICTIVE FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.crm_leads l
    WHERE l.id = crm_lead_stage_history.lead_id
      AND l.tenant_id = public.current_tenant_id()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.crm_leads l
    WHERE l.id = crm_lead_stage_history.lead_id
      AND l.tenant_id = public.current_tenant_id()
  )
);