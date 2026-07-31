-- ============================================================================
-- HARDENING 1/3 — Fecha as funções internas para quem NÃO está logado.
-- ============================================================================
DO $$
DECLARE
  r record;
  keep_anon text[] := ARRAY['get_tenant_by_slug'];
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
       AND p.prosecdef
       AND p.prokind = 'f'
  LOOP
    DECLARE
      tinha_auth boolean := has_function_privilege('authenticated', r.oid, 'EXECUTE');
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);

      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);

      IF r.proname = ANY(service_only) THEN
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

CREATE OR REPLACE FUNCTION public.assert_tenant_do_chamador(_tenant uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
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