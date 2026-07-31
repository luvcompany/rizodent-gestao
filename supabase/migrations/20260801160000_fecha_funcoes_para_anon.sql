-- ============================================================================
-- HARDENING 1/3 — Fecha as funções internas para quem NÃO está logado.
-- ============================================================================
-- Achado da auditoria (crítico): 74 funções SECURITY DEFINER do schema public
-- estavam executáveis por `anon` — o papel da chave publicável, que fica visível
-- no bundle JS do site. SECURITY DEFINER ignora RLS, então as que recebem o
-- cliente por PARÂMETRO entregavam dados de QUALQUER clínica sem nenhum login:
--   admin_api_unread_leads_base(_tenant)  -> nome e telefone de leads
--   get_conversation_leads(p_tenant_id)   -> lista de conversas
--   crm_template_usage_counts(_tenant_id) -> uso de modelos
--   ensure_instagram_pipeline(_tenant_id) -> ESCRITA em tenant alheio
--   rpt_faturamento_criativo(..., p_tenant_id) -> faturamento
--
-- Por que revogar de PUBLIC também: `anon` herda o que estiver concedido a
-- PUBLIC — revogar só de anon não fecharia nada.
-- Por que conceder explicitamente depois: ao tirar de PUBLIC, quem dependia
-- dessa herança (inclusive service_role, usado pelas edge functions) perderia
-- o acesso. Aqui cada papel legítimo recebe GRANT nominal.
-- ============================================================================

DO $$
DECLARE
  r record;
  -- Única função que precisa mesmo de acesso sem login: o app carrega a marca
  -- do cliente pelo slug ANTES da tela de login (TenantContext).
  keep_anon text[] := ARRAY['get_tenant_by_slug'];
  -- Chamadas apenas por edge functions/cron (service_role). Nenhum uso no
  -- frontend — confirmado por varredura do código.
  service_only text[] := ARRAY[
    'admin_api_unread_leads_base',
    'ensure_instagram_pipeline',
    'match_good_examples',
    'pacientes_whatsapp_direto',
    'recover_stuck_bot_executions',
    'watchdog_reenqueue_missing_bots',
    'backup_list_tables',
    'api4com_call_to_message',
    'api4com_sync_transcription_to_message'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname, p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef                       -- só SECURITY DEFINER
       AND p.prokind = 'f'                   -- funções (triggers entram aqui também)
  LOOP
    -- Guarda quem já podia executar, para não ampliar privilégio sem querer.
    DECLARE
      tinha_auth boolean := has_function_privilege('authenticated', r.oid, 'EXECUTE');
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);

      -- service_role sempre: é quem roda webhooks, crons e a admin-api.
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);

      IF r.proname = ANY(service_only) THEN
        -- Deliberadamente SEM authenticated: nenhuma tela do app chama.
        NULL;
      ELSIF tinha_auth THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
      END IF;

      IF r.proname = ANY(keep_anon) THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.sig);
      END IF;
    END;
  END LOOP;
END $$;

-- ============================================================================
-- Defesa em profundidade: as funções que recebem o cliente por PARÂMETRO passam
-- a exigir que ele seja o do próprio chamador. Assim, mesmo que um GRANT volte
-- por engano no futuro, um usuário logado não lê dados de outra clínica.
-- service_role (edge functions) tem auth.uid() nulo e segue livre, como hoje.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.assert_tenant_do_chamador(_tenant uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  -- Sem JWT = chamada interna (service_role): mantém o comportamento atual.
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF has_role(auth.uid(), 'superadmin'::app_role) THEN RETURN; END IF;
  IF _tenant IS NULL OR _tenant <> current_tenant_id() THEN
    RAISE EXCEPTION 'Acesso negado: cliente diferente do seu' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_tenant_do_chamador(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_tenant_do_chamador(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.assert_tenant_do_chamador(uuid) IS
  'Usar no início de toda função SECURITY DEFINER que receba tenant por parâmetro.';
