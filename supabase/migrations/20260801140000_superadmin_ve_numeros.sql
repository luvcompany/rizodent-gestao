-- A gestão de usuários e permissões passa a viver SÓ no painel do superadmin.
-- Lá o superadmin opera sobre OUTRO tenant, mas a policy de leitura de
-- whatsapp_numbers exige tenant_id = current_tenant_id() e não abre exceção
-- para superadmin (diferente de crm_pipelines e user_permission_overrides, que
-- já abrem). Sem isto, a aba de permissões abriria sem nenhum número e não
-- haveria como conceder a cada recepcionista o número da sua unidade.
--
-- Continua valendo o privilégio por COLUNA: token/app_secret/verify_token não
-- são legíveis por nenhum usuário do app, superadmin incluído.
DROP POLICY IF EXISTS "superadmin select whatsapp_numbers" ON public.whatsapp_numbers;
CREATE POLICY "superadmin select whatsapp_numbers"
ON public.whatsapp_numbers FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'superadmin'::app_role));
