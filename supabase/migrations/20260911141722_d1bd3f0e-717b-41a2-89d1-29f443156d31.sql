-- =============================================================================
-- A SDR passa a LER (só ler) as contas e as mensagens do Instagram.
--
-- POR QUE FALTAVA. A migration 20260911010000 abriu os LEADS do funil do
-- Instagram para as SDRs, mas duas RESTRICTIVE continuaram fechando o resto:
--   sdr_sem_acesso_ig_accounts        (FOR ALL)
--   sdr_sem_acesso_instagram_messages (FOR ALL)
-- Com elas, a aba abre e a conversa aparece, mas a tela não consegue dizer de
-- QUAL das quatro contas o lead veio, e o chat não resolve a conta de origem
-- para responder. Ou seja: a aba apareceria pela metade — que é a mesma coisa
-- que o dono reclamou no botão AUTOMATIZE, um recurso que abre e não serve.
--
-- O QUE MUDA. Só LEITURA, e só do que ela já pode ver:
--   - ig_accounts: SELECT das contas do próprio cliente. É o nome e a foto da
--     conta na tela. O access_token continua numa coluna que a tela não lê, e
--     escrever continua proibido.
--   - instagram_messages: SELECT das linhas cujo LEAD ela pode abrir, pela mesma
--     régua de sempre (public.sdr_pode_ver_lead). Escrever continua proibido —
--     quem grava é a edge function, com service_role, que não passa por RLS.
--
-- POR QUE TROCAR AS POLICIES EM VEZ DE ACRESCENTAR. As duas são RESTRICTIVE, e
-- RESTRICTIVE se soma com E: não existe acrescentar permissão por fora. As
-- substitutas continuam RESTRICTIVE e continuam negando por padrão; o que muda é
-- que a negação deixa de ser total e passa a ter a exceção de leitura acima.
-- Nenhuma outra policy é tocada.
-- =============================================================================

-- ============================================================ 1. as contas
DROP POLICY IF EXISTS sdr_sem_acesso_ig_accounts ON public.ig_accounts;

-- Ler: pode, do próprio cliente.
CREATE POLICY sdr_le_ig_accounts ON public.ig_accounts
  AS RESTRICTIVE FOR SELECT TO public
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
    OR tenant_id = public.current_tenant_id()
  );

-- Escrever: continua proibido, nos três verbos. Sem estas três, o DROP acima
-- teria aberto INSERT, UPDATE e DELETE para a SDR — era isso que o FOR ALL
-- segurava.
CREATE POLICY sdr_sem_insert_ig_accounts ON public.ig_accounts
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)));
CREATE POLICY sdr_sem_update_ig_accounts ON public.ig_accounts
  AS RESTRICTIVE FOR UPDATE TO public
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)));
CREATE POLICY sdr_sem_delete_ig_accounts ON public.ig_accounts
  AS RESTRICTIVE FOR DELETE TO public
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)));

-- ============================================================ 2. as mensagens
DROP POLICY IF EXISTS sdr_sem_acesso_instagram_messages ON public.instagram_messages;

-- Ler: só as linhas do lead que ela pode abrir. lead_id nulo (mensagem ainda não
-- ligada a lead nenhum) fica de fora: não há a quem pertencer.
CREATE POLICY sdr_le_instagram_messages ON public.instagram_messages
  AS RESTRICTIVE FOR SELECT TO public
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
    OR (lead_id IS NOT NULL AND public.sdr_pode_ver_lead(lead_id))
  );

CREATE POLICY sdr_sem_insert_instagram_messages ON public.instagram_messages
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)));
CREATE POLICY sdr_sem_update_instagram_messages ON public.instagram_messages
  AS RESTRICTIVE FOR UPDATE TO public
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)));
CREATE POLICY sdr_sem_delete_instagram_messages ON public.instagram_messages
  AS RESTRICTIVE FOR DELETE TO public
  USING ((SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role)));

-- =============================================================================
-- VERIFICAÇÃO (só leitura, depois de aplicar)
--
-- 1. As oito policies entraram e continuam RESTRICTIVE:
-- SELECT tablename, policyname, cmd FROM pg_policies
--  WHERE policyname LIKE 'sdr_le_%' OR policyname LIKE 'sdr_sem_%ig%' ORDER BY 1,2;
--
-- 2. ENSAIO, emulando a Bia (desfeito pelo RAISE):
-- DO $t$
-- DECLARE v_bia uuid := '9c32408d-d852-4c55-9637-b30a59a16c13'; n integer; rep text := E'\n';
-- BEGIN
--   PERFORM set_config('request.jwt.claims',
--     json_build_object('sub', v_bia, 'role','authenticated')::text, true);
--   EXECUTE 'SET LOCAL ROLE authenticated';
--   SELECT count(*) INTO n FROM public.ig_accounts;
--   rep := rep || '1 contas do Instagram que ela ve: ' || n || ' (esperado 4)' || E'\n';
--   SELECT count(*) INTO n FROM public.instagram_messages im
--     JOIN public.crm_leads l ON l.id = im.lead_id
--    WHERE l.pipeline_id = 'c2d3e4f5-0001-4000-8000-000000000002';
--   rep := rep || '2 mensagens do funil do Instagram: ' || n || ' (esperado > 0)' || E'\n';
--   BEGIN UPDATE public.ig_accounts SET username = 'x' WHERE true;
--         GET DIAGNOSTICS n = ROW_COUNT;
--         rep := rep || '3 ela EDITA conta do Instagram: ' || n || ' (esperado 0)' || E'\n';
--   EXCEPTION WHEN OTHERS THEN rep := rep || '3 editar conta: recusado' || E'\n'; END;
--   EXECUTE 'RESET ROLE';
--   RAISE EXCEPTION 'ENSAIO LEITURA IG (desfeito): %', rep;
-- END $t$;
-- =============================================================================