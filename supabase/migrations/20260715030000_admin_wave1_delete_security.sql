-- ==========================================================================
-- ONDA 1 do painel admin (SaaS): exclusão robusta + soft-delete + segurança
-- ==========================================================================

-- 1) Soft-delete: coluna para a Lixeira. status já suporta 'active'/'paused'/'deleted'.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 2) hard_delete_tenant DATA-DRIVEN (ponto-fixo).
--    Problema antigo: lista fixa de DELETEs deixava de fora tabelas novas
--    (whatsapp_calls, whatsapp_call_permissions, ad_account_map) → o sanity-check
--    via RAISE EXCEPTION dava ROLLBACK e a exclusão falhava inteira. Pior:
--    ad_account_map.clinica_id→clinicas (NO ACTION) quebrava o DELETE de clinicas.
--    Correção: apagar as tabelas FILHAS sem tenant_id por join (como antes) e
--    depois apagar TODAS as tabelas com tenant_id num loop de ponto-fixo que
--    tolera violações de FK (a dependente cai numa passada anterior). Assim
--    nenhuma tabela nova com tenant_id volta a travar a exclusão.
CREATE OR REPLACE FUNCTION public.hard_delete_tenant(_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_ids uuid[];
  v_lead_ids uuid[];
  v_bot_ids uuid[];
  v_clinic_ids uuid[];
  v_paciente_ids uuid[];
  v_pipeline_ids uuid[];
  v_leftover_count int;
  v_deleted bigint;
  v_progress boolean;
  v_pass int;
  r record;
BEGIN
  SELECT COALESCE(array_agg(id), '{}') INTO v_user_ids FROM public.profiles WHERE tenant_id = _tenant_id;
  SELECT COALESCE(array_agg(id), '{}') INTO v_lead_ids FROM public.crm_leads WHERE tenant_id = _tenant_id;
  SELECT COALESCE(array_agg(id), '{}') INTO v_bot_ids FROM public.bots WHERE tenant_id = _tenant_id;
  SELECT COALESCE(array_agg(id), '{}') INTO v_clinic_ids FROM public.clinicas WHERE tenant_id = _tenant_id;
  SELECT COALESCE(array_agg(id), '{}') INTO v_paciente_ids FROM public.pacientes WHERE tenant_id = _tenant_id;
  SELECT COALESCE(array_agg(id), '{}') INTO v_pipeline_ids FROM public.crm_pipelines WHERE tenant_id = _tenant_id;

  BEGIN
    SELECT COALESCE(array_agg(DISTINCT u.id), v_user_ids) INTO v_user_ids
    FROM auth.users u
    WHERE u.id = ANY(v_user_ids)
       OR (u.raw_user_meta_data ->> 'tenant_id') = _tenant_id::text;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- (a) Tabelas FILHAS SEM tenant_id, apagadas por referência às linhas do tenant.
  DELETE FROM public.crm_lead_stage_history WHERE lead_id = ANY(v_lead_ids);
  DELETE FROM public.crm_lead_pacientes WHERE lead_id = ANY(v_lead_ids) OR paciente_id = ANY(v_paciente_ids);
  DELETE FROM public.crm_lead_custom_values WHERE lead_id = ANY(v_lead_ids);
  DELETE FROM public.crm_lead_instagram_identities WHERE lead_id = ANY(v_lead_ids);
  DELETE FROM public.crm_lead_label_assignments WHERE lead_id = ANY(v_lead_ids);
  DELETE FROM public.bot_execution_logs WHERE execution_id IN (SELECT id FROM public.bot_executions WHERE bot_id = ANY(v_bot_ids));
  DELETE FROM public.bot_versions WHERE bot_id = ANY(v_bot_ids);
  DELETE FROM public.bot_stage_triggers WHERE bot_id = ANY(v_bot_ids);
  DELETE FROM public.pagamentos WHERE clinica_id = ANY(v_clinic_ids) OR paciente_id = ANY(v_paciente_ids);
  DELETE FROM public.tratamentos WHERE clinica_id = ANY(v_clinic_ids) OR paciente_id = ANY(v_paciente_ids);
  DELETE FROM public.leads_diarios WHERE clinica_id = ANY(v_clinic_ids);
  DELETE FROM public.registros_diarios_atendimento WHERE clinica_id = ANY(v_clinic_ids);
  DELETE FROM public.crm_funnel_custom_reports WHERE pipeline_id = ANY(v_pipeline_ids);

  -- (b) Ponto-fixo: apaga TODAS as tabelas base com tenant_id (menos 'tenants'),
  --     tolerando FK entre elas. Repete até nenhuma linha ser apagada numa passada.
  FOR v_pass IN 1..50 LOOP
    v_progress := false;
    FOR r IN
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
        AND t.table_type = 'BASE TABLE' AND c.table_name <> 'tenants'
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', r.table_name) USING _tenant_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
        IF v_deleted > 0 THEN v_progress := true; END IF;
      EXCEPTION
        WHEN foreign_key_violation THEN NULL;  -- tenta de novo na próxima passada
      END;
    END LOOP;
    EXIT WHEN NOT v_progress;
  END LOOP;

  -- (c) O tenant por último.
  DELETE FROM public.tenants WHERE id = _tenant_id;

  -- (d) Sanity-check: nenhuma linha do tenant pode sobrar.
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
      AND t.table_type = 'BASE TABLE' AND c.table_name <> 'tenants'
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = $1', r.table_name)
      INTO v_leftover_count USING _tenant_id;
    IF v_leftover_count > 0 THEN
      RAISE EXCEPTION 'hard_delete_tenant: sobrou % linhas em public.% para tenant % (provável tabela filha sem tenant_id bloqueando por FK)', v_leftover_count, r.table_name, _tenant_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('user_ids', v_user_ids);
END;
$function$;

-- 3) SEGURANÇA — RLS de user_roles vazava entre tenants: 4 policies antigas
--    sem filtro de tenant (combinadas por OR permitiam qualquer 'crc' ler/gravar
--    papéis de QUALQUER cliente). Remover; sobram user_roles_same_tenant (ALL,
--    já checa tenant/superadmin) e "Users can view own roles".
DROP POLICY IF EXISTS "Admins can view roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;

-- 4) SEGURANÇA — impedir auto-desbloqueio / troca de tenant pelo próprio usuário.
--    A policy "Users can update own profile" não restringe colunas; sem isto o
--    usuário dá UPDATE em is_blocked=false (ou muda tenant_id) via PostgREST.
CREATE OR REPLACE FUNCTION public.prevent_self_privilege_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Só restringe quando o PRÓPRIO usuário edita seu perfil. Admin/superadmin e
  -- service_role (auth.uid() nulo ou <> id) seguem livres.
  IF auth.uid() = NEW.id THEN
    IF NEW.is_blocked IS DISTINCT FROM OLD.is_blocked
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'Alteração não permitida: is_blocked/tenant_id do próprio perfil';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prevent_self_privilege_change ON public.profiles;
CREATE TRIGGER trg_prevent_self_privilege_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_privilege_change();
