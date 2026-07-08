
-- Restringe as políticas de tenant_isolation em crm_leads/crm_pipelines/crm_stages/messages
-- para NÃO cobrirem SELECT, garantindo que apenas as políticas granulares (com verificação
-- de pipeline permitido) autorizem leituras. Antes, o FOR ALL do tenant_isolation era
-- somado (OR) e permitia que qualquer usuário do tenant enxergasse leads/estágios/mensagens
-- de funis restritos (ex.: Pós-venda).

-- crm_leads
DROP POLICY IF EXISTS tenant_isolation ON public.crm_leads;
CREATE POLICY tenant_isolation_ins ON public.crm_leads
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_upd ON public.crm_leads
  FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_del ON public.crm_leads
  FOR DELETE USING (tenant_id = current_tenant_id());

-- crm_pipelines
DROP POLICY IF EXISTS tenant_isolation ON public.crm_pipelines;
CREATE POLICY tenant_isolation_ins ON public.crm_pipelines
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR has_role(auth.uid(), 'superadmin'::app_role));
CREATE POLICY tenant_isolation_upd ON public.crm_pipelines
  FOR UPDATE USING (tenant_id = current_tenant_id() OR has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (tenant_id = current_tenant_id() OR has_role(auth.uid(), 'superadmin'::app_role));
CREATE POLICY tenant_isolation_del ON public.crm_pipelines
  FOR DELETE USING (tenant_id = current_tenant_id() OR has_role(auth.uid(), 'superadmin'::app_role));

-- crm_stages
DROP POLICY IF EXISTS tenant_isolation ON public.crm_stages;
CREATE POLICY tenant_isolation_ins ON public.crm_stages
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id() OR has_role(auth.uid(), 'superadmin'::app_role));
CREATE POLICY tenant_isolation_upd ON public.crm_stages
  FOR UPDATE USING (tenant_id = current_tenant_id() OR has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (tenant_id = current_tenant_id() OR has_role(auth.uid(), 'superadmin'::app_role));
CREATE POLICY tenant_isolation_del ON public.crm_stages
  FOR DELETE USING (tenant_id = current_tenant_id() OR has_role(auth.uid(), 'superadmin'::app_role));

-- messages
DROP POLICY IF EXISTS tenant_isolation ON public.messages;
CREATE POLICY tenant_isolation_ins ON public.messages
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_upd ON public.messages
  FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_del ON public.messages
  FOR DELETE USING (tenant_id = current_tenant_id());
