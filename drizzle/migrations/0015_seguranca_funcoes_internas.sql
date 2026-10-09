-- Segurança: funções internas fechadas e "sem papel = sem acesso" (09/10/2026).
--
-- 1) Funções SECURITY DEFINER feitas para cron, gatilho ou edge function
--    (service role) estavam executáveis por qualquer usuário logado, de
--    qualquer cliente: apagar um cliente inteiro, tomar lead de outra SDR,
--    voltar/apagar leads Contratado, listar nome e telefone de leads de outro
--    cliente. Todas as chamadas legítimas usam service_role ou outra função
--    SECURITY DEFINER — nenhuma tela as chama.
-- 2) Função nova nasce sem EXECUTE para anon/PUBLIC (o padrão do banco
--    liberava). authenticated continua no padrão: RPC nova da tela funciona
--    sem lista; função interna faz o próprio REVOKE (convenção no AGENTS.md).
-- 3) Conta sem papel (ex-funcionária que ficou só sem papel) não pertence a
--    nenhum cliente: current_tenant_id() exige papel, e toda a RLS depende dele.
-- 4) Exceções de acesso por usuário (user_permission_overrides) só pelo
--    superadmin — a CRC podia dar a si mesma o número e os funis do closer.

-- 1) Funções internas: só service_role.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS f
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = ANY (ARRAY[
         'hard_delete_tenant', 'crm_cleanup_contratado_sem_pagamento', 'lead_transferir_autorizado',
         'crm_lead_revert_or_delete', 'contratado_mover_agora', 'contratado_agendar',
         'contratado_promove_consulta', 'sdr_entrega_lead_ao_gestor', 'sdr_agenda_entrega_ao_gestor',
         'sdr_entregas_pendentes', 'admin_api_unread_leads_base', 'relatorio_sdr_calc', 'ponto_sessoes',
         'match_good_examples', 'mesclar_lead_duplicado_mesmo_mundo', 'mesclar_leads_duplicados_recentes',
         'lead_whatsapp_existente'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.f);
  END LOOP;
END $$;
COMMENT ON FUNCTION public.hard_delete_tenant(uuid) IS
  'Ação interna do sistema: só service_role (admin-create-tenant / admin-update-tenant).';

-- 2) Funções novas sem EXECUTE para anon/PUBLIC; as atuais também.
--    O PUBLIC vem do padrão global (um REVOKE "IN SCHEMA" não o desfaz); o anon
--    vem do padrão do schema public. authenticated e service_role seguem com
--    GRANT explícito no padrão do schema — nenhuma tela depende do PUBLIC.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS f
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.prokind = 'f'
       AND p.prorettype <> 'trigger'::regtype
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
       AND p.proname NOT IN ('get_tenant_by_slug', 'get_public_branding')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.f);
  END LOOP;
END $$;

-- 3) Sem papel = sem cliente (e portanto sem acesso a nada pela RLS).
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.tenant_id
    FROM public.profiles p
    JOIN public.tenants t ON t.id = p.tenant_id
   WHERE p.id = auth.uid()
     AND COALESCE(p.is_blocked, false) = false
     AND t.status = 'active'
     AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id)
$$;

-- 4) Exceções de acesso só pelo superadmin (a clínica usará uma RPC auditada).
DROP POLICY IF EXISTS "Admins manage overrides" ON public.user_permission_overrides;
CREATE POLICY "Admins manage overrides" ON public.user_permission_overrides
  AS PERMISSIVE FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'superadmin'::app_role));
