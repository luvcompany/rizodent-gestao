-- Remove o bypass de superadmin das tabelas diretamente envolvidas nas conversas/CRM.
-- Superadmin continua existindo para o painel administrativo, mas não deve quebrar
-- o isolamento tenant-facing do CRM.

DROP POLICY IF EXISTS tenant_isolation ON public.crm_leads;
CREATE POLICY tenant_isolation
ON public.crm_leads
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON public.messages;
CREATE POLICY tenant_isolation
ON public.messages
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS ig_messages_tenant_isolation ON public.instagram_messages;
CREATE POLICY ig_messages_tenant_isolation
ON public.instagram_messages
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON public.crm_pipelines;
CREATE POLICY tenant_isolation
ON public.crm_pipelines
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON public.crm_stages;
CREATE POLICY tenant_isolation
ON public.crm_stages
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON public.ig_accounts;
CREATE POLICY tenant_isolation
ON public.ig_accounts
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON public.instagram_accounts;
CREATE POLICY tenant_isolation
ON public.instagram_accounts
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON public.integrations;
CREATE POLICY tenant_isolation
ON public.integrations
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());