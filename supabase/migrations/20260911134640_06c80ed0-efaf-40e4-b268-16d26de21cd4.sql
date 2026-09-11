-- =============================================================================
-- Os leads do Instagram passam a aparecer para TODAS as SDRs.
--
-- PEDIDO DO DONO (11/09/2026): "Os leads do instagram não estão aparecendo para
-- as sdrs, não precisa fazer distribuição neles apenas deixar aparecer pra todo
-- mundo."
--
-- POR QUE NÃO APARECIAM. Duas travas somadas, e as duas de propósito:
--   1. As SDRs não tinham acesso ao FUNIL. sdr_prepara_novo_membro e
--      sdr_concede_funil_novo (20260908150000) concedem override de pipeline
--      para todo funil geral do cliente, mas excluem explicitamente
--      is_instagram. Sem o override, a policy "Users can view allowed pipelines"
--      não passa e a coluna nem aparece no Kanban.
--   2. As SDRs não enxergavam os LEADS. A RESTRICTIVE sdr_escopo_crm_leads_select
--      diz que quem carrega o papel sdr só lê lead com assigned_to = auth.uid(),
--      e os 1.278 leads do funil Instagram estão TODOS sem dona.
--
-- O QUE MUDA, E O QUE NÃO MUDA. O funil do Instagram vira uma CAIXA COMUM: toda
-- SDR vê, lê a conversa, agenda e move entre as etapas DAQUELE funil. Ninguém se
-- apropria: o lead continua sem dona, e é isso que o mantém visível para todas.
-- A distribuição automática continua sem tocar no Instagram — rodizio_lead_na_fila
-- já exige ig_account_uuid IS NULL e rodizio_definir_funis recusa funil de
-- Instagram; nada disso é alterado aqui, como o dono pediu.
--
-- POR QUE EDITAR UMA POLICY EXISTENTE, contra a regra deste projeto. Policies
-- RESTRICTIVE se somam com E, então não existe "acrescentar uma permissão": para
-- abrir uma exceção é preciso mexer na própria expressão. A alternativa seria
-- carimbar dona nos leads do Instagram, que é exatamente a distribuição que o
-- dono NÃO quer. As duas policies trocadas aqui continuam RESTRICTIVE, continuam
-- negando por padrão, e a exceção é estreita: só funil marcado is_instagram, só
-- lead sem dona, só do próprio cliente.
--
-- O CRÉDITO DO AGENDAMENTO continua de quem agendou: crm_appointments carimba
-- responsavel_credito_id por gatilho com quem fez a ação, então a SDR que marcar
-- a consulta de um lead do Instagram leva o comparecimento dela no relatório.
-- =============================================================================

-- ============================================================ 1. a régua
-- Lead que está num funil de Instagram do MESMO cliente e ainda não tem dona.
-- Ter dona tira da caixa comum de propósito: lead com dona é de quem o tem, e
-- essa é a regra que protege o trabalho de cada SDR.
CREATE OR REPLACE FUNCTION public.lead_da_caixa_do_instagram(_lead_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_leads l
      JOIN public.crm_pipelines p ON p.id = l.pipeline_id
     WHERE l.id = _lead_id
       AND l.tenant_id = public.current_tenant_id()
       AND COALESCE(p.is_instagram, false)
       AND l.assigned_to IS NULL);
$fn$;
REVOKE ALL ON FUNCTION public.lead_da_caixa_do_instagram(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_da_caixa_do_instagram(uuid) TO authenticated, service_role;

-- ============================================================ 2. o ponto único
-- sdr_pode_ver_lead é a régua de TODAS as outras telas da SDR: mensagens
-- (sdr_escopo_messages_select/_insert/_update), agendamentos
-- (sdr_escopo_crm_appointments) e tarefas (sdr_escopo_crm_tasks) chamam esta
-- função. Abrindo aqui, a conversa, a agenda e as tarefas do lead do Instagram
-- funcionam de uma vez — sem mexer em mais nenhuma policy dessas três tabelas.
CREATE OR REPLACE FUNCTION public.sdr_pode_ver_lead(_lead_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT _lead_id IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND (
       EXISTS (
         SELECT 1 FROM public.crm_leads l
          WHERE l.id = _lead_id
            AND l.assigned_to = auth.uid()
            AND l.tenant_id = public.current_tenant_id()
       )
       OR public.lead_da_caixa_do_instagram(_lead_id)
     );
$fn$;

-- Auxiliar das duas policies abaixo. Fica separada de
-- lead_da_caixa_do_instagram porque ali dentro da policy o lead é a PRÓPRIA linha
-- sendo avaliada: consultar crm_leads de novo dali seria recursão.
CREATE OR REPLACE FUNCTION public.funil_e_instagram(_pipeline_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_pipelines p
     WHERE p.id = _pipeline_id
       AND p.tenant_id = public.current_tenant_id()
       AND COALESCE(p.is_instagram, false));
$fn$;
REVOKE ALL ON FUNCTION public.funil_e_instagram(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.funil_e_instagram(uuid) TO authenticated, service_role;

-- ============================================================ 3. ver o lead na lista
DROP POLICY IF EXISTS sdr_escopo_crm_leads_select ON public.crm_leads;
CREATE POLICY sdr_escopo_crm_leads_select ON public.crm_leads
  AS RESTRICTIVE FOR SELECT TO public
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
    OR assigned_to = auth.uid()
    OR (assigned_to IS NULL AND public.funil_e_instagram(pipeline_id))
  );

-- ============================================================ 4. trabalhar o lead
-- USING diz o que ela pode pegar para editar; WITH CHECK diz como a linha pode
-- FICAR. O WITH CHECK é o que impede a apropriação: depois do UPDATE o lead
-- continua sem dona e continua no funil do Instagram. Ou seja, ela move entre as
-- etapas daquele funil, mas não carimba o próprio nome nem leva o lead embora —
-- se pudesse, o lead sumiria para as colegas e a caixa comum deixaria de ser
-- comum no primeiro clique.
DROP POLICY IF EXISTS sdr_escopo_crm_leads_update ON public.crm_leads;
CREATE POLICY sdr_escopo_crm_leads_update ON public.crm_leads
  AS RESTRICTIVE FOR UPDATE TO public
  USING (
    (SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
    OR assigned_to = auth.uid()
    OR (assigned_to IS NULL AND public.funil_e_instagram(pipeline_id))
  )
  WITH CHECK (
    (SELECT NOT public.has_role(auth.uid(), 'sdr'::app_role))
    OR assigned_to = auth.uid()
    OR (assigned_to IS NULL AND public.funil_e_instagram(pipeline_id))
  );

-- ============================================================ 4b. a caixa continua comum
-- POR QUE UM GATILHO, E NÃO O WITH CHECK DA POLICY. O WITH CHECK só enxerga a
-- linha NOVA, então ele não distingue "este lead já era dela" de "ela acabou de
-- se apropriar": nos dois casos a linha nova tem assigned_to = auth.uid() e o
-- ramo normal da policy aprova. Medido em cluster de teste: com a policy
-- sozinha, a SDR carimbava o próprio nome no lead do Instagram e ele sumia para
-- as colegas — a caixa comum deixava de ser comum no primeiro clique.
--
-- O gatilho compara OLD com NEW, que é o que o caso pede. Ele sai cedo quando o
-- lead JÁ tinha dona (OLD.assigned_to IS NOT NULL), então lead do Instagram que
-- o administrador transferir para alguém continua funcionando normalmente para
-- essa pessoa; e sai cedo quando quem escreve é o servidor (auth.uid() nulo),
-- para não atrapalhar cron, webhook nem edge function.
--
-- O gatilho de propriedade que já existe (protege_propriedade_lead) NÃO cobre
-- este caso: ele só age quando OLD.assigned_to não é nulo E é de uma SDR. Aqui
-- o lead está justamente sem dona.
CREATE OR REPLACE FUNCTION public.protege_caixa_do_instagram()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF OLD.assigned_to IS NOT NULL THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NOT public.has_role(auth.uid(), 'sdr'::app_role) THEN RETURN NEW; END IF;
  IF NOT public.funil_e_instagram(OLD.pipeline_id) THEN RETURN NEW; END IF;

  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    RAISE EXCEPTION 'O lead do Instagram fica visível para a equipe toda e por isso não tem responsável. Se precisar passar para alguém, peça ao administrador.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id THEN
    RAISE EXCEPTION 'O lead do Instagram não sai do funil do Instagram por aqui. Se precisar movê-lo de funil, peça ao administrador.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_zz_caixa_do_instagram ON public.crm_leads;
CREATE TRIGGER trg_zz_caixa_do_instagram BEFORE UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.protege_caixa_do_instagram();

-- ============================================================ 5. enxergar o funil
-- Sem o override a coluna não aparece no Kanban, por mais que os leads estejam
-- liberados. Concede para as SDRs que já existem...
INSERT INTO public.user_permission_overrides (user_id, scope, resource_id, granted, created_by)
SELECT DISTINCT ur.user_id, 'pipeline', p.id::text, true, NULL::uuid
  FROM public.user_roles ur
  JOIN public.profiles pf ON pf.id = ur.user_id
  JOIN public.crm_pipelines p ON p.tenant_id = pf.tenant_id
 WHERE ur.role = 'sdr'::app_role
   AND COALESCE(p.is_instagram, false)
ON CONFLICT (user_id, scope, resource_id) DO NOTHING;

-- ...e para as que vierem depois: as duas funções que concedem acesso a funil
-- excluíam is_instagram explicitamente. Corpo copiado de 20260908150000 com essa
-- única linha removida em cada uma.
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
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.sdr_concede_funil_novo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.allowed_roles IS NOT NULL
     OR COALESCE(NEW.is_posvenda, false)
     -- is_instagram deixou de ser exceção em 11/09/2026 (pedido do dono).
     OR NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.user_permission_overrides (user_id, scope, resource_id, granted, created_by)
  SELECT DISTINCT ur.user_id, 'pipeline', NEW.id::text, true, auth.uid()
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE ur.role = 'sdr'::app_role
     AND p.tenant_id = NEW.tenant_id
  ON CONFLICT (user_id, scope, resource_id) DO NOTHING;
  RETURN NEW;
END $fn$;

-- =============================================================================
-- VERIFICAÇÃO (só leitura, depois de aplicar)
--
-- 1. As duas policies continuam RESTRICTIVE e nenhuma outra sumiu (eram 618):
-- SELECT policyname, permissive, cmd FROM pg_policies
--  WHERE tablename='crm_leads' AND policyname LIKE 'sdr_escopo%' ORDER BY 1;
-- SELECT count(*) FROM pg_policies WHERE schemaname IN ('public','storage');
--
-- 2. As SDRs ganharam o funil:
-- SELECT pf.nome FROM public.user_permission_overrides o
--   JOIN public.profiles pf ON pf.id = o.user_id
--  WHERE o.scope='pipeline' AND o.granted
--    AND o.resource_id = 'c2d3e4f5-0001-4000-8000-000000000002';
--
-- 3. ENSAIO, emulando a Bia (tudo desfeito pelo RAISE). O caso que NÃO pode
--    passar é o do meio: ver lead de outra SDR.
-- DO $t$
-- DECLARE
--   v_bia uuid := '9c32408d-d852-4c55-9637-b30a59a16c13';
--   v_ju  uuid := '602e63f5-1c67-4f4a-9f4d-9f44b7923721';
--   v_ig uuid; v_dela uuid; v_da_colega uuid; n integer; rep text := E'\n';
-- BEGIN
--   SELECT id INTO v_ig FROM public.crm_leads
--    WHERE pipeline_id='c2d3e4f5-0001-4000-8000-000000000002' AND assigned_to IS NULL LIMIT 1;
--   PERFORM set_config('rodizio.autorizado','sim',true);
--   INSERT INTO public.crm_leads (tenant_id,name,phone,pipeline_id,stage_id,source,assigned_to,distribuido_em)
--   SELECT '00000000-0000-0000-0000-000000000010','ENSAIO da colega','5577900000099',
--          'a1b2c3d4-0001-4000-8000-000000000001', s.id,'whatsapp', v_ju, now()
--     FROM public.crm_stages s WHERE s.pipeline_id='a1b2c3d4-0001-4000-8000-000000000001'
--      AND public.normaliza_nome_etapa(s.name)='conversando' LIMIT 1
--   RETURNING id INTO v_da_colega;
--   PERFORM set_config('request.jwt.claims',
--     json_build_object('sub', v_bia, 'role','authenticated')::text, true);
--   EXECUTE 'SET LOCAL ROLE authenticated';
--   SELECT count(*) INTO n FROM public.crm_leads WHERE id = v_ig;
--   rep := rep || '1 Bia ve lead do Instagram sem dona: ' || n || ' (esperado 1)' || E'\n';
--   SELECT count(*) INTO n FROM public.crm_leads WHERE id = v_da_colega;
--   rep := rep || '2 Bia ve lead da Julia: ' || n || ' (esperado 0)' || E'\n';
--   SELECT count(*) INTO n FROM public.messages WHERE lead_id = v_ig;
--   rep := rep || '3 Bia ve a conversa do lead do Instagram: ' || n || ' mensagens' || E'\n';
--   BEGIN UPDATE public.crm_leads SET assigned_to = v_bia WHERE id = v_ig;
--         GET DIAGNOSTICS n = ROW_COUNT;
--         rep := rep || '4 Bia se apropria do lead do Instagram: ' || n || ' (esperado 0)' || E'\n';
--   EXCEPTION WHEN OTHERS THEN rep := rep || '4 apropriacao: recusada' || E'\n'; END;
--   EXECUTE 'RESET ROLE';
--   RAISE EXCEPTION 'ENSAIO INSTAGRAM (desfeito): %', rep;
-- END $t$;
-- =============================================================================