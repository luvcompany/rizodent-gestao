-- Fecha vazamento de metadados entre tenants em crm_pipelines e crm_stages.
--
-- Bug: a política tenant_isolation dessas tabelas era PERMISSIVE. Como as políticas
-- permissivas se combinam com OR, a política "por papel" (que lista funis/etapas sem
-- checar tenant) permitia que um usuário crc/gerente de um tenant enxergasse os funis
-- e etapas de OUTRO tenant (com allowed_roles = NULL). Os leads/mensagens NÃO vazavam
-- (as políticas deles já exigem tenant_id = current_tenant_id()); o vazamento era só
-- dos nomes de funil/etapa.
--
-- Correção: tornar tenant_isolation RESTRICTIVE (igual às tabelas já corretas —
-- bots, crm_appointments, crm_automations, crm_whatsapp_templates), de modo que a
-- checagem de tenant passe a ser obrigatória (AND) em vez de opcional (OR).
DROP POLICY IF EXISTS "tenant_isolation" ON public.crm_pipelines;
CREATE POLICY "tenant_isolation" ON public.crm_pipelines
  AS RESTRICTIVE FOR ALL
  USING ((tenant_id = current_tenant_id()) OR has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK ((tenant_id = current_tenant_id()) OR has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "tenant_isolation" ON public.crm_stages;
CREATE POLICY "tenant_isolation" ON public.crm_stages
  AS RESTRICTIVE FOR ALL
  USING ((tenant_id = current_tenant_id()) OR has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK ((tenant_id = current_tenant_id()) OR has_role(auth.uid(), 'superadmin'::app_role));
