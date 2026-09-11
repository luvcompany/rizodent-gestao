-- =============================================================================
-- A SDR ganha acesso às CONTAS do Instagram do próprio cliente.
--
-- A última peça da aba do Instagram. Depois de 20260911010000 (leads) e
-- 20260911040000 (leitura de contas e mensagens), a Bia via 1.232 dos 1.278
-- leads do funil — faltavam exatamente os 46 que têm ig_account_uuid preenchido,
-- ou seja, os leads em que o sistema sabe de QUAL das quatro contas vieram.
--
-- O corte vinha da PERMISSIVE de SELECT de crm_leads, que exige
-- can_access_instagram_account(ig_account_uuid). Essa função só passa para
-- superadmin, crc, gerente — ou para quem tem override da conta. A SDR não tinha
-- nenhum dos quatro. Note que ela é PERMISSIVE: sem ela, nenhuma linha aparece,
-- por mais que as RESTRICTIVE deixem passar.
--
-- Concede o override das contas do cliente para quem tem papel sdr. É o mesmo
-- instrumento já usado para funil (user_permission_overrides, scope 'pipeline'),
-- agora com scope 'instagram_account'. ON CONFLICT DO NOTHING respeita decisão
-- anterior: se um superadmin tiver revogado a conta para alguém (granted=false),
-- a revogação fica de pé.
--
-- Isto NÃO dá à SDR o token nem o direito de escrever em ig_accounts — a
-- 20260911040000 deixou a escrita fechada nos três verbos.
-- =============================================================================

INSERT INTO public.user_permission_overrides (user_id, scope, resource_id, granted, created_by)
SELECT DISTINCT ur.user_id, 'instagram_account', a.id::text, true, NULL::uuid
  FROM public.user_roles ur
  JOIN public.profiles pf ON pf.id = ur.user_id
  JOIN public.ig_accounts a ON a.tenant_id = pf.tenant_id
 WHERE ur.role = 'sdr'::app_role
ON CONFLICT (user_id, scope, resource_id) DO NOTHING;

-- SDR nova entra com as contas já liberadas. Corpo de 20260911010000 com o bloco
-- das contas acrescentado; o resto é igual.
CREATE OR REPLACE FUNCTION public.sdr_prepara_novo_membro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_tenant uuid;
BEGIN
  IF NEW.role <> 'sdr'::app_role THEN RETURN NEW; END IF;
  -- tenant vem do PERFIL (set_tenant_id_default cai no tenant Rizodent quando
  -- o servidor não manda tenant_id — o perfil é a fonte confiável).
  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = NEW.user_id;
  IF v_tenant IS NULL THEN v_tenant := NEW.tenant_id; END IF;
  IF v_tenant IS NULL THEN RETURN NEW; END IF;

  -- Membro do rodízio nasce INATIVO: o gestor liga pela aba Equipe.
  INSERT INTO public.crm_rodizio_membros (tenant_id, user_id, ativo)
  VALUES (v_tenant, NEW.user_id, false)
  ON CONFLICT (tenant_id, user_id) DO NOTHING;

  INSERT INTO public.user_permission_overrides (user_id, scope, resource_id, granted, created_by)
  SELECT NEW.user_id, 'pipeline', p.id::text, true, auth.uid()
    FROM public.crm_pipelines p
   WHERE p.tenant_id = v_tenant
     AND p.allowed_roles IS NULL
     AND NOT COALESCE(p.is_posvenda, false)
     -- is_instagram deixou de ser exceção em 11/09/2026 (pedido do dono).
  ON CONFLICT (user_id, scope, resource_id) DO NOTHING;

  -- Contas do Instagram: sem isto ela vê o funil mas não os leads em que o
  -- sistema já identificou a conta de origem.
  INSERT INTO public.user_permission_overrides (user_id, scope, resource_id, granted, created_by)
  SELECT NEW.user_id, 'instagram_account', a.id::text, true, auth.uid()
    FROM public.ig_accounts a
   WHERE a.tenant_id = v_tenant
  ON CONFLICT (user_id, scope, resource_id) DO NOTHING;

  RETURN NEW;
END $fn$;

-- Conta de Instagram nova → as SDRs do cliente ganham na hora, no mesmo espírito
-- do gatilho que faz isso para funil geral.
CREATE OR REPLACE FUNCTION public.sdr_concede_conta_ig_nova()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.user_permission_overrides (user_id, scope, resource_id, granted, created_by)
  SELECT DISTINCT ur.user_id, 'instagram_account', NEW.id::text, true, auth.uid()
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE ur.role = 'sdr'::app_role
     AND p.tenant_id = NEW.tenant_id
  ON CONFLICT (user_id, scope, resource_id) DO NOTHING;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_sdr_concede_conta_ig_nova ON public.ig_accounts;
CREATE TRIGGER trg_sdr_concede_conta_ig_nova AFTER INSERT ON public.ig_accounts
  FOR EACH ROW EXECUTE FUNCTION public.sdr_concede_conta_ig_nova();

-- =============================================================================
-- VERIFICAÇÃO (só leitura, depois de aplicar)
--
-- SELECT pf.nome, count(*) AS contas_liberadas
--   FROM public.user_permission_overrides o
--   JOIN public.profiles pf ON pf.id = o.user_id
--  WHERE o.scope='instagram_account' AND o.granted
--  GROUP BY pf.nome ORDER BY pf.nome;
--
-- ENSAIO (desfeito): a Bia passa a ver os 1.278, e não 1.232.
-- DO $t$
-- DECLARE n integer; rep text := E'\n';
-- BEGIN
--   PERFORM set_config('request.jwt.claims',
--     json_build_object('sub','9c32408d-d852-4c55-9637-b30a59a16c13','role','authenticated')::text, true);
--   EXECUTE 'SET LOCAL ROLE authenticated';
--   SELECT count(*) INTO n FROM public.crm_leads
--    WHERE pipeline_id='c2d3e4f5-0001-4000-8000-000000000002';
--   rep := rep || 'leads do Instagram que ela ve: ' || n || ' (esperado 1278)' || E'\n';
--   EXECUTE 'RESET ROLE';
--   RAISE EXCEPTION '%', rep;
-- END $t$;
-- =============================================================================
