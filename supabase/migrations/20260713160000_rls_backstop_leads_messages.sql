-- Defesa em profundidade: backstop RESTRICTIVE de tenant em crm_leads e messages.
--
-- Essas tabelas JÁ estavam seguras (as políticas de SELECT exigem
-- tenant_id = current_tenant_id()), mas a tenant_isolation delas é PERMISSIVE.
-- Adicionamos uma política RESTRICTIVE separada, só de tenant, como backstop:
-- se um dia for criada outra política PERMISSIVE sem checagem de tenant (foi
-- exatamente o que vazou em crm_pipelines/crm_stages), esta aqui impede o
-- vazamento cross-tenant.
--
-- Intencionalmente SEM WITH CHECK (não restringe INSERT — alto volume, já
-- tratado por trg_enforce_lead_tenant / trg_enforce_message_tenant) e SEM
-- alterar a tenant_isolation existente (para NÃO passar a impor can_access_pipeline
-- nos leads, o que removeria a visão de funis de usuários pós-venda). Efeito no
-- que cada usuário enxerga hoje: NENHUM.
DROP POLICY IF EXISTS "tenant_isolation_restrictive" ON public.crm_leads;
CREATE POLICY "tenant_isolation_restrictive" ON public.crm_leads
  AS RESTRICTIVE FOR ALL
  USING ((tenant_id = current_tenant_id()) OR has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "tenant_isolation_restrictive" ON public.messages;
CREATE POLICY "tenant_isolation_restrictive" ON public.messages
  AS RESTRICTIVE FOR ALL
  USING ((tenant_id = current_tenant_id()) OR has_role(auth.uid(), 'superadmin'::app_role));
