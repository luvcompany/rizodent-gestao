
-- 1. crm_automations: rebuild write policies to include superadmin + gerente + crc + posvenda
DROP POLICY IF EXISTS "Admins managers crc can delete crm_automations" ON public.crm_automations;
DROP POLICY IF EXISTS "Admins managers crc can insert crm_automations" ON public.crm_automations;
DROP POLICY IF EXISTS "Admins managers crc can update crm_automations" ON public.crm_automations;

CREATE POLICY "Staff can insert crm_automations"
  ON public.crm_automations FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(),'superadmin'::app_role)
    OR has_role(auth.uid(),'gerente'::app_role)
    OR has_role(auth.uid(),'crc'::app_role)
    OR has_role(auth.uid(),'posvenda'::app_role)
  );

CREATE POLICY "Staff can update crm_automations"
  ON public.crm_automations FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(),'superadmin'::app_role)
    OR has_role(auth.uid(),'gerente'::app_role)
    OR has_role(auth.uid(),'crc'::app_role)
    OR has_role(auth.uid(),'posvenda'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(),'superadmin'::app_role)
    OR has_role(auth.uid(),'gerente'::app_role)
    OR has_role(auth.uid(),'crc'::app_role)
    OR has_role(auth.uid(),'posvenda'::app_role)
  );

CREATE POLICY "Staff can delete crm_automations"
  ON public.crm_automations FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(),'superadmin'::app_role)
    OR has_role(auth.uid(),'gerente'::app_role)
    OR has_role(auth.uid(),'crc'::app_role)
    OR has_role(auth.uid(),'posvenda'::app_role)
  );

-- 2. crm_pipelines: superadmin bypasses tenant_isolation
DROP POLICY IF EXISTS "tenant_isolation" ON public.crm_pipelines;
CREATE POLICY "tenant_isolation"
  ON public.crm_pipelines AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() OR has_role(auth.uid(),'superadmin'::app_role))
  WITH CHECK (tenant_id = current_tenant_id() OR has_role(auth.uid(),'superadmin'::app_role));

-- 3. crm_stages: same superadmin exception
DROP POLICY IF EXISTS "tenant_isolation" ON public.crm_stages;
CREATE POLICY "tenant_isolation"
  ON public.crm_stages AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() OR has_role(auth.uid(),'superadmin'::app_role))
  WITH CHECK (tenant_id = current_tenant_id() OR has_role(auth.uid(),'superadmin'::app_role));

-- 4. Remove duplicate cron with corrupted token
SELECT cron.unschedule('invoke-automation-engine-every-minute');
